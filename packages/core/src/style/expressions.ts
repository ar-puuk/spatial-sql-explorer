// MapLibre paint and filters for a resolved style (spec 003 research §4,
// contracts/style-core.md). Plain JSON, so it stays host-agnostic and is
// unit-tested with MapLibre's own expression evaluator.
//
// Thematic renderers compute ONE class-index expression per feature, which
// the class color AND the hidden-class filter both read. The map and the
// legend therefore can't disagree on which class a feature is in, and the
// index rules mirror `classify.ts` exactly (toCategory / toNumber).
import { parseColor, rendererOf, type CategorizedRenderer, type GraduatedRenderer, type LayerStyle, type ResolvedStyle } from './model.js'

export type MapLayerId = 'fill' | 'fill-outline' | 'line' | 'circle' | 'halo'
export type MapPaint = Record<MapLayerId, Record<string, unknown>>

const selected = ['boolean', ['feature-state', 'selected'], false]
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

/** The class color per feature: `match` on the class index. */
function classColorExpression(index: unknown, resolved: ResolvedStyle, fallback: string): unknown {
  const arms: unknown[] = []
  resolved.classes.forEach((c, i) => arms.push(i, c.color))
  return arms.length ? ['match', index, ...arms, fallback] : fallback
}

export function paintFor(style: LayerStyle, resolved: ResolvedStyle, selectionColor: string): MapPaint {
  const s = style
  const sel = selectionColor
  const index = classIndexExpression(style, resolved)
  const thematic = index !== null
  // Thematic renderers vary only the color: polygon and point fill, and the
  // line color of line layers (FR-006). Polygon outlines keep the stroke.
  const fillColor = thematic ? classColorExpression(index, resolved, s.fillColor) : s.fillColor
  const lineColor = thematic ? classColorExpression(index, resolved, s.strokeColor) : s.strokeColor
  const outlineWidth = Math.max(s.strokeWidth, 1) + 1.5
  return {
    // Under the outline: a contrasting ring around the selected feature, so
    // selection never depends on hue alone (FR-019). Thematic styles only;
    // spec 001's single symbol is unchanged.
    halo: {
      'line-color': haloColor(sel),
      'line-width': thematic ? ['case', selected, outlineWidth + 4, 0] : 0,
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
    },
    line: {
      'line-color': ['case', selected, sel, lineColor],
      'line-width': ['case', selected, outlineWidth + 1, hovered, s.strokeWidth + 1, s.strokeWidth],
      'line-opacity': ['case', selected, 1, s.strokeOpacity],
    },
    circle: {
      'circle-color': ['case', selected, sel, fillColor],
      'circle-opacity': ['case', selected, 1, Math.max(s.fillOpacity, 0.05)],
      // Spec 007: a polygon or line under ~2 px in the current view is drawn as a small dot (DOT_PROP).
      'circle-radius': ['case', selected, s.pointRadius + 2, DOT, DOT_RADIUS, hovered, s.pointRadius + 1, s.pointRadius],
      'circle-stroke-color': ['case', selected, thematic ? haloColor(sel) : '#ffffff', s.strokeColor],
      'circle-stroke-width': ['case', selected, 2, DOT, 0, s.strokeWidth],
      'circle-stroke-opacity': ['case', selected, 1, s.strokeOpacity],
    },
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
