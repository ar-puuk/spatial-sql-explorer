// Spec 016: the print layout's data blocks: the SQL they ask the engine, and what they make of the answers.
import { describe, expect, it } from 'vitest'
import { barData, blockSql, groupRows, lineResult, MAX_PIE_SLICES, MAX_TABLE_ROWS, normalizePrintLayoutConfig, pieData, scopeConditions, tableResult, DEFAULT_PRINT_LAYOUT, createDefaultPrintLayout } from '@spatial-explorer/core'

const all = { mode: 'all' as const, bbox: null }

describe('block SQL', () => {
  it('a table reads the columns as text, sorted with missing values last, limited', () => {
    const { main, count } = blockSql({ kind: 'table', columns: ['name', 'pop'], sortField: 'pop', sortDesc: true, limit: 10, ...all }, 'layer', '"geom"', null)
    expect(main).toBe('SELECT CAST("name" AS VARCHAR) AS c0, CAST("pop" AS VARCHAR) AS c1 FROM layer ORDER BY "pop" DESC NULLS LAST LIMIT 10')
    expect(count).toBe('SELECT count(*) AS n FROM layer')
  })

  it('a table never reads more than the page can hold', () => {
    const { main } = blockSql({ kind: 'table', columns: ['a'], sortField: '', sortDesc: false, limit: 5000, ...all }, 'layer', null, null)
    expect(main).toContain(`LIMIT ${MAX_TABLE_ROWS}`)
  })

  it('a name with a quote is quoted', () => {
    const { main } = blockSql({ kind: 'groups', category: 'a"b', valueField: null, ...all }, 'layer', null, null)
    expect(main).toContain('CAST("a""b" AS VARCHAR)')
  })

  it('the page extent: completely within is ST_Within, touching is ST_Intersects, in the layer CRS', () => {
    const within = scopeConditions({ mode: 'contained', bbox: [-112, 40, -111, 41] }, '"geom"', null)
    expect(within).toHaveLength(1)
    expect(within[0]).toContain('ST_Within("geom"')
    const touching = scopeConditions({ mode: 'intersecting', bbox: [-112, 40, -111, 41] }, '"geom"', 26912)
    expect(touching[0]).toContain('ST_Intersects("geom"')
    expect(touching[0]).toContain("'EPSG:26912'")
  })

  it('no filter without a geometry column or an extent, and a page feature is its row id', () => {
    expect(scopeConditions({ mode: 'contained', bbox: [0, 0, 1, 1] }, null, null)).toEqual([])
    expect(scopeConditions({ mode: 'contained', bbox: null }, '"g"', null)).toEqual([])
    expect(scopeConditions({ mode: 'all', bbox: null, rowId: 7 }, '"g"', null)).toEqual(['__se_rowid = 7'])
  })

  it('an extent over the date line (west past east) is wrapped, not taken as the other side of the world', () => {
    const [cond] = scopeConditions({ mode: 'intersecting', bbox: [170, -10, -170, 10] }, '"g"', null)
    expect(cond).toContain('190')
  })

  it('a line is sampled evenly so a long series stays small', () => {
    const { main } = blockSql({ kind: 'line', valueField: 'v', ...all }, 'layer', null, null)
    expect(main).toContain('idx %')
    expect(main).toContain('2000.0')
  })
})

describe('what the answers make', () => {
  it('table cells are text, a missing value is blank, and the rest are counted as truncated', () => {
    const r = tableResult({ kind: 'table', columns: ['a', 'b'], sortField: '', sortDesc: false, limit: 2, ...all }, [{ c0: 'x', c1: null }, { c0: 3, c1: 'y' }], 5)
    expect(r).toEqual({ columns: ['a', 'b'], rows: [['x', ''], ['3', 'y']], truncated: 3 })
    expect(tableResult({ kind: 'table', columns: ['a'], sortField: '', sortDesc: false, limit: 2, ...all }, [], 0)).toBeNull()
  })

  it('a blank category is "(blank)", and counts may arrive as bigint', () => {
    expect(groupRows([{ label: null, n: 3n, s: 0, nn: 0n }, { label: '', n: 1, s: 0, nn: 0 }, { label: 'A', n: 2, s: 5, nn: 2 }])).toEqual([
      { label: '(blank)', count: 3, sum: 0, numeric: 0 },
      { label: '(blank)', count: 1, sum: 0, numeric: 0 },
      { label: 'A', count: 2, sum: 5, numeric: 2 },
    ])
  })

  it('bars: the biggest first, capped, with the rest counted; sum and mean skip a category with no numbers', () => {
    const groups = [
      { label: 'a', count: 1, sum: 10, numeric: 1 },
      { label: 'b', count: 4, sum: 0, numeric: 0 },
      { label: 'c', count: 2, sum: 30, numeric: 2 },
    ]
    expect(barData(groups, 'count')?.bars.map((b) => b.label)).toEqual(['b', 'c', 'a'])
    expect(barData(groups, 'sum')?.bars.map((b) => [b.label, b.value])).toEqual([['c', 30], ['a', 10]])
    expect(barData(groups, 'mean')?.bars.map((b) => [b.label, b.value])).toEqual([['c', 15], ['a', 10]])
    expect(barData(groups, 'count', 2)?.truncated).toBe(1)
    expect(barData([], 'count')).toBeNull()
  })

  it('a pie keeps positive parts and folds the rest into (other)', () => {
    const groups = Array.from({ length: 12 }, (_, i) => ({ label: `c${i}`, count: 12 - i, sum: 0, numeric: 0 }))
    const pie = pieData(groups, 'count')!
    expect(pie.slices).toHaveLength(MAX_PIE_SLICES)
    expect(pie.slices.at(-1)?.label).toBe('(other)')
    expect(pie.total).toBe(78)
    expect(pieData([{ label: 'a', count: 1, sum: -3, numeric: 1 }], 'sum')).toBeNull()
  })

  it('a line: the points, their range and how many rows there are', () => {
    expect(lineResult([{ idx: 0, v: 3 }, { idx: 2n, v: 1 }], 10)).toEqual({ points: [{ index: 0, value: 3 }, { index: 2, value: 1 }], min: 1, max: 3, length: 10 })
    expect(lineResult([], 3)).toBeNull()
  })
})

describe('the saved layout', () => {
  it('a missing or odd value falls back to the default, and an empty object is a default layout', () => {
    expect(normalizePrintLayoutConfig('nope')).toBeNull()
    const n = normalizePrintLayoutConfig({ paperSize: 'poster', orientation: 'portrait', mapBorderWidth: 99, extentBbox: [2, 0, 1, 1], tableColumns: ['a', 3] })!
    expect(n.paperSize).toBe(DEFAULT_PRINT_LAYOUT.paperSize)
    expect(n.orientation).toBe('portrait')
    expect(n.mapBorderWidth).toBe(10)
    expect(n.extentBbox).toBeNull()
    expect(n.tableColumns).toEqual(['a'])
    expect(normalizePrintLayoutConfig({})).toEqual(createDefaultPrintLayout())
  })

  it('custom legend ids are made unique', () => {
    const n = normalizePrintLayoutConfig({ customLegendEntries: [{ id: 'cl-1', label: 'A', color: '#111' }, { id: 'cl-1', label: 'B', color: '#222' }, { label: 'C', color: '#333' }] })!
    expect(new Set(n.customLegendEntries.map((e) => e.id)).size).toBe(3)
  })
})
