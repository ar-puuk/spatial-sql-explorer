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

/** Spec 009: every value of several columns in one pass, in row order (column i as `v<i>`). */
export function columnsValuesSql(relation: string, columns: readonly string[]): string {
  return `SELECT ${columns.map((c, i) => `${quoteIdent(c)} AS v${i}`).join(', ')} FROM ${relation}`
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

/** Spec 011 US4, As-is colors: values that aren't `#rgb` or `#rrggbb` (missing values aside). */
export function invalidColorsSql(relation: string, column: string): string {
  return `SELECT count(*) FILTER (WHERE cat IS NOT NULL AND NOT regexp_matches(trim(cat), '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')) AS bad FROM (SELECT ${categorySql(column)} AS cat FROM ${relation})`
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
  return `SELECT cls, count(*) AS n FROM (SELECT ${classCaseSql('v', ranges)} AS cls FROM (SELECT ${numberSql(column)} AS v FROM ${relation})) GROUP BY cls`
}

/** A number's class as SQL `CASE` (classOf's rules): the range index, -1 outside, -2 no value. */
function classCaseSql(v: string, ranges: ReadonlyArray<{ lower: number; upper: number }>): string {
  if (!ranges.length) return `CASE WHEN ${v} IS NULL THEN -2 ELSE -1 END`
  const whens = ranges.map((r, i) => `WHEN ${v} <= ${r.upper} THEN ${i}`).join(' ')
  return `CASE WHEN ${v} IS NULL THEN -2 WHEN ${v} < ${ranges[0].lower} THEN -1 ${whens} ELSE -1 END`
}

/**
 * Spec 009: numeric count, nulls, min and max of several columns in one pass
 * (the size channel and bivariate axes). Column i's values are `n_i`,
 * `nulls_i`, `min_i`, `max_i`.
 */
export function multiTotalsSql(relation: string, columns: readonly string[]): string {
  const values = columns.map((c, i) => `${numberSql(c)} AS v${i}`).join(', ')
  const totals = columns.map((_, i) => `count(v${i}) AS n_${i}, count(*) - count(v${i}) AS nulls_${i}, min(v${i}) AS min_${i}, max(v${i}) AS max_${i}`).join(', ')
  return `SELECT ${totals} FROM (SELECT ${values} FROM ${relation})`
}

/**
 * Spec 009: exact bivariate cell counts in one pass: each axis's class
 * (classOf's rules; -1 outside, -2 no value), grouped by both.
 */
export function cellCountsSql(
  relation: string,
  xColumn: string,
  xRanges: ReadonlyArray<{ lower: number; upper: number }>,
  yColumn: string,
  yRanges: ReadonlyArray<{ lower: number; upper: number }>
): string {
  return `SELECT cx, cy, count(*) AS n FROM (SELECT ${classCaseSql('vx', xRanges)} AS cx, ${classCaseSql('vy', yRanges)} AS cy FROM (SELECT ${numberSql(xColumn)} AS vx, ${numberSql(yColumn)} AS vy FROM ${relation})) GROUP BY cx, cy`
}

// --- Value distribution (spec 008 FR-003, research §10) ----------------------

/** Bars in the style panel's value distribution chart. */
export const HISTOGRAM_BINS = 40

/** The style panel's chart: equal-width bins from min to max, with counts. */
export interface ValueHistogram {
  /** bins + 1 edges, min first, max last. */
  edges: number[]
  counts: number[]
  /** Non-null numeric values counted. */
  total: number
}

/**
 * Counts per equal-width bin of the column's numeric values in one pass. The
 * maximum falls in the last bin; a column with one distinct value is one bin.
 */
export function histogramSql(relation: string, column: string, min: number, max: number, bins: number = HISTOGRAM_BINS): string {
  const n = max > min ? bins : 1
  const width = max > min ? (max - min) / n : 1
  return `SELECT least(${n - 1}, CAST(floor((v - (${min})) / ${width}) AS INTEGER)) AS b, count(*) AS n FROM (SELECT ${numberSql(column)} AS v FROM ${relation}) WHERE v IS NOT NULL GROUP BY b`
}

/** Assembles the chart from `histogramSql` rows. */
export function histogramFrom(min: number, max: number, rows: ReadonlyArray<{ b: number; n: number }>, bins: number = HISTOGRAM_BINS): ValueHistogram {
  const n = max > min ? bins : 1
  const counts = new Array<number>(n).fill(0)
  for (const r of rows) if (r.b >= 0 && r.b < n) counts[r.b] += r.n
  const edges = Array.from({ length: n + 1 }, (_, i) => (i === n ? max : min + ((max - min) * i) / n))
  return { edges, counts, total: counts.reduce((a, b) => a + b, 0) }
}
