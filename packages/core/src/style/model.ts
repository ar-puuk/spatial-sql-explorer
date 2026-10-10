// Single-symbol layer style: the "single" mode of CLAUDE.md's styling scope,
// and the shared model behind every interchange format (QGIS QML, OGC SLD,
// Mapbox GL style JSON — see ./qml.ts, ./sld.ts, ./mapbox.ts). Categorized and
// graduated renderers extend this later; every serializer already writes
// the format's own "single symbol" construct so that extension is additive.
//
// Units are screen pixels throughout (MapLibre's native unit). Formats whose
// default unit is millimetres (QML) or that size markers by diameter (QML,
// SLD) are converted at the format boundary, never here.

export interface LayerStyle {
  /** `#rrggbb`. Polygon fill and point marker fill. */
  fillColor: string
  /** 0..1 */
  fillOpacity: number
  /** `#rrggbb`. Polygon outline, line color, and point marker outline. */
  strokeColor: string
  /** 0..1 */
  strokeOpacity: number
  /** Pixels. */
  strokeWidth: number
  /** Pixels (radius, as MapLibre's `circle-radius`). */
  pointRadius: number
}

/**
 * Data colors are fixed and theme-independent (CLAUDE.md): a mid blue that
 * reads on light and dark basemaps alike, with a darker outline, following
 * GeoLibre's default single-symbol treatment.
 */
export const DEFAULT_LAYER_STYLE: Readonly<LayerStyle> = Object.freeze({
  fillColor: '#3b82f6',
  fillOpacity: 0.45,
  strokeColor: '#1d4ed8',
  strokeOpacity: 1,
  strokeWidth: 1.5,
  pointRadius: 5,
})

export type StyleFormat = 'qml' | 'sld' | 'mapbox'

/** Which geometry the exported style should describe. `Mixed` layers export every symbolizer the format allows. */
export type StyleGeometry = 'Point' | 'LineString' | 'Polygon' | 'Mixed'

export interface StyleImportResult {
  style: LayerStyle
  format: StyleFormat
  /** Human-readable caveats, e.g. "Only the first symbol of a categorized renderer was imported." */
  notes: string[]
}

// --- color helpers (shared by every format) -------------------------------

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0..1 */
  a: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function hex2(n: number): string {
  return Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
}

export function rgbToHex({ r, g, b }: Pick<Rgba, 'r' | 'g' | 'b'>): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

/**
 * Parses `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`, and QGIS's
 * `r,g,b,a` (0–255 alpha; newer QGIS appends `,rgb:...` float components,
 * which are ignored). Returns null for anything else (named colors,
 * expressions) so importers can fall back to a default and add a note.
 */
export function parseColor(input: string | null | undefined): Rgba | null {
  if (!input) return null
  const s = input.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16))
    return { r, g, b, a: 1 }
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s)
  if (m) {
    const n = parseInt(m[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 }
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s)
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? clamp(Number(m[4]), 0, 1) : 1 }
  }
  m = /^(\d{1,3}),(\d{1,3}),(\d{1,3})(?:,(\d{1,3}))?(?:,.*)?$/.exec(s)
  if (m) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] !== undefined ? Number(m[4]) / 255 : 1 }
  }
  return null
}

/** Rounds to a sensible precision for files humans may diff. */
export function round(n: number, digits = 3): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

export function sanitizeStyle(style: Partial<LayerStyle>): LayerStyle {
  const pick = (c: string | undefined, fallback: string): string => {
    const rgba = parseColor(c)
    return rgba ? rgbToHex(rgba) : fallback
  }
  const num = (n: number | undefined, fallback: number, lo: number, hi: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? clamp(n, lo, hi) : fallback
  return {
    fillColor: pick(style.fillColor, DEFAULT_LAYER_STYLE.fillColor),
    fillOpacity: num(style.fillOpacity, DEFAULT_LAYER_STYLE.fillOpacity, 0, 1),
    strokeColor: pick(style.strokeColor, DEFAULT_LAYER_STYLE.strokeColor),
    strokeOpacity: num(style.strokeOpacity, DEFAULT_LAYER_STYLE.strokeOpacity, 0, 1),
    strokeWidth: num(style.strokeWidth, DEFAULT_LAYER_STYLE.strokeWidth, 0, 50),
    pointRadius: num(style.pointRadius, DEFAULT_LAYER_STYLE.pointRadius, 0.5, 100),
  }
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
