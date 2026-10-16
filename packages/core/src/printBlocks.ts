// Spec 016: the print layout's data blocks (an attribute table, a chart of the layer's rows). The engine does the
// work: a table is a query, a bar or pie is a GROUP BY, a line is the values in row order (sampled when there are
// many); this module builds that SQL and turns the answers into what the page draws. GeoLibre's blocks
// (print-data-blocks.ts and attribute-charts.ts, MIT, © 2026 Qiusheng Wu) do the same in the browser over every
// feature; the top-N cap, the "(other)" slice and the blank bucket are theirs.
import { shapesInCrsSql, spatialPredicateSql } from './draw/shapes.js'

/** Hard ceiling on table rows drawn on the page. */
export const MAX_TABLE_ROWS = 50
export const DEFAULT_TABLE_ROWS = 10
/** Columns shown when none were picked. */
export const DEFAULT_TABLE_COLUMNS = 4
/** The bar chart draws at most this many categories (top-N by value). */
export const MAX_BAR_CATEGORIES = 20
/** The pie chart draws at most this many slices; the rest fold into "(other)". */
export const MAX_PIE_SLICES = 8
/** A line chart plots at most this many points: a longer series is sampled evenly. */
export const MAX_LINE_POINTS = 2000

export type BlockAggregation = 'count' | 'sum' | 'mean'
/** Which rows a block covers: all, those completely inside the page's extent, or those touching it. */
export type PageFilterMode = 'all' | 'contained' | 'intersecting'

/** The rows a block reads. */
export interface BlockScope {
  mode: PageFilterMode
  /** The page's extent (west, south, east, north), for `contained` and `intersecting`. */
  bbox: [number, number, number, number] | null
  /** Only the row with this id (an atlas page's own feature). */
  rowId?: number | null
}

export type BlockSpec =
  | ({ kind: 'table'; columns: string[]; sortField: string; sortDesc: boolean; limit: number } & BlockScope)
  | ({ kind: 'groups'; category: string; valueField: string | null } & BlockScope)
  | ({ kind: 'line'; valueField: string } & BlockScope)

export interface TableBlockResult {
  columns: string[]
  rows: string[][]
  /** Rows beyond the limit. */
  truncated: number
}
export interface GroupRow {
  label: string
  count: number
  sum: number
  /** Rows of the group with a number in the value field. */
  numeric: number
}
export interface LineBlockResult {
  points: Array<{ index: number; value: number }>
  min: number
  max: number
  /** Rows in all: x spans them. */
  length: number
}

const q = (name: string): string => `"${name.replace(/"/g, '""')}"`

/** The WHERE conditions of a scope, in the CRS the relation's geometry is in (`srid`). */
export function scopeConditions(scope: BlockScope, geom: string | null, srid: number | null): string[] {
  const out: string[] = []
  if (scope.rowId !== undefined && scope.rowId !== null) out.push(`__se_rowid = ${Math.trunc(scope.rowId)}`)
  if (scope.mode !== 'all' && scope.bbox && geom) {
    const [w, s, e, n] = scope.bbox
    // A page's extent can come from an unwrapped view: wrap a west past east back, as the box of a view over the date line.
    const east = w > e ? e + 360 : e
    const ring = [[w, s], [east, s], [east, n], [w, n], [w, s]]
    const box = { type: 'Polygon' as const, coordinates: [ring] }
    out.push(spatialPredicateSql(scope.mode === 'contained' ? 'within' : 'intersects', geom, shapesInCrsSql([{ geometry: box }], srid)))
  }
  return out
}

const where = (conditions: string[]): string => (conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '')

/** The statements a block needs, over `relation` (already narrowed to the displayed rows). */
export function blockSql(spec: BlockSpec, relation: string, geom: string | null, srid: number | null): { main: string; count: string } {
  const w = where(scopeConditions(spec, geom, srid))
  const count = `SELECT count(*) AS n FROM ${relation}${w}`
  if (spec.kind === 'table') {
    const limit = Math.max(1, Math.min(MAX_TABLE_ROWS, Math.trunc(spec.limit) || DEFAULT_TABLE_ROWS))
    const order = spec.sortField ? ` ORDER BY ${q(spec.sortField)} ${spec.sortDesc ? 'DESC' : 'ASC'} NULLS LAST` : ''
    const cols = spec.columns.map((c, i) => `CAST(${q(c)} AS VARCHAR) AS c${i}`).join(', ')
    return { main: `SELECT ${cols} FROM ${relation}${w}${order} LIMIT ${limit}`, count }
  }
  if (spec.kind === 'groups') {
    const v = spec.valueField ? `TRY_CAST(${q(spec.valueField)} AS DOUBLE)` : 'NULL'
    return {
      main: `SELECT CAST(${q(spec.category)} AS VARCHAR) AS label, count(*) AS n, coalesce(sum(${v}), 0) AS s, count(${v}) AS nn FROM ${relation}${w} GROUP BY 1 ORDER BY n DESC LIMIT 5000`,
      count,
    }
  }
  const v = `TRY_CAST(${q(spec.valueField)} AS DOUBLE)`
  // Every k-th row, so a long series stays a few thousand points; the count says how long it is.
  return {
    main: `SELECT idx, v FROM (SELECT row_number() OVER () - 1 AS idx, ${v} AS v FROM ${relation}${w}) WHERE v IS NOT NULL AND isfinite(v) AND idx % GREATEST(1, CAST(ceil((SELECT count(*) FROM ${relation}${w}) / ${MAX_LINE_POINTS}.0) AS BIGINT)) = 0`,
    count,
  }
}

const num = (v: unknown): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0))

/** The rows of a table block's answer. */
export function tableResult(spec: Extract<BlockSpec, { kind: 'table' }>, rows: Array<Record<string, unknown>>, total: number): TableBlockResult | null {
  if (rows.length === 0 || spec.columns.length === 0) return null
  return { columns: spec.columns, rows: rows.map((r) => spec.columns.map((_, i) => (r[`c${i}`] === null || r[`c${i}`] === undefined ? '' : String(r[`c${i}`])))), truncated: Math.max(0, total - rows.length) }
}

export function groupRows(rows: Array<Record<string, unknown>>): GroupRow[] {
  return rows.map((r) => ({ label: r.label === null || r.label === undefined || r.label === '' ? '(blank)' : String(r.label), count: num(r.n), sum: num(r.s), numeric: num(r.nn) }))
}

export function lineResult(rows: Array<Record<string, unknown>>, total: number): LineBlockResult | null {
  const points = rows.map((r) => ({ index: num(r.idx), value: num(r.v) }))
  if (points.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    if (p.value < min) min = p.value
    if (p.value > max) max = p.value
  }
  return { points, min, max, length: total }
}

export interface BarData {
  bars: Array<{ label: string; value: number }>
  maxValue: number
  minValue: number
  /** Categories dropped past the cap. */
  truncated: number
}

/** The top categories by value. Sum and mean drop a category with no number to reduce (not a misleading zero bar). */
export function barData(groups: GroupRow[], aggregation: BlockAggregation, maxBars: number = MAX_BAR_CATEGORIES): BarData | null {
  const all = groups
    .filter((g) => aggregation === 'count' || g.numeric > 0)
    .map((g) => ({ label: g.label, value: aggregation === 'count' ? g.count : aggregation === 'sum' ? g.sum : g.sum / g.numeric }))
  if (all.length === 0) return null
  all.sort((a, b) => b.value - a.value)
  const bars = all.slice(0, Math.max(1, maxBars))
  let maxValue = 0
  let minValue = 0
  for (const b of bars) {
    if (b.value > maxValue) maxValue = b.value
    if (b.value < minValue) minValue = b.value
  }
  return { bars, maxValue, minValue, truncated: Math.max(0, all.length - bars.length) }
}

export interface PieData {
  slices: Array<{ label: string; value: number }>
  total: number
}

/** Parts of a whole: positive values only, the biggest slices, the rest folded into "(other)". */
export function pieData(groups: GroupRow[], aggregation: BlockAggregation, maxSlices: number = MAX_PIE_SLICES): PieData | null {
  const all = groups.map((g) => ({ label: g.label, value: aggregation === 'count' ? g.count : g.sum })).filter((s) => s.value > 0)
  if (all.length === 0) return null
  all.sort((a, b) => b.value - a.value)
  // At least two: a named slice and the overflow, never everything under "(other)".
  const limit = Math.max(2, maxSlices)
  let slices = all
  if (all.length > limit) {
    const head = all.slice(0, limit - 1)
    const other = all.slice(limit - 1).reduce((sum, s) => sum + s.value, 0)
    slices = [...head, { label: head.some((s) => s.label === '(other)') ? '(other categories)' : '(other)', value: other }]
  }
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  return total > 0 ? { slices, total } : null
}
