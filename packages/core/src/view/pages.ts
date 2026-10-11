// The attribute table's rows, a page at a time (spec 007 research §10,
// contracts/core-data-access.md QuerySession.page). Pure builders and the
// page LRU; tests in tests/core/pages-sql.test.ts.
import type { TablePage, TablePageRequest } from '../models.js'
import { displayColumnSql, quoteIdent } from '../query/util.js'

/** Rows per page: small enough to arrive at once, big enough for a screenful. */
export const PAGE_SIZE = 200

/** Other geometry columns show this much WKT in the table (spec 002). */
const OTHER_GEOMETRY_TEXT_MAX = 200

export interface PageTarget {
  /** A relation providing `__se_rowid` (see QuerySession.pageTarget). */
  relation: string
  /** Visible columns, in result order; geometry-typed ones other than `geom` are shown as WKT text. */
  columns: Array<{ name: string; type: string }>
  /** Quoted primary geometry column, or null (a table-only result). */
  geom: string | null
  /** The open counted no invalid geometry: the invalid flag only checks for NULL. */
  allValid?: boolean
}

const isGeometryType = (type: string): boolean => type.toUpperCase().startsWith('GEOMETRY')

export function pageSql(t: PageTarget, req: TablePageRequest): string {
  const select = t.columns.map((c) => {
    const id = quoteIdent(c.name)
    // Spec 008: dates and times as text (Arrow gives bare numbers).
    return isGeometryType(c.type) ? `left(ST_AsText(${id}), ${OTHER_GEOMETRY_TEXT_MAX}) AS ${id}` : displayColumnSql(c.name, c.type)
  })
  select.push('__se_rowid')
  const g = t.geom
  select.push(g ? (t.allValid ? `(${g} IS NULL) AS __se_invalid` : `(${g} IS NULL OR NOT ST_IsValid(${g})) AS __se_invalid`) : 'false AS __se_invalid')
  const order = req.sort ? ` ORDER BY ${quoteIdent(req.sort.column)} ${req.sort.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, __se_rowid` : ' ORDER BY __se_rowid'
  return `SELECT ${select.join(', ')} FROM ${t.relation}${order} LIMIT ${Math.max(1, Math.floor(req.limit))} OFFSET ${Math.max(0, Math.floor(req.offset))}`
}

/**
 * Pages of the current result, least recently used dropped first. Keyed by
 * sort and offset; a new result or a new sort starts a new cache (clear()).
 */
export class PageCache {
  private pages = new Map<string, TablePage>()

  constructor(private readonly max = 50) {}

  private key(req: TablePageRequest): string {
    return `${req.sort ? `${req.sort.column}\u0000${req.sort.dir}` : ''}\u0001${req.offset}\u0001${req.limit}`
  }

  get(req: TablePageRequest): TablePage | undefined {
    const k = this.key(req)
    const page = this.pages.get(k)
    if (page) {
      // Refresh recency.
      this.pages.delete(k)
      this.pages.set(k, page)
    }
    return page
  }

  set(req: TablePageRequest, page: TablePage): void {
    const k = this.key(req)
    this.pages.delete(k)
    this.pages.set(k, page)
    while (this.pages.size > this.max) this.pages.delete(this.pages.keys().next().value as string)
  }

  clear(): void {
    this.pages.clear()
  }

  get size(): number {
    return this.pages.size
  }
}
