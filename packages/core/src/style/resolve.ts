// From a style + the displayed result to what the map, legend and panel
// draw (spec 003 data-model.md ResolvedStyle). Pure; recomputed whenever the
// style or the result changes. Classes cover every row of the displayed
// result and nothing else (FR-005).
import type { Feature, Layer } from '../models.js'
import { NO_VALUE_COLOR, OTHER_COLOR, rendererOf, type CategorizedRenderer, type GraduatedMethod, type GraduatedRenderer, type LayerStyle, type ResolvedClass, type ResolvedStyle } from './model.js'
import { JENKS_EXACT_LIMIT, classOf, compareCategories, equalIntervalBreaks, jenksBreaks, quantileBreaks, toCategory, toNumber } from './classify.js'
import { rampById, rampColors } from './ramps.js'
import { DEFAULT_SIZE_RANGE, classSizes } from './symbol.js'

/**
 * The styled column's data (spec 007 research §11). `values`: every row's
 * value (results up to STYLE_VALUES_CAP rows; classified exactly as in spec
 * 003). For bigger results, from SQL: `categories` (exact per-category
 * counts) or `numbers` (evenly spaced order statistics, exact quantile order
 * statistics; class counts are filled in afterwards, also exactly).
 */
export type ColumnData =
  | { kind: 'values'; column: string; values: Array<Feature['attributes'][string]> }
  | { kind: 'categories'; column: string; top: Array<{ value: string; count: number }>; distinct: number; nonNull: number; nulls: number }
  | { kind: 'numbers'; column: string; sample: number[]; n: number; nulls: number; quantileStats?: Record<number, number> }

/**
 * What a style is resolved against: the result's columns, plus its features
 * (spec 003; small in-memory results and tests) or, since spec 007, its row
 * count and the styled column's data computed by the engine.
 */
export interface ResolveInput {
  columns: Layer['columns']
  features?: Feature[]
  rowCount?: number
  data?: ColumnData | null
  /** Distinct-value counts per column, when known (renderer suggestions). */
  distinct?: Record<string, number>
}

/** Rows in the result. */
export function rowsOf(input: ResolveInput | null): number {
  return input?.rowCount ?? input?.features?.length ?? 0
}

/** Every value of `column`, from the fetched data or the features. */
export function valuesOf(input: ResolveInput, column: string): Array<Feature['attributes'][string] | undefined> {
  const d = input.data
  if (d?.kind === 'values' && d.column === column) return d.values
  return (input.features ?? []).map((f) => f.attributes[column])
}

const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL(\(.*\))?|NUMERIC(\(.*\))?|INT[1248]?|FLOAT[48])$/i

/** True for DuckDB numeric types (research §5). */
export function isNumericType(type: string): boolean {
  return NUMERIC.test(type.trim())
}

/** Columns a renderer can use: every attribute for categorized, numeric ones for graduated. */
export function eligibleColumns(columns: ResolveInput['columns'] | undefined, kind: 'categorized' | 'graduated'): Array<{ name: string; type: string }> {
  return (columns ?? []).filter((c) => kind === 'categorized' || isNumericType(c.type))
}

/** The single symbol as one legend class. */
function single(style: LayerStyle, layer: ResolveInput | null, extra: Partial<ResolvedStyle> = {}): ResolvedStyle {
  return {
    status: 'ok',
    caption: '',
    notes: [],
    ...extra,
    classes: [{ key: 'single', kind: 'single', label: 'All features', color: style.fillColor, visible: true, count: rowsOf(layer) }],
  }
}

/** Shared by the renderer branches: the fallback when the styled column can't be used (FR-012). */
export function fallback(style: LayerStyle, layer: ResolveInput | null, reason: string): ResolvedStyle {
  return single(style, layer, { status: 'fallback', reason })
}

export function resolveStyle(style: LayerStyle, layer: ResolveInput | null): ResolvedStyle {
  const r = rendererOf(style)
  switch (r.kind) {
    case 'single':
      return single(style, layer)
    case 'categorized':
      return categorized(style, r, layer)
    case 'graduated':
      return graduated(style, r, layer)
    case 'bivariate':
      // Spec 009 US4.
      return fallback(style, layer, 'Bivariate maps are not available in this build.')
  }
}

const nf = new Intl.NumberFormat('en-US')

function missingColumn(style: LayerStyle, layer: ResolveInput | null, column: string): ResolvedStyle | null {
  if (!layer) return single(style, layer)
  if (!column) return fallback(style, layer, 'Choose a column to style by.')
  if (!layer.columns.some((c) => c.name === column)) return fallback(style, layer, `Column "${column}" is not in this result.`)
  return null
}

/**
 * Categorized (FR-003): a class per distinct value, most frequent first
 * (ties alphabetical), up to the cap; the rest share "Other"; nulls and ""
 * are "No value". Manual mode keeps the stored class list in its order.
 */
function categorized(style: LayerStyle, r: CategorizedRenderer, layer: ResolveInput | null): ResolvedStyle {
  const missing = missingColumn(style, layer, r.column)
  if (missing || !layer) return missing ?? single(style, layer)

  const counts = new Map<string, number>()
  let nulls = 0
  // Spec 007: a big result's exact counts from SQL (the top categories, plus totals).
  const sql = layer.data?.kind === 'categories' && layer.data.column === r.column ? layer.data : null
  if (sql) {
    for (const c of sql.top) counts.set(c.value, c.count)
    nulls = sql.nulls
  } else {
    for (const value of valuesOf(layer, r.column)) {
      const v = toCategory(value)
      if (v === null) nulls++
      else counts.set(v, (counts.get(v) ?? 0) + 1)
    }
  }

  const ordered = r.manual
    ? r.classes.map((c) => c.value)
    : [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || compareCategories(a, b)).slice(0, r.cap)
  const inClasses = new Set(ordered)
  let otherCount = 0
  let otherGroups = 0
  for (const [v, n] of counts) {
    if (!inClasses.has(v)) {
      otherCount += n
      otherGroups++
    }
  }
  if (sql) {
    // Categories beyond the fetched top ones are "Other" too.
    let fetched = 0
    for (const n of counts.values()) fetched += n
    otherCount += Math.max(0, sql.nonNull - fetched)
    otherGroups += Math.max(0, sql.distinct - counts.size)
  }

  const colors = rampColors(r.ramp, ordered.length)
  const overrides = new Map(r.classes.map((c) => [c.value, c]))
  const classes: ResolvedClass[] = ordered.map((value, i) => {
    const o = overrides.get(value)
    return {
      key: `v:${value}`,
      kind: 'value',
      value,
      label: o?.label ?? value,
      color: o?.color ?? colors[i],
      visible: o?.visible !== false,
      count: counts.get(value) ?? 0,
    }
  })
  if (otherCount > 0) {
    classes.push({
      key: '__other',
      kind: 'other',
      label: r.other.label ?? `Other (${nf.format(otherGroups)} ${otherGroups === 1 ? 'value' : 'values'})`,
      color: r.other.color ?? OTHER_COLOR,
      visible: r.other.visible !== false,
      count: otherCount,
      groups: otherGroups,
    })
  }
  if (nulls > 0) {
    classes.push({ key: '__null', kind: 'noValue', label: r.noValue.label ?? 'No value', color: r.noValue.color ?? NO_VALUE_COLOR, visible: r.noValue.visible !== false, count: nulls })
  }

  const notes: string[] = []
  const max = rampById(r.ramp.id)?.maxClasses
  if (max !== undefined && ordered.length > max) notes.push(`${rampById(r.ramp.id)?.name} has ${max} colors; colors repeat after ${max} classes.`)
  const n = ordered.length
  return { status: 'ok', caption: `${r.column} · ${nf.format(n)} ${n === 1 ? 'category' : 'categories'}`, classes, notes }
}

export const METHOD_NAMES: Record<GraduatedMethod, string> = {
  equal: 'Equal interval',
  quantile: 'Quantile',
  jenks: 'Natural breaks',
  manual: 'Manual',
}

/** Decimals that show the class width with about two significant digits. */
function labelFormat(min: number, max: number, k: number): Intl.NumberFormat {
  const step = (max - min) / Math.max(k, 1)
  const decimals = step > 0 && Number.isFinite(step) ? Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(step)))) : 2
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals })
}

/** Ranges from inner breaks: [min, b1], (b1, b2], ... (bk, max]; equal and out-of-range breaks collapse. */
function rangesFrom(sorted: number[], breaks: number[]): Array<{ lower: number; upper: number }> {
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const inner = [...new Set(breaks.filter((b) => b >= min && b < max))].sort((a, b) => a - b)
  const bounds = [min, ...inner, max]
  if (bounds.length === 2 && min === max) return [{ lower: min, upper: max }]
  const ranges: Array<{ lower: number; upper: number }> = []
  for (let i = 0; i < bounds.length - 1; i++) if (bounds[i] < bounds[i + 1] || ranges.length === 0) ranges.push({ lower: bounds[i], upper: bounds[i + 1] })
  return ranges
}

/**
 * Graduated (FR-004): a numeric column split into classes by a method (or
 * manual ranges); upper-inclusive classes (research §2); nulls and
 * non-numbers are "No value"; values outside manual ranges are "Other".
 */
function graduated(style: LayerStyle, r: GraduatedRenderer, layer: ResolveInput | null): ResolvedStyle {
  const missing = missingColumn(style, layer, r.column)
  if (missing || !layer) return missing ?? single(style, layer)
  const type = layer.columns.find((c) => c.name === r.column)?.type ?? ''
  if (!isNumericType(type)) return fallback(style, layer, `Column "${r.column}" is not numeric in this result.`)

  // Spec 007: a big result's order statistics from SQL (counts filled in afterwards).
  const stats = layer.data?.kind === 'numbers' && layer.data.column === r.column ? layer.data : null
  const numbers: Array<number | null> = stats ? [] : valuesOf(layer, r.column).map((v) => toNumber(v))
  const sorted = stats ? stats.sample : numbers.filter((v): v is number => v !== null).sort((a, b) => a - b)
  const total = stats ? stats.n : sorted.length
  const notes: string[] = []
  let estimated = false
  // Fewer distinct values than classes: one class per value, labeled by it.
  let perValue = false

  let ranges: Array<{ lower: number; upper: number }> = []
  if (r.method === 'manual') {
    ranges = [...r.classes]
      .filter((c) => c.lower !== undefined && c.upper !== undefined)
      .sort((a, b) => a.index - b.index)
      .map((c) => ({ lower: c.lower as number, upper: c.upper as number }))
  } else if (sorted.length) {
    const distinct = [...new Set(sorted)]
    if (distinct.length === 1) {
      ranges = [{ lower: distinct[0], upper: distinct[0] }]
      notes.push(`Every value is ${distinct[0]}: the range can't be divided.`)
    } else if (distinct.length < r.classCount) {
      perValue = true
      ranges = distinct.map((v, i) => ({ lower: i === 0 ? v : distinct[i - 1], upper: v }))
      notes.push(`Only ${distinct.length} distinct values: ${distinct.length} classes.`)
    } else {
      const breaks =
        r.method === 'equal'
          ? equalIntervalBreaks(sorted, r.classCount)
          : r.method === 'quantile'
            ? stats?.quantileStats
              ? quantileFromStats(total, r.classCount, stats.quantileStats)
              : quantileBreaks(sorted, r.classCount)
            : jenksBreaks(sorted, r.classCount)
      estimated = r.method === 'jenks' && (stats ? stats.sample.length < total : total > JENKS_EXACT_LIMIT)
      ranges = rangesFrom(sorted, breaks)
      if (ranges.length < r.classCount) notes.push(`${r.classCount - ranges.length} of ${r.classCount} classes merged: many values are identical.`)
    }
  } else {
    notes.push(`Column "${r.column}" has no numeric values in this result.`)
  }

  const counts = ranges.map(() => 0)
  let nulls = stats ? stats.nulls : 0
  let outside = 0
  for (const v of numbers) {
    if (v === null) nulls++
    else {
      const i = classOf(v, ranges)
      if (i === -1) outside++
      else counts[i]++
    }
  }

  const fmt = labelFormat(ranges[0]?.lower ?? 0, ranges[ranges.length - 1]?.upper ?? 0, ranges.length)
  // Size classes (QGIS GraduatedSize) share the single symbol's color; the ramp isn't used.
  const bySize = r.vary === 'size'
  const colors = bySize ? ranges.map(() => style.fillColor) : rampColors(r.ramp, ranges.length)
  const sizes = bySize ? classSizes(ranges.length, r.sizeMin ?? DEFAULT_SIZE_RANGE.point.min, r.sizeMax ?? DEFAULT_SIZE_RANGE.point.max) : []
  const overrides = new Map(r.classes.map((c) => [c.index, c]))
  const classes: ResolvedClass[] = ranges.map((range, i) => {
    const o = overrides.get(i)
    const label = perValue || range.lower === range.upper ? fmt.format(range.upper) : `${fmt.format(range.lower)} – ${fmt.format(range.upper)}`
    const color = bySize ? colors[i] : (o?.color ?? colors[i])
    return { key: `range:${i}`, kind: 'range', lower: range.lower, upper: range.upper, label: o?.label ?? label, color, visible: o?.visible !== false, count: counts[i], ...(bySize ? { size: sizes[i] } : {}) }
  })
  // A big result's class counts arrive from SQL afterwards (QuerySession.resolveStyle), "Other" included.
  if (outside > 0 || (stats && r.method === 'manual')) classes.push({ key: '__other', kind: 'other', label: 'Other (outside the classes)', color: OTHER_COLOR, visible: true, count: outside })
  if (nulls > 0) classes.push({ key: '__null', kind: 'noValue', label: r.noValue.label ?? 'No value', color: r.noValue.color ?? NO_VALUE_COLOR, visible: r.noValue.visible !== false, count: nulls })

  const n = ranges.length
  let caption = `${r.column} · ${METHOD_NAMES[r.method]}, ${n} ${n === 1 ? 'class' : 'classes'}`
  if (estimated) caption += ` (estimated from ${nf.format(stats ? stats.sample.length : JENKS_EXACT_LIMIT)} values)`
  return { status: 'ok', caption, classes, notes }
}

/** QGIS's quantile from just the order statistics around each break (stats.ts quantilePositions). */
function quantileFromStats(n: number, k: number, stats: Record<number, number>): number[] {
  return Array.from({ length: k - 1 }, (_, i) => {
    const a = ((i + 1) / k) * (n - 1)
    const lo = Math.floor(a)
    const r = a - lo
    return (1 - r) * (stats[lo] ?? 0) + r * (stats[Math.min(lo + 1, n - 1)] ?? stats[lo] ?? 0)
  })
}
