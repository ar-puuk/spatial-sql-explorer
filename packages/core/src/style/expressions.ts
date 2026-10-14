// MapLibre paint and filters for a resolved style (spec 003 research §4,
// contracts/style-core.md). Plain JSON, so it stays host-agnostic and is
// unit-tested with MapLibre's own expression evaluator.
//
// Thematic renderers compute ONE class-index expression per feature, which
// the class color AND the hidden-class filter both read. The map and the
// legend therefore can't disagree on which class a feature is in, and the
// index rules mirror `classify.ts` exactly (toCategory / toNumber).
import { extrusionHeightExpression } from './extrusion.js'
import { EXPRESSION_VALUE_COLUMN, HEATMAP_METERS, metersPerPixel, type HeatmapRenderer, RULE_CLASS_COLUMN, parseColor, rendererOf, withLayerOpacity, type CategorizedRenderer, type GraduatedRenderer, type LayerStyle, type ResolvedClass, type ResolvedSizeChannel, type ResolvedStyle } from './model.js'
import { baseSymbol, classSymbols, dashPattern, markerExtent, markerIconId, type SymbolSpec } from './symbol.js'
import { bivariateIndexExpression } from './bivariate.js'

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
  return style.size && size?.status === 'ok' && kind !== 'bivariate' && kind !== 'heatmap' ? size : null
}

/** The size channel's class position per feature (classed), or null. */
export function sizeIndexExpression(style: LayerStyle, resolved: ResolvedStyle): unknown | null {
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
  if (!size) return null
  return Math.max(baseSymbol(style).radius, ...size.classes.map((c) => c.size ?? 0), ...(size.samples ?? []).map((x) => x.size))
}

/** The class symbols as expressions (unselected): what `paintFor` draws and the Mapbox GL export writes. */
export function symbolExpressions(style: LayerStyle, resolved: ResolvedStyle) {
  const index = classIndexExpression(style, resolved)
  const base = baseSymbol(style)
  const symbols = classSymbols(style, resolved)
  // Spec 009: a size channel sets marker radius and line width per feature, on its own column.
  const radius = channelSize(style, resolved, base.radius) ?? perClassSize(index, symbols, (x) => x.radius, base.radius)
  const lineWidth = channelSize(style, resolved, base.lineWidth) ?? perClassSize(index, symbols, (x) => x.lineWidth, base.lineWidth)
  const iconRadius = largestRadius(style, resolved)
  const icon = (x: SymbolSpec) => markerIconId(iconRadius === null ? x : { ...x, radius: iconRadius })
  return {
    index,
    fillColor: perClass(index, symbols, (x) => x.fillColor, base.fillColor),
    lineColor: perClass(index, symbols, (x) => x.lineColor, base.lineColor),
    radius: radius as number | unknown[],
    lineWidth: lineWidth as number | unknown[],
    /** Marker icon per feature (shapes other than the circle). */
    icon: perClass(index, symbols, icon, icon(base)),
    /** Spec 009: icons are drawn at the largest radius and scaled per feature by the size channel; null = 1. */
    iconSize: iconRadius === null ? null : typeof radius === 'number' ? radius / iconRadius : ['/', radius, iconRadius],
    /** In line widths, for MapLibre `line-dasharray`; null when solid. */
    dash: dashPattern(style.lineDash),
  }
}

/** Every marker icon the style draws (the map makes the missing ones and drops the rest). */
export function markerIconIds(style: LayerStyle, resolved: ResolvedStyle): string[] {
  const iconRadius = largestRadius(style, resolved)
  const id = (x: SymbolSpec) => markerIconId(iconRadius === null ? x : { ...x, radius: iconRadius })
  return [...new Set([id(baseSymbol(style)), ...classSymbols(style, resolved).map(id)])]
}

/**
 * Layout properties that follow the style: the marker icon, and butt caps on
 * dashed lines (round caps would fill the gaps of a dotted line).
 */
export function layoutFor(style: LayerStyle, resolved: ResolvedStyle): Partial<Record<MapLayerId, Record<string, unknown>>> {
  const dashed = (style.lineDash ?? 'solid') !== 'solid'
  const { icon, iconSize } = symbolExpressions(style, resolved)
  return {
    line: { 'line-cap': dashed ? 'butt' : 'round' },
    marker: { 'icon-image': icon, ...(iconSize !== null ? { 'icon-size': iconSize } : {}) },
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
  return rendererOf(style).kind === 'heatmap' && resolved.status === 'ok' && !!resolved.heat
}

/**
 * The heatmap's paint (MapLibre and Mapbox GL): zero density transparent,
 * then the ramp; weights as value / the column's largest value (missing or
 * negative values weigh 0). The layer opacity applies.
 */
export function heatmapPaint(style: LayerStyle, resolved: ResolvedStyle, layerLatitude = 0): Record<string, unknown> {
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

/** `layerLatitude`: the layer's center, for a heatmap radius in meters that has no latitude of its own. */
export function paintFor(style: LayerStyle, resolved: ResolvedStyle, selectionColor: string, layerLatitude = 0): MapPaint {
  // Spec 008: the layer opacity scales the fill and outline opacities.
  const s = withLayerOpacity(style)
  const sel = selectionColor
  // Thematic renderers vary the color (polygon and point fill, and the line
  // color of line layers, FR-006; polygon outlines keep the stroke), or, by
  // size, the marker size and the line width.
  const { index, fillColor, lineColor, radius, lineWidth, dash } = symbolExpressions(style, resolved)
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
      'fill-opacity': ['case', selected, Math.max(s.fillOpacity, 0.6), hovered, Math.min(1, s.fillOpacity + 0.15), s.fillOpacity],
    },
    'fill-outline': {
      'line-color': ['case', selected, sel, s.strokeColor],
      'line-width': ['case', selected, outlineWidth, s.strokeWidth],
      'line-opacity': ['case', selected, 1, s.strokeOpacity],
      'line-dasharray': dasharray,
    },
    line: {
      'line-color': ['case', selected, sel, lineColor],
      'line-width': ['case', selected, plus(lineOutline, 1), hovered, plus(lineWidth, 1), lineWidth],
      'line-opacity': ['case', selected, 1, s.strokeOpacity],
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
      'circle-opacity': heat ? ['case', selected, 1, DOT, Math.max(s.fillOpacity, 0.05), 0] : ['case', selected, 1, Math.max(s.fillOpacity, 0.05)],
      // A polygon or line under ~2 px at this zoom is drawn as a small dot (DOT_PROP; spec 010 option C).
      'circle-radius': ['case', selected, plus(radius, 2), DOT, DOT_RADIUS, hovered, plus(radius, 1), radius],
      'circle-stroke-color': ['case', selected, thematic ? haloColor(sel) : '#ffffff', s.strokeColor],
      'circle-stroke-width': ['case', selected, 2, DOT, 0, s.strokeWidth],
      'circle-stroke-opacity': pointShown(['case', selected, 1, s.strokeOpacity]),
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
    marker: {},
  }
}

/** Hides features of hidden classes (FR-009), in the color or (spec 009) the size channel; null = everything visible. */
export function visibilityFilter(style: LayerStyle, resolved: ResolvedStyle): unknown | null {
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
  return tests.length === 0 ? null : tests.length === 1 ? tests[0] : ['all', ...tests]
}
