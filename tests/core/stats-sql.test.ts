// T033 (spec 007 research §11, FR-012): style statistics in SQL, and the
// classifier giving spec 003's answers from them.
import { describe, expect, it } from 'vitest'
import {
  categorySql,
  classCountsSql,
  evenPositions,
  jenksBreaks,
  JENKS_EXACT_LIMIT,
  numberSql,
  orderStatisticsSql,
  quantileBreaks,
  quantilePositions,
  resolveStyle,
  topCategoriesSql,
  DEFAULT_LAYER_STYLE,
  type LayerStyle,
} from '@spatial-explorer/core'

describe('SQL forms of the value rules', () => {
  it('a category is the text form; NULL and empty text have none', () => {
    expect(categorySql('zone')).toBe(`nullif(CAST("zone" AS VARCHAR), '')`)
  })

  it('a number is a finite double from numbers or numeric text', () => {
    expect(numberSql('value')).toBe('CASE WHEN isfinite(TRY_CAST("value" AS DOUBLE)) THEN TRY_CAST("value" AS DOUBLE) END')
  })

  it('the top categories are most frequent first, ties alphabetical, plus manual values', () => {
    const sql = topCategoriesSql('__se_layer', 'zone', ["O'Hare"])
    expect(sql).toContain('row_number() OVER (ORDER BY count(*) DESC, cat)')
    expect(sql).toContain("OR cat IN ('O''Hare')")
    expect(sql).toMatch(/ORDER BY n DESC, cat$/)
  })
})

describe('order statistics', () => {
  it('reproduce natural breaks sampling exactly, so its breaks are identical', () => {
    const n = 300_000
    const all = Array.from({ length: n }, (_, i) => (i * 7919) % 100_003).sort((a, b) => a - b)
    const pos = evenPositions(n, JENKS_EXACT_LIMIT)
    expect(pos).toHaveLength(JENKS_EXACT_LIMIT)
    const sample = pos.map((p) => all[p])
    // jenksBreaks samples `all` the same way itself: same input, same breaks.
    expect(jenksBreaks(sample, 5)).toEqual(jenksBreaks(all, 5))
  })

  it('quantile positions are the two order statistics around each break', () => {
    const n = 101
    const all = Array.from({ length: n }, (_, i) => i * i)
    const needed = quantilePositions(n, 4)
    expect(needed).toEqual([25, 26, 50, 51, 75, 76])
    // Interpolating between just those reproduces quantileBreaks on all values.
    const breaks = [1, 2, 3].map((i) => {
      const a = (i / 4) * (n - 1)
      const lo = Math.floor(a)
      return (1 - (a - lo)) * all[lo] + (a - lo) * all[Math.min(lo + 1, n - 1)]
    })
    expect(breaks).toEqual(quantileBreaks(all, 4))
  })

  it('selects positions from the sorted non-null values', () => {
    const sql = orderStatisticsSql('__se_result', 'value', [5, 0, 5])
    expect(sql).toContain('row_number() OVER (ORDER BY v) - 1 AS pos')
    expect(sql).toContain('WHERE v IS NOT NULL')
    expect(sql).toContain('WHERE pos IN (0, 5)')
  })
})

describe('class counts', () => {
  it('are upper-inclusive like classOf, with outside (-1) and no value (-2)', () => {
    const sql = classCountsSql('__se_layer', 'value', [
      { lower: 0, upper: 10 },
      { lower: 10, upper: 20 },
    ])
    expect(sql).toContain('CASE WHEN v IS NULL THEN -2 WHEN v < 0 THEN -1 WHEN v <= 10 THEN 0 WHEN v <= 20 THEN 1 ELSE -1 END')
    expect(sql).toMatch(/GROUP BY cls$/)
  })
})

describe('the classifier on SQL inputs (spec 003 parity)', () => {
  const columns = [{ name: 'zone', type: 'VARCHAR' }, { name: 'value', type: 'INTEGER' }]
  const zones = ['R1', 'R1', 'R1', 'C', 'C', 'I', null, '']
  const values = [1, 4, 9, 16, 25, 36, 49, 64, 81, 100, null]
  const categorized: LayerStyle = { ...DEFAULT_LAYER_STYLE, renderer: { kind: 'categorized', column: 'zone', ramp: { id: 'set2', reversed: false }, cap: 2, manual: false, classes: [], other: {}, noValue: {} } }
  const graduated: LayerStyle = { ...DEFAULT_LAYER_STYLE, renderer: { kind: 'graduated', column: 'value', method: 'quantile', classCount: 3, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} } }

  it('categorized: fetched values give the same classes as features did', () => {
    const fromFeatures = resolveStyle(categorized, { columns, features: zones.map((z, i) => ({ id: i, geometry: null, attributes: { zone: z } })) })
    const fromValues = resolveStyle(categorized, { columns, rowCount: zones.length, data: { kind: 'values', column: 'zone', values: zones } })
    expect(fromValues).toEqual(fromFeatures)
  })

  it('categorized: exact SQL category counts give the same classes', () => {
    const fromFeatures = resolveStyle(categorized, { columns, features: zones.map((z, i) => ({ id: i, geometry: null, attributes: { zone: z } })) })
    const fromSql = resolveStyle(categorized, {
      columns,
      rowCount: zones.length,
      data: { kind: 'categories', column: 'zone', top: [{ value: 'R1', count: 3 }, { value: 'C', count: 2 }, { value: 'I', count: 1 }], distinct: 3, nonNull: 6, nulls: 2 },
    })
    expect(fromSql).toEqual(fromFeatures)
  })

  it('graduated: fetched values give the same classes as features did', () => {
    const fromFeatures = resolveStyle(graduated, { columns, features: values.map((v, i) => ({ id: i, geometry: null, attributes: { value: v } })) })
    const fromValues = resolveStyle(graduated, { columns, rowCount: values.length, data: { kind: 'values', column: 'value', values } })
    expect(fromValues).toEqual(fromFeatures)
  })

  it('graduated from order statistics: same breaks; counts come from SQL afterwards', () => {
    const sorted = values.filter((v): v is number => v !== null)
    const fromFeatures = resolveStyle(graduated, { columns, features: values.map((v, i) => ({ id: i, geometry: null, attributes: { value: v } })) })
    const q = quantilePositions(sorted.length, 3)
    const fromSql = resolveStyle(graduated, {
      columns,
      rowCount: values.length,
      data: { kind: 'numbers', column: 'value', sample: sorted, n: sorted.length, nulls: 1, quantileStats: Object.fromEntries(q.map((p) => [p, sorted[p]])) },
    })
    expect(fromSql.classes.map((c) => [c.lower, c.upper, c.label])).toEqual(fromFeatures.classes.map((c) => [c.lower, c.upper, c.label]))
    expect(fromSql.classes.filter((c) => c.kind === 'range').every((c) => c.count === 0)).toBe(true)
  })
})
