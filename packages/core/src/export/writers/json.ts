// JSON (spec 008 FR-020): the rows as one array of objects, attributes only.
// Written here rather than by the engine's COPY ... (FORMAT JSON): that needs
// the json extension, which the engine lockdown won't autoload, and loading it
// at every start would cost every user for a rare export.
import { ChunkBuffer, jsonSafe, type ExportRow, type RowWriter, type WriterColumn } from './common.js'

export function jsonWriter(columns: readonly WriterColumn[]): RowWriter {
  const out = new ChunkBuffer()
  let pending = '['
  let first = true
  return {
    add({ values }: ExportRow) {
      const row: Record<string, unknown> = {}
      columns.forEach((c, i) => (row[c.name] = jsonSafe(values[i])))
      pending += `${first ? '\n' : ',\n'}${JSON.stringify(row)}`
      first = false
      if (pending.length > 1 << 20) {
        out.push(pending)
        pending = ''
      }
    },
    get size() {
      return out.size + pending.length
    },
    finish() {
      out.push(`${pending}\n]\n`)
      return out.bytes()
    },
  }
}
