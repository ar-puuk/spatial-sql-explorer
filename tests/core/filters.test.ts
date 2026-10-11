// T021 (spec 008 FR-010/FR-011): per-column filters as SQL. The engine runs
// them in tests/web/specs/table-filters.spec.ts.
import { describe, expect, it } from 'vitest'
import { filterKindsFor, filtersToSql, parseFilter, type ColumnFilter } from '@spatial-explorer/core'

const cols = [
  { name: 'name', type: 'VARCHAR' },
  { name: 'pop', type: 'BIGINT' },
  { name: 'area', type: 'DOUBLE' },
  { name: 'built', type: 'DATE' },
  { name: 'seen', type: 'TIMESTAMP WITH TIME ZONE' },
  { name: 'open', type: 'BOOLEAN' },
  { name: 'geom', type: 'GEOMETRY' },
  { name: 'it\'s "odd"', type: 'VARCHAR' },
]

describe('filterKindsFor', () => {
  it('offers kinds by column type', () => {
    expect(filterKindsFor('VARCHAR')).toEqual(['contains'])
    expect(filterKindsFor('DECIMAL(10,2)')).toEqual(['eq', 'gte', 'lte', 'between'])
    expect(filterKindsFor('DATE')).toEqual(['eq', 'gte', 'lte', 'between'])
    expect(filterKindsFor('BOOLEAN')).toEqual(['bool'])
    expect(filterKindsFor('GEOMETRY')).toEqual([])
    expect(filterKindsFor('STRUCT(a INTEGER)')).toEqual([])
  })
})

describe('parseFilter', () => {
  it('rejects letters in a number filter, with a reason', () => {
    const f = parseFilter({ column: 'pop', kind: 'gte', value: 'abc' }, 'BIGINT')
    expect(f.valid).toBe(false)
    expect(f.reason).toBe('Enter a number.')
  })
  it('accepts thousands separators in numbers', () => {
    expect(parseFilter({ column: 'pop', kind: 'gte', value: '1,000' }, 'BIGINT').valid).toBe(true)
  })
  it('needs YYYY-MM-DD dates and both between values', () => {
    expect(parseFilter({ column: 'built', kind: 'eq', value: '05/01/2020' }, 'DATE').valid).toBe(false)
    expect(parseFilter({ column: 'built', kind: 'between', value: '2020-01-01', value2: '' }, 'DATE').reason).toMatch(/^Upper value/)
  })
  it('refuses kinds the type does not offer', () => {
    expect(parseFilter({ column: 'name', kind: 'gte', value: 'a' }, 'VARCHAR').valid).toBe(false)
  })
})

describe('filtersToSql', () => {
  const sql = (fs: ColumnFilter[]) => filtersToSql(fs, cols)

  it('contains: case-insensitive, with %, _, \ and quotes taken literally', () => {
    expect(sql([{ column: 'name', kind: 'contains', value: "50%_o'k\\" }])).toBe(String.raw`(CAST("name" AS VARCHAR) ILIKE '%50\%\_o''k\\%' ESCAPE '\')`)
  })

  it('numbers, dates and timestamps compare as typed literals', () => {
    expect(sql([{ column: 'pop', kind: 'gte', value: '1,000' }])).toBe('("pop" >= 1000)')
    expect(sql([{ column: 'area', kind: 'lte', value: '2.5' }])).toBe('("area" <= 2.5)')
    expect(sql([{ column: 'built', kind: 'eq', value: '2020-05-01' }])).toBe(`("built" = DATE '2020-05-01')`)
    expect(sql([{ column: 'seen', kind: 'gte', value: '2020-05-01T08:30' }])).toBe(`("seen" >= TIMESTAMP '2020-05-01 08:30')`)
  })

  it('between works with the bounds in either order', () => {
    expect(sql([{ column: 'pop', kind: 'between', value: 500, value2: 100 }])).toBe('("pop" BETWEEN least(500, 100) AND greatest(500, 100))')
  })

  it('booleans, quoted column names, and AND across filters', () => {
    expect(sql([{ column: 'open', kind: 'bool', value: true }, { column: 'it\'s "odd"', kind: 'contains', value: 'x' }])).toBe(
      String.raw`("open" = true) AND (CAST("it's ""odd""" AS VARCHAR) ILIKE '%x%' ESCAPE '\')`
    )
  })

  it('skips invalid filters and columns the result does not have; null when nothing applies', () => {
    expect(sql([{ column: 'pop', kind: 'gte', value: 'abc' }])).toBeNull()
    expect(sql([{ column: 'gone', kind: 'contains', value: 'a' }])).toBeNull()
    expect(sql([])).toBeNull()
  })

  it('never lets a value end the literal (injection)', () => {
    const out = sql([{ column: 'name', kind: 'contains', value: "'); DROP TABLE layer; --" }])!
    expect(out).toBe(String.raw`(CAST("name" AS VARCHAR) ILIKE '%''); DROP TABLE layer; --%' ESCAPE '\')`)
  })
})
