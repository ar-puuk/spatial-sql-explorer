// Per-column table filters (spec 008 FR-010/FR-011, research §9,
// data-model.md ColumnFilter). A filter is a convenience over the current
// result, not a second query language: text "contains", number and date
// comparisons, and true/false. They compile to one WHERE body over the
// result, so the table, the map, counts, styles and export all read the
// same rows, and large files keep spec 007's paths (progress, cancel).
// Every value reaches SQL through quoteLiteral or as a validated number.
// Pure builders; tests in tests/core/filters.test.ts.
import { quoteIdent, quoteLiteral } from './util.js'

export type FilterKind = 'contains' | 'eq' | 'gte' | 'lte' | 'between' | 'bool'

export interface ColumnFilter {
  column: string
  kind: FilterKind
  /** As typed (text, number or date text), or a boolean for `bool`. */
  value: string | number | boolean
  /** `between` only: the upper value. */
  value2?: string | number
  /** Set by `parseFilter`: false when a value doesn't fit the column type (not applied). */
  valid?: boolean
  /** Why it's invalid, for the input's description. */
  reason?: string
}

type ColumnClass = 'number' | 'date' | 'timestamp' | 'boolean' | 'text' | 'other'

/** What a DuckDB column type can be filtered as. Geometry and nested types: nothing. */
export function columnClass(type: string): ColumnClass {
  const t = type.toUpperCase()
  if (/^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)\b/.test(t)) return 'number'
  if (/^DATE$/.test(t)) return 'date'
  if (/^TIMESTAMP/.test(t)) return 'timestamp'
  if (/^BOOL/.test(t)) return 'boolean'
  if (/^(VARCHAR|TEXT|STRING|CHAR|BPCHAR|ENUM|UUID|TIME\b)/.test(t)) return 'text'
  return 'other'
}

/** The filter kinds offered for a column type (FR-010); empty for geometry and nested types. */
export function filterKindsFor(columnType: string): FilterKind[] {
  switch (columnClass(columnType)) {
    case 'number':
    case 'date':
    case 'timestamp':
      return ['eq', 'gte', 'lte', 'between']
    case 'boolean':
      return ['bool']
    case 'text':
      return ['contains']
    default:
      return []
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/

function parseValue(raw: string | number | boolean | undefined, cls: ColumnClass): { ok: true; sql: string } | { ok: false; reason: string } {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, reason: 'Enter a value.' }
  if (cls === 'number') {
    const n = Number(text.replace(/,/g, ''))
    return Number.isFinite(n) ? { ok: true, sql: String(n) } : { ok: false, reason: 'Enter a number.' }
  }
  if (cls === 'date') {
    return DATE_RE.test(text) && !Number.isNaN(Date.parse(text)) ? { ok: true, sql: `DATE ${quoteLiteral(text)}` } : { ok: false, reason: 'Enter a date as YYYY-MM-DD.' }
  }
  if (cls === 'timestamp') {
    return TIMESTAMP_RE.test(text) && !Number.isNaN(Date.parse(text.replace(' ', 'T'))) ? { ok: true, sql: `TIMESTAMP ${quoteLiteral(text.replace('T', ' '))}` } : { ok: false, reason: 'Enter a date as YYYY-MM-DD, or YYYY-MM-DD HH:MM.' }
  }
  return { ok: true, sql: quoteLiteral(text) }
}

/** Marks a filter valid or not for its column type (FR-010 edge case: letters in a number filter). */
export function parseFilter(f: ColumnFilter, columnType: string): ColumnFilter {
  const kinds = filterKindsFor(columnType)
  if (!kinds.includes(f.kind)) return { ...f, valid: false, reason: 'This column can’t be filtered this way.' }
  if (f.kind === 'bool') return typeof f.value === 'boolean' ? { ...f, valid: true, reason: undefined } : { ...f, valid: false, reason: 'Choose true or false.' }
  if (f.kind === 'contains') return String(f.value).length ? { ...f, valid: true, reason: undefined } : { ...f, valid: false, reason: 'Enter text to find.' }
  const cls = columnClass(columnType)
  const a = parseValue(f.value, cls)
  if (!a.ok) return { ...f, valid: false, reason: a.reason }
  if (f.kind === 'between') {
    const b = parseValue(f.value2, cls)
    if (!b.ok) return { ...f, valid: false, reason: `Upper value: ${b.reason}` }
  }
  return { ...f, valid: true, reason: undefined }
}

/** `%`, `_` and `\` match literally inside ILIKE ... ESCAPE '\'. */
function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function filterSql(f: ColumnFilter, columnType: string): string | null {
  const parsed = parseFilter(f, columnType)
  if (!parsed.valid) return null
  const c = quoteIdent(f.column)
  if (f.kind === 'contains') return `CAST(${c} AS VARCHAR) ILIKE ${quoteLiteral(`%${likeEscape(String(f.value))}%`)} ESCAPE '\\'`
  if (f.kind === 'bool') return `${c} = ${f.value ? 'true' : 'false'}`
  const cls = columnClass(columnType)
  const a = parseValue(f.value, cls)
  if (!a.ok) return null
  if (f.kind === 'eq') return `${c} = ${a.sql}`
  if (f.kind === 'gte') return `${c} >= ${a.sql}`
  if (f.kind === 'lte') return `${c} <= ${a.sql}`
  const b = parseValue(f.value2, cls)
  if (!b.ok) return null
  // Either order works: the user may type the larger bound first.
  return `${c} BETWEEN least(${a.sql}, ${b.sql}) AND greatest(${a.sql}, ${b.sql})`
}

/**
 * The WHERE body for every valid filter, combined with AND, or null when
 * none applies. Filters on columns the result doesn't have are skipped.
 */
export function filtersToSql(filters: readonly ColumnFilter[], columns: ReadonlyArray<{ name: string; type: string }>): string | null {
  const types = new Map(columns.map((c) => [c.name, c.type]))
  const parts: string[] = []
  for (const f of filters) {
    const type = types.get(f.column)
    if (type === undefined) continue
    const sql = filterSql(f, type)
    if (sql) parts.push(`(${sql})`)
  }
  return parts.length ? parts.join(' AND ') : null
}
