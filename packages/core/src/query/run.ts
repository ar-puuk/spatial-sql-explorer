// The result pipeline shared by the initial view and every user query
// (spec 002 research §5). The statement executes ONCE, into __se_result;
// every later pass (describe, stats, rows) reads that table, the parse-once
// lesson from spec 001. Every step goes through the streaming API, so a
// cancel lands wherever the work is (research §1).
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { reprojectToWgs84Sql, resolveCrsInfo } from '../crs.js'
import type { Bbox, CrsInfo, Feature, GeometryType, Layer, QueryableTable, ResultCrsSource } from '../models.js'
import { geometryTypeOf, quoteIdent, sanitizeAttributes, singleRow, streamRows, yieldToUi } from './util.js'

export const RESULT_TABLE = '__se_result'
/** Rows longer than this in "other" geometry columns are cut in the table (WKT can be huge). */
const OTHER_GEOMETRY_TEXT_MAX = 200

export interface ResultCrs {
  crs: CrsInfo
  srid: number | null
  source: ResultCrsSource
}

export interface BuildContext {
  conn: AsyncDuckDBConnection
  table: QueryableTable
  isCancelled: () => boolean
  /** Decides the result CRS from the raw (pre-reprojection) extent and the engine type (research §4). */
  resolveCrs: (input: { engineType: string; rawExtent: Bbox | null }) => ResultCrs
  /** FR-012: asked only above the threshold; returns how many rows to fetch, or null to cancel. */
  limitRows: (rowCount: number) => Promise<number | null>
  onProgress?: (fetched: number, total: number) => void
}

export interface BuiltResult {
  layer: Omit<Layer, 'id' | 'sourceUri' | 'sourceFormat' | 'source' | 'styleSidecar'>
  geometryColumn: string | null
  otherGeometryColumns: string[]
  resultCrs: ResultCrs | null
  truncatedTo: number | null
  /** Rows the query returned before any "Show first 50,000" truncation. */
  totalRows: number
}

/** Result of the size check: the user declined to render. */
export class ResultDeclinedError extends Error {}

const isGeometryType = (type: string): boolean => type.toUpperCase().startsWith('GEOMETRY')

const bbox = (r: { min_x: number | null; min_y: number | null; max_x: number | null; max_y: number | null }): Bbox | null =>
  r.min_x === null || r.min_y === null || r.max_x === null || r.max_y === null ? null : [r.min_x, r.min_y, r.max_x, r.max_y]

/**
 * Materializes a query statement into __se_result and builds the displayed
 * layer from it. `statement` must already be classified as a `query`. A
 * newline separates it from the CTAS prefix so engine error positions stay
 * mappable (line n in the error = line n-1 of the statement; research §8).
 */
export async function buildQueryResult(ctx: BuildContext, statement: string): Promise<BuiltResult> {
  const { conn, isCancelled } = ctx
  await streamRows(conn, `CREATE OR REPLACE TEMP TABLE ${RESULT_TABLE} AS\n${statement}`, isCancelled)

  const columns: Array<{ name: string; type: string }> = []
  await streamRows(conn, `DESCRIBE ${RESULT_TABLE}`, isCancelled, (rows) => {
    for (const r of rows) columns.push({ name: String(r.column_name), type: String(r.column_type) })
  })
  const geometryColumns = columns.filter((c) => isGeometryType(c.type))
  const primary = geometryColumns[0] ?? null
  const others = geometryColumns.slice(1).map((c) => c.name)

  // One stats pass: counts, raw extent (for CRS detection) and types.
  const g = primary ? quoteIdent(primary.name) : null
  const stats = await singleRow<{
    n: bigint | number
    valid: bigint | number | null
    min_x: number | null
    min_y: number | null
    max_x: number | null
    max_y: number | null
    gtypes: unknown
  }>(
    conn,
    g
      ? `SELECT count(*) AS n,
           count(*) FILTER (WHERE ok) AS valid,
           min(ST_XMin(${g})) FILTER (WHERE ok) AS min_x, min(ST_YMin(${g})) FILTER (WHERE ok) AS min_y,
           max(ST_XMax(${g})) FILTER (WHERE ok) AS max_x, max(ST_YMax(${g})) FILTER (WHERE ok) AS max_y,
           list(DISTINCT ST_GeometryType(${g})::VARCHAR) FILTER (WHERE ok) AS gtypes
         FROM (SELECT ${g}, (${g} IS NOT NULL AND ST_IsValid(${g})) AS ok FROM ${RESULT_TABLE})`
      : `SELECT count(*) AS n, NULL AS valid, NULL AS min_x, NULL AS min_y, NULL AS max_x, NULL AS max_y, NULL AS gtypes FROM ${RESULT_TABLE}`,
    isCancelled
  )
  const rowCount = Number(stats.n)
  const featureCount = primary ? Number(stats.valid ?? 0) : 0
  const resultCrs = primary ? ctx.resolveCrs({ engineType: primary.type, rawExtent: bbox(stats) }) : null

  // FR-012: ask before fetching more than the threshold.
  const limit = await ctx.limitRows(rowCount)
  if (limit === null) throw new ResultDeclinedError()
  const truncatedTo = limit < rowCount ? limit : null

  // WGS84 extent of what's displayed, for fit-to-extent.
  let extent: Bbox | null = null
  const wgs = g && resultCrs ? reprojectToWgs84Sql(g, resultCrs.srid) : null
  if (g && wgs && featureCount > 0) {
    const e = await singleRow<{ min_x: number | null; min_y: number | null; max_x: number | null; max_y: number | null }>(
      conn,
      `SELECT min(ST_XMin(w)) AS min_x, min(ST_YMin(w)) AS min_y, max(ST_XMax(w)) AS max_x, max(ST_YMax(w)) AS max_y
       FROM (SELECT ${wgs} AS w FROM (SELECT * FROM ${RESULT_TABLE} LIMIT ${limit}) WHERE ${g} IS NOT NULL AND ST_IsValid(${g}))`,
      isCancelled
    )
    extent = bbox(e)
  }

  // Rows: attributes, other geometries as text, primary geometry as WGS84 GeoJSON.
  const select = columns
    .filter((c) => c !== primary)
    .map((c) => (isGeometryType(c.type) ? `left(ST_AsText(${quoteIdent(c.name)}), ${OTHER_GEOMETRY_TEXT_MAX}) AS ${quoteIdent(c.name)}` : quoteIdent(c.name)))
  if (g && wgs) select.push(`CASE WHEN ${g} IS NOT NULL AND ST_IsValid(${g}) THEN ST_AsGeoJSON(${wgs}) END AS __se_geojson`)
  const features: Feature[] = []
  const fetchTotal = Math.min(rowCount, limit)
  await streamRows(conn, `SELECT ${select.length ? select.join(', ') : '*'} FROM ${RESULT_TABLE} LIMIT ${limit}`, isCancelled, async (rows) => {
    for (const row of rows) {
      const { __se_geojson, ...attributes } = row
      features.push({
        id: features.length,
        geometry: __se_geojson ? (JSON.parse(String(__se_geojson)) as GeoJSON.Geometry) : null,
        attributes: sanitizeAttributes(attributes),
      })
    }
    ctx.onProgress?.(features.length, fetchTotal)
    await yieldToUi()
  })

  const mapped = truncatedTo === null ? featureCount : features.filter((f) => f.geometry !== null).length
  const geometryType: GeometryType = primary ? geometryTypeOf(stats.gtypes) : 'Point'
  return {
    layer: {
      geometryType,
      sourceCrs: resultCrs?.crs ?? ctx.table.crs,
      crsAssumed: resultCrs ? resultCrs.source === 'layer' && ctx.table.crsAssumed : false,
      rowCount: features.length,
      featureCount: mapped,
      invalidGeometryCount: primary ? features.length - mapped : 0,
      truncated: truncatedTo !== null,
      extent,
      features,
    },
    geometryColumn: primary?.name ?? null,
    otherGeometryColumns: others,
    resultCrs,
    truncatedTo,
    totalRows: rowCount,
  }
}

/** The table's own CRS: the fallback (and, until T017, the only) result CRS. */
export function layerCrs(table: QueryableTable): ResultCrs {
  return { crs: table.srid === null ? resolveCrsInfo(null).crs : table.crs, srid: table.srid, source: 'layer' }
}
