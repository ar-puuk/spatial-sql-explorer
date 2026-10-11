// T032 (spec 007 research §10, FR-011): the attribute table's pages.
import { describe, expect, it } from 'vitest'
import { PAGE_SIZE, PageCache, pageSql, type PageTarget, type TablePage, type TablePageRequest } from '@spatial-explorer/core'

const target: PageTarget = {
  relation: '__se_layer',
  columns: [
    { name: 'zone', type: 'VARCHAR' },
    { name: 'value', type: 'INTEGER' },
    { name: 'centroid', type: 'GEOMETRY' },
  ],
  geom: '"geom"',
}
const req = (patch: Partial<TablePageRequest> = {}): TablePageRequest => ({ offset: 0, limit: PAGE_SIZE, sort: null, ...patch })

describe('page SQL', () => {
  it('selects visible columns, the row id and an invalid-geometry flag, in row-id order', () => {
    expect(pageSql(target, req({ offset: 400 }))).toBe(
      'SELECT "zone", "value", left(ST_AsText("centroid"), 200) AS "centroid", __se_rowid, ("geom" IS NULL OR NOT ST_IsValid("geom")) AS __se_invalid FROM __se_layer ORDER BY __se_rowid LIMIT 200 OFFSET 400'
    )
  })

  it('sorts the whole result in SQL, nulls last, ties by row id (FR-011)', () => {
    expect(pageSql(target, req({ sort: { column: 'value', dir: 'desc' } }))).toMatch(/ORDER BY "value" DESC NULLS LAST, __se_rowid LIMIT 200 OFFSET 0$/)
    expect(pageSql(target, req({ sort: { column: 'zone', dir: 'asc' } }))).toMatch(/ORDER BY "zone" ASC NULLS LAST, __se_rowid/)
  })

  it('checks only for NULL when the open counted no invalid geometry, and nothing for table-only results', () => {
    expect(pageSql({ ...target, allValid: true }, req())).toContain('("geom" IS NULL) AS __se_invalid')
    expect(pageSql({ ...target, geom: null }, req())).toContain('false AS __se_invalid')
  })

  it('quotes column names', () => {
    expect(pageSql({ ...target, columns: [{ name: 'we"ird', type: 'VARCHAR' }] }, req({ sort: { column: 'we"ird', dir: 'asc' } }))).toContain('"we""ird"')
  })
})

describe('page cache', () => {
  const page = (offset: number): TablePage => ({ offset, rows: [] })

  it('hits by sort and offset', () => {
    const c = new PageCache()
    c.set(req({ offset: 200 }), page(200))
    expect(c.get(req({ offset: 200 }))?.offset).toBe(200)
    expect(c.get(req({ offset: 200, sort: { column: 'zone', dir: 'asc' } }))).toBeUndefined()
  })

  it('evicts the least recently used page beyond its size', () => {
    const c = new PageCache(50)
    for (let i = 0; i < 50; i++) c.set(req({ offset: i * 200 }), page(i * 200))
    c.get(req({ offset: 0 })) // refresh the first page
    c.set(req({ offset: 50 * 200 }), page(50 * 200))
    expect(c.size).toBe(50)
    expect(c.get(req({ offset: 0 }))).toBeDefined()
    expect(c.get(req({ offset: 200 }))).toBeUndefined()
  })

  it('clears on a new result or sort', () => {
    const c = new PageCache()
    c.set(req(), page(0))
    c.clear()
    expect(c.size).toBe(0)
  })
})
