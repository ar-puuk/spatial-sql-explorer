// Spec 027 US4: the raster's cells inside a drawn area, and what they add up to. Pure: the area as rows of cells (a cell
// is inside when its center is), the figures over a window of values, and which reduced level to read when the area is
// large. The worker reads the values and calls these.
import { isNodata } from './pixel.js'
import type { RasterFacts } from './types.js'

type Position = readonly number[]

/** The most cells read per band for one answer (the tiler's own limit for a window). */
export const MAX_STATS_CELLS = 1 << 24
/** Bins in the histogram of the values inside the area. */
export const AREA_HISTOGRAM_BINS = 64

/** Splits every edge of `ring` into pieces no longer than `maxStep` (degrees), so a curve in the raster's system is followed. */
export function densifyRing(ring: readonly Position[], maxStep: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i + 1 < ring.length; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const parts = Math.max(1, Math.min(2000, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxStep)))
    for (let k = 0; k < parts; k++) out.push([x0 + ((x1 - x0) * k) / parts, y0 + ((y1 - y0) * k) / parts])
  }
  if (ring.length) out.push([ring[ring.length - 1][0], ring[ring.length - 1][1]])
  return out
}

/** Whether a place is inside a ring (even-odd), for checks against `polygonSpans`. */
export function pointInRing(x: number, y: number, ring: readonly Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * The cells of a `width` x `height` window whose centers are inside the rings (even-odd, so a second ring is a hole). Rings are in
 * window cell coordinates (x to the right, y down, a cell (c, r) has its center at c + 0.5, r + 0.5). Returns triples
 * `row, firstColumn, endColumn` (end exclusive), one per run of cells, in row order.
 */
export function polygonSpans(rings: ReadonlyArray<readonly Position[]>, width: number, height: number): Int32Array {
  const edges: Array<[number, number, number, number]> = []
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j]
      const b = ring[i]
      if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]])
    }
  }
  if (!edges.length || width <= 0 || height <= 0) return new Int32Array(0)
  let minY = Infinity
  let maxY = -Infinity
  for (const e of edges) {
    minY = Math.min(minY, e[1], e[3])
    maxY = Math.max(maxY, e[1], e[3])
  }
  const r0 = Math.max(0, Math.ceil(minY - 0.5))
  const r1 = Math.min(height - 1, Math.floor(maxY - 0.5))
  const out: number[] = []
  const xs: number[] = []
  for (let r = r0; r <= r1; r++) {
    const yc = r + 0.5
    xs.length = 0
    for (const [x0, y0, x1, y1] of edges) {
      if (y0 > yc !== y1 > yc) xs.push(x0 + ((yc - y0) * (x1 - x0)) / (y1 - y0))
    }
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] - 0.5))
      const c1 = Math.min(width, Math.ceil(xs[k + 1] - 0.5))
      if (c1 > c0) out.push(r, c0, c1)
    }
  }
  return Int32Array.from(out)
}

export interface BandAreaStats {
  band: number
  name: string
  /** Cells inside the area with a value. */
  count: number
  /** Cells inside the area with no data. */
  excluded: number
  min: number | null
  max: number | null
  mean: number | null
  sum: number | null
  std: number | null
  /** Counts per equal-width bin from `min` to `max` ([] when there is no value). */
  histogram: number[]
}

/** The figures over the cells `spans` picks out of a window of values (row-major, `width` wide). */
export function statsOfWindow(values: ArrayLike<number>, width: number, spans: Int32Array, nodata: RasterFacts['nodata'], band: { index: number; name: string }): BandAreaStats {
  let count = 0
  let excluded = 0
  let sum = 0
  let sumsq = 0
  let min = Infinity
  let max = -Infinity
  // Welford would be steadier for a huge count of nearly equal values; shifting by the first value keeps the sum of squares small.
  let shift = NaN
  for (let s = 0; s < spans.length; s += 3) {
    const base = spans[s] * width
    for (let c = spans[s + 1]; c < spans[s + 2]; c++) {
      const v = values[base + c]
      if (!Number.isFinite(v) || isNodata(v, nodata)) {
        excluded++
        continue
      }
      if (count === 0) shift = v
      count++
      const d = v - shift
      sum += d
      sumsq += d * d
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (count === 0) return { band: band.index, name: band.name, count: 0, excluded, min: null, max: null, mean: null, sum: null, std: null, histogram: [] }
  const meanShift = sum / count
  const variance = Math.max(0, sumsq / count - meanShift * meanShift)
  const histogram = new Array<number>(AREA_HISTOGRAM_BINS).fill(0)
  const range = max - min
  if (range > 0) {
    const scale = AREA_HISTOGRAM_BINS / range
    for (let s = 0; s < spans.length; s += 3) {
      const base = spans[s] * width
      for (let c = spans[s + 1]; c < spans[s + 2]; c++) {
        const v = values[base + c]
        if (!Number.isFinite(v) || isNodata(v, nodata)) continue
        histogram[Math.min(AREA_HISTOGRAM_BINS - 1, Math.floor((v - min) * scale))]++
      }
    }
  } else histogram[0] = count
  return { band: band.index, name: band.name, count, excluded, min, max, mean: shift + meanShift, sum: shift * count + sum, std: Math.sqrt(variance), histogram }
}

/**
 * The finest level whose window for an area of `cellsAtFull` cells (at the full-size level) has at most `limit` cells per
 * band. `widths` are the levels' widths, finest first. `approximate` when it is not the finest.
 */
export function chooseStatsLevel(widths: readonly number[], cellsAtFull: number, limit = MAX_STATS_CELLS): { level: number; approximate: boolean; fits: boolean } {
  if (!widths.length) return { level: 0, approximate: false, fits: false }
  for (let l = 0; l < widths.length; l++) {
    const f = widths[0] / widths[l]
    if (cellsAtFull / (f * f) <= limit) return { level: l, approximate: l > 0, fits: true }
  }
  return { level: widths.length - 1, approximate: widths.length > 1, fits: false }
}

/** What the panel shows for an area. */
export interface AreaResult {
  /** Square meters, from the drawn shape. */
  areaM2: number
  /** True when a reduced level was read (the figures are estimates). */
  approximate: boolean
  /** The size of a cell of the level read, in meters (null when unknown). */
  cellMeters: number | null
  bands: BandAreaStats[]
}
