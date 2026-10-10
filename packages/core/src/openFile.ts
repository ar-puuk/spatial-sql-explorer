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

/** Builds the SQL FROM-source expression for a given read strategy. */
async function buildFromExpr(conn: AsyncDuckDBConnection, strategy: ReadStrategy, vfsPath: string): Promise<{ fromExpr: string; geomExpr: string }> {
  switch (strategy) {
    case 'st_read':
      return { fromExpr: `ST_Read('${vfsPath}')`, geomExpr: 'geom' }
    case 'parquet':
      // GeoParquet convention: a "geometry" column storing WKB bytes (per
      // the GeoParquet spec's default primary column name). Real-world files
      // with a differently-named primary geometry column are a known
      // limitation of this heuristic.
      return { fromExpr: `read_parquet('${vfsPath}')`, geomExpr: 'ST_GeomFromWKB(geometry)' }
    case 'csv': {
      // Heuristic column detection, per spec.md's assumption ("CSV with
      // coordinate columns or WKT"). Tries common lon/lat name variants
      // first, then a WKT column. Must pick ONE geomExpr referencing only
      // columns that actually exist: a real browser run surfaced "Referenced
      // column 'longitude' not found" — DuckDB binds every column named in a
      // CASE/COALESCE expression at bind time regardless of which branch
      // would execute, so a single static expression referencing all three
      // naming variants fails outright on a CSV that only has `lon`/`lat`.
      const fromExpr = `read_csv_auto('${vfsPath}')`
      const describeRes = await conn.query(`DESCRIBE SELECT * FROM ${fromExpr}`)
      const columns = new Set(describeRes.toArray().map((r) => String(r.toJSON().column_name).toLowerCase()))
      if (columns.has('lon') && columns.has('lat')) {
        return { fromExpr, geomExpr: 'ST_Point(lon, lat)' }
      }
      if (columns.has('longitude') && columns.has('latitude')) {
        return { fromExpr, geomExpr: 'ST_Point(longitude, latitude)' }
      }
      if (columns.has('wkt')) {
        return { fromExpr, geomExpr: 'ST_GeomFromText(wkt)' }
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
 * `read_parquet`/`read_csv_auto` (the `parquet`/`csv` strategies) expose no
 * comparable CRS metadata, and a non-EPSG authority (rare, e.g. an ESRI-only
 * WKID) can't be fed back into `ST_Transform`'s `'EPSG:<code>'` source-CRS
 * argument — both fall back to `null` (WGS84 assumed, disclosed via
 * `crsAssumed`), the same honest fallback FR-015 already requires when a
 * file truly has no CRS.
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
async function attributeProjection(conn: AsyncDuckDBConnection, strategy: ReadStrategy, fromExpr: string): Promise<string> {
  const describeRes = await conn.query(`DESCRIBE SELECT * FROM ${fromExpr}`)
  const columns = new Set(describeRes.toArray().map((r) => String(r.toJSON().column_name)))
  const exclude = ['geom_']
  if (strategy === 'st_read') {
    if (columns.has('geom')) exclude.push('geom')
    if (columns.has('OGC_FID')) exclude.push('OGC_FID')
  } else if (strategy === 'parquet' && columns.has('geometry')) {
    exclude.push('geometry')
  }
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

  try {
    registered = await registerSourceFiles(db, dataFiles)
    const vfsPath = `/tmp/${source.primaryFileName}`
    const { fromExpr, geomExpr: rawGeomExpr } = await buildFromExpr(conn, strategy, vfsPath)
    const sourceSrid = await detectSourceSrid(conn, vfsPath, strategy)
    // Every query below reads this already-reprojected expression, so
    // Layer.extent and every Feature.geometry are WGS84 from here on, while
    // Layer.sourceCrs (below) still reports the file's real, original CRS.
    const geomExpr = reprojectToWgs84Sql(rawGeomExpr, sourceSrid)

    // Total valid feature count (FR-006's "feature count", independent of
    // the load cap) and invalid-geometry count (FR-014), in one pass.
    const countRes = await conn.query(`
      SELECT
        COUNT(*) FILTER (WHERE geom_ IS NOT NULL AND ST_IsValid(geom_)) AS valid_count,
        COUNT(*) FILTER (WHERE geom_ IS NULL OR NOT ST_IsValid(geom_)) AS invalid_count
      FROM (SELECT ${geomExpr} AS geom_ FROM ${fromExpr})
    `)
    const countRow = countRes.toArray()[0]?.toJSON() as { valid_count: bigint | number; invalid_count: bigint | number }
    const featureCount = Number(countRow.valid_count)
    const invalidGeometryCount = Number(countRow.invalid_count)

    // Full-source extent (FR-003/FR-019: must reflect the whole source, not
    // just the loaded/capped subset).
    const extentRes = await conn.query(`
      SELECT MIN(ST_XMin(geom_)) AS min_x, MIN(ST_YMin(geom_)) AS min_y,
             MAX(ST_XMax(geom_)) AS max_x, MAX(ST_YMax(geom_)) AS max_y
      FROM (SELECT ${geomExpr} AS geom_ FROM ${fromExpr})
      WHERE geom_ IS NOT NULL AND ST_IsValid(geom_)
    `)
    const extentRow = extentRes.toArray()[0]?.toJSON() as {
      min_x: number | null
      min_y: number | null
      max_x: number | null
      max_y: number | null
    }
    const extent: Bbox | null =
      extentRow.min_x === null ? null : [extentRow.min_x, extentRow.min_y!, extentRow.max_x!, extentRow.max_y!]

    // Geometry type mix, from valid geometries only.
    const typesRes = await conn.query(`
      SELECT DISTINCT ST_GeometryType(geom_) AS gtype
      FROM (SELECT ${geomExpr} AS geom_ FROM ${fromExpr})
      WHERE geom_ IS NOT NULL AND ST_IsValid(geom_)
    `)
    const rawTypes = typesRes.toArray().map((r) => String(r.toJSON().gtype))
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
    const exclude = await attributeProjection(conn, strategy, fromExpr)
    const rowsRes = await conn.query(`
      SELECT * EXCLUDE (${exclude}), ST_AsGeoJSON(geom_) AS __geom_geojson
      FROM (SELECT *, ${geomExpr} AS geom_ FROM ${fromExpr})
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
    }
    return layer
  } finally {
    // The shared instance stays alive for the next open; this file's bytes
    // don't. Everything the viewer needs (at most DEFAULT_FEATURE_CAP
    // features) is materialized above, so the registered buffers are pure
    // WASM-heap weight against the ~512 MB ceiling (CLAUDE.md).
    await conn.close().catch(() => {})
    for (const path of registered) await db.dropFile(path).catch(() => {})
  }
}
