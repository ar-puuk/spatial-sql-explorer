// Runs an export plan on the query session's exclusive, cancellable
// connection (spec 005 research §1, §3, §7). Engine formats are written by
// DuckDB COPY into the in-memory file system under the already-allowed source
// directory, copied out, and always dropped. GeoParquet is written as WKB with
// our own `geo` metadata, because DuckDB's default makes QGIS read projected
// data as WGS84.
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { SOURCE_DIR } from '../duckdbService.js'
import { singleRow, streamRows } from '../query/util.js'
import { exportFormat } from './formats.js'
import { writeGeoJson } from './geojson.js'
import type { ExportPlan } from './plan.js'
import { projjsonFor } from './projjson.js'

export interface ExportHooks {
  /** Rows written so far, or null while an engine COPY runs (no row progress). */
  onProgress?(rowsWritten: number | null): void
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
  const col = plan.format === 'geojson' ? '"__se_geojson"' : plan.format === 'csv' && plan.csvGeometry === 'xy' ? null : `"${plan.geometryColumn}"`
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

export async function runExport(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  plan: ExportPlan,
  isCancelled: () => boolean,
  hooks: ExportHooks = {}
): Promise<ExportResult> {
  if (plan.blocked) throw new Error(plan.blocked)
  const format = exportFormat(plan.format)

  if (plan.format === 'geojson') {
    const { bytes, rows, empty } = await writeGeoJson(conn, plan, isCancelled, hooks.onProgress)
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
