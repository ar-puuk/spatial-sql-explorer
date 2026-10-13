// Shared pieces of the JS export writers (spec 008 US4, research §3; spec 010:
// GeoJSON, KML, Shapefile and GeoPackage, whose GDAL writers fail or crawl in
// WASM): rows stream out of the engine (export/run.ts) and each writer turns
// them into its format. Rows arrive
// with values already made JS-safe by the plan's SQL (dates as ISO text,
// decimals as doubles, nested values as JSON), and geometry as GeoJSON.
import type { Geometry, Position } from 'geojson'

/** How a writer stores a column, from its source SQL type. */
export type WriterKind = 'bool' | 'int' | 'bigint' | 'double' | 'date' | 'datetime' | 'text' | 'json'

export interface WriterColumn {
  name: string
  kind: WriterKind
}

/** One exported row: values in column order, and the geometry (null: none or invalid). */
export interface ExportRow {
  values: unknown[]
  geometry: Geometry | null
}

export interface RowWriter {
  add(row: ExportRow): void
  /** Bytes written so far (an estimate, for size limits). */
  readonly size: number
  finish(): Uint8Array | Promise<Uint8Array>
}

export function writerKind(sqlType: string): WriterKind {
  const t = sqlType.trim().toUpperCase()
  if (/^BOOL/.test(t)) return 'bool'
  if (/^(TINYINT|SMALLINT|INTEGER|INT|UTINYINT|USMALLINT)$/.test(t)) return 'int'
  if (/^(BIGINT|UINTEGER|UBIGINT|INT8|LONG)$/.test(t)) return 'bigint'
  if (/^(FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)/.test(t)) return 'double'
  if (t === 'DATE') return 'date'
  if (/^TIMESTAMP/.test(t)) return 'datetime'
  if (/(\[\]|^STRUCT\(|^MAP\(|^UNION\(|^LIST|^JSON$)/.test(t)) return 'json'
  return 'text'
}

export function writerColumnsOf(columns: ReadonlyArray<{ name: string; type: string }>): WriterColumn[] {
  return columns.map((c) => ({ name: c.name, kind: writerKind(c.type) }))
}

/** A value as a JS number, or null (bigint, numeric text, booleans). */
export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** A value as JSON can hold it (bigints beyond 2^53 as text). */
export function jsonSafe(v: unknown): unknown {
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  return v === undefined ? null : v
}

export function textOf(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'bigint' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** Collects encoded chunks; `bytes()` joins them once. */
export class ChunkBuffer {
  private chunks: Uint8Array[] = []
  private encoder = new TextEncoder()
  size = 0
  push(chunk: Uint8Array | string): void {
    const u8 = typeof chunk === 'string' ? this.encoder.encode(chunk) : chunk
    this.chunks.push(u8)
    this.size += u8.length
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.size)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    this.chunks = [out]
    return out
  }
}

// --- Geometry helpers -------------------------------------------------------

/** [minX, minY, maxX, maxY] of a geometry, or null when it has no coordinates. */
export function bboxOf(g: Geometry | null): [number, number, number, number] | null {
  if (!g) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const visit = (c: unknown): void => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number') {
      const [x, y] = c as number[]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    } else c.forEach(visit)
  }
  const visitGeometry = (geom: Geometry): void => {
    if (geom.type === 'GeometryCollection') geom.geometries.forEach(visitGeometry)
    else visit(geom.coordinates)
  }
  visitGeometry(g)
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null
}

const WKB_TYPES: Record<string, number> = { Point: 1, LineString: 2, Polygon: 3, MultiPoint: 4, MultiLineString: 5, MultiPolygon: 6, GeometryCollection: 7 }

/** OGC WKB (2D, little endian) of a GeoJSON geometry. Z and M are dropped. */
export function toWkb(g: Geometry): Uint8Array {
  const bytes: Uint8Array[] = []
  let size = 0
  const buf = new ArrayBuffer(8)
  const view = new DataView(buf)
  const pushU8 = (v: number): void => {
    bytes.push(Uint8Array.of(v))
    size += 1
  }
  const pushU32 = (v: number): void => {
    view.setUint32(0, v, true)
    bytes.push(new Uint8Array(buf.slice(0, 4)))
    size += 4
  }
  const pushF64 = (v: number): void => {
    view.setFloat64(0, v, true)
    bytes.push(new Uint8Array(buf.slice(0, 8)))
    size += 8
  }
  const point = (p: Position): void => {
    pushF64(p[0])
    pushF64(p[1])
  }
  const ring = (r: Position[]): void => {
    pushU32(r.length)
    r.forEach(point)
  }
  const write = (geom: Geometry): void => {
    pushU8(1)
    pushU32(WKB_TYPES[geom.type])
    switch (geom.type) {
      case 'Point':
        if (geom.coordinates.length) point(geom.coordinates)
        else {
          pushF64(NaN)
          pushF64(NaN)
        }
        break
      case 'LineString':
        ring(geom.coordinates)
        break
      case 'Polygon':
        pushU32(geom.coordinates.length)
        geom.coordinates.forEach(ring)
        break
      case 'MultiPoint':
        pushU32(geom.coordinates.length)
        geom.coordinates.forEach((p) => write({ type: 'Point', coordinates: p }))
        break
      case 'MultiLineString':
        pushU32(geom.coordinates.length)
        geom.coordinates.forEach((l) => write({ type: 'LineString', coordinates: l }))
        break
      case 'MultiPolygon':
        pushU32(geom.coordinates.length)
        geom.coordinates.forEach((p) => write({ type: 'Polygon', coordinates: p }))
        break
      case 'GeometryCollection':
        pushU32(geom.geometries.length)
        geom.geometries.forEach(write)
        break
    }
  }
  write(g)
  const out = new Uint8Array(size)
  let o = 0
  for (const b of bytes) {
    out.set(b, o)
    o += b.length
  }
  return out
}

/** XML text with the five special characters escaped and characters XML forbids removed. */
export function xmlEscape(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string)
}
