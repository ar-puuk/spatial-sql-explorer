// From a style + the displayed result to what the map, legend and panel
// draw (spec 003 data-model.md ResolvedStyle). Pure; recomputed whenever the
// style or the result changes. Classes cover every row of the displayed
// result and nothing else (FR-005).
import type { Layer } from '../models.js'
import { NO_VALUE_COLOR, OTHER_COLOR, rendererOf, type CategorizedRenderer, type LayerStyle, type ResolvedClass, type ResolvedStyle } from './model.js'
import { compareCategories, toCategory } from './classify.js'
import { rampById, rampColors } from './ramps.js'

export type ResolveInput = Pick<Layer, 'features' | 'columns'>

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
    classes: [{ key: 'single', kind: 'single', label: 'All features', color: style.fillColor, visible: true, count: layer?.features.length ?? 0 }],
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
    default:
      return single(style, layer) // graduated (US2)
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
  for (const f of layer.features) {
    const v = toCategory(f.attributes[r.column])
    if (v === null) nulls++
    else counts.set(v, (counts.get(v) ?? 0) + 1)
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
