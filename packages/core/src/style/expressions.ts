// MapLibre paint and filters for a resolved style (spec 003 research §4,
// contracts/style-core.md). Plain JSON, so it stays host-agnostic and is
// unit-tested with MapLibre's own expression evaluator.
//
// Thematic renderers compute ONE class-index expression per feature, which
// the class color AND the hidden-class filter both read. The map and the
// legend therefore can't disagree on which class a feature is in, and the
// index rules mirror `classify.ts` exactly (toCategory / toNumber).
import { extrusionHeightExpression } from './extrusion.js'
import { EXPRESSION_VALUE_COLUMN, HEATMAP_METERS, metersPerPixel, type ClusterCountFormat, type ClusterRenderer, type HeatmapRenderer, RULE_CLASS_COLUMN, parseColor, withLayerOpacity, type CategorizedRenderer, type GraduatedRenderer, type LayerStyle, type ResolvedClass, type ResolvedSizeChannel, type ResolvedStyle } from './model.js'
import { legacyView, rendererOf } from './legacy.js'
import { CONTINUOUS_STOPS, ICON_COLOR_STEPS, continuousOutput, isGenericChannel } from './resolve.js'
import { CHANNEL_ORDER, fixedValue, isColorChannel, type ChannelId, type ContinuousScale, type Output, type SymbolPart } from './channels.js'
import type { LineDash, MarkerShape } from './symbol.js'
import { baseSymbol, classSymbols, dashPattern, markerExtent, markerIconId, type SymbolSpec } from './symbol.js'
import { bivariateIndexExpression } from './bivariate.js'
import { LABEL_FONT } from './labelLayer.js'

/**
 * `marker` draws points of a shape other than the circle, from icons
 * (`markerIconId`); `marker-select` is the disc behind them that shows
 * hover and selection (icons can't change with feature state).
 */
export type MapLayerId = 'fill' | 'fill-outline' | 'line' | 'circle' | 'halo' | 'extrusion' | 'marker-select' | 'marker' | 'heatmap'
export type MapPaint = Record<MapLayerId, Record<string, unknown>>

// The focused feature (inspector, table cursor), or a ticked row (spec 008 FR-012): drawn alike.
const selected = ['any', ['boolean', ['feature-state', 'selected'], false], ['boolean', ['feature-state', 'ticked'], false]]
const hovered = ['boolean', ['feature-state', 'hover'], false]

/** Black or white, whichever contrasts with the selection color (research §6: the selection halo). */
export function haloColor(selectionColor: string): string {
  const c = parseColor(selectionColor)
  if (!c) return '#000000'
  const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
  return lum > 0.5 ? '#000000' : '#ffffff'
}

/**
 * The class index of each feature (a position in `resolved.classes`), as a
 * MapLibre expression, or null when the single symbol is drawn (single
 * renderer, or a fallback, FR-012).
 */
export function classIndexExpression(style: LayerStyle, resolved: ResolvedStyle): unknown | null {
  style = legacyView(style)
  if (resolved.status !== 'ok') return null
  const r = rendererOf(style)
  switch (r.kind) {
    case 'single':
      return null
    case 'categorized':
      return categorizedIndex(r, resolved)
    case 'graduated':
      return graduatedIndex(r, resolved)
    case 'bivariate':
      return bivariateIndexExpression(style, resolved)
    case 'rules':
      return rulesIndex(resolved)
    case 'heatmap':
    case 'clusters':
      return null
  }
}

/**
 * Spec 010: the engine's rule index per feature (RULE_CLASS_COLUMN; -1 or
 * missing: everything else). Rule classes come first, in rule order, so a
 * rule's index is its class position.
 */
function rulesIndex(resolved: ResolvedStyle): unknown {
  const n = resolved.classes.filter((c) => c.kind === 'rule').length
  const rest = resolved.classes.findIndex((c) => c.key === '__else')
  const c = ['var', 'c']
  // `to-number` makes a missing value 0 (the first rule): features drawn before the column arrives are "else".
  return ['let', 'c', ['to-number', ['coalesce', ['get', RULE_CLASS_COLUMN], -1], -1], ['case', ['<', c, 0], rest, ['>=', c, n], rest, c]]
}

/** `to-number` fallback for text: far outside any real value, caught with the non-finite guard. */
const NOT_A_NUMBER = -Number.MAX_VALUE

/**
 * Mirrors resolve.ts's graduated branch with `toNumber()`'s rules. MapLibre's
 * `to-number` turns null and "" into 0, so those are caught first (research
 * §4); booleans have no value; text and non-finite numbers land on the
 * sentinel. Then upper-inclusive `<=` tests per class (research §2), the
 * first class also including its lower bound; anything else is "Other".
 */
function graduatedIndex(r: GraduatedRenderer, resolved: ResolvedStyle): unknown {
  // Spec 010: an expression's value is computed by the engine per feature.
  return rangeIndex(r.expression ? EXPRESSION_VALUE_COLUMN : r.column, resolved.classes)
}

/**
 * A feature's position in `classes` (range classes, then "Other" and "No
 * value", keyed `…__other` / `…__null`) for a numeric column: graduated's
 * rules, shared by the size channel (spec 009).
 */
function rangeIndex(column: string, classes: ResolvedClass[]): unknown {
  const noValue = classes.findIndex((c) => c.kind === 'noValue')
  const other = classes.findIndex((c) => c.kind === 'other')
  const v = ['var', 'v']
  const n = ['var', 'n']
  const ranges = classes.flatMap((c, i) => (c.kind === 'range' && c.lower !== undefined && c.upper !== undefined ? [{ i, lower: c.lower, upper: c.upper }] : []))
  const tests: unknown[] = []
  if (ranges.length) tests.push(['<', n, ranges[0].lower], other)
  for (const range of ranges) tests.push(['<=', n, range.upper], range.i)
  const byRange = tests.length ? ['case', ...tests, other] : other
  return [
    'let',
    'v',
    ['get', column],
    [
      'case',
      ['==', v, null],
      noValue,
      ['==', ['typeof', v], 'boolean'],
      noValue,
      ['==', ['to-string', v], ''],
      noValue,
      ['let', 'n', ['to-number', v, NOT_A_NUMBER], ['case', ['>=', ['abs', n], Number.MAX_VALUE], noValue, byRange]],
    ],
  ]
}

/** Position of the class with this key, or -1 (drawn in the fallback color). */
const indexOf = (resolved: ResolvedStyle, key: string): number => resolved.classes.findIndex((c) => c.key === key)

/**
 * Mirrors resolve.ts's categorized branch with `toCategory()`'s rules:
 * null / "" -> "No value"; listed values -> their class; anything else ->
 * "Other". `to-string` equals JS `String()` (research §4).
 */
function categorizedIndex(r: CategorizedRenderer, resolved: ResolvedStyle): unknown {
  const noValue = indexOf(resolved, '__null')
  const other = indexOf(resolved, '__other')
  const arms: unknown[] = []
  resolved.classes.forEach((c, i) => {
    if (c.kind === 'value' && c.value !== undefined) arms.push(c.value, i)
  })
  const v = ['var', 'v']
  const byValue = arms.length ? ['match', ['to-string', v], ...arms, other] : other
  return ['let', 'v', ['get', r.column], ['case', ['==', v, null], noValue, ['==', ['to-string', v], ''], noValue, byValue]]
}

/** Map feature property marking a polygon or line drawn as a dot because it's under ~2 px at this zoom (spec 007; spec 010 option C). */
export const DOT_PROP = '__se_dot'
const DOT = ['boolean', ['get', DOT_PROP], false]
const DOT_RADIUS = 1.75

/** A class value per feature: `match` on the class index (single symbol: the value itself). */
function perClass(index: unknown, symbols: SymbolSpec[], pick: (s: SymbolSpec) => unknown, fallback: unknown): unknown {
  if (index === null) return fallback
  const arms: unknown[] = []
  symbols.forEach((sym, i) => arms.push(i, pick(sym)))
  return arms.length ? ['match', index, ...arms, fallback] : fallback
}

/** As `perClass`, but a plain number when every class has the fallback's (sizes rarely vary). */
function perClassSize(index: unknown, symbols: SymbolSpec[], pick: (s: SymbolSpec) => number, fallback: number): number | unknown[] {
  return symbols.every((sym) => pick(sym) === fallback) ? fallback : (perClass(index, symbols, pick, fallback) as unknown[])
}

const plus = (e: number | unknown[], n: number): number | unknown[] => (typeof e === 'number' ? e + n : ['+', e, n])
const atLeast1 = (e: number | unknown[]): number | unknown[] => (typeof e === 'number' ? Math.max(e, 1) : ['max', e, 1])

/** Spec 009: the size channel drawn on the map, or null (none, a fallback, or a bivariate color channel). */
function activeSize(style: LayerStyle, resolved: ResolvedStyle): ResolvedSizeChannel | null {
  const size = resolved.size
  const kind = rendererOf(style).kind
  return style.size && size?.status === 'ok' && kind !== 'bivariate' && kind !== 'heatmap' && kind !== 'clusters' ? size : null
}

/** The size channel's class position per feature (classed), or null. */
export function sizeIndexExpression(style: LayerStyle, resolved: ResolvedStyle): unknown | null {
  style = legacyView(style)
  const size = activeSize(style, resolved)
  return size && size.mode === 'classed' ? rangeIndex(size.column, size.classes) : null
}

/** A value that counts as "No value" (graduated's rules: null, boolean, "", non-numeric), as an expression. */
function noValueTest(column: string): unknown {
  const v = ['var', 'v']
  return ['let', 'v', ['get', column], ['any', ['==', v, null], ['==', ['typeof', v], 'boolean'], ['==', ['to-string', v], ''], ['>=', ['abs', ['to-number', v, NOT_A_NUMBER]], Number.MAX_VALUE]]]
}

/** Spec 009 US2: the proportional size per feature (research §3); no value gets `fallback`. */
function proportionalExpression(style: LayerStyle, size: ResolvedSizeChannel, fallback: number): unknown {
  const s = style.size as NonNullable<LayerStyle['size']>
  const domain = size.domain as { min: number; max: number }
  const span = domain.max - domain.min
  const n = ['var', 'n']
  const t = ['min', 1, ['max', 0, ['/', ['-', n, domain.min], span]]]
  const scaled = !(span > 0) ? s.sizeMax : ['+', s.sizeMin, ['*', s.sizeMax - s.sizeMin, (s.scale ?? 'linear') === 'area' ? ['sqrt', t] : t]]
  return ['case', noValueTest(size.column), fallback, ['let', 'n', ['to-number', ['get', size.column], NOT_A_NUMBER], scaled]]
}

/** The size per feature from the size channel (`fallback` for no value / outside), or null. */
function channelSize(style: LayerStyle, resolved: ResolvedStyle, fallback: number): number | unknown[] | null {
  const size = activeSize(style, resolved)
  if (!size) return null
  if (size.mode === 'proportional') return size.domain ? (proportionalExpression(style, size, fallback) as unknown[]) : null
  const index = sizeIndexExpression(style, resolved)
  if (index === null) return null
  const arms: unknown[] = []
  size.classes.forEach((c, i) => arms.push(i, c.size ?? fallback))
  return arms.length ? ['match', index, ...arms, fallback] : fallback
}

/** The largest marker radius the style draws: shaped-marker icons are drawn at it and scaled down (never up). */
function largestRadius(style: LayerStyle, resolved: ResolvedStyle): number | null {
  const size = activeSize(style, resolved)
  const generic = genericResolved(style, resolved, 'size')
  if (!size && !generic) return null
  const sizes = generic ? generic.classes.map((c) => Number(c.output ?? 0)) : [...(size?.classes ?? []).map((c) => c.size ?? 0), ...(size?.samples ?? []).map((x) => x.size)]
  return Math.max(baseSymbol(style).radius, ...sizes)
}

// --- Spec 011: channels with categories or classes (resolve.ts genericChannel) ---

/** A generic channel as resolved, when it is drawn (ok), or null. */
function genericResolved(style: LayerStyle, resolved: ResolvedStyle, id: ChannelId) {
  const enc = style.channels?.[id]
  const rc = resolved.channels?.[id]
  return enc && rc && rc.status === 'ok' && isGenericChannel(id, enc) ? rc : null
}

/** A generic channel's class position per feature: categories by value, classes by range (graduated's rules). */
function genericIndex(style: LayerStyle, resolved: ResolvedStyle, id: ChannelId): unknown | null {
  const rc = genericResolved(style, resolved, id)
  if (!rc) return null
  if (style.channels?.[id]?.scale.kind === 'classes') return rangeIndex(rc.dataColumn, rc.classes)
  return valueIndex(rc.dataColumn, rc.classes)
}

/** As `categorizedIndex`, on any column. */
function valueIndex(column: string, classes: ResolvedClass[]): unknown {
  const noValue = classes.findIndex((c) => c.key === '__null')
  const other = classes.findIndex((c) => c.key === '__other')
  const arms: unknown[] = []
  classes.forEach((c, i) => {
    if (c.kind === 'value' && c.value !== undefined) arms.push(c.value, i)
  })
  const v = ['var', 'v']
  const byValue = arms.length ? ['match', ['to-string', v], ...arms, other] : other
  return ['let', 'v', ['get', column], ['case', ['==', v, null], noValue, ['==', ['to-string', v], ''], noValue, byValue]]
}

/** A pattern as MapLibre's `line-dasharray` (solid: one dash with no gap). */
const dashArray = (d: LineDash): number[] => dashPattern(d) ?? [1, 0]

/**
 * Spec 011: a channel's value per feature: a `match` on its class position
 * when it varies by data (generic channels), else its fixed value.
 */
export function channelValue(style: LayerStyle, resolved: ResolvedStyle, id: ChannelId, part: SymbolPart = 'marker', forIcon = false): unknown {
  const fixed = fixedValue(style, id, part)
  const wrap = (v: unknown): unknown => (id === 'dash' ? ['literal', dashArray(v as LineDash)] : v)
  const rc = genericResolved(style, resolved, id)
  // Spec 011 US4: continuous and as is read the value itself.
  if (rc && (rc.scale === 'continuous' || rc.scale === 'identity')) return scaledValue(style, rc, id, fixed, forIcon)
  // Spec 011 US4: conditions, by the rule index the engine computed (-1: everything else).
  if (rc && rc.scale === 'conditions') {
    const rules = rc.classes.filter((c) => c.kind === 'rule')
    const elseOut = wrap(rc.classes.find((c) => c.kind === 'other')?.output ?? fixed)
    const arms = rules.flatMap((c, i) => (c.error ? [] : [i, wrap(c.output ?? fixed)]))
    return arms.length ? ['match', ['to-number', ['get', rc.dataColumn], -1], ...arms, elseOut] : elseOut
  }
  const index = genericIndex(style, resolved, id)
  if (!rc || index === null) return id === 'dash' ? dashPattern(fixed as LineDash) : fixed
  const arms: unknown[] = []
  rc.classes.forEach((c, i) => arms.push(i, wrap(c.output ?? fixed)))
  return arms.length ? ['match', index, ...arms, wrap(fixed)] : wrap(fixed)
}

/** No value for a continuous or as-is property: a number's test, or (as-is colors, a text column) missing or empty. */
function scaledMissing(rc: NonNullable<NonNullable<ResolvedStyle['channels']>[ChannelId]>, id: ChannelId): unknown {
  if (rc.scale !== 'identity' || !isColorChannel(id)) return noValueTest(rc.dataColumn)
  const v = ['var', 'v']
  return ['let', 'v', ['get', rc.dataColumn], ['any', ['==', v, null], ['==', ['to-string', v], '']]]
}

/** Continuous colors on marker icons: this many steps (each step is an icon; research §2). */
export { ICON_COLOR_STEPS }

/**
 * Spec 011 US4: a continuous or as-is property per feature. Continuous runs
 * along the ramp (colors, in RGB as QGIS does) or from the minimum to the
 * maximum output (linear, or by area); as is reads the value (colors that
 * aren't colors, and missing numbers, get the fixed value). No value gets
 * its class's output. On marker icons, colors take ICON_COLOR_STEPS steps
 * and widths quarter pixels, so the icons stay few.
 */
function scaledValue(style: LayerStyle, rc: NonNullable<ResolvedStyle['channels']>[ChannelId], id: ChannelId, fixed: Output, forIcon: boolean): unknown {
  if (!rc) return fixed
  const column = rc.dataColumn
  const noValue = rc.classes.find((c) => c.kind === 'noValue')?.output ?? fixed
  const n = ['var', 'n']
  const color = isColorChannel(id)
  const quarter = (e: unknown): unknown => (forIcon && id === 'strokeWidth' ? ['/', ['round', ['*', e, 4]], 4] : e)
  // Paint needs colors typed as colors inside interpolate and case (MapLibre doesn't coerce there); icon ids need strings.
  const out = (o: unknown): unknown => (color && !forIcon ? ['to-color', o] : o)
  const noValueOut = out(noValue)
  // ...and paint returns them as text: a case in the paint begins with plain hex colors (selection), which fixes its type.
  const text = (e: unknown): unknown => (color && !forIcon ? ['to-string', e] : e)
  let value: unknown
  if (rc.scale === 'identity') {
    if (color) value = forIcon ? ['to-string', ['to-color', ['get', column], fixed]] : ['to-color', ['get', column], fixed]
    else {
      const raw = ['to-number', ['get', column], fixed]
      value = quarter(id === 'opacity' ? ['max', 0, ['min', 1, raw]] : id === 'rotation' ? raw : ['max', 0, raw])
    }
    return text(['case', scaledMissing(rc, id), noValueOut, value])
  }
  const scale = style.channels?.[id]?.scale as ContinuousScale | undefined
  const domain = rc.domain
  if (!scale || !domain) return fixed
  const at = (v: number): Output => continuousOutput(id, scale, domain, v)
  const span = domain.max - domain.min
  if (!(span > 0)) value = out(at(domain.max))
  else if (color && forIcon) {
    // Steps at the middle of each of ICON_COLOR_STEPS equal bins.
    const step: unknown[] = ['step', n, at(domain.min + span / (2 * ICON_COLOR_STEPS))]
    for (let i = 1; i < ICON_COLOR_STEPS; i++) step.push(domain.min + (span * i) / ICON_COLOR_STEPS, at(domain.min + (span * (i + 0.5)) / ICON_COLOR_STEPS))
    value = step
  } else if (color) {
    const stops: unknown[] = ['interpolate', ['linear'], n]
    for (let i = 0; i < CONTINUOUS_STOPS; i++) {
      const v = domain.min + (span * i) / (CONTINUOUS_STOPS - 1)
      stops.push(v, out(at(v)))
    }
    value = stops
  } else if (scale.curve === 'area') {
    const range = { min: Number(at(domain.min)), max: Number(at(domain.max)) }
    const t = ['min', 1, ['max', 0, ['/', ['-', n, domain.min], span]]]
    value = quarter(['+', range.min, ['*', range.max - range.min, ['sqrt', t]]])
  } else value = quarter(['interpolate', ['linear'], n, domain.min, at(domain.min), domain.max, at(domain.max)])
  return text(['case', noValueTest(column), noValueOut, ['let', 'n', ['to-number', ['get', column], NOT_A_NUMBER], value]])
}

/** Whether a channel varies by data in what is drawn (generic channels). */
const varies = (style: LayerStyle, resolved: ResolvedStyle, id: ChannelId): boolean => genericResolved(style, resolved, id) !== null

/** `a × b`, leaving `a` as it is when `b` is a constant 1. */
const times = (a: unknown, b: unknown): unknown => (b === 1 ? a : typeof a === 'number' && typeof b === 'number' ? a * b : ['*', a, b])

/** The class symbols as expressions (unselected): what `paintFor` draws and the Mapbox GL export writes. */
export function symbolExpressions(style: LayerStyle, resolved: ResolvedStyle) {
  style = legacyView(style)
  const index = classIndexExpression(style, resolved)
  const base = baseSymbol(style)
  const symbols = classSymbols(style, resolved)
  // Spec 009: a size channel sets marker radius and line width per feature, on its own column.
  const radius = channelSize(style, resolved, base.radius) ?? perClassSize(index, symbols, (x) => x.radius, base.radius)
  const lineWidth = channelSize(style, resolved, base.lineWidth) ?? perClassSize(index, symbols, (x) => x.lineWidth, base.lineWidth)
  // Spec 011: size and width by categories (generic channels) replace the size channel's.
  const sizeBy = varies(style, resolved, 'size') ? (channelValue(style, resolved, 'size') as unknown[]) : radius
  const widthBy = varies(style, resolved, 'width') ? (channelValue(style, resolved, 'width', 'line') as unknown[]) : lineWidth
  const iconRadius = largestRadius(style, resolved)
  const icon = (x: SymbolSpec) => markerIconId(iconRadius === null ? x : { ...x, radius: iconRadius })
  // Spec 011 US4: a continuous or as-is color (the style type's own) per feature.
  const colorBy = varies(style, resolved, 'color')
  const fillColor = colorBy ? channelValue(style, resolved, 'color') : perClass(index, symbols, (x) => x.fillColor, base.fillColor)
  // Spec 011: shape, outline color or outline width by data: the icon id is built per feature (research §2).
  const perFeatureIcon = colorBy || varies(style, resolved, 'shape') || varies(style, resolved, 'strokeColor') || varies(style, resolved, 'strokeWidth')
  const num = (n: number) => String(Math.round(n * 100) / 100)
  const iconExpr = perFeatureIcon
    ? [
        'concat',
        'se-marker|',
        channelValue(style, resolved, 'shape'),
        '|',
        colorBy ? channelValue(style, resolved, 'color', 'marker', true) : fillColor,
        '|',
        num(base.fillOpacity),
        '|',
        channelValue(style, resolved, 'strokeColor', 'marker', true),
        '|',
        num(base.strokeOpacity),
        '|',
        ['to-string', channelValue(style, resolved, 'strokeWidth', 'marker', true)],
        '|',
        num(iconRadius ?? base.radius),
      ]
    : perClass(index, symbols, icon, icon(base))
  return {
    index,
    fillColor,
    lineColor: colorBy ? channelValue(style, resolved, 'color', 'line') : perClass(index, symbols, (x) => x.lineColor, base.lineColor),
    radius: sizeBy as number | unknown[],
    lineWidth: widthBy as number | unknown[],
    /** Marker icon per feature (shapes other than the circle). */
    icon: iconExpr,
    /** Spec 009: icons are drawn at the largest radius and scaled per feature by the size channel; null = 1. */
    iconSize: iconRadius === null ? null : typeof sizeBy === 'number' ? sizeBy / iconRadius : ['/', sizeBy, iconRadius],
    /** In line widths, for MapLibre `line-dasharray`; null when solid. */
    dash: varies(style, resolved, 'dash') ? channelValue(style, resolved, 'dash', 'line') : dashPattern(style.lineDash),
    /** Spec 011: marker and polygon outline color and width, opacity and marker rotation, per feature or fixed. */
    strokeColor: channelValue(style, resolved, 'strokeColor'),
    strokeWidth: channelValue(style, resolved, 'strokeWidth'),
    opacity: channelValue(style, resolved, 'opacity'),
    rotation: channelValue(style, resolved, 'rotation'),
    /** Spec 011: the shape per feature when it varies, else null (the layers split by `layerFilters`). */
    shape: varies(style, resolved, 'shape') ? channelValue(style, resolved, 'shape') : null,
  }
}

/**
 * Spec 011: extra filters when the shape varies by data: circles stay on the
 * circle layer, every other shape goes to the marker (icon) layer.
 */
export function layerFilters(style: LayerStyle, resolved: ResolvedStyle): Partial<Record<MapLayerId, unknown>> {
  style = legacyView(style)
  if (!varies(style, resolved, 'shape')) return {}
  const shape = channelValue(style, resolved, 'shape')
  const circle: MarkerShape = 'circle'
  return { circle: ['==', shape, circle], marker: ['!=', shape, circle], 'marker-select': ['!=', shape, circle] }
}

/** Spec 011: whether shaped-marker icons are drawn (a fixed shape other than the circle, or a shape by data). */
export function drawsMarkerIcons(style: LayerStyle, resolved: ResolvedStyle): boolean {
  style = legacyView(style)
  return (style.markerShape ?? 'circle') !== 'circle' || varies(style, resolved, 'shape')
}

/** Every marker icon the style draws (the map makes the missing ones and drops the rest). */
export function markerIconIds(style: LayerStyle, resolved: ResolvedStyle): string[] {
  style = legacyView(style)
  // Spec 011: icons built per feature are made when the map asks for them; nothing to list.
  if (varies(style, resolved, 'color') || varies(style, resolved, 'shape') || varies(style, resolved, 'strokeColor') || varies(style, resolved, 'strokeWidth')) return []
  const iconRadius = largestRadius(style, resolved)
  const id = (x: SymbolSpec) => markerIconId(iconRadius === null ? x : { ...x, radius: iconRadius })
  return [...new Set([id(baseSymbol(style)), ...classSymbols(style, resolved).map(id)])]
}

/**
 * Layout properties that follow the style: the marker icon, and butt caps on
 * dashed lines (round caps would fill the gaps of a dotted line).
 */
export function layoutFor(style: LayerStyle, resolved: ResolvedStyle): Partial<Record<MapLayerId, Record<string, unknown>>> {
  style = legacyView(style)
  const dashed = (style.lineDash ?? 'solid') !== 'solid' || varies(style, resolved, 'dash')
  const { icon, iconSize, rotation } = symbolExpressions(style, resolved)
  return {
    line: { 'line-cap': dashed ? 'butt' : 'round' },
    marker: { 'icon-image': icon, ...(iconSize !== null ? { 'icon-size': iconSize } : {}), ...(rotation !== 0 ? { 'icon-rotate': rotation } : {}) },
  }
}

/**
 * The heatmap radius: pixels, or (meters on the ground) pixels that double
 * with each zoom level, converted at the renderer's latitude (else the
 * layer's), so the surface stays put as the map zooms.
 */
export function heatmapRadius(r: HeatmapRenderer, layerLatitude = 0): number | unknown[] {
  if (r.radiusUnit !== 'm') return r.radius
  const px0 = (r.radiusMeters ?? HEATMAP_METERS.default) / metersPerPixel(r.latitude ?? layerLatitude, 0)
  return ['interpolate', ['exponential', 2], ['zoom'], 0, px0, 24, px0 * 2 ** 24]
}

/** True when the map draws points as a heatmap (and their circles only to show hover and selection). */
export function drawsHeatmap(style: LayerStyle, resolved: ResolvedStyle): boolean {
  style = legacyView(style)
  return rendererOf(style).kind === 'heatmap' && resolved.status === 'ok' && !!resolved.heat
}

/**
 * The heatmap's paint (MapLibre and Mapbox GL): zero density transparent,
 * then the ramp; weights as value / the column's largest value (missing or
 * negative values weigh 0). The layer opacity applies.
 */
export function heatmapPaint(style: LayerStyle, resolved: ResolvedStyle, layerLatitude = 0): Record<string, unknown> {
  style = legacyView(style)
  const r = rendererOf(style)
  const heat = resolved.heat
  if (r.kind !== 'heatmap' || !heat) return {}
  const color: unknown[] = ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0, 0, 0, 0)']
  heat.colors.forEach((c, i) => color.push((i + 1) / heat.colors.length, c))
  const w = heat.weight
  return {
    'heatmap-radius': heatmapRadius(r, layerLatitude),
    // Automatic: from the data (resolved.heat.intensity), once known.
    'heatmap-intensity': r.autoIntensity && heat.intensity !== undefined ? heat.intensity : r.intensity,
    'heatmap-weight': w ? ['/', ['max', 0, ['to-number', ['get', w.column], 0]], w.max] : 1,
    'heatmap-color': color,
    'heatmap-opacity': style.layerOpacity ?? 1,
  }
}

// --- Clusters (bubbles) ------------------------------------------------------

/** A group of points (MapLibre's GeoJSON clustering and the engine's tiles both set `point_count`). */
export const CLUSTER_FILTER = ['has', 'point_count']

/** True when the map groups points into clusters (bubbles). */
export function drawsClusters(style: LayerStyle, resolved: ResolvedStyle): boolean {
  style = legacyView(style)
  return rendererOf(style).kind === 'clusters' && resolved.status === 'ok' && !!resolved.clusters
}

/**
 * The count on a bubble, as mapgl writes it: abbreviated (987, 1.2k, 12k,
 * 1.2M), grouped (12,345) or raw (12345). One expression for GeoJSON and
 * tiles alike (tiles have no `point_count_abbreviated`).
 */
export function clusterCountText(format: ClusterCountFormat): unknown {
  const n = ['get', 'point_count']
  if (format === 'grouped') return ['number-format', n, { locale: 'en-US' }]
  if (format === 'raw') return ['to-string', n]
  return [
    'case',
    ['>=', n, 1_000_000],
    ['concat', ['to-string', ['/', ['floor', ['/', n, 100_000]], 10]], 'M'],
    ['>=', n, 10_000],
    ['concat', ['to-string', ['floor', ['/', n, 1000]]], 'k'],
    ['>=', n, 1000],
    ['concat', ['to-string', ['/', ['floor', ['/', n, 100]], 10]], 'k'],
    ['to-string', n],
  ]
}

/** The GeoJSON source's clustering for this style (MapLibre `cluster`, `clusterRadius`, `clusterMaxZoom`). */
export function clusterSourceOptions(style: LayerStyle, resolved: ResolvedStyle): { cluster: boolean; clusterRadius?: number; clusterMaxZoom?: number } {
  if (!drawsClusters(style, resolved)) return { cluster: false }
  const r = rendererOf(legacyView(style))
  return r.kind === 'clusters' ? { cluster: true, clusterRadius: r.radius, clusterMaxZoom: r.maxZoom } : { cluster: false }
}

/** The engine tiles' clustering for this style (grouped in SQL, view/tiles.ts), or null. */
export function clusterTiles(style: LayerStyle): { radius: number; maxZoom: number } | null {
  const r = rendererOf(legacyView(style))
  return r.kind === 'clusters' ? { radius: r.radius, maxZoom: r.maxZoom } : null
}

/** A step expression over the group's size: the first step's value, then each later step's from its count. */
function clusterStep(r: ClusterRenderer, value: (st: ClusterRenderer['steps'][number]) => unknown): unknown {
  if (r.steps.length === 1) return value(r.steps[0])
  return ['step', ['get', 'point_count'], value(r.steps[0]), ...r.steps.slice(1).flatMap((st) => [st.from, value(st)])]
}

/** The bubbles (a circle layer) and their counts (a symbol layer), MapLibre and Mapbox GL alike. */
export function clusterPaint(style: LayerStyle): { bubble: Record<string, unknown>; count: { layout: Record<string, unknown>; paint: Record<string, unknown> } } | null {
  style = legacyView(style)
  const r = rendererOf(style)
  if (r.kind !== 'clusters') return null
  const opacity = r.opacity * (style.layerOpacity ?? 1)
  return {
    bubble: {
      'circle-color': clusterStep(r, (st) => st.color),
      'circle-radius': clusterStep(r, (st) => st.radius),
      'circle-opacity': opacity,
      'circle-stroke-color': r.strokeColor,
      'circle-stroke-width': r.strokeWidth,
      'circle-stroke-opacity': opacity,
    },
    count: {
      layout: { 'text-field': clusterCountText(r.countFormat), 'text-font': LABEL_FONT, 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': r.textColor, 'text-opacity': style.layerOpacity ?? 1 },
    },
  }
}

/** `layerLatitude`: the layer's center, for a heatmap radius in meters that has no latitude of its own. */
export function paintFor(style: LayerStyle, resolved: ResolvedStyle, selectionColor: string, layerLatitude = 0): MapPaint {
  style = legacyView(style)
  // Spec 008: the layer opacity scales the fill and outline opacities.
  const s = withLayerOpacity(style)
  const sel = selectionColor
  // Thematic renderers vary the color (polygon and point fill, and the line
  // color of line layers, FR-006; polygon outlines keep the stroke), or, by
  // size, the marker size and the line width.
  const { index, fillColor, lineColor, radius, lineWidth, dash, strokeColor, strokeWidth, opacity } = symbolExpressions(style, resolved)
  const thematic = index !== null
  const outlineWidth = Math.max(s.strokeWidth, 1) + 1.5
  const lineOutline = plus(atLeast1(lineWidth), 1.5)
  const extent = markerExtent(style.markerShape ?? 'circle')
  // Shaped markers: the disc behind the icon reaches past the shape and its outline.
  const reach = plus(typeof radius === 'number' ? radius * extent : ['*', radius, extent], s.strokeWidth / 2 + 3)
  const dasharray = dash ?? undefined
  // Heatmap: points are drawn by the heatmap; their circles stay (clicks, hover, selection) but show only then.
  const heat = drawsHeatmap(style, resolved)
  const pointShown = (shown: unknown): unknown => (heat ? ['case', selected, 1, hovered, 0.6, DOT, shown, 0] : shown)
  return {
    // Under the outline: a contrasting ring around the selected feature, so
    // selection never depends on hue alone (FR-019). Thematic styles only;
    // spec 001's single symbol is unchanged.
    halo: {
      'line-color': haloColor(sel),
      'line-width': thematic ? ['case', selected, typeof lineWidth === 'number' ? outlineWidth + 4 : plus(lineOutline, 4), 0] : 0,
      'line-opacity': thematic ? 0.85 : 0,
    },
    fill: {
      'fill-color': ['case', selected, sel, fillColor],
      'fill-opacity': ['case', selected, Math.max(s.fillOpacity, 0.6), hovered, Math.min(1, s.fillOpacity + 0.15), times(s.fillOpacity, opacity)],
    },
    'fill-outline': {
      'line-color': ['case', selected, sel, strokeColor],
      'line-width': ['case', selected, outlineWidth, strokeWidth],
      'line-opacity': ['case', selected, 1, times(s.strokeOpacity, opacity)],
      'line-dasharray': dasharray,
    },
    line: {
      'line-color': ['case', selected, sel, lineColor],
      'line-width': ['case', selected, plus(lineOutline, 1), hovered, plus(lineWidth, 1), lineWidth],
      'line-opacity': ['case', selected, 1, times(s.strokeOpacity, opacity)],
      'line-dasharray': dasharray,
    },
    // Spec 008 US6: polygons raised by the extrusion, in the style's colors.
    // Solid, like QGIS 3D (MapLibre extrusion opacity is layer-wide): the
    // layer opacity still applies.
    extrusion: {
      'fill-extrusion-color': ['case', selected, sel, fillColor],
      'fill-extrusion-height': style.extrusion ? extrusionHeightExpression(style.extrusion) : 0,
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': style.layerOpacity ?? 1,
      'fill-extrusion-vertical-gradient': true,
    },
    circle: {
      'circle-color': ['case', selected, sel, fillColor],
      'circle-opacity': heat ? ['case', selected, 1, DOT, Math.max(s.fillOpacity, 0.05), 0] : ['case', selected, 1, times(Math.max(s.fillOpacity, 0.05), opacity)],
      // A polygon or line under ~2 px at this zoom is drawn as a small dot (DOT_PROP; spec 010 option C).
      'circle-radius': ['case', selected, plus(radius, 2), DOT, DOT_RADIUS, hovered, plus(radius, 1), radius],
      'circle-stroke-color': ['case', selected, thematic ? haloColor(sel) : '#ffffff', strokeColor],
      'circle-stroke-width': ['case', selected, 2, DOT, 0, strokeWidth],
      'circle-stroke-opacity': pointShown(['case', selected, 1, times(s.strokeOpacity, opacity)]),
    },
    heatmap: heatmapPaint(style, resolved, layerLatitude),
    // Hover and selection of shaped markers: a disc in the selection color behind the icon.
    'marker-select': {
      'circle-color': sel,
      'circle-radius': reach,
      'circle-opacity': ['case', selected, 0.9, hovered, 0.35, 0],
      'circle-stroke-color': haloColor(sel),
      'circle-stroke-width': ['case', selected, 1.5, 0],
    },
    // The icons carry their own colors and opacities (`markerIconId`).
    marker: opacity === 1 ? {} : { 'icon-opacity': opacity },
  }
}

/** Hides features of hidden classes (FR-009), in the color or (spec 009) the size channel; null = everything visible. */
export function visibilityFilter(style: LayerStyle, resolved: ResolvedStyle): unknown | null {
  style = legacyView(style)
  const tests: unknown[] = []
  const index = classIndexExpression(style, resolved)
  if (index !== null) {
    const hidden = resolved.classes.flatMap((c, i) => (c.visible ? [] : [i]))
    if (hidden.length) tests.push(['!', ['in', index, ['literal', hidden]]])
  }
  const sizeIndex = sizeIndexExpression(style, resolved)
  const size = activeSize(style, resolved)
  if (sizeIndex !== null && size) {
    const hidden = size.classes.flatMap((c, i) => (c.visible ? [] : [i]))
    if (hidden.length) tests.push(['!', ['in', sizeIndex, ['literal', hidden]]])
  } else if (size?.mode === 'proportional' && size.classes.some((c) => c.kind === 'noValue' && !c.visible)) {
    // Proportional: only "No value" can be hidden.
    tests.push(['!', noValueTest(size.column)])
  }
  // Spec 011: a class hidden in any other channel hides its features too.
  for (const id of CHANNEL_ORDER) {
    const rc = genericResolved(style, resolved, id)
    // Spec 011 US4: conditions hide by rule index (-1: everything else).
    if (rc && rc.scale === 'conditions') {
      const rules = rc.classes.filter((c) => c.kind === 'rule')
      const hidden = [...rules.flatMap((c, i) => (c.visible ? [] : [i])), ...(rc.classes.find((c) => c.kind === 'other')?.visible === false ? [-1] : [])]
      if (hidden.length) tests.push(['!', ['in', ['to-number', ['get', rc.dataColumn], -1], ['literal', hidden]]])
      continue
    }
    // Spec 011 US4: continuous and as is have only "No value" to hide.
    if (rc && (rc.scale === 'continuous' || rc.scale === 'identity')) {
      if (rc.classes.some((c) => c.kind === 'noValue' && !c.visible)) tests.push(['!', scaledMissing(rc, id)])
      continue
    }
    const index = rc ? genericIndex(style, resolved, id) : null
    if (!rc || index === null) continue
    const hidden = rc.classes.flatMap((c, i) => (c.visible ? [] : [i]))
    if (hidden.length) tests.push(['!', ['in', index, ['literal', hidden]]])
  }
  return tests.length === 0 ? null : tests.length === 1 ? tests[0] : ['all', ...tests]
}
