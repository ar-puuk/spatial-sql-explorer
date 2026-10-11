// Style statistics in SQL (spec 007 research §11, FR-012): what the classifier
// needs from a result too big to fetch, computed by the engine. Up to
// STYLE_VALUES_CAP rows the styled column's values are fetched and classified
// exactly as in spec 003; above it:
// - categorized: exact per-category counts (the top TOP_CATEGORIES, plus the
//   distinct and null counts);
// - graduated: the evenly spaced order statistics natural breaks itself uses
//   above its exact limit (so its breaks are identical), exact quantile
//   positions, exact min/max;
// - class counts: one exact CASE aggregation.
// Pure builders; tests in tests/core/stats-sql.test.ts.
import { quoteIdent } from '../query/util.js'
import { JENKS_EXACT_LIMIT } from '../style/classify.js'

/** Results up to this many rows are styled from their fetched values (exactly spec 003). */
export const STYLE_VALUES_CAP = JENKS_EXACT_LIMIT

/** Categories fetched for a big result: far more than any class cap. */
export const TOP_CATEGORIES = 1_000

/** A value's category in SQL, like `toCategory`: its text form; NULL and '' have none. */
export function categorySql(column: string): string {
  const c = quoteIdent(column)
  return `nullif(CAST(${c} AS VARCHAR), '')`
}

/** A value as a number in SQL, like `toNumber`: numbers and numeric text; everything else NULL. */
export function numberSql(column: string): string {
  const c = quoteIdent(column)
  return `CASE WHEN isfinite(TRY_CAST(${c} AS DOUBLE)) THEN TRY_CAST(${c} AS DOUBLE) END`
}

/** Every value of the column, in row order (small results). */
export function columnValuesSql(relation: string, column: string): string {
  return `SELECT ${quoteIdent(column)} AS v FROM ${relation}`
}

/** The most frequent categories, most frequent first (ties alphabetical); `also` adds manual values. */
export function topCategoriesSql(relation: string, column: string, also: string[] = []): string {
  const extra = also.length ? ` OR cat IN (${also.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')})` : ''
  return `SELECT cat, n FROM (SELECT cat, count(*) AS n, row_number() OVER (ORDER BY count(*) DESC, cat) AS r FROM (SELECT ${categorySql(column)} AS cat FROM ${relation}) WHERE cat IS NOT NULL GROUP BY cat) WHERE r <= ${TOP_CATEGORIES}${extra} ORDER BY n DESC, cat`
}

/** Distinct categories, non-null rows and nulls of the column. */
export function categoryTotalsSql(relation: string, column: string): string {
  const cat = categorySql(column)
  return `SELECT count(DISTINCT cat) AS distinct_n, count(cat) AS non_null, count(*) - count(cat) AS nulls FROM (SELECT ${cat} AS cat FROM ${relation})`
}

/** Numeric count, nulls, min and max of the column. */
export function numberTotalsSql(relation: string, column: string): string {
  return `SELECT count(v) AS n, count(*) - count(v) AS nulls, min(v) AS min, max(v) AS max FROM (SELECT ${numberSql(column)} AS v FROM ${relation})`
}

/**
 * The order statistics at 0-based positions `positions` of the sorted
 * non-null values (`m` evenly spaced ones reproduce natural breaks' own
 * sampling; quantiles ask for the two around each break).
 */
export function orderStatisticsSql(relation: string, column: string, positions: number[]): string {
  const list = [...new Set(positions.map((p) => Math.max(0, Math.floor(p))))].sort((a, b) => a - b)
  return `SELECT pos, v FROM (SELECT v, row_number() OVER (ORDER BY v) - 1 AS pos FROM (SELECT ${numberSql(column)} AS v FROM ${relation}) WHERE v IS NOT NULL) WHERE pos IN (${list.join(', ') || '0'}) ORDER BY pos`
}

/** The positions natural breaks samples above its exact limit (classify.ts sampleSorted). */
export function evenPositions(n: number, m: number): number[] {
  if (n <= m) return Array.from({ length: n }, (_, i) => i)
  return Array.from({ length: m }, (_, i) => Math.round((i * (n - 1)) / (m - 1)))
}

/** The order statistics QGIS's quantile interpolates between for k classes (classify.ts quantileBreaks). */
export function quantilePositions(n: number, k: number): number[] {
  const out: number[] = []
  for (let i = 1; i < k; i++) {
    const a = (i / k) * (n - 1)
    out.push(Math.floor(a), Math.min(Math.floor(a) + 1, n - 1))
  }
  return out
}

/**
 * Exact counts per class of upper-inclusive ranges (the first class also
 * includes its lower bound, like classOf), with "outside" (-1) and "no
 * value" (-2), in one pass.
 */
export function classCountsSql(relation: string, column: string, ranges: ReadonlyArray<{ lower: number; upper: number }>): string {
  const whens = ranges.map((r, i) => `WHEN v <= ${r.upper} THEN ${i}`).join(' ')
  const lower = ranges.length ? ranges[0].lower : 0
  const cls = ranges.length ? `CASE WHEN v IS NULL THEN -2 WHEN v < ${lower} THEN -1 ${whens} ELSE -1 END` : 'CASE WHEN v IS NULL THEN -2 ELSE -1 END'
  return `SELECT cls, count(*) AS n FROM (SELECT ${cls} AS cls FROM (SELECT ${numberSql(column)} AS v FROM ${relation})) GROUP BY cls`
}
