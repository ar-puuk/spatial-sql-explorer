// T011/T040 (spec 003): resolving a style against the displayed result.
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STYLE, eligibleColumns, isNumericType, resolveStyle, type LayerStyle } from '@spatial-explorer/core'

const COLUMNS = [
  { name: 'name', type: 'VARCHAR' },
  { name: 'pop', type: 'BIGINT' },
  { name: 'area', type: 'DOUBLE' },
  { name: 'price', type: 'DECIMAL(18,2)' },
  { name: 'open', type: 'BOOLEAN' },
  { name: 'since', type: 'DATE' },
]

describe('single symbol and column eligibility', () => {
  it('single resolves to one class covering every row', () => {
    const features = [1, 2, 3].map((id) => ({ id, geometry: null, attributes: {} }))
    const r = resolveStyle(DEFAULT_LAYER_STYLE, { features, columns: [] })
    expect(r.status).toBe('ok')
    expect(r.caption).toBe('')
    expect(r.classes).toEqual([{ key: 'single', kind: 'single', label: 'All features', color: DEFAULT_LAYER_STYLE.fillColor, visible: true, count: 3 }])
  })

  it('graduated accepts DuckDB numeric types only; categorized accepts every attribute', () => {
    expect(eligibleColumns(COLUMNS, 'graduated').map((c) => c.name)).toEqual(['pop', 'area', 'price'])
    expect(eligibleColumns(COLUMNS, 'categorized').map((c) => c.name)).toEqual(COLUMNS.map((c) => c.name))
    for (const t of ['TINYINT', 'UBIGINT', 'HUGEINT', 'FLOAT', 'DECIMAL(9,3)']) expect(isNumericType(t), t).toBe(true)
    for (const t of ['VARCHAR', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'INTERVAL', 'BLOB']) expect(isNumericType(t), t).toBe(false)
  })
})

// T040 (US5, FR-011/FR-012): the same style against changing query results.
describe('styles follow query results', () => {
  const style: LayerStyle = {
    ...DEFAULT_LAYER_STYLE,
    renderer: { kind: 'graduated', column: 'value', method: 'quantile', classCount: 4, ramp: { id: 'viridis', reversed: false }, classes: [{ index: 0, label: 'Lowest' }], noValue: {} },
  }
  const result = (n: number, columns = [{ name: 'value', type: 'DOUBLE' }]) => ({
    features: Array.from({ length: n }, (_, i) => ({ id: i, geometry: null, attributes: { value: i } })),
    columns,
  })

  it('a missing column falls back to the single symbol, naming it', () => {
    const r = resolveStyle(style, result(10, [{ name: 'parcel_id', type: 'VARCHAR' }]))
    expect(r.status).toBe('fallback')
    expect(r.reason).toBe('Column "value" is not in this result.')
    expect(r.classes.map((c) => c.kind)).toEqual(['single'])
  })

  it('a graduated column that is now text falls back with a "not numeric" reason', () => {
    const r = resolveStyle(style, result(10, [{ name: 'value', type: 'VARCHAR' }]))
    expect(r.reason).toBe('Column "value" is not numeric in this result.')
  })

  it('a new result reclassifies; overrides by index survive; the style itself never changes', () => {
    const frozen = JSON.stringify(style)
    const a = resolveStyle(style, result(100))
    const b = resolveStyle(style, result(40))
    resolveStyle(style, result(10, []))
    expect(JSON.stringify(style)).toBe(frozen)
    expect(a.classes[3].upper).toBe(99)
    expect(b.classes[3].upper).toBe(39)
    expect(a.classes.reduce((n, c) => n + c.count, 0)).toBe(100)
    expect(b.classes.reduce((n, c) => n + c.count, 0)).toBe(40)
    expect(b.classes[0].label).toBe('Lowest')
  })

  it('the column coming back restores the thematic classes', () => {
    expect(resolveStyle(style, result(10, [])).status).toBe('fallback')
    expect(resolveStyle(style, result(10)).status).toBe('ok')
  })
})
