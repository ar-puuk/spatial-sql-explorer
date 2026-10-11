// T022 (spec 008 FR-012/FR-013): row selection as SQL. The engine runs it in
// tests/web/specs/table-selection.spec.ts.
import { describe, expect, it } from 'vitest'
import { isEmptySelection, SELECTION_INLINE_MAX, selectionExtentSql, selectionPredicate, selectionSize, selectionTableSql, type Selection } from '@spatial-explorer/core'

const ids = (...n: number[]): Selection => ({ kind: 'ids', ids: new Set(n) })

describe('selectionPredicate', () => {
  it('small selections are an IN list of row ids', () => {
    expect(selectionPredicate(ids(3, 1, 2))).toBe('__se_rowid IN (3, 1, 2)')
  })
  it('an empty selection matches nothing; "all matching" adds no predicate', () => {
    expect(selectionPredicate(ids())).toBe('false')
    expect(selectionPredicate({ kind: 'all-matching' })).toBeNull()
  })
  it('only safe integers reach SQL', () => {
    expect(selectionPredicate({ kind: 'ids', ids: new Set([1, 2.5, Number.NaN, 2 ** 60]) })).toBe('__se_rowid IN (1)')
  })
  it('large selections go through a temporary table, filled in chunks', () => {
    const big: Selection = { kind: 'ids', ids: new Set(Array.from({ length: SELECTION_INLINE_MAX + 1 }, (_, i) => i)) }
    expect(selectionPredicate(big)).toBe('__se_rowid IN (SELECT id FROM __se_selection)')
    const fill = selectionTableSql(big)!
    expect(fill[0]).toBe('CREATE OR REPLACE TEMP TABLE __se_selection (id BIGINT)')
    expect(fill).toHaveLength(1 + Math.ceil((SELECTION_INLINE_MAX + 1) / 10_000))
    expect(selectionTableSql(ids(1, 2))).toBeNull()
  })
})

describe('selection helpers', () => {
  it('size and emptiness', () => {
    expect(selectionSize(ids(1, 2), 99)).toBe(2)
    expect(selectionSize({ kind: 'all-matching' }, 99)).toBe(99)
    expect(isEmptySelection(ids())).toBe(true)
    expect(isEmptySelection({ kind: 'all-matching' })).toBe(false)
  })
  it('the extent is reprojected to WGS84 unless it already is', () => {
    expect(selectionExtentSql('r', 'geom', null)).toContain('SELECT "geom" AS s FROM r WHERE "geom" IS NOT NULL')
    expect(selectionExtentSql('r', 'geom', 26912)).toContain(`ST_Transform("geom", 'EPSG:26912', 'EPSG:4326', always_xy := true)`)
  })
})
