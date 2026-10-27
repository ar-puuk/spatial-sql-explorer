// Spec 027 US3: the raster's value along a drawn line. Pure: the places to ask (evenly spaced along the great circle, at
// about one per cell), what the answers say (gaps for no data and off-raster, the rise and fall), and a CSV. The
// worker does the asking, with the same reader as the cursor readout, so a profile and a hover agree.
import { distanceMeters, lineLengthMeters } from '../draw/geodesy.js'
import { isNodata } from './pixel.js'
import type { RasterFacts } from './types.js'

type Position = readonly number[]

/** The most places a profile asks about (spec FR-008). */
export const MAX_PROFILE_POINTS = 2000
/** The fewest, so even a short line has a shape. */
export const MIN_PROFILE_POINTS = 2

const RAD = Math.PI / 180

/** The point a fraction `f` (0 to 1) of the way along the great circle from `a` to `b`. */
export function interpolateGreatCircle(a: Position, b: Position, f: number): [number, number] {
  const lat1 = a[1] * RAD
  const lat2 = b[1] * RAD
  const lon1 = a[0] * RAD
  const lon2 = b[0] * RAD
  const d = distanceMeters(a, b) / 6_371_008.8
  if (d < 1e-12) return [a[0], a[1]]
  const sinD = Math.sin(d)
  const A = Math.sin((1 - f) * d) / sinD
  const B = Math.sin(f * d) / sinD
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2)
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2)
  const z = A * Math.sin(lat1) + B * Math.sin(lat2)
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD]
}

/** The size of one cell in meters (an estimate for a geographic system: degrees at the raster's middle latitude). */
export function cellMeters(facts: Pick<RasterFacts, 'pixelSize' | 'crs' | 'extentWgs84'>): number | null {
  const size = facts.pixelSize
  if (!size) return null
  const units = facts.crs.units
  const step = Math.min(size[0], size[1])
  if (!(step > 0)) return null
  if (units === 'degrees') return step * 111_320 * Math.max(0.05, Math.cos(((facts.extentWgs84[1] + facts.extentWgs84[3]) / 2) * RAD))
  if (units === 'feet') return step * 0.3048
  return step
}

export interface ProfileSamples {
  /** [lon, lat] of each place, first to last. */
  points: Array<[number, number]>
  /** Meters from the start of the line to each place. */
  distances: number[]
  /** Length of the whole line, meters. */
  totalMeters: number
  /** True when the line is longer than the places allow at one per cell: the places are further apart than cells. */
  coarse: boolean
}

/**
 * Places along `line`, evenly spaced on the great circle through its vertices, about one per `spacingMeters` (a cell),
 * never more than `maxPoints` and never fewer than two. A line of no length gives its one place twice.
 */
export function profileSamples(line: readonly Position[], spacingMeters: number | null, maxPoints = MAX_PROFILE_POINTS): ProfileSamples {
  if (line.length < 2) return { points: [], distances: [], totalMeters: 0, coarse: false }
  const lengths: number[] = []
  for (let i = 1; i < line.length; i++) lengths.push(distanceMeters(line[i - 1], line[i]))
  const total = lineLengthMeters(line)
  const wanted = spacingMeters && spacingMeters > 0 ? Math.ceil(total / spacingMeters) + 1 : maxPoints
  const n = Math.max(MIN_PROFILE_POINTS, Math.min(maxPoints, wanted))
  const points: Array<[number, number]> = []
  const distances: number[] = []
  let seg = 0
  let before = 0
  for (let i = 0; i < n; i++) {
    const d = n === 1 ? 0 : (total * i) / (n - 1)
    while (seg < lengths.length - 1 && before + lengths[seg] < d) {
      before += lengths[seg]
      seg++
    }
    const f = lengths[seg] > 0 ? Math.min(1, Math.max(0, (d - before) / lengths[seg])) : 0
    points.push(interpolateGreatCircle(line[seg], line[seg + 1], f))
    distances.push(d)
  }
  return { points, distances, totalMeters: total, coarse: wanted > maxPoints }
}

/** The places as the flat array the worker takes: lon0, lat0, lon1, lat1, … */
export function flattenPoints(points: ReadonlyArray<readonly [number, number]>): Float64Array {
  const out = new Float64Array(points.length * 2)
  points.forEach((p, i) => {
    out[i * 2] = p[0]
    out[i * 2 + 1] = p[1]
  })
  return out
}

/** One band along the line: the value at each place, or null for a gap (no data, or off the raster). */
export interface ProfileBand {
  band: number
  name: string
  values: Array<number | null>
}

/**
 * The worker's answer (`values` holds `bands.length` numbers per place, NaN where the place is off the raster) as bands of
 * values with gaps. A value that is the file's no-data number is a gap too.
 */
export function profileBands(raw: ArrayLike<number>, placeCount: number, bands: ReadonlyArray<{ index: number; name: string }>, nodata: RasterFacts['nodata']): ProfileBand[] {
  return bands.map((b, k) => ({
    band: b.index,
    name: b.name,
    values: Array.from({ length: placeCount }, (_, i) => {
      const v = raw[i * bands.length + k]
      return Number.isFinite(v) && !isNodata(v, nodata) ? v : null
    }),
  }))
}

export interface ProfileSummary {
  /** Places with a value / places in all. */
  valid: number
  total: number
  gaps: number
  min: number | null
  max: number | null
  mean: number | null
  /** The sum of the climbs and of the descents between neighboring places that both have a value (the line's own rise and fall). */
  rise: number
  fall: number
}

export function summarizeProfile(values: ReadonlyArray<number | null>): ProfileSummary {
  let valid = 0
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let rise = 0
  let fall = 0
  let last: number | null = null
  for (const v of values) {
    if (v === null) {
      last = null
      continue
    }
    valid++
    sum += v
    if (v < min) min = v
    if (v > max) max = v
    if (last !== null) {
      if (v > last) rise += v - last
      else fall += last - v
    }
    last = v
  }
  return { valid, total: values.length, gaps: values.length - valid, min: valid ? min : null, max: valid ? max : null, mean: valid ? sum / valid : null, rise, fall }
}

/** A CSV of the profile: distance, longitude, latitude, then one column per band (empty for a gap). */
export function profileCsv(samples: ProfileSamples, bands: readonly ProfileBand[]): string {
  const q = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [['distance_m', 'longitude', 'latitude', ...bands.map((b) => q(b.name))].join(',')]
  samples.points.forEach((p, i) => {
    lines.push([samples.distances[i].toFixed(2), p[0].toFixed(7), p[1].toFixed(7), ...bands.map((b) => (b.values[i] === null ? '' : String(b.values[i])))].join(','))
  })
  return lines.join('\n') + '\n'
}

/** Round numbers for an axis from `min` to `max`: about `count` of them, steps of 1, 2 or 5 times a power of ten, all inside the range. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return []
  if (max === min) return [min]
  const raw = (max - min) / Math.max(1, count)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
  const first = Math.ceil(min / step - 1e-9) * step
  const out: number[] = []
  for (let v = first; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)))
  return out
}

/** The unit and size for the distance axis: meters or kilometers (miles and feet for imperial) by how long the line is. */
export function distanceAxis(totalMeters: number, imperial: boolean): { unit: string; perUnit: number } {
  if (imperial) return totalMeters >= 1609.344 ? { unit: 'mi', perUnit: 1609.344 } : { unit: 'ft', perUnit: 0.3048 }
  return totalMeters >= 1000 ? { unit: 'km', perUnit: 1000 } : { unit: 'm', perUnit: 1 }
}
