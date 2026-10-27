// Spec 027 US1: how the raster's picture is adjusted on the graphics card (MapLibre's raster paint properties), after the
// tiles are drawn. None of these re-reads the file or changes a tile: they are layer paint, like opacity. Neutral values
// draw the picture as the tiler made it.

export type RasterResampling = 'auto' | 'linear' | 'nearest'

export interface RasterDisplay {
  /** The darkest and brightest output (MapLibre `raster-brightness-min` / `-max`): 0 and 1 leave brightness alone. */
  brightnessMin: number
  brightnessMax: number
  /** -1 to 1 (`raster-contrast`). */
  contrast: number
  /** -1 to 1 (`raster-saturation`). */
  saturation: number
  /** Degrees, 0 to 360 (`raster-hue-rotate`). */
  hue: number
  /** `auto`: sharp cells for a colour table (classes), smooth for everything else. */
  resampling: RasterResampling
}

export const NEUTRAL_DISPLAY: RasterDisplay = { brightnessMin: 0, brightnessMax: 1, contrast: 0, saturation: 0, hue: 0, resampling: 'auto' }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** A display read from a sidecar or saved state: unknown fields dropped, values brought into MapLibre's ranges, min below max. */
export function sanitizeDisplay(raw: unknown): RasterDisplay {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...NEUTRAL_DISPLAY }
  const r = raw as Record<string, unknown>
  let min = finite(r.brightnessMin) ? clamp(r.brightnessMin, 0, 1) : NEUTRAL_DISPLAY.brightnessMin
  let max = finite(r.brightnessMax) ? clamp(r.brightnessMax, 0, 1) : NEUTRAL_DISPLAY.brightnessMax
  if (min > max) [min, max] = [max, min]
  return {
    brightnessMin: min,
    brightnessMax: max,
    contrast: finite(r.contrast) ? clamp(r.contrast, -1, 1) : 0,
    saturation: finite(r.saturation) ? clamp(r.saturation, -1, 1) : 0,
    hue: finite(r.hue) ? ((r.hue % 360) + 360) % 360 : 0,
    resampling: r.resampling === 'linear' || r.resampling === 'nearest' ? r.resampling : 'auto',
  }
}

export function isNeutralDisplay(d: RasterDisplay | undefined): boolean {
  if (!d) return true
  const n = NEUTRAL_DISPLAY
  return d.brightnessMin === n.brightnessMin && d.brightnessMax === n.brightnessMax && d.contrast === n.contrast && d.saturation === n.saturation && d.hue === n.hue && d.resampling === n.resampling
}

/** The picture adjustments only (not resampling), neutral or not. */
export function isNeutralAdjustment(d: RasterDisplay | undefined): boolean {
  return isNeutralDisplay(d ? { ...d, resampling: 'auto' } : d)
}

/** MapLibre's resampling for a display: `auto` is sharp for classes and smooth otherwise. */
export function resamplingFor(d: RasterDisplay | undefined, hasPalette: boolean): 'linear' | 'nearest' {
  const r = d?.resampling ?? 'auto'
  return r === 'auto' ? (hasPalette ? 'nearest' : 'linear') : r
}

/** The raster layer's paint properties for a display (opacity is set apart, from the style). */
export function displayPaint(d: RasterDisplay | undefined, hasPalette: boolean): Record<string, number | string> {
  const x = d ?? NEUTRAL_DISPLAY
  return {
    'raster-brightness-min': x.brightnessMin,
    'raster-brightness-max': x.brightnessMax,
    'raster-contrast': x.contrast,
    'raster-saturation': x.saturation,
    'raster-hue-rotate': x.hue,
    'raster-resampling': resamplingFor(x, hasPalette),
  }
}

/**
 * QGIS's brightness/contrast filter (brightness -255 to 255, contrast -100 to 100), as close as the two scales allow: the middle
 * of MapLibre's output range gives the shift, contrast scales the same way. Whole numbers; the exact values stay in our JSON.
 */
export function toQgisBrightnessContrast(d: RasterDisplay): { brightness: number; contrast: number } {
  const shift = (d.brightnessMin + d.brightnessMax) / 2 - 0.5
  return { brightness: Math.round(clamp(shift * 2 * 255, -255, 255)), contrast: Math.round(clamp(d.contrast * 100, -100, 100)) }
}

/** QGIS's hue/saturation filter saturation (-100 to 100). Hue rotation has no QGIS equivalent (its hue filter only colorizes). */
export function toQgisSaturation(d: RasterDisplay): number {
  return Math.round(clamp(d.saturation * 100, -100, 100))
}

/** What a QGIS-only reader can say about the display, back in MapLibre's scale (used when our JSON is missing). */
export function fromQgis(brightness: number, contrastValue: number, saturation: number): Partial<RasterDisplay> {
  const shift = clamp(brightness, -255, 255) / (2 * 255)
  return {
    brightnessMin: clamp(shift, 0, 1),
    brightnessMax: clamp(1 + shift, 0, 1),
    contrast: clamp(contrastValue / 100, -1, 1),
    saturation: clamp(saturation / 100, -1, 1),
  }
}
