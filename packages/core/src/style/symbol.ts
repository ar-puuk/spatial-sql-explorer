// Marker shapes, line patterns, and the symbol each class is drawn with.
// One description (`SymbolSpec`) per resolved class feeds the map paint, the
// marker icons, the legend swatches, the map image and the style files, so
// none of them can disagree on what a class looks like.
//
// Shapes follow QGIS's simple-marker geometry (unit coordinates, y down,
// the marker's half-size = 1): a square's half-side equals a circle's
// radius, as in QGIS. Dash patterns are Qt's pen styles, which QGIS's
// `line_style` names, in line widths (MapLibre's `line-dasharray` unit).
import { withLayerOpacity, type LayerStyle, type ResolvedClass, type ResolvedStyle } from './model.js'

export const MARKER_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'x'] as const
export type MarkerShape = (typeof MARKER_SHAPES)[number]

export const MARKER_SHAPE_NAMES: Record<MarkerShape, string> = {
  circle: 'Circle',
  square: 'Square',
  triangle: 'Triangle',
  diamond: 'Diamond',
  star: 'Star',
  cross: 'Cross',
  x: 'X',
}

export const LINE_DASHES = ['solid', 'dash', 'dot', 'dash-dot', 'dash-dot-dot'] as const
export type LineDash = (typeof LINE_DASHES)[number]

export const LINE_DASH_NAMES: Record<LineDash, string> = {
  solid: 'Solid',
  dash: 'Dash',
  dot: 'Dot',
  'dash-dot': 'Dash dot',
  'dash-dot-dot': 'Dash dot dot',
}

/** Qt's pen patterns (QGIS `line_style`), in line widths: dash, gap, dash, gap, ... */
export const DASH_PATTERNS: Record<Exclude<LineDash, 'solid'>, readonly number[]> = {
  dash: [4, 2],
  dot: [1, 2],
  'dash-dot': [4, 2, 1, 2],
  'dash-dot-dot': [4, 2, 1, 2, 1, 2],
}

export const isMarkerShape = (v: unknown): v is MarkerShape => typeof v === 'string' && (MARKER_SHAPES as readonly string[]).includes(v)
export const isLineDash = (v: unknown): v is LineDash => typeof v === 'string' && (LINE_DASHES as readonly string[]).includes(v)

/** The pattern of a dashed line, in line widths; null for solid. */
export function dashPattern(dash: LineDash | undefined): number[] | null {
  return dash && dash !== 'solid' ? [...DASH_PATTERNS[dash]] : null
}

/**
 * The closest of our patterns to a foreign dash array (SLD `stroke-dasharray`,
 * a QGIS custom dash, MapLibre `line-dasharray`), whatever its unit: only the
 * number of dashes and whether the first is long or short count. Null for an
 * empty or invalid array.
 */
export function dashFromPattern(values: number[]): LineDash | null {
  const v = values.filter((n) => Number.isFinite(n) && n >= 0)
  if (v.length !== values.length || v.length === 0 || v.every((n) => n === 0)) return null
  // An odd-length array repeats itself (SVG / SLD rule).
  const even = v.length % 2 ? [...v, ...v] : v
  const dashes = even.length / 2
  if (dashes === 1) return even[0] >= even[1] ? 'dash' : 'dot'
  if (dashes === 2) return 'dash-dot'
  return 'dash-dot-dot'
}

const STAR_INNER = Math.cos((72 * Math.PI) / 180) / Math.cos((36 * Math.PI) / 180)
const CROSS: Array<[number, number]> = [
  [-1, -0.2],
  [-1, 0.2],
  [-0.2, 0.2],
  [-0.2, 1],
  [0.2, 1],
  [0.2, 0.2],
  [1, 0.2],
  [1, -0.2],
  [0.2, -0.2],
  [0.2, -1],
  [-0.2, -1],
  [-0.2, -0.2],
]
const rotate45 = ([x, y]: [number, number]): [number, number] => [(x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2]

/** A shape's outline in unit coordinates (y down), or null for the circle (an arc of radius 1). */
export function markerPolygon(shape: MarkerShape): Array<[number, number]> | null {
  switch (shape) {
    case 'circle':
      return null
    case 'square':
      return [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]
    case 'triangle':
      return [
        [-1, 1],
        [1, 1],
        [0, -1],
      ]
    case 'diamond':
      return [
        [-1, 0],
        [0, 1],
        [1, 0],
        [0, -1],
      ]
    case 'star':
      return Array.from({ length: 10 }, (_, k) => {
        const a = (k * 36 * Math.PI) / 180
        const r = k % 2 ? STAR_INNER : 1
        return [r * Math.sin(a), -r * Math.cos(a)] as [number, number]
      })
    case 'cross':
      return CROSS
    case 'x':
      return CROSS.map(rotate45)
  }
}

/** How far a shape reaches from its center, in marker half-sizes (the square's corners reach √2). */
export function markerExtent(shape: MarkerShape): number {
  const poly = markerPolygon(shape)
  return poly ? Math.max(...poly.map(([x, y]) => Math.hypot(x, y))) : 1
}

/** An SVG path for the shape at half-size `r`, centered on (cx, cy). */
export function markerPath(shape: MarkerShape, r: number, cx = 0, cy = 0): string {
  const poly = markerPolygon(shape)
  const f = (n: number) => Math.round(n * 1000) / 1000
  if (!poly) return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`
  return poly.map(([x, y], i) => `${i ? 'L' : 'M'}${f(cx + x * r)} ${f(cy + y * r)}`).join('') + 'Z'
}

// --- the symbol each class is drawn with ----------------------------------

/** Everything needed to draw one class, with the layer opacity already folded in. */
export interface SymbolSpec {
  /** Polygon fill and point marker fill. */
  fillColor: string
  fillOpacity: number
  /** Polygon outline and marker outline. */
  strokeColor: string
  strokeOpacity: number
  strokeWidth: number
  /** Line features: color and width (their opacity is `strokeOpacity`). */
  lineColor: string
  lineWidth: number
  /** Marker half-size, px (`circle-radius`). */
  radius: number
  shape: MarkerShape
  /** Lines and polygon outlines. */
  dash: LineDash
}

/** The single symbol (no classes, or a fallback). */
export function baseSymbol(style: LayerStyle): SymbolSpec {
  const s = withLayerOpacity(style)
  return {
    fillColor: s.fillColor,
    fillOpacity: s.fillOpacity,
    strokeColor: s.strokeColor,
    strokeOpacity: s.strokeOpacity,
    strokeWidth: s.strokeWidth,
    lineColor: s.strokeColor,
    lineWidth: s.strokeWidth,
    radius: s.pointRadius,
    shape: style.markerShape ?? 'circle',
    dash: style.lineDash ?? 'solid',
  }
}

/**
 * The symbol of one resolved color class. Thematic colors replace the fill
 * (polygons, points) and the line color (lines); polygon outlines keep the
 * stroke (FR-006). Sizes come from the size channel (`sizeSymbols`).
 */
export function classSymbol(style: LayerStyle, resolved: ResolvedStyle, c: ResolvedClass): SymbolSpec {
  const base = baseSymbol(style)
  if (resolved.status !== 'ok' || c.kind === 'single') return base
  return { ...base, fillColor: c.color, lineColor: c.color }
}

/**
 * Spec 009: the size channel's legend symbols, in the single symbol's colors,
 * one per size class (its size; "No value" and "Other" at the single size).
 */
export function sizeSymbols(style: LayerStyle, resolved: ResolvedStyle): SymbolSpec[] {
  const base = baseSymbol(style)
  const size = resolved.size
  if (!size || size.status !== 'ok') return []
  // Proportional: the reference sizes first (legend rows that aren't classes), then "No value".
  const samples = (size.samples ?? []).map((x) => ({ ...base, radius: x.size, lineWidth: x.size }))
  return [...samples, ...size.classes.map((c) => (c.size === undefined ? base : { ...base, radius: c.size, lineWidth: c.size }))]
}

/** `classSymbol` for every class, in legend order (the class-index expression's positions). */
export function classSymbols(style: LayerStyle, resolved: ResolvedStyle): SymbolSpec[] {
  return resolved.classes.map((c) => classSymbol(style, resolved, c))
}

/**
 * Spec 009 US2: a proportional size. `t` is the value's place in the domain
 * (clamped to 0..1); lines scale linearly, markers by area (QGIS size
 * assistant "Area": min + (max - min)·√t, research §3). A domain of one
 * value gives the largest size.
 */
export function proportionalSize(value: number, domain: { min: number; max: number }, sizeMin: number, sizeMax: number, scale: 'line' | 'point' | 'linear' | 'area'): number {
  if (!(domain.max > domain.min)) return sizeMax
  const t = Math.min(1, Math.max(0, (value - domain.min) / (domain.max - domain.min)))
  return sizeMin + (sizeMax - sizeMin) * (scale === 'point' || scale === 'area' ? Math.sqrt(t) : t)
}

/** Default size ranges for a size channel: marker radius or line width, px. */
export const DEFAULT_SIZE_RANGE = Object.freeze({ point: { min: 2, max: 10 }, line: { min: 1, max: 6 } })

/** Class sizes from `min` to `max`, evenly spaced (QGIS's `setSymbolSizes`). */
export function classSizes(n: number, min: number, max: number): number[] {
  if (n <= 1) return n === 1 ? [min] : []
  return Array.from({ length: n }, (_, i) => Math.round((min + ((max - min) * i) / (n - 1)) * 100) / 100)
}

// --- marker icons (shapes other than the circle are drawn as map icons) ------

const ICON_PREFIX = 'se-marker|'
const num = (n: number) => String(Math.round(n * 100) / 100)

/** Shapes other than the circle are drawn from icons (MapLibre's circle layer has only circles). */
export function usesMarkerIcons(style: Pick<LayerStyle, 'markerShape'>): boolean {
  return (style.markerShape ?? 'circle') !== 'circle'
}

/**
 * The icon id of a marker. The id holds everything drawn, so an icon is made
 * once per look and a changed style simply asks for new ids
 * (`parseMarkerIconId` turns one back into what to draw).
 */
export function markerIconId(s: Pick<SymbolSpec, 'shape' | 'fillColor' | 'fillOpacity' | 'strokeColor' | 'strokeOpacity' | 'strokeWidth' | 'radius'>): string {
  return ICON_PREFIX + [s.shape, s.fillColor, num(s.fillOpacity), s.strokeColor, num(s.strokeOpacity), num(s.strokeWidth), num(s.radius)].join('|')
}

export type MarkerIcon = Pick<SymbolSpec, 'shape' | 'fillColor' | 'fillOpacity' | 'strokeColor' | 'strokeOpacity' | 'strokeWidth' | 'radius'>

export function parseMarkerIconId(id: string): MarkerIcon | null {
  if (!id.startsWith(ICON_PREFIX)) return null
  const [shape, fillColor, fo, strokeColor, so, sw, r] = id.slice(ICON_PREFIX.length).split('|')
  const n = [fo, so, sw, r].map(Number)
  if (!isMarkerShape(shape) || n.some((x) => !Number.isFinite(x))) return null
  return { shape, fillColor, fillOpacity: n[0], strokeColor, strokeOpacity: n[1], strokeWidth: n[2], radius: n[3] }
}

export const isMarkerIconId = (id: string): boolean => id.startsWith(ICON_PREFIX)
