// Spec 027 US4: the cells inside an area and the figures over them, against an independent per-cell computation.
import { describe, expect, it } from 'vitest'
import { AREA_HISTOGRAM_BINS, chooseStatsLevel, densifyRing, pointInRing, polygonSpans, statsOfWindow } from '@spatial-explorer/core'

/** A small deterministic generator, so a failure repeats. */
function rng(seed: number): () => number {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

function cellsOf(spans: Int32Array): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < spans.length; i += 3) for (let c = spans[i + 1]; c < spans[i + 2]; c++) out.add(`${spans[i]},${c}`)
  return out
}
function naiveCells(rings: Array<Array<[number, number]>>, w: number, h: number): Set<string> {
  const out = new Set<string>()
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    // Even-odd over all rings.
    const inside = rings.reduce((n, ring) => n + (pointInRing(c + 0.5, r + 0.5, ring) ? 1 : 0), 0) % 2 === 1
    if (inside) out.add(`${r},${c}`)
  }
  return out
}

describe('which cells a polygon holds', () => {
  it('a rectangle holds the cells whose centers it covers', () => {
    const spans = polygonSpans([[[2, 1], [6, 1], [6, 4], [2, 4], [2, 1]]], 10, 10)
    expect(cellsOf(spans).size).toBe(4 * 3)
    expect(cellsOf(spans).has('1,2')).toBe(true)
    expect(cellsOf(spans).has('3,5')).toBe(true)
    expect(cellsOf(spans).has('4,2')).toBe(false)
  })
  it('a center on the edge counts on one side only (no cell twice, none lost between two polygons)', () => {
    const left = cellsOf(polygonSpans([[[0, 0], [5.5, 0], [5.5, 4], [0, 4], [0, 0]]], 10, 10))
    const right = cellsOf(polygonSpans([[[5.5, 0], [10, 0], [10, 4], [5.5, 4], [5.5, 0]]], 10, 10))
    for (const c of left) expect(right.has(c)).toBe(false)
    expect(left.size + right.size).toBe(10 * 4)
  })
  it('agrees with the per-cell test on random polygons', () => {
    const rand = rng(7)
    for (let t = 0; t < 40; t++) {
      const n = 3 + Math.floor(rand() * 7)
      const ring: Array<[number, number]> = []
      for (let i = 0; i < n; i++) ring.push([rand() * 30 - 3, rand() * 30 - 3])
      ring.push(ring[0])
      const fast = cellsOf(polygonSpans([ring], 24, 24))
      const slow = naiveCells([ring], 24, 24)
      expect([...fast].sort()).toEqual([...slow].sort())
    }
  })
  it('a second ring is a hole', () => {
    const outer: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    const hole: Array<[number, number]> = [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]]
    expect(cellsOf(polygonSpans([outer, hole], 10, 10)).size).toBe(100 - 16)
  })
  it('clips to the window; nothing outside is nothing', () => {
    expect(cellsOf(polygonSpans([[[-5, -5], [50, -5], [50, 50], [-5, 50], [-5, -5]]], 4, 3)).size).toBe(12)
    expect(polygonSpans([[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]], 10, 10).length).toBe(0)
    expect(polygonSpans([], 10, 10).length).toBe(0)
  })
})

describe('the figures', () => {
  const values = Array.from({ length: 6 * 5 }, (_, i) => (i % 7 === 0 ? -9999 : i % 11 === 0 ? NaN : (i * 37) % 101))
  const spans = polygonSpans([[[1, 1], [5, 1], [5, 4], [1, 4], [1, 1]]], 6, 5)
  const naive = (): number[] => {
    const out: number[] = []
    for (const k of cellsOf(spans)) {
      const [r, c] = k.split(',').map(Number)
      const v = values[r * 6 + c]
      if (Number.isFinite(v) && v !== -9999) out.push(v)
    }
    return out
  }
  it('count, excluded, min, max, mean, sum and std equal a plain computation', () => {
    const s = statsOfWindow(values, 6, spans, -9999, { index: 1, name: 'Elevation' })
    const v = naive()
    const mean = v.reduce((a, b) => a + b, 0) / v.length
    expect(s.count).toBe(v.length)
    expect(s.excluded).toBe(cellsOf(spans).size - v.length)
    expect(s.min).toBe(Math.min(...v))
    expect(s.max).toBe(Math.max(...v))
    expect(s.mean).toBeCloseTo(mean, 10)
    expect(s.sum).toBeCloseTo(v.reduce((a, b) => a + b, 0), 8)
    expect(s.std).toBeCloseTo(Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length), 8)
    expect(s.histogram).toHaveLength(AREA_HISTOGRAM_BINS)
    expect(s.histogram.reduce((a, b) => a + b, 0)).toBe(v.length)
  })
  it('big values do not lose the small differences', () => {
    const big = Array.from({ length: 100 }, (_, i) => 1e9 + (i % 5))
    const s = statsOfWindow(big, 10, polygonSpans([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], 10, 10), null, { index: 1, name: 'b' })
    expect(s.mean).toBeCloseTo(1e9 + 2, 6)
    expect(s.std).toBeCloseTo(Math.sqrt(2), 6)
  })
  it('nothing inside but no data says so', () => {
    const s = statsOfWindow([-9999, -9999, -9999, -9999], 2, polygonSpans([[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]], 2, 2), -9999, { index: 1, name: 'b' })
    expect(s).toMatchObject({ count: 0, excluded: 4, min: null, max: null, mean: null, sum: null, std: null, histogram: [] })
  })
  it('one value everywhere is one full bin', () => {
    const s = statsOfWindow([5, 5, 5, 5], 2, polygonSpans([[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]], 2, 2), null, { index: 1, name: 'b' })
    expect(s.histogram[0]).toBe(4)
    expect(s.std).toBe(0)
  })
})

describe('which level to read', () => {
  const widths = [40000, 20000, 10000, 5000, 2500]
  it('the finest when the area is small', () => {
    expect(chooseStatsLevel(widths, 1_000_000)).toEqual({ level: 0, approximate: false, fits: true })
  })
  it('a coarser level when the area is large, and says it is approximate', () => {
    const r = chooseStatsLevel(widths, 1e9)
    expect(r.level).toBeGreaterThan(0)
    expect(r.approximate).toBe(true)
    expect(r.fits).toBe(true)
    expect(1e9 / (widths[0] / widths[r.level]) ** 2).toBeLessThanOrEqual(1 << 24)
  })
  it('when even the coarsest is too much, it says it does not fit', () => {
    expect(chooseStatsLevel([40000], 1e12)).toEqual({ level: 0, approximate: false, fits: false })
  })
})

describe('densifying', () => {
  it('splits long edges and keeps the ends', () => {
    const d = densifyRing([[0, 0], [10, 0]], 1)
    expect(d.length).toBe(11)
    expect(d[0]).toEqual([0, 0])
    expect(d.at(-1)).toEqual([10, 0])
  })
})
