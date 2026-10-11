// Streamed RFC 7946 GeoJSON writer (spec 005 research §4). GDAL can't write
// in this engine build, so GeoJSON is ours: rows stream from the cancellable
// connection, each batch becomes one encoded chunk (never one giant string),
// and the UI gets a turn between batches.
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { streamRows, yieldToUi } from '../query/util.js'
import { GEOJSON_JSON_PREFIX, type ExportPlan } from './plan.js'

const GEOMETRY = '__se_geojson'

/** A value JSON can hold exactly (the SQL already converted dates, blobs, decimals, nested values). */
function jsonValue(v: unknown): unknown {
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  return v
}

export async function writeGeoJson(
  conn: AsyncDuckDBConnection,
  plan: ExportPlan,
  isCancelled: () => boolean,
  onProgress?: (rows: number) => void
): Promise<{ bytes: Uint8Array; rows: number; empty: number }> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = [encoder.encode('{"type":"FeatureCollection","features":[\n')]
  let rows = 0
  let empty = 0
  await streamRows(conn, plan.sql, isCancelled, async (batch) => {
    let text = ''
    for (const row of batch) {
      const properties: Record<string, unknown> = {}
      let geometry: unknown = null
      for (const [key, value] of Object.entries(row)) {
        if (key === GEOMETRY) geometry = value
        else if (key.startsWith(GEOJSON_JSON_PREFIX)) properties[key.slice(GEOJSON_JSON_PREFIX.length)] = value === null ? null : JSON.parse(String(value))
        else properties[key] = jsonValue(value)
      }
      if (geometry === null || geometry === undefined) empty++
      text += `${rows === 0 ? '' : ',\n'}{"type":"Feature","properties":${JSON.stringify(properties)},"geometry":${geometry ?? 'null'}}`
      rows++
    }
    chunks.push(encoder.encode(text))
    onProgress?.(rows)
    await yieldToUi()
  })
  chunks.push(encoder.encode('\n]}\n'))

  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.length
  }
  return { bytes, rows, empty }
}
