// Row selection (spec 008 FR-012/FR-013, data-model.md Selection): the rows
// the user ticked in the table or Ctrl-clicked on the map, held as row ids
// (`__se_rowid`, stable per result), or as the rule "every row matching the
// filters", so selecting all of a large result stays cheap. Pure builders;
// tests in tests/core/selection.test.ts.
import { quoteIdent } from './util.js'

export type Selection = { kind: 'ids'; ids: ReadonlySet<number> } | { kind: 'all-matching' }

export const EMPTY_SELECTION: Selection = { kind: 'ids', ids: new Set() }

/** Up to this many ids go into SQL as an IN list; more go through a temporary table. */
export const SELECTION_INLINE_MAX = 50_000

/** The temporary table holding a large id selection. */
export const SELECTION_TABLE = '__se_selection'

export function selectionSize(sel: Selection, matching: number): number {
  return sel.kind === 'all-matching' ? matching : sel.ids.size
}

export function isEmptySelection(sel: Selection): boolean {
  return sel.kind === 'ids' && sel.ids.size === 0
}

/**
 * The predicate keeping selected rows of a relation that has `__se_rowid`,
 * or null for "all matching" (the filters already narrow the rows). Ids are
 * integers: anything else is dropped, so no text reaches SQL.
 */
export function selectionPredicate(sel: Selection): string | null {
  if (sel.kind === 'all-matching') return null
  const ids = [...sel.ids].filter((id) => Number.isSafeInteger(id))
  if (!ids.length) return 'false'
  if (ids.length > SELECTION_INLINE_MAX) return `__se_rowid IN (SELECT id FROM ${SELECTION_TABLE})`
  return `__se_rowid IN (${ids.join(', ')})`
}

/** Statements filling the temporary id table for a large selection (null when inline is enough). */
export function selectionTableSql(sel: Selection): string[] | null {
  if (sel.kind !== 'ids' || sel.ids.size <= SELECTION_INLINE_MAX) return null
  const ids = [...sel.ids].filter((id) => Number.isSafeInteger(id))
  const out = [`CREATE OR REPLACE TEMP TABLE ${SELECTION_TABLE} (id BIGINT)`]
  for (let i = 0; i < ids.length; i += 10_000) out.push(`INSERT INTO ${SELECTION_TABLE} VALUES ${ids.slice(i, i + 10_000).map((id) => `(${id})`).join(', ')}`)
  return out
}

/**
 * The WGS84 extent of the selected rows' geometry (FR-013 "Zoom to
 * selection"), from a relation narrowed to the selection. `srid` is the
 * geometry's EPSG code; null when it is already WGS84.
 */
export function selectionExtentSql(relation: string, geometryColumn: string, srid: number | null): string {
  return selectionExtentSqlFor(relation, quoteIdent(geometryColumn), srid)
}

/** Same, with an already quoted geometry expression. */
export function selectionExtentSqlFor(relation: string, g: string, srid: number | null): string {
  const shape = srid && srid !== 4326 ? `ST_Transform(${g}, 'EPSG:${srid}', 'EPSG:4326', always_xy := true)` : g
  return `SELECT min(ST_XMin(s)) AS x0, min(ST_YMin(s)) AS y0, max(ST_XMax(s)) AS x1, max(ST_YMax(s)) AS y1 FROM (SELECT ${shape} AS s FROM ${relation} WHERE ${g} IS NOT NULL)`
}
