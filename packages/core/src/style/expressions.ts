// MapLibre paint and filters for a resolved style (spec 003 research §4,
// contracts/style-core.md). Plain JSON, so it stays host-agnostic and is
// unit-tested with MapLibre's own expression evaluator.
//
// Thematic renderers compute ONE class-index expression per feature, which
// the class color AND the hidden-class filter both read. The map and the
// legend therefore can't disagree on which class a feature is in, and the
// index rules mirror `classify.ts` exactly (toCategory / toNumber).
import { extrusionHeightExpression } from './extrusion.js'
import { parseColor, rendererOf, withLayerOpacity, type CategorizedRenderer, type GraduatedRenderer, type LayerStyle, type ResolvedStyle } from './model.js'
import { baseSymbol, classSymbols, dashPattern, markerExtent, markerIconId, type SymbolSpec } from './symbol.js'

/**
 * `marker` draws points of a shape other than the circle, from icons
 * (`markerIconId`); `marker-select` is the disc behind them that shows
 * hover and selection (icons can't change with feature state).
 */
export type MapLayerId = 'fill' | 'fill-outline' | 'line' | 'circle' | 'halo' | 'extrusion' | 'marker-select' | 'marker'
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
  }
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
  const noValue = indexOf(resolved, '__null')
  const other = indexOf(resolved, '__other')
  const v = ['var', 'v']
  const n = ['var', 'n']
  const ranges = resolved.classes.flatMap((c, i) => (c.kind === 'range' && c.lower !== undefined && c.upper !== undefined ? [{ i, lower: c.lower, upper: c.upper }] : []))
  const tests: unknown[] = []
  if (ranges.length) tests.push(['<', n, ranges[0].lower], other)
  for (const range of ranges) tests.push(['<=', n, range.upper], range.i)
  const byRange = tests.length ? ['case', ...tests, other] : other
  return [
    'let',
    'v',
    ['get', r.column],
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

/** Map feature property marking a polygon or line drawn as a dot because it's under ~2 px in the view (spec 007). */
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

/** The class symbols as expressions (unselected): what `paintFor` draws and the Mapbox GL export writes. */
export function symbolExpressions(style: LayerStyle, resolved: ResolvedStyle) {
  const index = classIndexExpression(style, resolved)
  const base = baseSymbol(style)
  const symbols = classSymbols(style, resolved)
  return {
    index,
    fillColor: perClass(index, symbols, (x) => x.fillColor, base.fillColor),
    lineColor: perClass(index, symbols, (x) => x.lineColor, base.lineColor),
    radius: perClassSize(index, symbols, (x) => x.radius, base.radius),
    lineWidth: perClassSize(index, symbols, (x) => x.lineWidth, base.lineWidth),
    /** Marker icon per feature (shapes other than the circle). */
    icon: perClass(index, symbols, markerIconId, markerIconId(base)),
    /** In line widths, for MapLibre `line-dasharray`; null when solid. */
    dash: dashPattern(style.lineDash),
  }
}

/** Every marker icon the style draws (the map makes the missing ones and drops the rest). */
export function markerIconIds(style: LayerStyle, resolved: ResolvedStyle): string[] {
  return [...new Set([markerIconId(baseSymbol(style)), ...classSymbols(style, resolved).map(markerIconId)])]
}

/**
 * Layout properties that follow the style: the marker icon, and butt caps on
 * dashed lines (round caps would fill the gaps of a dotted line).
 */
export function layoutFor(style: LayerStyle, resolved: ResolvedStyle): Partial<Record<MapLayerId, Record<string, unknown>>> {
  const dashed = (style.lineDash ?? 'solid') !== 'solid'
  return {
    line: { 'line-cap': dashed ? 'butt' : 'round' },
    marker: { 'icon-image': symbolExpressions(style, resolved).icon },
  }
}

export function paintFor(style: LayerStyle, resolved: ResolvedStyle, selectionColor: string): MapPaint {
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
      'circle-opacity': ['case', selected, 1, Math.max(s.fillOpacity, 0.05)],
      // Spec 007: a polygon or line under ~2 px in the current view is drawn as a small dot (DOT_PROP).
      'circle-radius': ['case', selected, plus(radius, 2), DOT, DOT_RADIUS, hovered, plus(radius, 1), radius],
      'circle-stroke-color': ['case', selected, thematic ? haloColor(sel) : '#ffffff', s.strokeColor],
      'circle-stroke-width': ['case', selected, 2, DOT, 0, s.strokeWidth],
      'circle-stroke-opacity': ['case', selected, 1, s.strokeOpacity],
    },
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

/** Hides features of hidden classes (FR-009); null = everything visible. */
export function visibilityFilter(style: LayerStyle, resolved: ResolvedStyle): unknown | null {
  const index = classIndexExpression(style, resolved)
  if (index === null) return null
  const hidden = resolved.classes.flatMap((c, i) => (c.visible ? [] : [i]))
  if (!hidden.length) return null
  return ['!', ['in', index, ['literal', hidden]]]
}
