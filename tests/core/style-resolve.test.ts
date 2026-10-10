// T011/T040 (spec 003): resolving a style against the displayed result.
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STYLE, eligibleColumns, isNumericType, resolveStyle } from '@spatial-explorer/core'

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
