// Open-file -> parse pipeline (T024). HostAdapter.getFileSource -> DuckDB
// ST_Read/read_parquet -> populate Layer/Feature, per data-model.md.
//
// Format detection is by file extension for spec 001 (simple, adequate for
// the MVP; content-sniffing can be added later if needed). Per FR-018
// (research.md §1 "T006 resolution"), only formats genuinely verified
// readable against the real eh-bundle WASM build are handled here: GeoJSON,
// CSV (coordinate columns), GeoParquet, FlatGeobuf, GeoPackage, Shapefile,
// GML. Shapefile needs its sidecar files (.shx/.dbf/.prj) — see
// HostAdapter.getFileSource's multi-file FileSource shape.

import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { HostAdapter, OpenedFileRef } from './hostAdapter.js'
import { getDuckDb, type DuckDbAssetUrls } from './duckdbService.js'
import { sidecarStyleFileName } from './style/index.js'
import { reprojectToWgs84Sql, resolveCrsInfo } from './crs.js'
import {
  DEFAULT_FEATURE_CAP,
  type Bbox,
  type CrsInfo,
  type Feature,
  type GeometryType,
  type Layer,
} from './models.js'

export interface OpenFileDeps {
  hostAdapter: HostAdapter
  duckdbAssets: DuckDbAssetUrls
}

type ReadStrategy = 'st_read' | 'parquet' | 'csv' | 'unsupported'

function detectStrategy(fileName: string): ReadStrategy {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.parquet') || lower.endsWith('.geoparquet')) return 'parquet'
  if (lower.endsWith('.csv')) return 'csv'
  if (
    lower.endsWith('.geojson') ||
    lower.endsWith('.json') ||
    lower.endsWith('.fgb') ||
    lower.endsWith('.flatgeobuf') ||
    lower.endsWith('.gpkg') ||
    lower.endsWith('.shp') ||
    lower.endsWith('.gml')
  ) {
    return 'st_read'
  }
  return 'unsupported'
}

/** Normalizes a DuckDB spatial geometry-type string to this project's GeometryType. */
function normalizeGeometryType(raw: string): Exclude<GeometryType, 'Mixed'> | null {
  const upper = raw.toUpperCase()
  if (upper.includes('POINT')) return 'Point'
  if (upper.includes('LINESTRING') || upper.includes('LINE')) return 'LineString'
  if (upper.includes('POLYGON')) return 'Polygon'
  return null
}

const STYLE_SIDECAR_EXTENSIONS = ['.qml', '.sld']

/**
 * Splits off the QGIS-convention style sidecar (`<basename>.qml`, see
 * style/index.ts) before anything is handed to DuckDB: registerFileBuffer
 * transfers (detaches) the bytes, so they can't be read afterwards. Other
 * style files are skipped too; they're never data.
 */
function takeStyleSidecar(
  files: Record<string, ArrayBuffer>,
  primaryFileName: string
): { dataFiles: Record<string, ArrayBuffer>; styleSidecar: Layer['styleSidecar'] } {
  const wanted = sidecarStyleFileName(primaryFileName).toLowerCase()
  const dataFiles: Record<string, ArrayBuffer> = {}
  let styleSidecar: Layer['styleSidecar'] = null
  for (const [name, bytes] of Object.entries(files)) {
    const lower = name.toLowerCase()
    if (name !== primaryFileName && STYLE_SIDECAR_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      if (lower === wanted) styleSidecar = { fileName: name, text: new TextDecoder().decode(bytes) }
      continue
    }
    dataFiles[name] = bytes
  }
  return { dataFiles, styleSidecar }
}

async function registerSourceFiles(db: AsyncDuckDB, files: Record<string, ArrayBuffer>): Promise<string[]> {
  const paths: string[] = []
  for (const [name, bytes] of Object.entries(files)) {
    const path = `/tmp/${name}`
    await db.registerFileBuffer(path, new Uint8Array(bytes))
    paths.push(path)
  }
  return paths
}

interface FromExpr {
  fromExpr: string
  /** SQL yielding a GEOMETRY in the source CRS. */
  geomExpr: string
  /** The source column holding geometry, excluded from attributes. */
  geometryColumn: string | null
  /** Source CRS when the strategy itself knows it (GeoParquet); undefined = ask ST_Read_Meta. */
  srid?: number | null
  /** Source column names from the one DESCRIBE each open runs (every ST_Read bind re-ingests the file). */
  columns: string[]
}

async function describeColumns(conn: AsyncDuckDBConnection, fromExpr: string): Promise<Array<{ name: string; type: string }>> {
  const res = await conn.query(`DESCRIBE SELECT * FROM ${fromExpr}`)
  return res.toArray().map((r) => {
    const row = r.toJSON() as { column_name: string; column_type: string }
    return { name: String(row.column_name), type: String(row.column_type) }
  })
}

/** `EPSG:<code>` from a DuckDB GEOMETRY type (`GEOMETRY('EPSG:4326')`) or a PROJJSON `id`. */
function epsgFrom(text: string | null | undefined): number | null {
  const m = /EPSG[:"\s,]*(?:code"?\s*:\s*)?(\d{4,6})/i.exec(text ?? '')
  return m ? Number(m[1]) : null
}

/**
 * GeoParquet (https://geoparquet.org): the `geo` key-value metadata names the
 * primary geometry column and its CRS (PROJJSON; absent = OGC:CRS84, i.e.
 * WGS84 lon/lat). With the spatial extension loaded, current DuckDB already
 * decodes that column to GEOMETRY, typed with its CRS: calling
 * ST_GeomFromWKB on it fails, which broke every real GeoParquet file until
 * this was fixed (research.md §9). Plain Parquet with a WKB BLOB column
 * still goes through ST_GeomFromWKB.
 */
async function geoParquetFromExpr(conn: AsyncDuckDBConnection, vfsPath: string, materialize: boolean): Promise<FromExpr> {
  const fromExpr = await readerSource(conn, `read_parquet('${vfsPath}')`, materialize)
  const columns = await describeColumns(conn, fromExpr)

  let primary: string | null = null
  let metaSrid: number | null | undefined
  try {
    const meta = await conn.query(`SELECT decode(value) AS geo FROM parquet_kv_metadata('${vfsPath}') WHERE decode(key) = 'geo'`)
    const raw = meta.toArray()[0]?.toJSON().geo as string | undefined
    if (raw) {
      const geo = JSON.parse(raw) as { primary_column?: string; columns?: Record<string, { crs?: unknown }> }
      primary = geo.primary_column ?? null
      const crs = primary ? geo.columns?.[primary]?.crs : undefined
      // GeoParquet: an absent crs means OGC:CRS84 (WGS84 lon/lat), stated, not assumed.
      metaSrid = crs === undefined ? 4326 : crs === null ? null : epsgFrom(JSON.stringify((crs as { id?: unknown }).id ?? crs))
    }
  } catch {
    // Not GeoParquet metadata we can read; fall back to column types.
  }

  const pick =
    columns.find((c) => c.name === primary) ??
    columns.find((c) => c.type.toUpperCase().startsWith('GEOMETRY')) ??
    columns.find((c) => c.name.toLowerCase() === 'geometry' || c.name.toLowerCase() === 'geom')
  if (!pick) throw new Error('This Parquet file has no geometry column (no GeoParquet metadata, GEOMETRY column, or WKB "geometry" column).')

  const col = quoteIdent(pick.name)
  const names = columns.map((c) => c.name)
  if (pick.type.toUpperCase().startsWith('GEOMETRY')) {
    return { fromExpr, geomExpr: col, geometryColumn: pick.name, srid: epsgFrom(pick.type) ?? metaSrid ?? null, columns: names }
  }
  if (pick.type.toUpperCase() === 'BLOB') {
    return { fromExpr, geomExpr: `ST_GeomFromWKB(${col})`, geometryColumn: pick.name, srid: metaSrid ?? null, columns: names }
  }
  throw new Error(`The Parquet column "${pick.name}" (${pick.type}) is not a geometry or WKB column.`)
}

/**
 * Every ST_Read bind re-ingests the whole file (GDAL parses e.g. GeoJSON
 * completely on open), and an open needs several passes (DESCRIBE, stats,
 * rows). Up to MATERIALIZE_MAX_BYTES the reader's output is parsed exactly
 * once into a temp table, and everything else reads that table; openFile
 * drops it after loading. Larger files stream each pass rather than hold a
 * second full copy against the ~512 MB WASM ceiling (CLAUDE.md performance
 * rules). T046: this took a ~10 MB GeoJSON from 3.2 s to ~1 s warm.
 */
async function readerSource(conn: AsyncDuckDBConnection, reader: string, materialize: boolean): Promise<string> {
  if (!materialize) return reader
  await conn.query(`CREATE OR REPLACE TEMP TABLE ${TEMP_TABLE} AS SELECT * FROM ${reader}`)
  return TEMP_TABLE
}

/** Builds the SQL FROM-source expression for a given read strategy. */
async function buildFromExpr(conn: AsyncDuckDBConnection, strategy: ReadStrategy, vfsPath: string, materialize: boolean): Promise<FromExpr> {
  switch (strategy) {
    case 'st_read': {
      // ST_Read keeps the source's geometry field name: `geom` for most
      // drivers, but e.g. GML exposes `geometryProperty` (a hard-coded `geom`
      // broke every GML file; research.md §9). Use the GEOMETRY-typed column.
      const fromExpr = await readerSource(conn, `ST_Read('${vfsPath}')`, materialize)
      const columns = await describeColumns(conn, fromExpr)
      const geometry = columns.find((c) => c.type.toUpperCase().startsWith('GEOMETRY'))
      if (!geometry) throw new Error('This file has no geometry column.')
      // Current DuckDB types the column with its CRS (`GEOMETRY('EPSG:4326')`),
      // which saves the ST_Read_Meta call, itself another full ingest of the
      // file. A plain GEOMETRY type falls back to ST_Read_Meta.
      const typed = epsgFrom(geometry.type)
      return {
        fromExpr,
        geomExpr: quoteIdent(geometry.name),
        geometryColumn: geometry.name,
        columns: columns.map((c) => c.name),
        ...(typed !== null ? { srid: typed } : {}),
      }
    }
    case 'parquet':
      return geoParquetFromExpr(conn, vfsPath, materialize)
    case 'csv': {
      // Heuristic column detection, per spec.md's assumption ("CSV with
      // coordinate columns or WKT"). Tries common lon/lat name variants
      // first, then a WKT column. Must pick ONE geomExpr referencing only
      // columns that actually exist: a real browser run surfaced "Referenced
      // column 'longitude' not found" — DuckDB binds every column named in a
      // CASE/COALESCE expression at bind time regardless of which branch
      // would execute, so a single static expression referencing all three
      // naming variants fails outright on a CSV that only has `lon`/`lat`.
      const fromExpr = await readerSource(conn, `read_csv_auto('${vfsPath}')`, materialize)
      const names = (await describeColumns(conn, fromExpr)).map((c) => c.name)
      const columns = new Set(names.map((n) => n.toLowerCase()))
      if (columns.has('lon') && columns.has('lat')) {
        return { fromExpr, geomExpr: 'ST_Point(lon, lat)', geometryColumn: null, srid: null, columns: names }
      }
      if (columns.has('longitude') && columns.has('latitude')) {
        return { fromExpr, geomExpr: 'ST_Point(longitude, latitude)', geometryColumn: null, srid: null, columns: names }
      }
      if (columns.has('wkt')) {
        return { fromExpr, geomExpr: 'ST_GeomFromText(wkt)', geometryColumn: null, srid: null, columns: names }
      }
      throw new Error('CSV file has no recognized coordinate columns (lon/lat, longitude/latitude, or wkt).')
    }
    case 'unsupported':
      throw new Error('Unsupported file format')
  }
}

/**
 * Reads the source CRS's EPSG code for `st_read`-backed formats (GeoJSON,
 * FlatGeobuf, GeoPackage, Shapefile, GML) via `ST_Read_Meta`'s nested
 * `layers[1].geometry_fields[1].crs` struct, selecting only its scalar
 * `auth_name`/`auth_code` leaves (a real `duckdb` CLI spike confirmed: this
 * is populated and correct for every `st_read` format spec 001 supports,
 * contradicting an earlier, mistaken assumption that it wasn't — see
 * research.md §5). `layers[1]`/`geometry_fields[1]` match this project's
 * existing "first layer only" scope decision, consistent with `buildFromExpr`
 * calling `ST_Read` without an explicit `layer=` argument.
 *
 * GeoParquet's CRS comes from its own metadata instead (geoParquetFromExpr);
 * CSV has none. A non-EPSG authority (rare, e.g. an ESRI-only WKID) can't be
 * fed back into `ST_Transform`'s `'EPSG:<code>'` source-CRS argument, so it
 * falls back to `null` (WGS84 assumed, disclosed via `crsAssumed`), the same
 * honest fallback FR-015 already requires when a file truly has no CRS.
 */
async function detectSourceSrid(conn: AsyncDuckDBConnection, vfsPath: string, strategy: ReadStrategy): Promise<number | null> {
  if (strategy !== 'st_read') return null
  const metaRes = await conn.query(`
    SELECT layers[1].geometry_fields[1].crs.auth_name AS auth_name,
           layers[1].geometry_fields[1].crs.auth_code AS auth_code
    FROM ST_Read_Meta('${vfsPath}')
  `)
  const row = metaRes.toArray()[0]?.toJSON() as { auth_name: string | null; auth_code: string | null } | undefined
  if (!row || row.auth_name !== 'EPSG' || !row.auth_code) return null
  const srid = Number(row.auth_code)
  return Number.isFinite(srid) ? srid : null
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Which source columns become attributes. Two things must not:
 * - The source geometry column (`geom` from ST_Read, `geometry` in
 *   GeoParquet). It arrives as raw WKB bytes and would show up in the table
 *   as `{"0":1,"1":3,...}`. The reprojected `geom_` is excluded likewise.
 * - `OGC_FID`, the synthetic feature id GDAL's Arrow stream adds for formats
 *   without a native FID (GeoJSON, FlatGeobuf, Shapefile, GML). It is not an
 *   OGR field: a real `duckdb` run fails with "Cannot find OGR field for
 *   Arrow array OGC_FID" (GeoLibre hit the same duplicate, #499). It is just
 *   0..n-1, which the table already shows as its row number, and QGIS
 *   doesn't show it either. GeoPackage's real primary key arrives as `fid`
 *   instead and is kept, as in QGIS.
 */
function attributeProjection(strategy: ReadStrategy, source: FromExpr): string {
  const columns = new Set(source.columns)
  const exclude = ['geom_']
  if (source.geometryColumn && columns.has(source.geometryColumn)) exclude.push(source.geometryColumn)
  if (strategy === 'st_read' && columns.has('OGC_FID')) exclude.push('OGC_FID')
  return exclude.map(quoteIdent).join(', ')
}

/**
 * DuckDB-WASM returns BIGINT columns as native JS `bigint` values, which
 * `JSON.stringify`-based serialization (used internally by MapLibre's
 * actor/worker messaging, confirmed via a real browser error: "can't
 * serialize object of type bigint") cannot handle. Converts each `bigint` to
 * a `number` when it safely fits, otherwise to a `string`, so
 * `Feature.attributes` is always safe to pass to `MapView`/MapLibre.
 */
function sanitizeAttributes(raw: Record<string, unknown>): Feature['attributes'] {
  const result: Feature['attributes'] = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'bigint') {
      result[key] = Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
    } else {
      result[key] = value as Feature['attributes'][string]
    }
  }
  return result
}

/** Files up to this size are parsed once into a temp table (see openFile). */
const MATERIALIZE_MAX_BYTES = 64 * 1024 * 1024
const TEMP_TABLE = '__se_layer'

export async function openFile(ref: OpenedFileRef, deps: OpenFileDeps): Promise<Layer> {
  const { hostAdapter, duckdbAssets } = deps
  const source = await hostAdapter.getFileSource(ref)
  const strategy = detectStrategy(source.primaryFileName)
  if (strategy === 'unsupported') {
    throw new Error(
      `"${ref.displayName}" is not a supported format. Spec 001 supports GeoJSON, CSV, GeoParquet, FlatGeobuf, GeoPackage, Shapefile, and GML.`
    )
  }

  const { dataFiles, styleSidecar } = takeStyleSidecar(source.files, source.primaryFileName)
  const db = await getDuckDb(duckdbAssets)
  const conn: AsyncDuckDBConnection = await db.connect()
  let registered: string[] = []
  let materialized = false

  // Per-step timings, surfaced in the VS Code output channel.
  const timings: Record<string, number> = {}
  let mark = performance.now()
  const lap = (): number => {
    const now = performance.now()
    const ms = Math.round(now - mark)
    mark = now
    return ms
  }

  try {
    registered = await registerSourceFiles(db, dataFiles)
    const vfsPath = `/tmp/${source.primaryFileName}`
    materialized = source.totalBytes <= MATERIALIZE_MAX_BYTES
    const read = await buildFromExpr(conn, strategy, vfsPath, materialized)
    const { fromExpr, geomExpr: rawGeomExpr } = read
    const sourceSrid = read.srid !== undefined ? read.srid : await detectSourceSrid(conn, vfsPath, strategy)
    // Every query below reads this already-reprojected expression, so
    // Layer.extent and every Feature.geometry are WGS84 from here on, while
    // Layer.sourceCrs (below) still reports the file's real, original CRS.
    const geomExpr = reprojectToWgs84Sql(rawGeomExpr, sourceSrid)

    const base = `(SELECT *, ${geomExpr} AS geom_ FROM ${fromExpr})`
    timings.prepare = lap()

    // One scan for everything the metadata needs: valid / invalid counts
    // (FR-006, FR-014), the full-source extent (FR-003/FR-019: the whole
    // source, not the capped subset) and the geometry-type mix (FR-013).
    // These used to be three separate queries, and every ST_Read bind
    // re-ingests the whole file, so a ~10 MB GeoJSON was parsed several times
    // over (T046 measured 3.2 s; SC-001 asks for 2 s).
    const statsRes = await conn.query(`
      SELECT
        COUNT(*) FILTER (WHERE valid) AS valid_count,
        COUNT(*) FILTER (WHERE NOT valid) AS invalid_count,
        MIN(ST_XMin(g)) FILTER (WHERE valid) AS min_x, MIN(ST_YMin(g)) FILTER (WHERE valid) AS min_y,
        MAX(ST_XMax(g)) FILTER (WHERE valid) AS max_x, MAX(ST_YMax(g)) FILTER (WHERE valid) AS max_y,
        list(DISTINCT ST_GeometryType(g)) FILTER (WHERE valid) AS gtypes
      FROM (SELECT geom_ AS g, (geom_ IS NOT NULL AND ST_IsValid(geom_)) AS valid FROM ${base})
    `)
    const stats = statsRes.toArray()[0]?.toJSON() as {
      valid_count: bigint | number
      invalid_count: bigint | number
      min_x: number | null
      min_y: number | null
      max_x: number | null
      max_y: number | null
      gtypes: { toArray?: () => unknown[] } | unknown[] | null
    }
    timings.scan = lap()
    const featureCount = Number(stats.valid_count)
    const invalidGeometryCount = Number(stats.invalid_count)
    const extent: Bbox | null =
      stats.min_x === null || stats.min_y === null || stats.max_x === null || stats.max_y === null ? null : [stats.min_x, stats.min_y, stats.max_x, stats.max_y]
    const rawTypes = (Array.isArray(stats.gtypes) ? stats.gtypes : (stats.gtypes?.toArray?.() ?? [])).map(String)
    const normalizedTypes = new Set(rawTypes.map(normalizeGeometryType).filter((t): t is Exclude<GeometryType, 'Mixed'> => t !== null))
    const geometryType: GeometryType = normalizedTypes.size > 1 ? 'Mixed' : [...normalizedTypes][0] ?? 'Point'

    // Report the file's real, original source CRS (FR-007) — never the
    // WGS84 `geomExpr` has already reprojected everything else to.
    const crsResolution = resolveCrsInfo(sourceSrid)
    const sourceCrs: CrsInfo = crsResolution.crs
    const crsAssumed = crsResolution.assumed

    // Load at most DEFAULT_FEATURE_CAP features (FR-019). Geometry is
    // serialized to GeoJSON in SQL via ST_AsGeoJSON — DuckDB spatial's
    // native GEOMETRY type does not have a well-defined JS-side
    // representation once it crosses the Arrow boundary, so this is the
    // reliable way to get a real GeoJSON.Geometry on the JS side.
    const exclude = attributeProjection(strategy, read)
    const rowsRes = await conn.query(`
      SELECT * EXCLUDE (${exclude}), ST_AsGeoJSON(geom_) AS __geom_geojson
      FROM ${base}
      WHERE geom_ IS NOT NULL AND ST_IsValid(geom_)
      LIMIT ${DEFAULT_FEATURE_CAP}
    `)
    const rawRows = rowsRes.toArray().map((r) => r.toJSON())
    const features: Feature[] = rawRows.map((row, index) => {
      const { __geom_geojson, ...rawAttributes } = row as Record<string, unknown>
      return {
        id: index,
        geometry: __geom_geojson ? (JSON.parse(String(__geom_geojson)) as GeoJSON.Geometry) : null,
        attributes: sanitizeAttributes(rawAttributes),
      }
    })

    timings.rows = lap()

    const layer: Layer = {
      id: ref.id,
      sourceUri: ref.id,
      sourceFormat: strategy,
      geometryType,
      sourceCrs,
      crsAssumed,
      featureCount,
      invalidGeometryCount,
      truncated: featureCount > DEFAULT_FEATURE_CAP,
      extent,
      features,
      styleSidecar,
      loadTimings: timings,
    }
    return layer
  } finally {
    // The shared instance stays alive for the next open; this file's bytes
    // don't. Everything the viewer needs (at most DEFAULT_FEATURE_CAP
    // features) is materialized above, so the registered buffers are pure
    // WASM-heap weight against the ~512 MB ceiling (CLAUDE.md).
    if (materialized) await conn.query(`DROP TABLE IF EXISTS ${TEMP_TABLE}`).catch(() => {})
    await conn.close().catch(() => {})
    for (const path of registered) await db.dropFile(path).catch(() => {})
  }
}
