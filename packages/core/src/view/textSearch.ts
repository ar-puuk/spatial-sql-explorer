// Spec 018: ranked word search over the displayed result's text columns, with the engine's `fts` extension (BM25, English
// stemming and stop words). The app builds the index itself on a hidden temp table, because the SQL policy refuses PRAGMA.
// Rows are keyed by `__se_rowid`, the same ids the substring search and the table use.
import { quoteIdent, quoteLiteral } from '../query/util.js'
import type { SearchHit } from './search.js'

/** The hidden table holding the indexed text; the extension names its schema `fts_main_<table>`. */
export const FTS_TABLE = '__se_fts'
export const FTS_SCHEMA = `fts_main_${FTS_TABLE}`

/** Column types an index reads: free text, not enums or booleans (those are values, not prose). */
const FTS_TEXT_TYPE = /^(VARCHAR|TEXT|STRING|CHAR|BPCHAR)/i
/** More columns than this are not indexed (the first ones, in table order). */
export const FTS_MAX_COLUMNS = 12
/** A search starts at this many characters. */
export const FTS_MIN_LENGTH = 2

/** The text columns to index, in table order; empty when the result has none. */
export function ftsColumns(columns: ReadonlyArray<{ name: string; type: string }>): string[] {
  return columns.filter((c) => FTS_TEXT_TYPE.test(c.type)).slice(0, FTS_MAX_COLUMNS).map((c) => c.name)
}

/** Statements that (re)build the index over `relation` (which carries `__se_rowid`), in order. */
export function ftsBuildSql(relation: string, columns: readonly string[]): string[] {
  const list = columns.map(quoteIdent).join(', ')
  const names = columns.map(quoteLiteral).join(', ')
  return [
    `CREATE OR REPLACE TEMP TABLE ${FTS_TABLE} AS SELECT __se_rowid AS rid, ${list} FROM ${relation}`,
    `PRAGMA create_fts_index('${FTS_TABLE}', 'rid', ${names}, stemmer = 'porter', stopwords = 'english', overwrite = 1)`,
  ]
}

/** Statements that remove the index and its table. */
export const ftsDropSql: readonly string[] = [`PRAGMA drop_fts_index('${FTS_TABLE}')`, `DROP TABLE IF EXISTS ${FTS_TABLE}`]

/** The words a query is made of (what the dialog highlights and the snippet is chosen by). */
export function ftsWords(q: string): string[] {
  return q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
}

/**
 * Rows whose indexed text matches every word of `q`, best first. `narrowedIds` is the displayed rows (filters applied),
 * or null for all. Each hit shows the first column that contains one of the words, else the first with text.
 */
export function ftsSearchSql(q: string, columns: readonly string[], narrowedIds: string | null, limit = 8): string | null {
  const words = ftsWords(q)
  if (words.join('').length < FTS_MIN_LENGTH || !columns.length) return null
  const likes = words.map((w) => quoteLiteral(`%${w.replace(/[\\%_]/g, '\\$&')}%`))
  const text = (c: string): string => `CAST(${quoteIdent(c)} AS VARCHAR)`
  const hasWord = (c: string): string => `(${likes.map((l) => `${text(c)} ILIKE ${l} ESCAPE '\\'`).join(' OR ')})`
  const shown = `coalesce(${columns.map((c) => `CASE WHEN ${hasWord(c)} THEN ${text(c)} END`).join(', ')}, ${columns.map((c) => `nullif(${text(c)}, '')`).join(', ')})`
  const which = `coalesce(${columns.map((c) => `CASE WHEN ${hasWord(c)} THEN ${quoteLiteral(c)} END`).join(', ')}, ${columns.map((c) => `CASE WHEN nullif(${text(c)}, '') IS NOT NULL THEN ${quoteLiteral(c)} END`).join(', ')})`
  const inView = narrowedIds ? ` AND rid IN (${narrowedIds})` : ''
  return (
    `SELECT rid AS id, ${which} AS col, ${shown} AS value, score FROM ` +
    `(SELECT *, ${FTS_SCHEMA}.match_bm25(rid, ${quoteLiteral(words.join(' '))}, conjunctive := 1) AS score FROM ${FTS_TABLE}) ` +
    `WHERE score IS NOT NULL${inView} ORDER BY score DESC, rid LIMIT ${Math.max(1, Math.floor(limit))}`
  )
}

/** A search row as a hit: one row each, so the count is 1. */
export function ftsHit(r: { id: unknown; col: unknown; value: unknown; score: unknown }): SearchHit {
  return { id: Number(r.id), column: String(r.col ?? ''), value: String(r.value ?? ''), count: 1, score: Number(r.score) }
}
