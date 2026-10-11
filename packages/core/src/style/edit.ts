// Style edits (spec 003 FR-009, data-model.md "Transitions"). Every function
// returns a new LayerStyle; nothing is mutated.
import { DEFAULT_CATEGORY_CAP, DEFAULT_CLASS_COUNT, DEFAULT_LAYER_STYLE, rendererOf, type ClassOverride, type LayerStyle, type Renderer } from './model.js'
import { toCategory } from './classify.js'
import { defaultRamp } from './ramps.js'
import { eligibleColumns, type ResolveInput } from './resolve.js'

const TEXTUAL = /^(VARCHAR|TEXT|STRING|CHAR|BPCHAR|ENUM|BOOLEAN)/i

function distinctCount(layer: ResolveInput | null, column: string, stopAt = Infinity): number {
  const seen = new Set<string>()
  for (const f of layer?.features ?? []) {
    const v = toCategory(f.attributes[column])
    if (v !== null) seen.add(v)
    if (seen.size > stopAt) break
  }
  return seen.size
}

/**
 * A fresh renderer of `kind` for the displayed result: the given column, or
 * a sensible one (categorized prefers a text column with 2-12 distinct
 * values, as GeoLibre's suggestion does; graduated takes the first numeric
 * column), with the default ramp, method and class count.
 */
export function startRenderer(kind: Renderer['kind'], layer: ResolveInput | null, column?: string): Renderer {
  if (kind === 'single') return { kind: 'single' }
  const columns = eligibleColumns(layer?.columns, kind)
  if (kind === 'categorized') {
    const pick =
      column ??
      columns.find((c) => TEXTUAL.test(c.type) && distinctCount(layer, c.name, DEFAULT_CATEGORY_CAP) >= 2 && distinctCount(layer, c.name, DEFAULT_CATEGORY_CAP) <= DEFAULT_CATEGORY_CAP)?.name ??
      columns.find((c) => TEXTUAL.test(c.type))?.name ??
      columns[0]?.name ??
      ''
    const n = Math.min(distinctCount(layer, pick, DEFAULT_CATEGORY_CAP), DEFAULT_CATEGORY_CAP)
    return { kind: 'categorized', column: pick, ramp: defaultRamp('categorized', n), cap: DEFAULT_CATEGORY_CAP, manual: false, classes: [], other: {}, noValue: {} }
  }
  return {
    kind: 'graduated',
    column: column ?? columns[0]?.name ?? '',
    method: 'quantile',
    classCount: DEFAULT_CLASS_COUNT,
    ramp: defaultRamp('graduated', DEFAULT_CLASS_COUNT),
    classes: [],
    noValue: {},
  }
}

/** Applies `patch` to the override of the class with `key` (`v:<value>`, `range:<i>`, `__other`, `__null`). */
function patchClass(style: LayerStyle, key: string, patch: ClassOverride): LayerStyle {
  const r = rendererOf(style)
  if (r.kind === 'single') return style
  if (key === '__null') return { ...style, renderer: { ...r, noValue: { ...r.noValue, ...patch } } }
  if (r.kind === 'categorized') {
    if (key === '__other') return { ...style, renderer: { ...r, other: { ...r.other, ...patch } } }
    if (!key.startsWith('v:')) return style
    const value = key.slice(2)
    const found = r.classes.some((c) => c.value === value)
    const classes = found ? r.classes.map((c) => (c.value === value ? { ...c, ...patch } : c)) : [...r.classes, { value, ...patch }]
    return { ...style, renderer: { ...r, classes } }
  }
  if (!key.startsWith('range:')) return style
  const index = Number(key.slice(6))
  const found = r.classes.some((c) => c.index === index)
  const classes = found ? r.classes.map((c) => (c.index === index ? { ...c, ...patch } : c)) : [...r.classes, { index, ...patch }]
  return { ...style, renderer: { ...r, classes } }
}

/** FR-009: hides or shows a class on the map. Keeps the method and the manual flag. */
export function setClassVisible(style: LayerStyle, key: string, visible: boolean): LayerStyle {
  return patchClass(style, key, { visible })
}

/**
 * Symbol settings for class colors: spec 001's default blue outline and 45%
 * fill wash class colors out and read like a class of their own, so a
 * thematic renderer starts, as in QGIS, with a thin neutral outline and a
 * stronger fill. Only settings still at their defaults change.
 */
export const THEMATIC_SYMBOL = Object.freeze({ fillOpacity: 0.75, strokeColor: '#4b5563', strokeOpacity: 0.8, strokeWidth: 0.75 })

/** Switches the renderer (or its column), adjusting untouched symbol defaults for thematic renderers. */
export function startStyle(style: LayerStyle, kind: Renderer['kind'], layer: ResolveInput | null, column?: string): LayerStyle {
  const next: LayerStyle = { ...style, renderer: startRenderer(kind, layer, column) }
  const wasThematic = rendererOf(style).kind !== 'single'
  // Into a thematic renderer: untouched spec 001 defaults become the thematic
  // ones. Back to single: untouched thematic defaults become spec 001's again.
  const [from, to] = kind === 'single' ? [THEMATIC_SYMBOL, DEFAULT_LAYER_STYLE] : [DEFAULT_LAYER_STYLE, THEMATIC_SYMBOL]
  if (kind === 'single' && !wasThematic) return next
  for (const key of ['fillOpacity', 'strokeColor', 'strokeOpacity', 'strokeWidth'] as const) {
    if (style[key] === from[key]) (next as unknown as Record<string, unknown>)[key] = to[key]
  }
  return next
}
