// Style edits (spec 003 FR-009, data-model.md "Transitions"). Every function
// returns a new LayerStyle; nothing is mutated.
import {
  DEFAULT_BIVARIATE_PALETTE,
  DEFAULT_CATEGORY_CAP,
  DEFAULT_CLASS_COUNT,
  DEFAULT_ELSE_LABEL,
  DEFAULT_HEATMAP_RAMP,
  DEFAULT_LAYER_STYLE,
  HEATMAP_INTENSITY,
  HEATMAP_METERS,
  HEATMAP_RADIUS,
  MAX_CLASS_COUNT,
  metersPerPixel,
  OTHER_COLOR,
  MIN_CLASS_COUNT,
  type CategorizedRenderer,
  type ClassOverride,
  type GraduatedMethod,
  type GraduatedRenderer,
  type HeatmapRenderer,
  type LayerStyle,
  type RampRef,
  type BivariateAxis,
  type BivariateRenderer,
  type RangeClassDef,
  type Renderer,
  type ResolvedStyle,
  type RuleDef,
  type RulesRenderer,
  type SizeChannel,
  type SizeMode,
} from './model.js'
import { rendererOf, sizeOf, toChannelShape } from './legacy.js'
import { toCategory } from './classify.js'
import { defaultRamp, rampById, rampColors } from './ramps.js'
import { DEFAULT_SIZE_RANGE, type LineDash, type MarkerShape } from './symbol.js'
import { eligibleColumns, isNumericType, measureColumns, valuesOf, type ResolveInput } from './resolve.js'
import { sanitizeLabels, type LabelAnchor, type LabelSettings } from './labels.js'
import {
  OUTPUT_KIND,
  categoryCapFor,
  isColorChannel,
  isOutputFor,
  type CategoriesScale,
  type ChannelId,
  type ClassDef,
  type ClassesScale,
  type Encoding,
  type Output,
  type Scale,
  type SymbolPart,
} from './channels.js'

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
    // Identifier-like columns go last, so the default axes are measures (spec 009 SC-002).
    const numeric = measureColumns(layer?.columns).map((c) => c.name)
    const x = column ?? numeric[0] ?? ''
    const y = numeric.find((c) => c !== x) ?? ''
    return { kind: 'bivariate', x: { column: x, method: 'quantile' }, y: { column: y, method: 'quantile' }, palette: DEFAULT_BIVARIATE_PALETTE, hidden: [], noValue: {} }
  }
  // Spec 010: rules start empty; the panel fills in suggestions from the data (suggestedRules).
  if (kind === 'rules') return { kind: 'rules', rules: [], elseColor: OTHER_COLOR, elseVisible: true, elseLabel: DEFAULT_ELSE_LABEL }
  // Each point counts once until a weight column is chosen.
  if (kind === 'heatmap') {
    return { kind: 'heatmap', weight: column ?? '', radius: HEATMAP_RADIUS.default, intensity: HEATMAP_INTENSITY.default, ramp: { id: DEFAULT_HEATMAP_RAMP, reversed: false } }
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
  if (r.kind === 'single' || r.kind === 'bivariate' || r.kind === 'heatmap') return style
  // Spec 010: `rule:<id>` and `__else`.
  if (r.kind === 'rules') {
    if (key === RULES_ELSE_KEY) {
      return setRulesElse(style, {
        ...(patch.color !== undefined ? { elseColor: patch.color } : {}),
        ...(patch.label !== undefined ? { elseLabel: patch.label } : {}),
        ...(patch.visible !== undefined ? { elseVisible: patch.visible } : {}),
      })
    }
    return key.startsWith('rule:') ? updateRule(style, key.slice(5), patch as Partial<RuleDef>) : style
  }
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
  // A heatmap draws no class symbols: the symbol settings stay as they are.
  const classed = (k: Renderer['kind']) => k !== 'single' && k !== 'heatmap'
  const wasThematic = classed(rendererOf(style).kind)
  if (kind === 'heatmap' || (kind === 'single' && !wasThematic)) return next
  // Into a thematic renderer: untouched spec 001 defaults become the thematic
  // ones. Back to single: untouched thematic defaults become spec 001's again.
  const [from, to] = classed(kind) ? [DEFAULT_LAYER_STYLE, THEMATIC_SYMBOL] : [THEMATIC_SYMBOL, DEFAULT_LAYER_STYLE]
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
  if (r.kind === 'single' || r.kind === 'bivariate' || r.kind === 'heatmap') return style
  if (r.kind === 'rules') return key === RULES_ELSE_KEY ? setRulesElse(style, { elseLabel: DEFAULT_ELSE_LABEL }) : key.startsWith('rule:') ? updateRule(style, key.slice(5), { label: '' }) : style
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
  return r.kind === 'single' || r.kind === 'bivariate' || r.kind === 'rules' ? style : { ...style, renderer: { ...r, ramp } }
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
  const was = sizeOf(style)
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
  const was = sizeOf(style)
  return was ? { ...style, size: patch(was) } : style
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
  const s = sizeOf(style)
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

/**
 * An axis's column or method; only that axis is reclassified. Choosing the
 * column the other axis uses swaps the two columns (the axes stay different).
 */
export function setBivariateAxis(style: LayerStyle, axis: 'x' | 'y', patch: Partial<BivariateAxis>): LayerStyle {
  return withBivariate(style, (r) => {
    const other = axis === 'x' ? 'y' : 'x'
    const next = { ...r, [axis]: { ...r[axis], ...patch } }
    if (patch.column !== undefined && patch.column === r[other].column && patch.column !== r[axis].column) next[other] = { ...r[other], column: r[axis].column }
    return next
  })
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

// --- Spec 010: rules -----------------------------------------------------------

/** The "Everything else" class key of a rules renderer (`rule:<id>` for the rules). */
export const RULES_ELSE_KEY = '__else'

function withRules(style: LayerStyle, patch: (r: RulesRenderer) => Partial<RulesRenderer>): LayerStyle {
  const r = rendererOf(style)
  return r.kind === 'rules' ? { ...style, renderer: { ...r, ...patch(r) } } : style
}

/** A rule id not used yet. */
function newRuleId(rules: readonly RuleDef[]): string {
  const used = new Set(rules.map((r) => r.id))
  let i = rules.length + 1
  while (used.has(`r${i}`)) i++
  return `r${i}`
}

/** A qualitative color for the n-th rule (Set2, as categorized starts with). */
function ruleColor(n: number): string {
  const colors = rampColors({ id: 'brewer-set2', reversed: false }, 8)
  return colors[n % colors.length]
}

/** Adds a rule at the end (empty condition: it matches nothing until written). */
export function addRule(style: LayerStyle, where = '', label = ''): LayerStyle {
  return withRules(style, (r) => ({ rules: [...r.rules, { id: newRuleId(r.rules), label, where, color: ruleColor(r.rules.length), visible: true }] }))
}

export function updateRule(style: LayerStyle, id: string, patch: Partial<Omit<RuleDef, 'id'>>): LayerStyle {
  return withRules(style, (r) => ({ rules: r.rules.map((x) => (x.id === id ? { ...x, ...patch, id } : x)) }))
}

export function removeRule(style: LayerStyle, id: string): LayerStyle {
  return withRules(style, (r) => ({ rules: r.rules.filter((x) => x.id !== id) }))
}

/** Moves a rule up (-1) or down (+1): order matters, the first matching rule wins. */
export function moveRule(style: LayerStyle, id: string, by: -1 | 1): LayerStyle {
  return withRules(style, (r) => {
    const i = r.rules.findIndex((x) => x.id === id)
    const j = i + by
    if (i < 0 || j < 0 || j >= r.rules.length) return {}
    const rules = [...r.rules]
    ;[rules[i], rules[j]] = [rules[j], rules[i]]
    return { rules }
  })
}

export function setRulesElse(style: LayerStyle, patch: Partial<Pick<RulesRenderer, 'elseColor' | 'elseLabel' | 'elseVisible'>>): LayerStyle {
  return withRules(style, () => patch)
}

/** What the data suggests for a first rule set (the engine finds these: QuerySession.ruleSuggestions). */
export interface RuleSuggestions {
  /** The first numeric (measure) column and its median. */
  numeric?: { column: string; median: number }
  /** The first text column and its most common value. */
  text?: { column: string; value: string }
}

/** A column name as SQL: bare when it is a plain lower-case identifier, else double-quoted. */
export function sqlColumnName(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`
}

/** Two example rules from the data: the numeric column above its median, the text column equal to its most common value. */
export function suggestedRules(s: RuleSuggestions): RuleDef[] {
  const out: RuleDef[] = []
  if (s.numeric) {
    const m = Number(s.numeric.median.toPrecision(3))
    out.push({ id: 'r1', label: '', where: `${sqlColumnName(s.numeric.column)} > ${m}`, color: ruleColor(0), visible: true })
  }
  if (s.text) out.push({ id: `r${out.length + 1}`, label: '', where: `${sqlColumnName(s.text.column)} = '${s.text.value.replace(/'/g, "''")}'`, color: ruleColor(out.length), visible: true })
  return out
}

/** Heatmap: the weight column ('' = each point counts once), radius or intensity, kept within their ranges. */
export function setHeatmap(style: LayerStyle, patch: Partial<Pick<HeatmapRenderer, 'weight' | 'radius' | 'intensity' | 'radiusUnit' | 'radiusMeters' | 'latitude' | 'autoIntensity'>>): LayerStyle {
  const r = rendererOf(style)
  if (r.kind !== 'heatmap') return style
  const clamp = (v: number, b: { min: number; max: number }) => Math.min(b.max, Math.max(b.min, v))
  return {
    ...style,
    renderer: {
      ...r,
      ...(patch.weight !== undefined ? { weight: patch.weight } : {}),
      ...(patch.radius !== undefined && Number.isFinite(patch.radius) ? { radius: clamp(patch.radius, HEATMAP_RADIUS) } : {}),
      ...(patch.intensity !== undefined && Number.isFinite(patch.intensity) ? { intensity: clamp(patch.intensity, HEATMAP_INTENSITY) } : {}),
      ...(patch.radiusUnit !== undefined ? { radiusUnit: patch.radiusUnit } : {}),
      ...(patch.autoIntensity !== undefined ? { autoIntensity: patch.autoIntensity } : {}),
      ...(patch.radiusMeters !== undefined && Number.isFinite(patch.radiusMeters) ? { radiusMeters: clamp(patch.radiusMeters, HEATMAP_METERS) } : {}),
      ...(patch.latitude !== undefined && Number.isFinite(patch.latitude) ? { latitude: Math.min(85, Math.max(-85, patch.latitude)) } : {}),
    },
  }
}

/**
 * Heatmap: measures the radius in screen pixels or ground meters. With the
 * current view (`latitude`, `zoom`), the new radius matches what is on
 * screen, so the map doesn't jump; meters keep that latitude for converting.
 */
export function setHeatmapRadiusUnit(style: LayerStyle, unit: 'px' | 'm', view: { latitude: number; zoom: number } | null): LayerStyle {
  const r = rendererOf(style)
  if (r.kind !== 'heatmap' || (r.radiusUnit ?? 'px') === unit) return style
  const twoDigits = (v: number) => Number(v.toPrecision(2))
  if (unit === 'm') {
    const latitude = view?.latitude ?? r.latitude ?? 0
    const meters = view ? twoDigits(r.radius * metersPerPixel(latitude, view.zoom)) : (r.radiusMeters ?? HEATMAP_METERS.default)
    return setHeatmap(style, { radiusUnit: 'm', radiusMeters: meters, latitude })
  }
  const px = view && r.radiusMeters ? Math.round(r.radiusMeters / metersPerPixel(r.latitude ?? view.latitude, view.zoom)) : r.radius
  // On screen the densest spot changes with zoom: automatic intensity ends.
  return setHeatmap(style, { radiusUnit: 'px', radius: px, autoIntensity: false })
}

/**
 * Heatmap: intensity from the data, or the slider's. Automatic needs the
 * radius in meters, so turning it on with pixels switches (keeping the size
 * on screen at `view`).
 */
export function setHeatmapAutoIntensity(style: LayerStyle, on: boolean, view: { latitude: number; zoom: number } | null): LayerStyle {
  const r = rendererOf(style)
  if (r.kind !== 'heatmap') return style
  const inMeters = on && (r.radiusUnit ?? 'px') === 'px' ? setHeatmapRadiusUnit(style, 'm', view) : style
  return setHeatmap(inMeters, { autoIntensity: on })
}

// --- Spec 011: one property at a time (contracts/style-core.md) ----------------

/**
 * A property's fixed value: written to the layer symbol field it reads from
 * (`fixedValue`). A line's Color is the stroke color (spec 001's look).
 */
export function setFixed(style: LayerStyle, channel: ChannelId, value: Output, part: SymbolPart = 'fill'): LayerStyle {
  if (!isOutputFor(channel, value)) return style
  const s = toChannelShape(style)
  switch (channel) {
    case 'color':
      return part === 'line' ? { ...s, strokeColor: value as string } : { ...s, fillColor: value as string }
    case 'strokeColor':
      return { ...s, strokeColor: value as string }
    case 'strokeWidth':
      return { ...s, strokeWidth: value as number }
    case 'size':
      return { ...s, pointRadius: value as number }
    case 'width':
      return { ...s, lineWidth: value as number }
    case 'shape':
      return withoutDefault({ ...s, markerShape: value as MarkerShape }, 'markerShape', 'circle')
    case 'dash':
      return withoutDefault({ ...s, lineDash: value as LineDash }, 'lineDash', 'solid')
    case 'opacity':
      return withoutDefault({ ...s, opacity: value as number }, 'opacity', 1)
    case 'rotation':
      return withoutDefault({ ...s, rotation: value as number }, 'rotation', 0)
    case 'height':
      return { ...s, height: { meters: value as number } }
  }
}

/**
 * A default value is left unset. `undefined` rather than a deleted key: the
 * store merges edits into the style as a patch, and a missing key would keep
 * the old value.
 */
function withoutDefault<K extends keyof LayerStyle>(style: LayerStyle, key: K, def: LayerStyle[K]): LayerStyle {
  return style[key] !== def ? style : { ...style, [key]: undefined }
}

/** A property By column (`enc`), or back to Fixed (null). */
export function setEncoding(style: LayerStyle, channel: ChannelId, enc: Encoding | null): LayerStyle {
  const s = toChannelShape(style)
  const channels = { ...s.channels }
  if (enc) channels[channel] = enc
  else delete channels[channel]
  // Undefined, not deleted, when the last property goes back to Fixed (see withoutDefault).
  return { ...s, channels: Object.keys(channels).length ? channels : undefined }
}

function isTextColumn(layer: ResolveInput | null, column: string): boolean {
  const type = layer?.columns.find((c) => c.name === column)?.type ?? ''
  return !isNumericType(type)
}

/** Output ranges a numeric property starts with (px, 0..1, degrees, meters). */
export const CHANNEL_RANGES: Readonly<Partial<Record<ChannelId, { min: number; max: number }>>> = Object.freeze({
  strokeWidth: { min: 0.5, max: 4 },
  size: { min: DEFAULT_SIZE_RANGE.point.min, max: DEFAULT_SIZE_RANGE.point.max },
  width: { min: DEFAULT_SIZE_RANGE.line.min, max: DEFAULT_SIZE_RANGE.line.max },
  opacity: { min: 0.3, max: 1 },
  rotation: { min: 0, max: 315 },
  height: { min: 0, max: 100 },
})

/**
 * A new encoding for a property set by `column` (data-model "Default scale"):
 * categories for text, classes (quantile, 5) for numbers, and always
 * categories for shapes and patterns. Outputs come from a ramp (colors) or a
 * range (numbers) until the user sets them.
 */
export function startEncoding(channel: ChannelId, column: string, layer: ResolveInput | null): Encoding {
  const kind = OUTPUT_KIND[channel]
  const text = isTextColumn(layer, column) || kind === 'shape' || kind === 'dash'
  const color = isColorChannel(channel)
  const range = CHANNEL_RANGES[channel]
  const source = { kind: 'column' as const, column }
  if (text) {
    const scale: CategoriesScale = {
      kind: 'categories',
      manual: false,
      categories: [],
      other: {},
      noValue: {},
      cap: categoryCapFor(channel),
      ...(color ? { ramp: defaultRamp('categorized', distinctCount(layer, column, DEFAULT_CATEGORY_CAP + 1)) } : {}),
      ...(range ? { range: { ...range } } : {}),
    }
    return { source, scale }
  }
  const scale: ClassesScale = {
    kind: 'classes',
    method: 'quantile',
    classCount: DEFAULT_CLASS_COUNT,
    classes: [],
    noValue: {},
    ...(color ? { ramp: defaultRamp('graduated', DEFAULT_CLASS_COUNT) } : {}),
    ...(range ? { range: { ...range } } : {}),
  }
  return { source, scale }
}

/** Applies `patch` to a property's encoding (no change when the property is Fixed). */
export function patchEncoding(style: LayerStyle, channel: ChannelId, patch: (e: Encoding) => Encoding): LayerStyle {
  const s = toChannelShape(style)
  const enc = s.channels?.[channel]
  return enc ? setEncoding(s, channel, patch(enc)) : s
}

/** A property's column. The kind of scale is chosen again for the column; a ramp or range the user chose is kept. */
export function setChannelColumn(style: LayerStyle, channel: ChannelId, column: string, layer: ResolveInput | null): LayerStyle {
  const s = toChannelShape(style)
  const was = s.channels?.[channel]
  const fresh = startEncoding(channel, column, layer)
  if (!was || was.scale.kind !== fresh.scale.kind) return setEncoding(s, channel, fresh)
  const old = was.scale as CategoriesScale | ClassesScale
  const keep = { ...(old.ramp ? { ramp: old.ramp } : {}), ...(old.range ? { range: old.range } : {}) }
  return setEncoding(s, channel, { ...fresh, scale: { ...fresh.scale, ...keep } as Scale, ...(was.legend ? { legend: was.legend } : {}) })
}

/** A class's output, label or visibility, by its resolved key (`v:<value>`, `range:<i>`, `__other`, `__null`). */
export function setChannelClass(style: LayerStyle, channel: ChannelId, key: string, patch: ClassDef): LayerStyle {
  const merge = (d: ClassDef): ClassDef => {
    const out: ClassDef = { ...d, ...patch }
    if (out.visible !== false) delete out.visible
    return out
  }
  return patchEncoding(style, channel, (e) => {
    const scale = e.scale
    if (scale.kind === 'categories') {
      if (key === '__other') return { ...e, scale: { ...scale, other: merge(scale.other) } }
      if (key === '__null') return { ...e, scale: { ...scale, noValue: merge(scale.noValue) } }
      if (!key.startsWith('v:')) return e
      const value = key.slice(2)
      const found = scale.categories.some((c) => c.value === value)
      const categories = found ? scale.categories.map((c) => (c.value === value ? { ...merge(c), value } : c)) : [...scale.categories, { value, ...merge({}) }]
      return { ...e, scale: { ...scale, categories } }
    }
    // Spec 011 US4: continuous and as is have only "No value".
    if (scale.kind === 'continuous' || scale.kind === 'identity') return key === '__null' ? { ...e, scale: { ...scale, noValue: merge(scale.noValue) } } : e
    if (scale.kind === 'classes') {
      if (key === '__null') return { ...e, scale: { ...scale, noValue: merge(scale.noValue) } }
      if (!key.startsWith('range:')) return e
      const index = Number(key.slice('range:'.length))
      const found = scale.classes.some((c) => c.index === index)
      const classes = found ? scale.classes.map((c) => (c.index === index ? { ...merge(c), index } : c)) : [...scale.classes, { index, ...merge({}) }]
      return { ...e, scale: { ...scale, classes } }
    }
    return e
  })
}

/**
 * A property's kind of scale; its ramp or range is kept, classes start over.
 * Spec 011 US4: continuous (a sequential ramp, or the range; markers sized
 * by area) and as is.
 */
export function setScaleKind(style: LayerStyle, channel: ChannelId, kind: Scale['kind'], _layer: ResolveInput | null): LayerStyle {
  void _layer
  return patchEncoding(style, channel, (e) => {
    if (e.scale.kind === kind) return e
    const old = e.scale as { ramp?: RampRef; range?: { min: number; max: number } }
    const keep = { ...(old.ramp ? { ramp: old.ramp } : {}), ...(old.range ? { range: old.range } : {}) }
    const color = isColorChannel(channel)
    const range = CHANNEL_RANGES[channel]
    if (kind === 'categories') return { ...e, scale: { kind: 'categories', manual: false, categories: [], other: {}, noValue: {}, cap: categoryCapFor(channel), ...keep } }
    if (kind === 'classes') return { ...e, scale: { kind: 'classes', method: 'quantile', classCount: DEFAULT_CLASS_COUNT, classes: [], noValue: {}, ...keep } }
    if (kind === 'continuous') {
      // A categorized palette doesn't run smoothly: continuous colors start from a sequential ramp.
      const ramp = old.ramp && rampById(old.ramp.id)?.kind !== 'qualitative' ? old.ramp : defaultRamp('graduated', DEFAULT_CLASS_COUNT)
      return { ...e, scale: { kind: 'continuous', noValue: {}, ...(color ? { ramp } : { range: old.range ?? (range ? { ...range } : { min: 0, max: 1 }) }), ...(channel === 'size' ? { curve: 'area' as const } : {}) } }
    }
    if (kind === 'identity') return { ...e, scale: { kind: 'identity', noValue: {} } }
    return e
  })
}

/** Spec 011 US4: a continuous property's domain (null: the column's minimum to maximum). */
export function setChannelDomain(style: LayerStyle, channel: ChannelId, domain: { min: number; max: number } | null): LayerStyle {
  return patchEncoding(style, channel, (e) => {
    if (e.scale.kind !== 'continuous') return e
    const { domain: _d, ...rest } = e.scale
    void _d
    if (!domain || !Number.isFinite(domain.min) || !Number.isFinite(domain.max) || domain.min === domain.max) return { ...e, scale: rest }
    return { ...e, scale: { ...rest, domain: { min: Math.min(domain.min, domain.max), max: Math.max(domain.min, domain.max) } } }
  })
}

/** Spec 011 US4: a continuous number's curve (linear, or by area, as QGIS's size assistant). */
export function setChannelCurve(style: LayerStyle, channel: ChannelId, curve: 'linear' | 'area'): LayerStyle {
  return patchEncoding(style, channel, (e) => (e.scale.kind === 'continuous' && !isColorChannel(channel) ? { ...e, scale: { ...e.scale, curve } } : e))
}

/** The classification method and class count of a property with classes (overrides by index start over). */
export function setChannelClasses(style: LayerStyle, channel: ChannelId, patch: { method?: Exclude<GraduatedMethod, 'manual'>; classCount?: number }): LayerStyle {
  return patchEncoding(style, channel, (e) => {
    if (e.scale.kind !== 'classes') return e
    const n = patch.classCount === undefined ? e.scale.classCount : Math.min(MAX_CLASS_COUNT, Math.max(MIN_CLASS_COUNT, Math.round(patch.classCount)))
    const method = patch.method ?? (e.scale.method === 'manual' ? 'quantile' : e.scale.method)
    return { ...e, scale: { ...e.scale, method, classCount: n, classes: [] } }
  })
}

/** The smallest and largest output of a numeric property (classes spread between them). */
export function setChannelRange(style: LayerStyle, channel: ChannelId, min: number, max: number): LayerStyle {
  if (!isOutputFor(channel, min) || !isOutputFor(channel, max)) return style
  const range = { min: Math.min(min, max), max: Math.max(min, max) }
  return patchEncoding(style, channel, (e) => (e.scale.kind === 'categories' || e.scale.kind === 'classes' || e.scale.kind === 'continuous' ? { ...e, scale: { ...e.scale, range } } : e))
}

/** A color property's ramp. */
export function setChannelRamp(style: LayerStyle, channel: ChannelId, ramp: RampRef): LayerStyle {
  return patchEncoding(style, channel, (e) => (e.scale.kind === 'categories' || e.scale.kind === 'classes' || e.scale.kind === 'continuous' ? { ...e, scale: { ...e.scale, ramp } } : e))
}

/** Hides a property's group from the legend (the map is unchanged), or shows it again. */
export function setLegendHidden(style: LayerStyle, channel: ChannelId, hidden: boolean): LayerStyle {
  return patchEncoding(style, channel, (e) => {
    const legend = { ...e.legend }
    if (hidden) legend.hidden = true
    else delete legend.hidden
    const out: Encoding = { ...e, legend }
    if (!Object.keys(legend).length) delete out.legend
    return out
  })
}

// --- Spec 011 US6: labels -----------------------------------------------------

/** A change to the label settings; halo and placement merge with the current ones. */
export type LabelPatch = Partial<Omit<LabelSettings, 'halo' | 'placement'>> & {
  halo?: Partial<LabelSettings['halo']>
  placement?: { anchor?: LabelAnchor; offset?: number }
}

/** The column labels start with: a name-like text column, else the first text column, else the first column. */
export function defaultLabelColumn(columns: ReadonlyArray<{ name: string; type: string }>): string | null {
  const usable = columns.filter((c) => !c.name.startsWith('__se_') && !/^(GEOMETRY|BLOB|WKB)/i.test(c.type))
  const text = usable.filter((c) => /^(VARCHAR|TEXT|STRING)/i.test(c.type))
  return (text.find((c) => /^(name|label|title)$/i.test(c.name)) ?? text.find((c) => /name|label|title/i.test(c.name)) ?? text[0] ?? usable[0])?.name ?? null
}

/**
 * Spec 011 US6: the style with its labels changed. Turning labels on with no
 * text yet starts from `defaultLabelColumn` (nothing to label: unchanged).
 */
export function setLabels(style: LayerStyle, patch: LabelPatch, columns: ReadonlyArray<{ name: string; type: string }> = []): LayerStyle {
  const current = style.labels
  const fallback = defaultLabelColumn(columns)
  const source = patch.source ?? current?.source ?? (fallback ? { kind: 'column' as const, column: fallback } : null)
  if (!source) return style
  const placement = { kind: 'point', ...(current?.placement.kind === 'point' ? current.placement : {}), ...patch.placement }
  const labels = sanitizeLabels({ ...current, ...patch, source, halo: { ...current?.halo, ...patch.halo }, placement })
  return { ...style, labels }
}
