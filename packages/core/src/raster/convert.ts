// Spec 026: a GeoTIFF that is not stored in tiles (the kind many desktop tools write) cannot be read in parts, so the
// browser makes a COG of it in memory (geolibre-wasm's CogBuilder), under a sample limit. The limits, the overview list
// and the wording are here, pure; the conversion itself is packages/ui/src/raster/convert.ts.
// Adapted from GeoLibre (MIT): packages/processing/src/cog-convert.ts (the limits and the idea of the in-browser conversion).
import { RasterOpenError } from './errors.js'

/** Cells (width x height x bands) above which a file is not converted here: memory is about 20 bytes a cell (measured: 100 M cells, 2 GB of JS heap, 17 s). */
export const MAX_CONVERT_SAMPLES = 100_000_000
/** From here the conversion is slow and large; the note says so. */
export const LARGE_CONVERT_SAMPLES = 40_000_000
/** The side, in pixels, below which a reduced level is not worth writing. */
const SMALLEST_OVERVIEW = 256

export const sampleCount = (width: number, height: number, bands: number): number => width * height * Math.max(1, bands)

export type ConvertVerdict = { kind: 'convert'; samples: number; large: boolean } | { kind: 'refuse'; samples: number }

/** Whether a striped file may be converted here. */
export function convertVerdict(width: number, height: number, bands: number): ConvertVerdict {
  const samples = sampleCount(width, height, bands)
  if (!Number.isSafeInteger(samples) || samples > MAX_CONVERT_SAMPLES) return { kind: 'refuse', samples }
  return { kind: 'convert', samples, large: samples >= LARGE_CONVERT_SAMPLES }
}

export function tooLargeToConvert(fileName: string, samples: number): RasterOpenError {
  const n = Number.isSafeInteger(samples) ? `${(samples / 1e6).toFixed(0)} million` : 'too many'
  return new RasterOpenError(
    'too-large-to-convert',
    `${fileName} is a GeoTIFF that is not stored in tiles, with ${n} cells: too large to prepare here (the limit is ${MAX_CONVERT_SAMPLES / 1e6} million). Convert it first, for example gdal_translate -of COG in.tif out.tif, and open the result.`,
  )
}

/**
 * The `set_overview_levels` list for a raster. The builder takes each value as the reduction from the PREVIOUS level
 * (a chain), so `[2, 2, 2]` is 1/2, 1/4, 1/8 of the size; absolute factors (`[2, 4, 8]`) would give 1/2, 1/8, 1/64
 * (specs/026-raster-view/research.md §4b). Stops before a level would be under 256 px on its long side.
 */
export function overviewSteps(width: number, height: number): number[] {
  const steps: number[] = []
  let side = Math.max(width, height)
  while (side / 2 > SMALLEST_OVERVIEW) {
    steps.push(2)
    side /= 2
  }
  return steps
}

/** The sizes those steps give, largest first (the builder rounds up). */
export function overviewSizes(width: number, height: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let w = width
  let h = height
  for (let i = 0; i < overviewSteps(width, height).length; i++) {
    w = Math.ceil(w / 2)
    h = Math.ceil(h / 2)
    out.push([w, h])
  }
  return out
}

/** The note on the card of a converted file. */
export function convertedNote(dataType: string, hadPalette: boolean): string {
  const lost: string[] = []
  if (hadPalette) lost.push('its colour table')
  if (dataType !== 'uint8') lost.push(`its ${dataType} sample type (values are kept as 32-bit floating point)`)
  return `Prepared in memory from a GeoTIFF that is not stored in tiles${lost.length ? `; not kept: ${lost.join(' and ')}` : ''}. The file on disk is unchanged.`
}
