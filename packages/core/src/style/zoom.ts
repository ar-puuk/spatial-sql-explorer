// Spec 025: what a style does with the map's zoom. Two settings, both optional:
//  - a zoom range the layer is visible in (QGIS's scale-dependent visibility, in zoom levels): MapLibre's
//    own `minzoom` (visible from this zoom up) and `maxzoom` (hidden from this zoom up) on every map layer;
//  - sizes that follow the zoom: marker radius and outline widths are `factor` times their value, and line
//    widths `lineFactor` times theirs, at `fromZoom` and below; they grow in a straight line to 1 times at
//    `toZoom` and stay there.
// The zoom is the map's (0 world, 14 city, 18 street), the same numbers the basemap and the labels use.

export interface ZoomSizes {
  /** At this zoom and below, sizes are `factor` times their value. */
  fromZoom: number
  /** At this zoom and above, sizes are their value. */
  toZoom: number
  /** 0.1 to 1: the marker radius and outline width at `fromZoom`, as a fraction. */
  factor: number
  /** 0.1 to 1: the line width at `fromZoom`. Absent: `factor`. */
  lineFactor?: number
}

export interface ZoomSettings {
  /** The layer shows from this zoom (inclusive). Absent: from the world view. */
  min?: number
  /** The layer is hidden from this zoom up. Absent: at every zoom up. */
  max?: number
  sizes?: ZoomSizes
}

export const ZOOM_LIMITS = Object.freeze({ min: 0, max: 24 })
export const ZOOM_SIZE_FACTOR = Object.freeze({ min: 0.1, max: 1, default: 0.5 })

const clampZoom = (n: number): number => Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, n))
const tenth = (n: number): number => Math.round(n * 10) / 10

/** Zoom settings made valid, or undefined (none). A range that ends before it begins is dropped; sizes that do not grow are dropped. */
export function sanitizeZoom(raw: unknown): ZoomSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const zoom = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? tenth(clampZoom(v)) : undefined)
  let min = zoom(r.min)
  let max = zoom(r.max)
  if (min !== undefined && min <= ZOOM_LIMITS.min) min = undefined
  if (max !== undefined && max >= ZOOM_LIMITS.max) max = undefined
  if (min !== undefined && max !== undefined && max <= min) max = undefined
  let sizes: ZoomSizes | undefined
  const s = r.sizes as Record<string, unknown> | undefined
  if (s && typeof s === 'object') {
    const from = zoom(s.fromZoom)
    const to = zoom(s.toZoom)
    const fraction = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(ZOOM_SIZE_FACTOR.max, Math.max(ZOOM_SIZE_FACTOR.min, v)) * 100) / 100 : undefined)
    const factor = fraction(s.factor) ?? ZOOM_SIZE_FACTOR.default
    const lineFactor = fraction(s.lineFactor)
    if (from !== undefined && to !== undefined && to > from && (factor < 1 || (lineFactor ?? 1) < 1)) sizes = { fromZoom: from, toZoom: to, factor, ...(lineFactor !== undefined && lineFactor !== factor ? { lineFactor } : {}) }
  }
  if (min === undefined && max === undefined && !sizes) return undefined
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(sizes ? { sizes } : {}) }
}

/** MapLibre's layer zoom range for these settings (the full range when there are none). */
export function layerZoomRange(zoom: ZoomSettings | undefined): { minzoom: number; maxzoom: number } {
  return { minzoom: zoom?.min ?? ZOOM_LIMITS.min, maxzoom: zoom?.max ?? ZOOM_LIMITS.max }
}

/** The paint properties that are sizes in pixels. */
export const ZOOM_SIZE_PROPERTIES: readonly string[] = ['circle-radius', 'circle-stroke-width', 'line-width']

/** A size (a number or an expression) that follows the zoom: `factor` times at `fromZoom` and below, 1 times at `toZoom` and above. */
export function sizeWithZoom(size: unknown, sizes: ZoomSizes, factor: number = sizes.factor): unknown {
  const at = (f: number): unknown => (typeof size === 'number' ? Math.round(size * f * 100) / 100 : ['*', size, f])
  return ['interpolate', ['linear'], ['zoom'], sizes.fromZoom, at(factor), sizes.toZoom, at(1)]
}

/** A layer's paint with its sizes made to follow the zoom. The paint is returned as it is when there is nothing to do. */
export function paintWithZoom(paint: Record<string, unknown>, zoom: ZoomSettings | undefined): Record<string, unknown> {
  const sizes = zoom?.sizes
  if (!sizes) return paint
  const out: Record<string, unknown> = { ...paint }
  for (const prop of ZOOM_SIZE_PROPERTIES) if (out[prop] !== undefined && out[prop] !== null) out[prop] = sizeWithZoom(out[prop], sizes, prop === 'line-width' ? (sizes.lineFactor ?? sizes.factor) : sizes.factor)
  return out
}
