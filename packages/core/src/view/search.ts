// Spec 010 phase 10: the search box's two local sources, layer values (SQL
// over the displayed result) and typed coordinates. Places (Nominatim) live
// in the UI and are only fetched on request (spec 008 FR-033).
import { quoteIdent, quoteLiteral } from '../query/util.js'

/** Text-like columns a value search reads (as `distinctCounts`). */
export const SEARCH_TEXT_TYPE = /^(VARCHAR|TEXT|STRING|CHAR|BPCHAR|ENUM|BOOLEAN)/i

/** Searches start at this many characters. */
export const SEARCH_MIN_LENGTH = 2

export interface SearchHit {
  /** The first matching row's stable id (`__se_rowid`). */
  id: number
  column: string
  value: string
  /** Rows with this value in this column. */
  count: number
  /** Words search only (spec 018): the BM25 rank, higher is better. */
  score?: number
}

/** `q` as an ILIKE pattern body: `%`, `_` and `\` matched literally (with ESCAPE '\'). */
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, '\\$&')
}

/**
 * One query over every text column of `relation` (which carries `__se_rowid`):
 * values containing `q`, case-insensitive, one hit per column and value, exact
 * matches first, then prefixes, then shorter values. Null when there is nothing
 * to search.
 */
export function searchValuesSql(relation: string, columns: ReadonlyArray<{ name: string; type: string }>, q: string, limit = 8): string | null {
  const text = q.trim()
  const textual = columns.filter((c) => SEARCH_TEXT_TYPE.test(c.type))
  if (text.length < SEARCH_MIN_LENGTH || !textual.length) return null
  const body = escapeLike(text)
  const contains = quoteLiteral(`%${body}%`)
  const parts = textual.map((c) => {
    const v = `CAST(${quoteIdent(c.name)} AS VARCHAR)`
    return `SELECT __se_rowid AS id, ${quoteLiteral(c.name)} AS col, ${v} AS value FROM ${relation} WHERE ${v} ILIKE ${contains} ESCAPE '\\'`
  })
  const exact = `(value ILIKE ${quoteLiteral(body)} ESCAPE '\\')`
  const prefix = `(value ILIKE ${quoteLiteral(`${body}%`)} ESCAPE '\\')`
  return (
    `SELECT min(id) AS id, col, value, count(*) AS n FROM (${parts.join(' UNION ALL ')}) GROUP BY col, value ` +
    `ORDER BY ${exact} DESC, ${prefix} DESC, length(value), value, col LIMIT ${Math.max(1, Math.floor(limit))}`
  )
}

export interface CoordinateCandidate {
  lon: number
  lat: number
}

const NUMBER = String.raw`[-+]?\d+(?:\.\d+)?`
const HEMI = '[NSEWnsew]'
/** Two numbers, each with an optional degree sign and hemisphere letter, separated by a comma, semicolon or spaces. */
const PAIR = new RegExp(String.raw`^\s*(${HEMI})?\s*(${NUMBER})\s*°?\s*(${HEMI})?\s*(?:[,;]\s*|\s+)(${HEMI})?\s*(${NUMBER})\s*°?\s*(${HEMI})?\s*$`)

/**
 * Coordinates typed in the search box, as the places they could mean. With
 * hemisphere letters the order is explicit (`40.7 N, 111.9 W`). Without, the
 * order is `lon, lat` unless only `lat, lon` fits (`40.7, -111.9`); when both
 * fit and differ, both are offered, `lon, lat` first.
 */
export function parseCoordinates(q: string): CoordinateCandidate[] {
  const m = PAIR.exec(q)
  if (!m) return []
  const hemiA = (m[1] ?? m[3])?.toUpperCase()
  const hemiB = (m[4] ?? m[6])?.toUpperCase()
  if ((m[1] && m[3]) || (m[4] && m[6])) return []
  let a = Number(m[2])
  let b = Number(m[5])
  const signed = (v: number, h: string | undefined): number => (h === 'S' || h === 'W' ? -Math.abs(v) : v)
  a = signed(a, hemiA)
  b = signed(b, hemiB)
  const fits = (lon: number, lat: number): boolean => Math.abs(lon) <= 180 && Math.abs(lat) <= 90
  const latLetter = (h: string | undefined): boolean => h === 'N' || h === 'S'
  const lonLetter = (h: string | undefined): boolean => h === 'E' || h === 'W'
  if (hemiA || hemiB) {
    if (latLetter(hemiA) || lonLetter(hemiB)) return fits(b, a) && !latLetter(hemiB) && !lonLetter(hemiA) ? [{ lon: b, lat: a }] : []
    if (lonLetter(hemiA) || latLetter(hemiB)) return fits(a, b) ? [{ lon: a, lat: b }] : []
    return []
  }
  const out: CoordinateCandidate[] = []
  if (fits(a, b)) out.push({ lon: a, lat: b })
  if (fits(b, a) && a !== b) out.push({ lon: b, lat: a })
  return out
}
