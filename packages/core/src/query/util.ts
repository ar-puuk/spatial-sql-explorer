// Small helpers shared by openFile and the query pipeline.
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { Feature, GeometryType } from '../models.js'

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * A SQL string literal (spec 008): every value that comes from the user or a
 * file (filter values, layer names) reaches SQL through here, never raw.
 * DuckDB strings don't treat backslashes as escapes, so only `'` is doubled.
 */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Normalizes a DuckDB spatial geometry-type string to this project's GeometryType. */
export function normalizeGeometryType(raw: string): Exclude<GeometryType, 'Mixed'> | null {
  const upper = raw.toUpperCase()
  if (upper.includes('POINT')) return 'Point'
  if (upper.includes('LINESTRING') || upper.includes('LINE')) return 'LineString'
  if (upper.includes('POLYGON')) return 'Polygon'
  return null
}

/**
 * `rawTypes` is a list of ST_GeometryType values. Queries must cast them to
 * VARCHAR: the type is an enum, and Arrow's conversion of an enum list yields
 * dictionary codes, not names, which silently turned every layer into
 * 'Point'.
 */
export function geometryTypeOf(rawTypes: unknown): GeometryType {
  const list = Array.isArray(rawTypes) ? rawTypes : ((rawTypes as { toArray?: () => unknown[] } | null)?.toArray?.() ?? [])
  const types = new Set(list.map(String).map(normalizeGeometryType).filter((t): t is Exclude<GeometryType, 'Mixed'> => t !== null))
  return types.size > 1 ? 'Mixed' : ([...types][0] ?? 'Point')
}

/**
 * DuckDB-WASM returns BIGINT columns as native JS `bigint` values, which
 * `JSON.stringify`-based serialization (used internally by MapLibre's
 * actor/worker messaging, confirmed via a real browser error: "can't
 * serialize object of type bigint") cannot handle. Converts each `bigint` to
 * a `number` when it safely fits, otherwise to a `string`. Other non-JSON
 * values (Date, typed arrays, nested Arrow rows) become JSON-safe too.
 */
export function sanitizeAttributes(raw: Record<string, unknown>): Feature['attributes'] {
  const result: Feature['attributes'] = {}
  for (const [key, value] of Object.entries(raw)) result[key] = sanitizeValue(value)
  return result
}

function sanitizeValue(value: unknown): Feature['attributes'][string] {
  if (value === null || value === undefined) return null
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString()
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (ArrayBuffer.isView(value)) return `<${(value as ArrayBufferView).byteLength} bytes>`
  const json = (value as { toJSON?: () => unknown }).toJSON?.() ?? value
  try {
    return JSON.stringify(json, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  } catch {
    return String(value)
  }
}

export class QueryCancelledError extends Error {
  constructor() {
    super('Query cancelled')
    this.name = 'QueryCancelledError'
  }
}

/** Lets the UI paint between result batches (GeoLibre's post-launch fix #2858, as a decision). */
export const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Runs `sql` through the streaming API, the only one a cancel can interrupt
 * on the single-threaded build (spec 002 research §1), calling `onBatch`
 * with plain JS rows. A cancel requested between batches stops the stream.
 */
export async function streamRows(
  conn: AsyncDuckDBConnection,
  sql: string,
  isCancelled: () => boolean,
  onBatch?: (rows: Record<string, unknown>[]) => void | Promise<void>
): Promise<void> {
  let reader
  try {
    reader = await conn.send(sql, true)
  } catch (err) {
    if (isCancelled()) throw new QueryCancelledError()
    throw err
  }
  try {
    for await (const batch of reader) {
      if (isCancelled()) throw new QueryCancelledError()
      if (onBatch) await onBatch(batch.toArray().map((row) => row.toJSON() as Record<string, unknown>))
    }
  } catch (err) {
    if (isCancelled() || err instanceof QueryCancelledError) throw new QueryCancelledError()
    throw err
  }
  if (isCancelled()) throw new QueryCancelledError()
}

/** Streams a query that returns a single row and returns it. */
export async function singleRow<T>(conn: AsyncDuckDBConnection, sql: string, isCancelled: () => boolean): Promise<T> {
  let row: Record<string, unknown> | undefined
  await streamRows(conn, sql, isCancelled, (rows) => {
    row ??= rows[0]
  })
  return (row ?? {}) as T
}
