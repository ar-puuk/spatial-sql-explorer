// Newline-delimited GeoJSON (spec 008 FR-020, RFC 8142 without the record
// separator, as GDAL's GeoJSONSeq writes by default): one Feature per line,
// WGS84.
import { ChunkBuffer, jsonSafe, type ExportRow, type RowWriter, type WriterColumn } from './common.js'

export function geoJsonSeqWriter(columns: readonly WriterColumn[]): RowWriter {
  const out = new ChunkBuffer()
  let pending = ''
  return {
    add({ values, geometry }: ExportRow) {
      const properties: Record<string, unknown> = {}
      columns.forEach((c, i) => (properties[c.name] = jsonSafe(values[i])))
      pending += `${JSON.stringify({ type: 'Feature', properties, geometry })}\n`
      if (pending.length > 1 << 20) {
        out.push(pending)
        pending = ''
      }
    },
    get size() {
      return out.size + pending.length
    },
    finish() {
      out.push(pending)
      return out.bytes()
    },
  }
}
