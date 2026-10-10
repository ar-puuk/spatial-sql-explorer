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
import { getDuckDb, SOURCE_DIR, type DuckDbAssetUrls } from './duckdbService.js'
import { sidecarStyleFileName } from './style/index.js'
import { reprojectToWgs84Sql, resolveCrsInfo } from './crs.js'
import type { Bbox, Layer, QueryableTable } from './models.js'
import { QuerySession, SOURCE_TABLE } from './query/session.js'
import { geometryTypeOf, quoteIdent, singleRow } from './query/util.js'

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
    const path = `${SOURCE_DIR}${name}`
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
  // A regular table, not TEMP: DuckDB temp tables are visible only to the
  // connection that created them, and queries run on the session's own
  // connection (spec 002). QuerySession.dispose() drops it.
  await conn.query(`CREATE OR REPLACE TABLE ${SOURCE_TABLE} AS SELECT * FROM ${reader}`)
  return SOURCE_TABLE
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

/** Files up to this size are parsed once into a table (see readerSource). */
const MATERIALIZE_MAX_BYTES = 64 * 1024 * 1024

/** A file name usable as an unquoted SQL alias for `layer` (e.g. `parcels`). */
async function aliasFor(conn: AsyncDuckDBConnection, primaryFileName: string): Promise<string | null> {
  const base = primaryFileName.replace(/\.[^.]+$/, '')
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(base)) return null
  const lower = base.toLowerCase()
  if (lower === 'layer' || lower.startsWith('__se_')) return null
  const kw = await conn.query(`SELECT count(*) AS n FROM duckdb_keywords() WHERE keyword_name = '${lower}'`)
  return Number(kw.toArray()[0]?.toJSON().n ?? 0) > 0 ? null : base
}

export interface OpenedFile {
  /** The initial view: DEFAULT_QUERY's result, fitted to the whole file. */
  layer: Layer
  /** The viewer's query session over the `layer` view (spec 002). */
  session: QuerySession
}

/**
 * Opens a file as the queryable `layer` view (spec 002 FR-002) and returns
 * the initial view, which is DEFAULT_QUERY run through the same pipeline as
 * every user query (FR-003, SC-002).
 *
 * `layer` is a VIEW so the engine itself refuses writes to it (research §2):
 * - its geometry column is `geom`, in the file's ORIGINAL CRS (FR-014);
 * - GDAL's synthetic OGC_FID is dropped and GeoPackage `fid` is kept (spec 001
 *   attribute rules).
 * It reads a table materialized once (files up to 64 MB) or the reader
 * directly (larger files, which stay readable under the lockdown's
 * allowed_directories).
 */
export async function openFile(ref: OpenedFileRef, deps: OpenFileDeps): Promise<OpenedFile> {
  const { hostAdapter, duckdbAssets } = deps
  const source = await hostAdapter.getFileSource(ref)
  const strategy = detectStrategy(source.primaryFileName)
  if (strategy === 'unsupported') {
    throw new Error(
      `"${ref.displayName}" is not a supported format. Spatial Explorer supports GeoJSON, CSV, GeoParquet, FlatGeobuf, GeoPackage, Shapefile, and GML.`
    )
  }

  const { dataFiles, styleSidecar } = takeStyleSidecar(source.files, source.primaryFileName)
  const db = await getDuckDb(duckdbAssets)
  const conn: AsyncDuckDBConnection = await db.connect()
  let registered: string[] = []
  let session: QuerySession | null = null

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
    const vfsPath = `${SOURCE_DIR}${source.primaryFileName}`
    const materialized = source.totalBytes <= MATERIALIZE_MAX_BYTES
    const read = await buildFromExpr(conn, strategy, vfsPath, materialized)
    const srid = read.srid !== undefined ? read.srid : await detectSourceSrid(conn, vfsPath, strategy)
    const crs = resolveCrsInfo(srid)

    // The `layer` view: attributes, then the geometry as `geom` (source CRS).
    const exclude = [read.geometryColumn, strategy === 'st_read' && read.columns.includes('OGC_FID') ? 'OGC_FID' : null].filter(
      (c): c is string => c !== null && read.columns.includes(c)
    )
    const geomName = read.columns.includes('geom') && read.geometryColumn !== 'geom' ? 'geometry' : 'geom'
    const star = exclude.length ? `* EXCLUDE (${exclude.map(quoteIdent).join(', ')})` : '*'
    await conn.query(`CREATE OR REPLACE VIEW layer AS SELECT ${star}, ${read.geomExpr} AS ${quoteIdent(geomName)} FROM ${read.fromExpr}`)
    const alias = await aliasFor(conn, source.primaryFileName)
    if (alias) await conn.query(`CREATE OR REPLACE VIEW ${quoteIdent(alias)} AS SELECT * FROM layer`)
    timings.prepare = lap()

    // Whole-file metadata in one scan (FR-006): totals, extent in the source
    // CRS (for result-CRS detection) and in WGS84 (for the initial fit), and
    // the geometry type mix.
    const g = quoteIdent(geomName)
    const wgs = reprojectToWgs84Sql(g, srid)
    const stats = await singleRow<{
      n: bigint | number
      valid: bigint | number
      sx0: number | null; sy0: number | null; sx1: number | null; sy1: number | null
      wx0: number | null; wy0: number | null; wx1: number | null; wy1: number | null
      gtypes: unknown
    }>(
      conn,
      `SELECT count(*) AS n, count(*) FILTER (WHERE ok) AS valid,
         min(ST_XMin(${g})) FILTER (WHERE ok) AS sx0, min(ST_YMin(${g})) FILTER (WHERE ok) AS sy0,
         max(ST_XMax(${g})) FILTER (WHERE ok) AS sx1, max(ST_YMax(${g})) FILTER (WHERE ok) AS sy1,
         min(ST_XMin(w)) FILTER (WHERE ok) AS wx0, min(ST_YMin(w)) FILTER (WHERE ok) AS wy0,
         max(ST_XMax(w)) FILTER (WHERE ok) AS wx1, max(ST_YMax(w)) FILTER (WHERE ok) AS wy1,
         list(DISTINCT ST_GeometryType(${g})::VARCHAR) FILTER (WHERE ok) AS gtypes
       FROM (SELECT ${g}, CASE WHEN ok THEN ${wgs} END AS w, ok
             FROM (SELECT ${g}, (${g} IS NOT NULL AND ST_IsValid(${g})) AS ok FROM layer))`,
      () => false
    )
    const box = (a: number | null, b: number | null, c: number | null, d: number | null): Bbox | null =>
      a === null || b === null || c === null || d === null ? null : [a, b, c, d]
    const rows = Number(stats.n)
    const features = Number(stats.valid)
    const columns: QueryableTable['columns'] = []
    const described = await conn.query('DESCRIBE layer')
    for (const r of described.toArray()) {
      const j = r.toJSON() as { column_name: string; column_type: string }
      columns.push({ name: String(j.column_name), type: String(j.column_type) })
    }
    const table: QueryableTable = {
      name: 'layer',
      alias,
      columns,
      crs: crs.crs,
      crsAssumed: crs.assumed,
      srid,
      backing: materialized ? 'materialized' : 'streamed',
      totals: { rows, features, invalid: rows - features },
      extent: box(stats.wx0, stats.wy0, stats.wx1, stats.wy1),
      sourceExtent: box(stats.sx0, stats.sy0, stats.sx1, stats.sy1),
      geometryType: geometryTypeOf(stats.gtypes),
    }
    timings.scan = lap()

    // The initial view IS the default query's result (FR-003, SC-002).
    session = new QuerySession(db, await db.connect(), table, materialized ? [] : registered, hostAdapter.log?.bind(hostAdapter))
    const initial = await session.runDefault()
    timings.rows = lap()

    const layer: Layer = {
      ...initial.layer,
      id: ref.id,
      sourceUri: ref.id,
      sourceFormat: strategy,
      // Spec 001 behavior: fit and type describe the whole file, not just
      // the first 1,000 rows, and "Showing 1,000 of N" is a truncation.
      extent: table.extent,
      geometryType: table.geometryType,
      sourceCrs: table.crs,
      crsAssumed: table.crsAssumed,
      truncated: rows > initial.layer.rowCount,
      source: table.totals,
      styleSidecar,
      loadTimings: timings,
    }
    return { layer, session }
  } catch (err) {
    await session?.dispose().catch(() => {})
    throw err
  } finally {
    await conn.close().catch(() => {})
    // Materialized files' bytes are no longer needed: the WASM heap keeps
    // only the table (~512 MB ceiling, CLAUDE.md). Streamed files stay
    // registered until the session is disposed.
    if (source.totalBytes <= MATERIALIZE_MAX_BYTES) for (const path of registered) await db.dropFile(path).catch(() => {})
  }
}
