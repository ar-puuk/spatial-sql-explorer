// Spec 027 US2: shaded relief for a raster of heights (hillshade), drawn by MapLibre's `hillshade` layer from the raster's
// values. Pure: the setting and its limits, MapLibre's paint for it, when it is offered, and how a value is packed into the
// three bytes of a DEM tile (MapLibre's "custom" encoding) and back.
import type { RasterFacts, RasterStyle } from './types.js'

export type ReliefMethod = 'standard' | 'basic' | 'combined' | 'igor' | 'multidirectional'

export const RELIEF_METHODS: ReadonlyArray<{ id: ReliefMethod; label: string; hint: string }> = [
  { id: 'standard', label: 'Standard', hint: 'One light, the usual look' },
  { id: 'basic', label: 'Basic', hint: 'A simple one-light shading' },
  { id: 'combined', label: 'Combined', hint: 'Light and shadow blended' },
  { id: 'igor', label: 'Igor', hint: 'Softer, with less contrast on flat ground' },
  { id: 'multidirectional', label: 'Multidirectional', hint: 'Light from several directions at once: no direction to choose' },
]

export interface RasterRelief {
  on: boolean
  method: ReliefMethod
  /** Degrees clockwise from north the light comes from (0 to 359). */
  direction: number
  /** Degrees above the horizon (0 to 90). */
  altitude: number
  /** 0 to 1: how strong the shading is. */
  exaggeration: number
  shadow: string
  highlight: string
  accent: string
}

export const DEFAULT_RELIEF: RasterRelief = { on: false, method: 'standard', direction: 335, altitude: 45, exaggeration: 0.5, shadow: '#000000', highlight: '#ffffff', accent: '#000000' }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const HEX = /^#[0-9a-fA-F]{6}$/
const METHOD_IDS = RELIEF_METHODS.map((m) => m.id) as string[]

/** A relief read from a sidecar or saved state, made safe: unknown fields dropped, values in MapLibre's ranges. */
export function sanitizeRelief(raw: unknown): RasterRelief {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_RELIEF }
  const r = raw as Record<string, unknown>
  const d = DEFAULT_RELIEF
  return {
    on: r.on === true,
    method: typeof r.method === 'string' && METHOD_IDS.includes(r.method) ? (r.method as ReliefMethod) : d.method,
    direction: finite(r.direction) ? ((Math.round(r.direction) % 360) + 360) % 360 : d.direction,
    altitude: finite(r.altitude) ? Math.min(90, Math.max(0, r.altitude)) : d.altitude,
    exaggeration: finite(r.exaggeration) ? Math.min(1, Math.max(0, r.exaggeration)) : d.exaggeration,
    shadow: typeof r.shadow === 'string' && HEX.test(r.shadow) ? r.shadow : d.shadow,
    highlight: typeof r.highlight === 'string' && HEX.test(r.highlight) ? r.highlight : d.highlight,
    accent: typeof r.accent === 'string' && HEX.test(r.accent) ? r.accent : d.accent,
  }
}

/** True when the relief is on and not the plain default (what is worth storing in a style). */
export function isReliefStored(r: RasterRelief | undefined): boolean {
  if (!r) return false
  const d = DEFAULT_RELIEF
  return r.on || r.method !== d.method || r.direction !== d.direction || r.altitude !== d.altitude || r.exaggeration !== d.exaggeration || r.shadow !== d.shadow || r.highlight !== d.highlight || r.accent !== d.accent
}

/** The hillshade layer's paint for a relief. The light is fixed to the map, so turning the map does not turn the shading. */
export function reliefPaint(r: RasterRelief): Record<string, number | string> {
  return {
    'hillshade-method': r.method,
    'hillshade-illumination-direction': r.direction,
    'hillshade-illumination-altitude': r.altitude,
    'hillshade-illumination-anchor': 'map',
    'hillshade-exaggeration': r.exaggeration,
    'hillshade-shadow-color': r.shadow,
    'hillshade-highlight-color': r.highlight,
    'hillshade-accent-color': r.accent,
  }
}

export interface ReliefOffer {
  ok: boolean
  /** Why not, in a sentence, when `ok` is false. */
  reason?: string
}

/** Whether shaded relief makes sense for what is drawn: one band of numbers (not colors, not classes). */
export function canOfferRelief(facts: Pick<RasterFacts, 'hasPalette'>, style: Pick<RasterStyle, 'mode'>): ReliefOffer {
  if (facts.hasPalette || style.mode === 'paletted') return { ok: false, reason: 'Shaded relief needs a raster of heights; this one has classes.' }
  if (style.mode === 'rgb') return { ok: false, reason: 'Shaded relief needs one band of heights; this is drawn as a colour image. Draw one band to use it.' }
  return { ok: true }
}

// --- the packing of a value into a DEM tile ------------------------------------------------------------------------

/** How values are packed: `value = base + n * step`, `n` a 24-bit number: red is the high byte, then green, then blue. */
export interface DemEncoding {
  base: number
  step: number
}

export const DEM_TOP = 16777215

/** A packing that holds every value from `min` to `max` with the finest step 24 bits allow, and 1% of room either side. */
export function encodingFor(min: number, max: number): DemEncoding {
  const lo = Number.isFinite(min) ? min : 0
  const hi = Number.isFinite(max) && max > lo ? max : lo + 1
  const pad = (hi - lo) * 0.01
  const base = lo - pad
  return { base, step: (hi + pad - base) / DEM_TOP }
}

/**
 * The packing for a band: its lowest to highest value as the file's statistics estimate them (from a reduced level, so the
 * true extremes may lie a little outside), with 10% of room either side; values beyond are held at the ends.
 */
export function demEncodingFor(band: { min?: number; max?: number } | undefined, dataType: RasterFacts['dataType']): DemEncoding {
  const lo = band?.min
  const hi = band?.max
  if (typeof lo === 'number' && typeof hi === 'number' && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
    const room = (hi - lo) * 0.1
    return encodingFor(lo - room, hi + room)
  }
  if (dataType === 'uint8') return encodingFor(0, 255)
  if (dataType === 'uint16') return encodingFor(0, 65535)
  if (dataType === 'int16') return encodingFor(-32768, 32767)
  return encodingFor(-500, 9000)
}

/** What a cell with no value is packed as: the band's mean when the file says it, else the middle of the packing. The same in every tile. */
export function demFill(band: { mean?: number } | undefined, e: DemEncoding): number {
  return typeof band?.mean === 'number' && Number.isFinite(band.mean) ? band.mean : e.base + (e.step * DEM_TOP) / 2
}

/** MapLibre's "custom" DEM encoding for a packing. */
export function demSourceEncoding(e: DemEncoding): { encoding: 'custom'; redFactor: number; greenFactor: number; blueFactor: number; baseShift: number } {
  return { encoding: 'custom', redFactor: 65536 * e.step, greenFactor: 256 * e.step, blueFactor: e.step, baseShift: e.base }
}

/** The number a value packs to (clamped to the range the packing holds). */
export function packValue(v: number, e: DemEncoding): number {
  return Math.max(0, Math.min(DEM_TOP, Math.round((v - e.base) / e.step)))
}

/** What MapLibre makes of three bytes under `demSourceEncoding`. */
export function unpackValue(r: number, g: number, b: number, e: DemEncoding): number {
  return e.base + (r * 65536 + g * 256 + b) * e.step
}
