// Spec 026 US2: the value of each band under the cursor. The tiler's `point()` answers with the stored values, nodata
// included as the number the file uses; here nodata becomes "no data", and the values become the words shown on the
// map, in the status bar and on the clipboard. Pure.
import { valueText } from './describe.js'
import type { PixelReading, RasterFacts } from './types.js'

/** What `CogSource.point()` returns. */
export interface TilerPoint {
  coordinates?: [number, number]
  values: number[]
  band_names?: string[]
  outside?: boolean
}

/** True when `value` is the file's nodata value (a NaN nodata matches NaN samples). */
export function isNodata(value: number, nodata: RasterFacts['nodata']): boolean {
  if (Number.isNaN(value)) return true
  if (nodata === null) return false
  if (nodata === 'nan') return Number.isNaN(value)
  return value === nodata
}

/** A place on the raster, from the tiler's answer. `outside` when it is not on the raster (nothing is shown). */
export function readingFromPoint(facts: Pick<RasterFacts, 'bands' | 'nodata'>, lon: number, lat: number, point: TilerPoint): PixelReading {
  if (point.outside || !Array.isArray(point.values) || point.values.length === 0) return { lon, lat, outside: true, values: [] }
  return {
    lon,
    lat,
    outside: false,
    values: point.values.map((v, i) => ({ band: i + 1, name: facts.bands[i]?.name ?? `Band ${i + 1}`, value: Number.isFinite(v) && !isNodata(v, facts.nodata) ? v : null })),
  }
}

/** Past this many bands the readout shows the first few and the count (the tooltip and the clipboard have all of them). */
const SHOWN_BANDS = 4

/** "412.35" for one band; "Band 1 412, Band 2 no data" for several. Empty when the cursor is off the raster. */
export function pixelText(reading: PixelReading | null, limit = SHOWN_BANDS): string {
  if (!reading || reading.outside || reading.values.length === 0) return ''
  if (reading.values.length === 1) return valueText(reading.values[0].value)
  const shown = reading.values.slice(0, limit).map((v) => `${v.name} ${valueText(v.value)}`)
  const more = reading.values.length - limit
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ')
}

/** Every band, one per line, for the tooltip and the clipboard. */
export function pixelLines(reading: PixelReading | null): string[] {
  if (!reading || reading.outside) return []
  return reading.values.map((v) => `${v.name}: ${valueText(v.value)}`)
}

/** Where the cursor is, and the values: what "Copy location and values" puts on the clipboard. */
export function pixelCopyText(reading: PixelReading | null): string {
  if (!reading || reading.outside) return ''
  return [`${reading.lat.toFixed(5)}, ${reading.lon.toFixed(5)}`, ...pixelLines(reading)].join('\n')
}

/** True when the place is inside the raster's WGS84 box (cheap test before asking the file). */
export function insideExtent(extentWgs84: readonly number[], lon: number, lat: number): boolean {
  return lon >= extentWgs84[0] && lon <= extentWgs84[2] && lat >= extentWgs84[1] && lat <= extentWgs84[3]
}
