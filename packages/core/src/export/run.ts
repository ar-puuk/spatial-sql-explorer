// Runs an export plan on the query session's exclusive, cancellable
// connection (spec 005 research §1, §3, §7). Engine formats are written by
// DuckDB COPY into the in-memory file system under the already-allowed source
// directory, copied out, and always dropped. GeoParquet is written as WKB with
// our own `geo` metadata, because DuckDB's default makes QGIS read projected
// data as WGS84.
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { SOURCE_DIR } from '../duckdbService.js'
import type { Geometry } from 'geojson'
import { singleRow, streamRows, yieldToUi } from '../query/util.js'
import { exportFormat } from './formats.js'
import { writeGeoJson } from './geojson.js'
import { GEOJSON_JSON_PREFIX, type ExportPlan } from './plan.js'
import { projjsonFor, wktFor } from './projjson.js'
import { writerColumnsOf, type RowWriter } from './writers/common.js'
import { kmlWriter } from './writers/kml.js'
import { flatGeobufWriter } from './writers/flatgeobuf.js'
import { shapefileWriter } from './writers/shapefile.js'
import { xlsxWriter } from './writers/xlsx.js'
import { geoPackageWriter } from './writers/geopackage.js'

export interface ExportHooks {
  /** Rows written so far, or null while an engine COPY runs (no row progress). */
  onProgress?(rowsWritten: number | null): void
}

/** Spec 008: what JS writers need from the shell. */
export interface ExportAssets {
  /** sql.js's wasm, for GeoPackage (research §3). */
  /** Spec 008 research §15: sql.js's wasm, downloaded and hash-checked on first use. */
  loadSqlWasm?: () => Promise<ArrayBuffer>
}

export interface ExportResult {
  bytes: Uint8Array
  rows: number
  /** The plan's notices, made exact where the run learned more (e.g. empty geometries). */
  notices: string[]
}

let counter = 0
/** In-memory target for one export; `__se_` names are protected from user DDL. */
export function exportTarget(extension: string): string {
  counter += 1
  return `${SOURCE_DIR}__se_export-${counter}${extension}`
}

/** COPY options per format (research §2/§3). */
export function copyOptions(format: ExportPlan['format'], geo?: string): string {
  if (format === 'csv') return '(FORMAT CSV, HEADER)'
  if (format === 'json') return '(FORMAT JSON, ARRAY true)'
  if (format === 'geojsonseq') return '(FORMAT JSON)'
  const kv = geo ? `, KV_METADATA {geo: '${geo.replace(/'/g, "''")}'}` : ''
  return `(FORMAT PARQUET, GEOPARQUET_VERSION 'NONE'${kv})`
}

/** GeoParquet geometry type names from ST_GeometryType's. */
const GEOPARQUET_TYPES: Record<string, string> = {
  POINT: 'Point',
  LINESTRING: 'LineString',
  POLYGON: 'Polygon',
  MULTIPOINT: 'MultiPoint',
  MULTILINESTRING: 'MultiLineString',
  MULTIPOLYGON: 'MultiPolygon',
  GEOMETRYCOLLECTION: 'GeometryCollection',
}

/** The GeoParquet 1.1 `geo` metadata for the exported geometry column. */
async function geoMetadata(db: AsyncDuckDB, conn: AsyncDuckDBConnection, plan: ExportPlan, isCancelled: () => boolean): Promise<string> {
  const g = `"${plan.geometryColumn}"`
  const stats = await singleRow<{ types: unknown; minx: number | null; miny: number | null; maxx: number | null; maxy: number | null }>(
    conn,
    `SELECT list(DISTINCT ST_GeometryType(geo)::VARCHAR) AS types, min(ST_XMin(geo)) AS minx, min(ST_YMin(geo)) AS miny, max(ST_XMax(geo)) AS maxx, max(ST_YMax(geo)) AS maxy
     FROM (SELECT ST_GeomFromWKB(${g}) AS geo FROM (${plan.sql}) WHERE ${g} IS NOT NULL)`,
    isCancelled
  )
  const raw = Array.isArray(stats.types) ? stats.types : ((stats.types as { toArray?: () => unknown[] } | null)?.toArray?.() ?? [])
  const types = [...new Set(raw.map((t) => GEOPARQUET_TYPES[String(t).toUpperCase()]).filter(Boolean))].sort()
  const column: Record<string, unknown> = { encoding: 'WKB', geometry_types: types }
  if (stats.minx !== null && stats.miny !== null && stats.maxx !== null && stats.maxy !== null) column.bbox = [stats.minx, stats.miny, stats.maxx, stats.maxy]
  // WGS84 lon/lat is GeoParquet's default (OGC:CRS84): no `crs` member.
  if (plan.crs.srid !== null && plan.crs.srid !== 4326) column.crs = await projjsonFor(db, conn, plan.crs.srid, isCancelled)
  return JSON.stringify({ version: '1.1.0', primary_column: plan.geometryColumn, columns: { [plan.geometryColumn as string]: column } })
}

/** Rows written without a geometry (missing or invalid in the source). */
async function emptyGeometries(conn: AsyncDuckDBConnection, plan: ExportPlan, isCancelled: () => boolean): Promise<number> {
  if (!plan.geometryColumn || plan.format === 'parquet') return 0
  if (!plan.includeGeometry) return 0
  const col = exportFormat(plan.format).writer === 'js' ? '"__se_geojson"' : plan.format === 'geojsonseq' ? 'geometry' : plan.format === 'csv' && plan.csvGeometry === 'xy' ? null : `"${plan.geometryColumn}"`
  if (!col) return 0 // X/Y: counted through the same CASE guard, reported by the plan
  const row = await singleRow<{ n: bigint | number }>(conn, `SELECT count(*) AS n FROM (${plan.sql}) WHERE ${col} IS NULL`, isCancelled)
  return Number(row.n)
}

function exactNotices(plan: ExportPlan, empty: number): string[] {
  const generic = /^Rows without valid geometry|^\d+ rows? (has|have) no valid geometry/
  const rest = plan.notices.filter((n) => !generic.test(n))
  if (empty > 0) rest.push(`${empty} ${empty === 1 ? 'row has' : 'rows have'} no valid geometry: written with an empty geometry.`)
  return rest
}

/** The base name of the exported file, e.g. `parcels` (a GeoPackage table, a Shapefile's parts). */
const baseOf = (plan: ExportPlan): string => plan.layerName

/** A JS writer for the plan's format (spec 008 research §3). */
async function writerFor(db: AsyncDuckDB, conn: AsyncDuckDBConnection, plan: ExportPlan, assets: ExportAssets, isCancelled: () => boolean): Promise<RowWriter> {
  const columns = writerColumnsOf(plan.writerColumns)
  // Unknown CRS: the viewer assumed WGS84 (crsAssumed), so the files say so too.
  const srid = plan.crs.srid ?? 4326
  switch (plan.format) {
    case 'kml':
      return kmlWriter(columns, baseOf(plan))
    case 'flatgeobuf':
      return flatGeobufWriter(columns, srid)
    case 'shapefile':
      return shapefileWriter(columns, baseOf(plan), await wktFor(db, conn, srid, isCancelled).catch(() => null))
    case 'xlsx':
      return xlsxWriter(columns)
    case 'geopackage': {
      if (!assets.loadSqlWasm) throw new Error('GeoPackage export is not available in this build (sql.js is missing).')
      return geoPackageWriter(columns, {
        table: baseOf(plan),
        geometryColumn: plan.geometryColumn ?? 'geom',
        srid,
        wkt: await wktFor(db, conn, srid, isCancelled).catch(() => null),
        loadSqlWasm: assets.loadSqlWasm,
      })
    }
    default:
      throw new Error(`No writer for ${plan.format}.`)
  }
}

/**
 * Rows of the plan's SQL, fed to a JS writer batch by batch (the UI gets a
 * turn between batches). Geometry arrives as GeoJSON text, nested values as
 * JSON text under a marked name; both are parsed here.
 */
async function runWriter(conn: AsyncDuckDBConnection, plan: ExportPlan, writer: RowWriter, isCancelled: () => boolean, onProgress?: (rows: number) => void): Promise<{ bytes: Uint8Array; rows: number; empty: number }> {
  const keys = plan.writerColumns.map((c) => c.name)
  let rows = 0
  let empty = 0
  await streamRows(conn, plan.sql, isCancelled, async (batch) => {
    for (const row of batch) {
      const values = keys.map((k) => {
        if (k in row) return row[k]
        const nested = row[GEOJSON_JSON_PREFIX + k]
        return nested === null || nested === undefined ? null : JSON.parse(String(nested))
      })
      const text = row.__se_geojson
      const geometry = plan.includeGeometry && text !== null && text !== undefined ? (JSON.parse(String(text)) as Geometry) : null
      if (plan.includeGeometry && !geometry) empty++
      writer.add({ values, geometry })
      rows++
    }
    onProgress?.(rows)
    await yieldToUi()
  })
  return { bytes: await writer.finish(), rows, empty }
}

export async function runExport(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  plan: ExportPlan,
  isCancelled: () => boolean,
  hooks: ExportHooks = {},
  assets: ExportAssets = {}
): Promise<ExportResult> {
  if (plan.blocked) throw new Error(plan.blocked)
  const format = exportFormat(plan.format)

  if (plan.format === 'geojson') {
    const { bytes, rows, empty } = await writeGeoJson(conn, plan, isCancelled, hooks.onProgress)
    return { bytes, rows, notices: exactNotices(plan, empty) }
  }

  if (format.writer === 'js') {
    const writer = await writerFor(db, conn, plan, assets, isCancelled)
    const { bytes, rows, empty } = await runWriter(conn, plan, writer, isCancelled, hooks.onProgress)
    return { bytes, rows, notices: exactNotices(plan, empty) }
  }

  hooks.onProgress?.(null)
  const target = exportTarget(format.extension)
  try {
    const geo = plan.format === 'geoparquet' ? await geoMetadata(db, conn, plan, isCancelled) : undefined
    let rows = 0
    await streamRows(conn, `COPY (${plan.sql}) TO '${target}' ${copyOptions(plan.format, geo)}`, isCancelled, (batch) => {
      rows = Number(batch[0]?.Count ?? rows)
    })
    const empty = await emptyGeometries(conn, plan, isCancelled)
    const bytes = await db.copyFileToBuffer(target)
    return { bytes, rows, notices: exactNotices(plan, empty) }
  } finally {
    // A cancelled COPY leaves a partial file in memory (research §7).
    await db.dropFile(target).catch(() => {})
  }
}

/** Engine and allocation failures that mean "too big" (FR-011). */
export function exportErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof RangeError || /out of memory|memory limit|could not allocate|allocation failed/i.test(message)) {
    return 'The export ran out of memory. Filter the result or choose GeoParquet (smallest).'
  }
  return message.split('\n')[0]
}
