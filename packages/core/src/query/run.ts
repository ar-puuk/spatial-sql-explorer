// The result pipeline shared by every user query (spec 002 research §5,
// spec 007 research §9). The statement runs ONCE into __se_result, capped at
// the materialize cap + 1 rows: small results are tables (exact count, fast
// pages, views and styles); bigger ones become a view over the statement,
// so a 3M-row filter isn't copied into memory. No rows are fetched here: the
// table pages them, the map loads them by view, styles aggregate them.
// Every step goes through the streaming API, so a cancel lands wherever the
// work is (research §1).
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { reprojectToWgs84Sql, resolveCrsInfo } from '../crs.js'
import type { Bbox, CrsInfo, GeometryType, Layer, QueryableTable, ResultCrsSource } from '../models.js'
import { materializeCap } from '../source/readModes.js'
import { visibleColumns } from '../source/layerSql.js'
import { dropResultSql, materializeSql, promoteStagingSql, RESULT_STAGING, RESULT_TABLE, reRunsFromPlan, resultViewSql } from './resultModel.js'
import { geometryTypeOf, QueryCancelledError, quoteIdent, singleRow, streamRows } from './util.js'

export { CTAS_PREFIX, RESULT_TABLE } from './resultModel.js'

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
}

export interface BuiltResult {
  layer: Omit<Layer, 'id' | 'sourceUri' | 'sourceFormat' | 'source' | 'styleSidecar'>
  geometryColumn: string | null
  otherGeometryColumns: string[]
  resultCrs: ResultCrs | null
  /** Spec 007: never truncated any more (the large-result prompt is gone, FR-009). Kept for older callers. */
  truncatedTo: null
  /** Rows the query returned: always exact (FR-010). */
  totalRows: number
  /** `layer`: the default view; `table`: materialized; `view`: a big result over the statement. */
  kind: 'layer' | 'table' | 'view'
  /** A big result whose pages and views re-run expensive work (a sort, join or aggregate). */
  reRuns: boolean
}

/** Kept for spec 002 callers: a run the user declined. Nothing raises it since FR-009. */
export class ResultDeclinedError extends Error {}

const isGeometryType = (type: string): boolean => type.toUpperCase().startsWith('GEOMETRY')

const bbox = (r: { min_x: number | null; min_y: number | null; max_x: number | null; max_y: number | null }): Bbox | null =>
  r.min_x === null || r.min_y === null || r.max_x === null || r.max_y === null ? null : [r.min_x, r.min_y, r.max_x, r.max_y]

/**
 * Runs a query statement into __se_result and describes it. `statement` must
 * already be classified as a `query`. Only the first step runs the user's SQL
 * at its original positions (errors stay mappable, research §8).
 */
export async function buildQueryResult(ctx: BuildContext, statement: string): Promise<BuiltResult> {
  const { conn, isCancelled } = ctx
  const cap = materializeCap()
  await streamRows(conn, materializeSql(statement, cap), isCancelled)
  try {
    const n = await singleRow<{ n: bigint | number }>(conn, `SELECT count(*) AS n FROM ${RESULT_STAGING}`, isCancelled)
    let rows = Number(n.n)
    let kind: BuiltResult['kind'] = 'table'
    let reRuns = false
    // The query succeeded: it replaces the previous result now. Not cancellable
    // midway, so a result always exists.
    const never = (): boolean => false
    await dropResult(conn)
    if (rows <= cap) await streamRows(conn, promoteStagingSql(), never)
    else {
      // Over the cap: a view over the statement, not a copy (research §9).
      await streamRows(conn, `DROP TABLE IF EXISTS ${RESULT_STAGING}`, never)
      await streamRows(conn, resultViewSql(statement), never)
      kind = 'view'
      const plan: string[] = []
      await streamRows(conn, `EXPLAIN SELECT * FROM ${RESULT_TABLE}`, isCancelled, (batch) => {
        for (const r of batch) plan.push(String(r.explain_value ?? ''))
      })
      reRuns = reRunsFromPlan(plan.join('\n'))
      const total = await singleRow<{ n: bigint | number }>(conn, `SELECT count(*) AS n FROM ${RESULT_TABLE}`, isCancelled)
      rows = Number(total.n)
    }
    return await describe(ctx, rows, kind, reRuns)
  } catch (err) {
    if (err instanceof QueryCancelledError || err instanceof ResultDeclinedError) throw err
    // Errors from our own follow-up SQL must not point into the user's
    // statement: drop the LINE block (and so the position).
    const first = (err instanceof Error ? err.message : String(err)).split('\n')[0]
    throw new Error(`Internal Error: The result could not be prepared (${first})`, { cause: err })
  }
}

/** Drops `__se_result`, whichever it is: a table, or (when DuckDB says so) a view. */
export async function dropResult(conn: BuildContext['conn']): Promise<void> {
  const never = (): boolean => false
  try {
    await streamRows(conn, dropResultSql('table'), never)
  } catch (err) {
    if (!/is of type View/i.test(err instanceof Error ? err.message : String(err))) throw err
    await streamRows(conn, dropResultSql('view'), never)
  }
}

/** Columns, geometry, CRS, extent and counts of __se_result (one stats pass; no rows fetched). */
async function describe(ctx: BuildContext, rowCount: number, kind: BuiltResult['kind'], reRuns: boolean): Promise<BuiltResult> {
  const { conn, isCancelled } = ctx
  const columns: Array<{ name: string; type: string }> = []
  await streamRows(conn, `DESCRIBE ${RESULT_TABLE}`, isCancelled, (rows) => {
    // Hidden engine columns (spec 007) are neither displayed, styled nor exported.
    for (const r of rows) if (!String(r.column_name).startsWith('__se_')) columns.push({ name: String(r.column_name), type: String(r.column_type) })
  })
  const geometryColumns = columns.filter((c) => isGeometryType(c.type))
  const primary = geometryColumns[0] ?? null
  const others = geometryColumns.slice(1).map((c) => c.name)

  // One stats pass: valid count, raw extent (for CRS detection) and types.
  const g = primary ? quoteIdent(primary.name) : null
  const stats = g
    ? await singleRow<{ valid: bigint | number | null; min_x: number | null; min_y: number | null; max_x: number | null; max_y: number | null; gtypes: unknown }>(
        conn,
        `SELECT count(*) FILTER (WHERE ok) AS valid,
           min(ST_XMin(${g})) FILTER (WHERE ok) AS min_x, min(ST_YMin(${g})) FILTER (WHERE ok) AS min_y,
           max(ST_XMax(${g})) FILTER (WHERE ok) AS max_x, max(ST_YMax(${g})) FILTER (WHERE ok) AS max_y,
           list(DISTINCT ST_GeometryType(${g})::VARCHAR) FILTER (WHERE ok) AS gtypes
         FROM (SELECT ${g}, (${g} IS NOT NULL AND ST_IsValid(${g})) AS ok FROM ${RESULT_TABLE})`,
        isCancelled
      )
    : null
  const featureCount = stats ? Number(stats.valid ?? 0) : 0
  const resultCrs = primary && stats ? ctx.resolveCrs({ engineType: primary.type, rawExtent: bbox(stats) }) : null

  // WGS84 extent of the result, for fit-to-extent (envelope corners, not every feature).
  let extent: Bbox | null = null
  const raw = stats ? bbox(stats) : null
  if (raw && resultCrs) {
    const w = reprojectToWgs84Sql(`ST_MakeEnvelope(${raw.join(', ')})`, resultCrs.srid)
    const e = await singleRow<{ min_x: number; min_y: number; max_x: number; max_y: number }>(
      conn,
      `SELECT ST_XMin(w) AS min_x, ST_YMin(w) AS min_y, ST_XMax(w) AS max_x, ST_YMax(w) AS max_y FROM (SELECT ${w} AS w)`,
      isCancelled
    )
    extent = bbox(e)
  }

  const geometryType: GeometryType = primary && stats ? geometryTypeOf(stats.gtypes) : 'Point'
  return {
    layer: {
      geometryType,
      sourceCrs: resultCrs?.crs ?? ctx.table.crs,
      crsAssumed: resultCrs ? resultCrs.source === 'layer' && ctx.table.crsAssumed : false,
      rowCount,
      featureCount,
      invalidGeometryCount: primary ? rowCount - featureCount : 0,
      truncated: false,
      totalRows: rowCount,
      extent,
      columns: visibleColumns(columns.filter((c) => !isGeometryType(c.type))),
    },
    geometryColumn: primary?.name ?? null,
    otherGeometryColumns: others,
    resultCrs,
    truncatedTo: null,
    totalRows: rowCount,
    kind,
    reRuns,
  }
}

/** The default view: `layer` itself, described from the open's facts (no copy, no scan). */
export function defaultResult(table: QueryableTable): BuiltResult {
  const geometry = table.columns.find((c) => isGeometryType(c.type)) ?? null
  return {
    layer: {
      geometryType: table.geometryType,
      sourceCrs: table.crs,
      crsAssumed: table.crsAssumed,
      rowCount: table.totals.rows,
      featureCount: table.totals.features,
      invalidGeometryCount: table.totals.invalid,
      truncated: false,
      totalRows: table.totals.rows,
      extent: table.extent,
      columns: visibleColumns(table.columns.filter((c) => !isGeometryType(c.type))),
    },
    geometryColumn: geometry?.name ?? null,
    otherGeometryColumns: [],
    resultCrs: layerCrs(table),
    truncatedTo: null,
    totalRows: table.totals.rows,
    kind: 'layer',
    reRuns: false,
  }
}

/** The table's own CRS: the fallback result CRS. */
export function layerCrs(table: QueryableTable): ResultCrs {
  return { crs: table.srid === null ? resolveCrsInfo(null).crs : table.crs, srid: table.srid, source: 'layer' }
}
