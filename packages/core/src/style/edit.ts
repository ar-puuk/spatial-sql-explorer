// Style edits (spec 003 FR-009, data-model.md "Transitions"). Every function
// returns a new LayerStyle; nothing is mutated.
import {
  DEFAULT_BIVARIATE_PALETTE,
  DEFAULT_CATEGORY_CAP,
  DEFAULT_CLASS_COUNT,
  DEFAULT_LAYER_STYLE,
  MAX_CLASS_COUNT,
  MIN_CLASS_COUNT,
  rendererOf,
  type CategorizedRenderer,
  type ClassOverride,
  type GraduatedMethod,
  type GraduatedRenderer,
  type LayerStyle,
  type RampRef,
  type BivariateAxis,
  type BivariateRenderer,
  type RangeClassDef,
  type Renderer,
  type ResolvedStyle,
  type SizeChannel,
  type SizeMode,
} from './model.js'
import { toCategory } from './classify.js'
import { defaultRamp } from './ramps.js'
import { DEFAULT_SIZE_RANGE } from './symbol.js'
import { eligibleColumns, valuesOf, type ResolveInput } from './resolve.js'

const TEXTUAL = /^(VARCHAR|TEXT|STRING|CHAR|BPCHAR|ENUM|BOOLEAN)/i

function distinctCount(layer: ResolveInput | null, column: string, stopAt = Infinity): number {
  // Spec 007: counted by the engine for results whose values aren't fetched.
  const known = layer?.distinct?.[column]
  if (known !== undefined) return known
  const seen = new Set<string>()
  for (const value of layer ? valuesOf(layer, column) : []) {
    const v = toCategory(value)
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
  // Spec 009: bivariate takes two numeric columns (the given one first).
  if (kind === 'bivariate') {
    const numeric = eligibleColumns(layer?.columns, 'graduated').map((c) => c.name)
    const x = column ?? numeric[0] ?? ''
    const y = numeric.find((c) => c !== x) ?? ''
    return { kind: 'bivariate', x: { column: x, method: 'quantile' }, y: { column: y, method: 'quantile' }, palette: DEFAULT_BIVARIATE_PALETTE, hidden: [], noValue: {} }
  }
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
  if (r.kind === 'single' || r.kind === 'bivariate') return style
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
  // Spec 009: bivariate cells and their "No value".
  if (rendererOf(style).kind === 'bivariate') return setCellVisible(style, key, visible)
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

/** FR-009: a class's color. Keeps the method and the manual flag. */
export function setClassColor(style: LayerStyle, key: string, color: string): LayerStyle {
  return patchClass(style, key, { color })
}

/** FR-009: a class's label. An empty label goes back to the generated one. */
export function setClassLabel(style: LayerStyle, key: string, label: string): LayerStyle {
  const trimmed = label.trim()
  if (trimmed) return patchClass(style, key, { label: trimmed })
  const r = rendererOf(style)
  if (r.kind === 'single' || r.kind === 'bivariate') return style
  const strip = <T extends ClassOverride>(o: T): T => {
    const rest = { ...o }
    delete rest.label
    return rest
  }
  if (key === '__null') return { ...style, renderer: { ...r, noValue: strip(r.noValue) } }
  if (r.kind === 'categorized') {
    if (key === '__other') return { ...style, renderer: { ...r, other: strip(r.other) } }
    return { ...style, renderer: { ...r, classes: r.classes.map((c) => (`v:${c.value}` === key ? strip(c) : c)) } }
  }
  return { ...style, renderer: { ...r, classes: r.classes.map((c) => (`range:${c.index}` === key ? strip(c) : c)) } }
}

export function setRamp(style: LayerStyle, ramp: RampRef): LayerStyle {
  const r = rendererOf(style)
  return r.kind === 'single' || r.kind === 'bivariate' ? style : { ...style, renderer: { ...r, ramp } }
}

/** A method recomputes the classes; color, label and visibility overrides by index are kept. */
export function setMethod(style: LayerStyle, method: Exclude<GraduatedMethod, 'manual'>): LayerStyle {
  const r = rendererOf(style)
  if (r.kind !== 'graduated') return style
  const classes = r.classes.map((c) => {
    const o = { ...c }
    delete o.lower
    delete o.upper
    return o
  })
  return { ...style, renderer: { ...r, method, classes } }
}

export function setClassCount(style: LayerStyle, classCount: number): LayerStyle {
  const r = rendererOf(style)
  if (r.kind !== 'graduated') return style
  const n = Math.max(MIN_CLASS_COUNT, Math.min(MAX_CLASS_COUNT, Math.round(classCount)))
  return { ...style, renderer: { ...r, classCount: n, method: r.method === 'manual' ? 'quantile' : r.method, classes: [] } }
}

/** Categorized back to automatic classes (by frequency); overrides that still match by value are kept. */
export function setCategorizedAuto(style: LayerStyle): LayerStyle {
  const r = rendererOf(style)
  if (r.kind !== 'categorized' || !r.manual) return style
  const classes = r.classes.filter((c) => c.color !== undefined || c.label !== undefined || c.visible === false)
  return { ...style, renderer: { ...r, manual: false, classes } }
}

// --- Edits that fix the class list (Manual), FR-009 --------------------------

const overrideOf = (o: ClassOverride | undefined): ClassOverride => {
  const out: ClassOverride = {}
  if (o?.color !== undefined) out.color = o.color
  if (o?.label !== undefined) out.label = o.label
  if (o?.visible === false) out.visible = false
  return out
}

/** The categorized class list as currently resolved, as a manual list (positions keep their ramp colors). */
function manualCategories(r: CategorizedRenderer, resolved: ResolvedStyle): CategorizedRenderer {
  if (r.manual) return r
  const byValue = new Map(r.classes.map((c) => [c.value, c]))
  const classes = resolved.classes.flatMap((c) => (c.kind === 'value' && c.value !== undefined ? [{ value: c.value, ...overrideOf(byValue.get(c.value)) }] : []))
  return { ...r, manual: true, classes }
}

/** The graduated ranges as currently resolved, as manual ranges. */
function manualRanges(r: GraduatedRenderer, resolved: ResolvedStyle): GraduatedRenderer {
  if (r.method === 'manual') return r
  const byIndex = new Map(r.classes.map((c) => [c.index, c]))
  const classes: RangeClassDef[] = []
  for (const c of resolved.classes) {
    if (c.kind !== 'range' || c.lower === undefined || c.upper === undefined) continue
    const index = classes.length
    classes.push({ index, lower: c.lower, upper: c.upper, ...overrideOf(byIndex.get(index)) })
  }
  return { ...r, method: 'manual', classCount: Math.max(classes.length, MIN_CLASS_COUNT), classes }
}

/**
 * A graduated bound (switches to Manual). The neighbouring class moves with
 * it, so the ranges stay contiguous; `validateStyle` reports a bound that
 * crosses its class's other bound.
 */
export function setClassBound(style: LayerStyle, resolved: ResolvedStyle, index: number, side: 'lower' | 'upper', value: number): LayerStyle {
  const r = rendererOf(style)
  if (r.kind !== 'graduated' || !Number.isFinite(value)) return style
  const m = manualRanges(r, resolved)
  const classes = m.classes.map((c) => ({ ...c }))
  const target = classes.find((c) => c.index === index)
  if (!target) return style
  target[side] = value
  const neighbour = classes.find((c) => c.index === (side === 'lower' ? index - 1 : index + 1))
  if (neighbour) neighbour[side === 'lower' ? 'upper' : 'lower'] = value
  return { ...style, renderer: { ...m, classes } }
}

/** A category's value (switches to Manual). */
export function setCategoryValue(style: LayerStyle, resolved: ResolvedStyle, key: string, value: string): LayerStyle {
  const r = rendererOf(style)
  if (r.kind !== 'categorized' || !key.startsWith('v:')) return style
  const m = manualCategories(r, resolved)
  const old = key.slice(2)
  return { ...style, renderer: { ...m, classes: m.classes.map((c) => (c.value === old ? { ...c, value } : c)) } }
}

/** Adds a class (switches to Manual): a new category, or the last range split at its midpoint. */
export function addClass(style: LayerStyle, resolved: ResolvedStyle): LayerStyle {
  const r = rendererOf(style)
  if (r.kind === 'categorized') {
    const m = manualCategories(r, resolved)
    const taken = new Set(m.classes.map((c) => c.value))
    let n = 1
    while (taken.has(`New value ${n}`)) n++
    return { ...style, renderer: { ...m, classes: [...m.classes, { value: `New value ${n}` }] } }
  }
  if (r.kind === 'graduated') {
    const m = manualRanges(r, resolved)
    if (m.classes.length >= MAX_CLASS_COUNT) return style
    const last = m.classes[m.classes.length - 1]
    if (!last || last.lower === undefined || last.upper === undefined) return style
    const mid = (last.lower + last.upper) / 2
    const classes = [...m.classes.slice(0, -1), { ...last, upper: mid }, { index: last.index + 1, lower: mid, upper: last.upper }]
    return { ...style, renderer: { ...m, classCount: classes.length, classes } }
  }
  return style
}

/** Deletes a class (switches to Manual). A deleted range's span goes to its neighbour. */
export function deleteClass(style: LayerStyle, resolved: ResolvedStyle, key: string): LayerStyle {
  const r = rendererOf(style)
  if (r.kind === 'categorized' && key.startsWith('v:')) {
    const m = manualCategories(r, resolved)
    return { ...style, renderer: { ...m, classes: m.classes.filter((c) => c.value !== key.slice(2)) } }
  }
  if (r.kind === 'graduated' && key.startsWith('range:')) {
    const m = manualRanges(r, resolved)
    if (m.classes.length <= 1) return style
    const index = Number(key.slice(6))
    const pos = m.classes.findIndex((c) => c.index === index)
    if (pos === -1) return style
    const removed = m.classes[pos]
    const rest = m.classes.filter((_, i) => i !== pos).map((c) => ({ ...c }))
    if (pos > 0) rest[pos - 1].upper = removed.upper
    else rest[0].lower = removed.lower
    const classes = rest.map((c, i) => ({ ...c, index: i }))
    return { ...style, renderer: { ...m, classCount: Math.max(classes.length, MIN_CLASS_COUNT), classes } }
  }
  return style
}

// --- Spec 009: the size channel (data-model.md SizeChannel, contracts/style-core.md) ------

/** Class keys of the size channel: `size:range:<i>`, `size:__other`, `size:__null`. */
const SIZE = 'size:'

/**
 * Turns the size channel on for `column` (keeping its other settings when it
 * was on), or off with null. Defaults suit the geometry: marker radius 2-10
 * px for points, line width 1-6 px for lines (DEFAULT_SIZE_RANGE).
 */
export function setSizeChannel(style: LayerStyle, column: string | null, geometry: 'point' | 'line'): LayerStyle {
  // Off: `size: undefined` (not a deleted key), so it also clears through a patch merge (store.setStyle).
  if (column === null) return { ...style, size: undefined }
  const was = style.size
  if (was) return { ...style, size: { ...was, column, method: was.method === 'manual' ? 'quantile' : was.method, classes: [] } }
  const range = DEFAULT_SIZE_RANGE[geometry]
  const size: SizeChannel = {
    column,
    mode: 'classed',
    method: 'quantile',
    classCount: DEFAULT_CLASS_COUNT,
    classes: [],
    noValue: {},
    sizeMin: range.min,
    sizeMax: range.max,
    // Proportional markers scale by area, lines by width (research §3).
    scale: geometry === 'point' ? 'area' : 'linear',
  }
  return { ...style, size }
}

function withSize(style: LayerStyle, patch: (s: SizeChannel) => SizeChannel): LayerStyle {
  return style.size ? { ...style, size: patch(style.size) } : style
}

/** Classed or proportional (US2). Proportional has no classes: their overrides are dropped. */
export function setSizeMode(style: LayerStyle, mode: SizeMode): LayerStyle {
  return withSize(style, (s) => (s.mode === mode ? s : { ...s, mode, classes: [], method: s.method === 'manual' ? 'quantile' : s.method }))
}

/** A method recomputes the size classes; label and visibility overrides by index are kept. */
export function setSizeMethod(style: LayerStyle, method: Exclude<GraduatedMethod, 'manual'>): LayerStyle {
  return withSize(style, (s) => ({
    ...s,
    method,
    classes: s.classes.map((c) => {
      const o = { ...c }
      delete o.lower
      delete o.upper
      return o
    }),
  }))
}

export function setSizeClassCount(style: LayerStyle, classCount: number): LayerStyle {
  const n = Math.max(MIN_CLASS_COUNT, Math.min(MAX_CLASS_COUNT, Math.round(classCount)))
  return withSize(style, (s) => ({ ...s, classCount: n, method: s.method === 'manual' ? 'quantile' : s.method, classes: [] }))
}

/** The smallest and largest class size, px (validateStyle checks them). */
export function setSizeRange(style: LayerStyle, sizeMin: number, sizeMax: number): LayerStyle {
  return withSize(style, (s) => ({ ...s, sizeMin, sizeMax }))
}

/** Applies `patch` to a size class (`size:range:<i>`) or to No value (`size:__null`). */
function patchSizeClass(style: LayerStyle, key: string, patch: { label?: string; visible?: boolean }, drop?: 'label'): LayerStyle {
  return withSize(style, (s) => {
    const apply = <T extends { label?: string; visible?: boolean }>(o: T): T => {
      const next = { ...o, ...patch }
      if (drop) delete next[drop]
      if (next.visible === true) delete next.visible
      return next
    }
    if (key === `${SIZE}__null`) return { ...s, noValue: apply(s.noValue) }
    if (!key.startsWith(`${SIZE}range:`)) return s
    const index = Number(key.slice(`${SIZE}range:`.length))
    const found = s.classes.some((c) => c.index === index)
    const classes = found ? s.classes.map((c) => (c.index === index ? apply(c) : c)) : [...s.classes, apply({ index } as RangeClassDef)]
    return { ...s, classes }
  })
}

/** A size class's label; an empty label goes back to the generated one. */
export function setSizeClassLabel(style: LayerStyle, key: string, label: string): LayerStyle {
  const trimmed = label.trim()
  return trimmed ? patchSizeClass(style, key, { label: trimmed }) : patchSizeClass(style, key, {}, 'label')
}

/** Hides or shows a size class (and its features) on the map. */
export function setSizeClassVisible(style: LayerStyle, key: string, visible: boolean): LayerStyle {
  return patchSizeClass(style, key, { visible })
}

/** A size class bound (switches to Manual); the neighbouring class moves with it, as graduated bounds do. */
export function setSizeClassBound(style: LayerStyle, resolved: ResolvedStyle, index: number, side: 'lower' | 'upper', value: number): LayerStyle {
  const s = style.size
  if (!s || s.mode !== 'classed' || !Number.isFinite(value)) return style
  let classes: RangeClassDef[] = s.classes
  if (s.method !== 'manual') {
    const byIndex = new Map(s.classes.map((c) => [c.index, c]))
    classes = []
    for (const c of resolved.size?.classes ?? []) {
      if (c.kind !== 'range' || c.lower === undefined || c.upper === undefined) continue
      const i = classes.length
      const o = byIndex.get(i)
      classes.push({ index: i, lower: c.lower, upper: c.upper, ...(o?.label !== undefined ? { label: o.label } : {}), ...(o?.visible === false ? { visible: false } : {}) })
    }
  }
  const next = classes.map((c) => ({ ...c }))
  const target = next.find((c) => c.index === index)
  if (!target) return style
  target[side] = value
  const neighbour = next.find((c) => c.index === (side === 'lower' ? index - 1 : index + 1))
  if (neighbour) neighbour[side === 'lower' ? 'upper' : 'lower'] = value
  return { ...style, size: { ...s, method: 'manual', classCount: Math.max(next.length, MIN_CLASS_COUNT), classes: next } }
}

// --- Spec 009 US4: bivariate (data-model.md BivariateRenderer) -----------------

function withBivariate(style: LayerStyle, patch: (r: BivariateRenderer) => BivariateRenderer): LayerStyle {
  const r = rendererOf(style)
  return r.kind === 'bivariate' ? { ...style, renderer: patch(r) } : style
}

/** An axis's column or method; only that axis is reclassified. */
export function setBivariateAxis(style: LayerStyle, axis: 'x' | 'y', patch: Partial<BivariateAxis>): LayerStyle {
  return withBivariate(style, (r) => ({ ...r, [axis]: { ...r[axis], ...patch } }))
}

/** Swaps the axes; hidden cells follow (transposed). */
export function swapBivariateAxes(style: LayerStyle): LayerStyle {
  return withBivariate(style, (r) => ({ ...r, x: r.y, y: r.x, hidden: r.hidden.map((k) => k.split('-').reverse().join('-')) }))
}

export function setBivariatePalette(style: LayerStyle, palette: string): LayerStyle {
  return withBivariate(style, (r) => ({ ...r, palette }))
}

/** Hides or shows a cell (`cell:<i>-<j>`) or "No value" (`__null`). */
export function setCellVisible(style: LayerStyle, key: string, visible: boolean): LayerStyle {
  return withBivariate(style, (r) => {
    if (key === '__null') {
      const noValue = { ...r.noValue }
      if (visible) delete noValue.visible
      else noValue.visible = false
      return { ...r, noValue }
    }
    if (!key.startsWith('cell:')) return r
    const cell = key.slice(5)
    const hidden = r.hidden.filter((k) => k !== cell)
    return { ...r, hidden: visible ? hidden : [...hidden, cell] }
  })
}
