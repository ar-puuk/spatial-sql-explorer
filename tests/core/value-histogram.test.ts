// T009 (spec 008 FR-003): the style panel's value distribution, as SQL plus
// assembly. The engine runs it in the web suite (style-panel.spec.ts).
import { describe, expect, it } from 'vitest'
import { HISTOGRAM_BINS, histogramFrom, histogramSql } from '@spatial-explorer/core'

describe('histogramSql', () => {
  it('bins numeric values into equal-width bins from min to max, the max in the last bin', () => {
    const sql = histogramSql('layer', 'pop est', 0, 100, 4)
    expect(sql).toContain('least(3, CAST(floor((v - (0)) / 25) AS INTEGER)) AS b')
    expect(sql).toContain('TRY_CAST("pop est" AS DOUBLE)')
    expect(sql).toContain('WHERE v IS NOT NULL GROUP BY b')
  })

  it('a single-value column is one bin', () => {
    expect(histogramSql('layer', 'v', 5, 5)).toContain('least(0, CAST(floor((v - (5)) / 1) AS INTEGER))')
  })

  it('negative minimums stay parenthesized', () => {
    expect(histogramSql('layer', 'v', -10, 10, 2)).toContain('(v - (-10)) / 10')
  })
})

describe('histogramFrom', () => {
  it('fills every bin, with edges from min to max, and counts the values', () => {
    const h = histogramFrom(0, 100, [
      { b: 0, n: 3 },
      { b: 3, n: 1 },
    ], 4)
    expect(h.edges).toEqual([0, 25, 50, 75, 100])
    expect(h.counts).toEqual([3, 0, 0, 1])
    expect(h.total).toBe(4)
  })

  it('defaults to HISTOGRAM_BINS bins, and ignores out-of-range rows', () => {
    const h = histogramFrom(0, 1, [{ b: 99, n: 5 }])
    expect(h.counts).toHaveLength(HISTOGRAM_BINS)
    expect(h.total).toBe(0)
  })

  it('one distinct value: one bin, edges [v, v]', () => {
    expect(histogramFrom(7, 7, [{ b: 0, n: 12 }])).toEqual({ edges: [7, 7], counts: [12], total: 12 })
  })
})
