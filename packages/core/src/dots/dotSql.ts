// Spec 022: the query behind "Dot density". Pure text, like grid/binSql.ts: it needs the layer's facts (geometry column,
// CRS, columns), never the engine. The query is the product: it goes to the SQL tab, where it can be read, edited and rerun.
//
// A dot density map shows a count as dots: one dot stands for a fixed amount (500 people), and a polygon with 12,000
// of them gets 24 dots, placed at random inside it. The engine has no function that puts points inside a polygon
// (ST_GeneratePoints takes a box), so the query samples the polygon's box and keeps the points that fall inside it,
// as many as the polygon needs (spec 022 research). The "random" numbers are a hash of the feature, the column and the
// point's number, so the same layer always gives the same map, and a change in the amount per dot moves the dots a
// little instead of redrawing them.
import { quoteIdent, quoteLiteral } from '../query/util.js'
import { isNumericType } from '../style/resolve.js'
import { USABLE_GEOMETRY, wholeGeometrySql } from '../grid/binSql.js'

export interface DotSpec {
  /** The number columns to draw, one color each (1 to `MAX_DOT_COLUMNS`). */
  columns: string[]
  /** What one dot stands for, in the columns' own unit (a positive number). */
  perDot: number
}

/** The most columns drawn at once (a legend of colors people can tell apart). */
export const MAX_DOT_COLUMNS = 6
/** More dots than this asks first (the map draws them from tiles, which is slower). */
export const DOT_LIMIT = 100_000
/** More dots than this is refused: this is a quick-look tool (user decision 2026-10-17, as for the smoothing rings). */
export const MAX_DOTS = 1_000_000
/** Up to this many dots the map previews while the choices change. */
export const PREVIEW_DOT_LIMIT = 20_000
/** The number of dots the amount per dot is first chosen for. */
export const SUGGESTED_DOTS = 5_000
/** The largest amount per dot (it is written into the query as a plain number). */
export const MAX_PER_DOT = 1e12

/** The columns of a dot density result. */
export const DOT_ATTRIBUTES = ['feature', 'category', 'one_dot'] as const

/** Whether a result has the shape of a dot density query's (so a rerun of an edited query keeps the user's style). `columns` are the result's attribute columns. */
export function isDotResult(columns: ReadonlyArray<{ name: string }>): boolean {
  const names = new Set(columns.map((c) => c.name))
  return DOT_ATTRIBUTES.every((c) => names.has(c))
}

/** What the SQL needs to know about the open layer. */
export interface DotLayerFacts {
  /** The geometry column as SQL (quoted), as the layer view names it. */
  geom: string
  /** EPSG code of the layer's geometry; null (unknown) is read as WGS84. */
  srid: number | null
  columns: ReadonlyArray<{ name: string; type: string }>
  /** The relation the polygons come from: `layer` (absent), or the query behind the result on show, in parentheses. */
  source?: string
  /** The WHERE text for the rows the layer currently shows (column filters and shape filter), or null. */
  where?: string | null
}

/** What the dialog needs to know about the open layer (QuerySession.layerFactsForDots). */
export interface DotLayerInfo {
  /** Columns that can be drawn as dots. */
  numericColumns: string[]
  /** Rows in the layer, or in the result on show. */
  rows: number
  /** The sum of each number column's positive values over the rows shown (what the dots add up to, times the amount per dot). */
  totals: Record<string, number>
}

export interface DotQuery {
  sql: string
  /** The legend title ("One dot = 500"). */
  label: string
}

/** Why a spec cannot be turned into SQL, or null when it can. */
export function dotSpecProblem(spec: DotSpec, facts: Pick<DotLayerFacts, 'columns'>): string | null {
  if (spec.columns.length === 0) return 'Choose a column to draw as dots.'
  if (spec.columns.length > MAX_DOT_COLUMNS) return `Choose at most ${MAX_DOT_COLUMNS} columns: each gets its own color.`
  if (new Set(spec.columns).size !== spec.columns.length) return 'Each column can be chosen once.'
  for (const name of spec.columns) {
    const column = facts.columns.find((c) => c.name === name)
    if (!column) return `There is no column ${name}.`
    if (!isNumericType(column.type)) return `${name} is not a number column.`
  }
  if (!Number.isFinite(spec.perDot) || spec.perDot <= 0 || spec.perDot > MAX_PER_DOT) return 'One dot must stand for a positive amount.'
  return null
}

/** The legend title for an amount per dot. */
export function dotLabel(perDot: number): string {
  return `One dot = ${perDot.toLocaleString('en-US', { maximumFractionDigits: 6 })}`
}

/** A plain decimal text for a number that goes into SQL (never an exponent). */
const numberText = (n: number): string => (Number.isInteger(n) ? n.toFixed(0) : String(Number(n.toPrecision(12))))

/** The amounts per dot offered: 1, 2, 5, 10, 20, 50, … */
export function perDotLadder(max: number): number[] {
  const out: number[] = []
  for (let exp = 0; 10 ** exp <= Math.min(max, MAX_PER_DOT); exp++) {
    for (const m of [1, 2, 5]) if (m * 10 ** exp <= Math.min(max, MAX_PER_DOT)) out.push(m * 10 ** exp)
  }
  return out.length ? out : [1]
}

/** How many dots `perDot` gives for columns adding up to `total` (each polygon rounds its own, so this is about). */
export function estimateDots(total: number, perDot: number): number {
  return perDot > 0 && Number.isFinite(total) ? Math.round(total / perDot) : 0
}

/** The amount per dot (1, 2, 5, 10, …) that gives about `SUGGESTED_DOTS` dots for a total; at least 1. */
export function suggestPerDot(total: number): number {
  if (!(total > 0)) return 1
  const ladder = perDotLadder(Math.max(1, total))
  return ladder.find((v) => total / v <= SUGGESTED_DOTS) ?? ladder.at(-1) ?? 1
}

/**
 * The query for `spec` over the layer (`layer`), or null when the spec is not valid. Output columns: `feature` (the polygon's
 * place in the layer), `category` (the column the dot stands for), `one_dot` (the amount) and `geom`. Polygons with no usable
 * shape (empty, no area, outside the world) get no dots. A polygon's dots add up to its value over the amount per dot: the
 * remainder is a dot with that chance, so small polygons are not all rounded away.
 */
export function dotQuerySql(spec: DotSpec, facts: DotLayerFacts): DotQuery | null {
  if (dotSpecProblem(spec, facts) !== null) return null
  const per = numberText(spec.perDot)
  const values = spec.columns.map((c, i) => `TRY_CAST(${quoteIdent(c)} AS DOUBLE) AS v${i}`).join(', ')
  const wants = spec.columns
    .map((c, i) => `  SELECT feature, g, x0, w, y0, h, fill, ${quoteLiteral(c)} AS category, ${i} AS gi, v${i} / ${per} AS want FROM shapes WHERE v${i} > 0`)
    .join('\n  UNION ALL\n')
  const where = facts.where ? `\n    WHERE (${facts.where})` : ''
  const sql = [
    'WITH shapes AS (',
    '  SELECT feature, g, x0, w, y0, h, greatest(ST_Area(g) / nullif(w * h, 0), 0.005) AS fill,',
    ...spec.columns.map((_, i) => `    v${i}${i < spec.columns.length - 1 ? ',' : ''}`),
    '  FROM (',
    `    SELECT feature, g, ST_XMin(g) AS x0, ST_XMax(g) - ST_XMin(g) AS w, ST_YMin(g) AS y0, ST_YMax(g) - ST_YMin(g) AS h, ${spec.columns.map((_, i) => `v${i}`).join(', ')}`,
    '    FROM (',
    `      SELECT row_number() OVER () AS feature, ${wholeGeometrySql(facts.geom, facts.srid)} AS g, ${values}`,
    `      FROM ${facts.source ?? 'layer'}${where}`,
    '    )',
    `    WHERE ${USABLE_GEOMETRY} AND ST_Area(g) > 0`,
    '  )',
    '),',
    'wants AS (',
    wants,
    '),',
    'sized AS (',
    '  SELECT *, floor(want)::BIGINT + CASE WHEN (hash(feature, gi, -1) % 1000000) / 1000000.0 < want - floor(want) THEN 1 ELSE 0 END AS n',
    '  FROM wants',
    '),',
    'candidates AS (',
    '  SELECT feature, g, category, gi, n, k,',
    '    x0 + w * ((hash(feature, gi, k) % 1000000) / 1000000.0) AS x,',
    '    y0 + h * ((hash(feature, gi, k, 1) % 1000000) / 1000000.0) AS y',
    '  FROM sized, unnest(range(CAST(ceil((n * 1.5 + 4 * sqrt(n) + 6) / fill) AS BIGINT))) AS t(k)',
    '  WHERE n > 0',
    '),',
    'placed AS (',
    '  SELECT feature, category, n, x, y, row_number() OVER (PARTITION BY feature, gi ORDER BY k) AS rn',
    '  FROM candidates',
    '  WHERE ST_Within(ST_Point(x, y), g)',
    ')',
    `SELECT feature, category, ${per}::DOUBLE AS one_dot, ST_SetCRS(ST_Point(x, y), 'EPSG:4326') AS geom`,
    'FROM placed',
    'WHERE rn <= n',
  ].join('\n')
  return { sql, label: dotLabel(spec.perDot) }
}

/**
 * SQL for the sum of each of `columns` over the rows the layer shows (negative and missing values count as nothing), as
 * `t0`, `t1`, …; null for no columns.
 */
export function dotTotalsSql(columns: readonly string[], facts: Pick<DotLayerFacts, 'where' | 'source'>): string | null {
  if (columns.length === 0) return null
  const sums = columns.map((c, i) => `coalesce(sum(greatest(TRY_CAST(${quoteIdent(c)} AS DOUBLE), 0)), 0)::DOUBLE AS t${i}`).join(', ')
  return `SELECT ${sums} FROM ${facts.source ?? 'layer'}${facts.where ? ` WHERE (${facts.where})` : ''}`
}
