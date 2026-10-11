// ESRI Shapefile (spec 008 FR-020/FR-021), written from the ESRI Shapefile
// Technical Description (1998) and the dBASE III table format: .shp, .shx,
// .dbf, .prj (the CRS as WKT) and .cpg (UTF-8), zipped. A Shapefile holds one
// geometry type, so a mixed result becomes one set per type in the zip
// (<name>_points, _lines, _polygons). Field names are cut to 10 characters
// (dbfNames.ts); text over 254 bytes is cut. Rings are reoriented as the
// format requires (outer rings clockwise, holes counter-clockwise).
import { zipSync } from 'fflate'
import type { Geometry, Position } from 'geojson'
import { dbfFieldNames } from '../dbfNames.js'
import { SHAPEFILE_MAX_BYTES } from '../formats.js'
import { bboxOf, toNumber, textOf, type ExportRow, type RowWriter, type WriterColumn } from './common.js'

/** Shape types (null shapes are type 0 inside any file). */
const POINT = 1
const POLYLINE = 3
const POLYGON = 5
const MULTIPOINT = 8
type ShapeType = typeof POINT | typeof POLYLINE | typeof POLYGON | typeof MULTIPOINT
const SUFFIX: Record<ShapeType, string> = { [POINT]: 'points', [MULTIPOINT]: 'multipoints', [POLYLINE]: 'lines', [POLYGON]: 'polygons' }

function shapeTypeOf(g: Geometry | null): ShapeType | null {
  if (!g) return null
  switch (g.type) {
    case 'Point':
      return POINT
    case 'MultiPoint':
      return MULTIPOINT
    case 'LineString':
    case 'MultiLineString':
      return POLYLINE
    case 'Polygon':
    case 'MultiPolygon':
      return POLYGON
    case 'GeometryCollection':
      return null
  }
}

/** Twice the signed area: positive for counter-clockwise rings (y up). */
function signedArea(r: Position[]): number {
  let a = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1])
  return a
}

/** Parts (rings or lines) of a geometry, oriented for the Shapefile. */
function partsOf(g: Geometry): Position[][] {
  switch (g.type) {
    case 'LineString':
      return [g.coordinates]
    case 'MultiLineString':
      return g.coordinates
    case 'Polygon':
    case 'MultiPolygon': {
      const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      const out: Position[][] = []
      for (const rings of polygons) {
        rings.forEach((ring, i) => {
          const ccw = signedArea(ring) > 0
          // Outer ring clockwise, holes counter-clockwise.
          out.push((i === 0) === ccw ? [...ring].reverse() : ring)
        })
      }
      return out
    }
    default:
      return []
  }
}

/** One record's content (after the 8-byte record header). */
function shapeContent(type: ShapeType, g: Geometry | null): Uint8Array {
  if (!g) {
    const b = new DataView(new ArrayBuffer(4))
    b.setInt32(0, 0, true)
    return new Uint8Array(b.buffer)
  }
  if (type === POINT && g.type === 'Point') {
    const b = new DataView(new ArrayBuffer(20))
    b.setInt32(0, POINT, true)
    b.setFloat64(4, g.coordinates[0], true)
    b.setFloat64(12, g.coordinates[1], true)
    return new Uint8Array(b.buffer)
  }
  const box = bboxOf(g) ?? [0, 0, 0, 0]
  if (type === MULTIPOINT && g.type === 'MultiPoint') {
    const n = g.coordinates.length
    const b = new DataView(new ArrayBuffer(40 + 16 * n))
    b.setInt32(0, MULTIPOINT, true)
    box.forEach((v, i) => b.setFloat64(4 + i * 8, v, true))
    b.setInt32(36, n, true)
    g.coordinates.forEach((p, i) => {
      b.setFloat64(40 + i * 16, p[0], true)
      b.setFloat64(48 + i * 16, p[1], true)
    })
    return new Uint8Array(b.buffer)
  }
  const parts = partsOf(g)
  const points = parts.reduce((n, p) => n + p.length, 0)
  const b = new DataView(new ArrayBuffer(44 + 4 * parts.length + 16 * points))
  b.setInt32(0, type, true)
  box.forEach((v, i) => b.setFloat64(4 + i * 8, v, true))
  b.setInt32(36, parts.length, true)
  b.setInt32(40, points, true)
  let index = 0
  parts.forEach((p, i) => {
    b.setInt32(44 + i * 4, index, true)
    index += p.length
  })
  let o = 44 + 4 * parts.length
  for (const p of parts) {
    for (const [x, y] of p) {
      b.setFloat64(o, x, true)
      b.setFloat64(o + 8, y, true)
      o += 16
    }
  }
  return new Uint8Array(b.buffer)
}

/** The 100-byte main file header (.shp and .shx). */
function fileHeader(type: ShapeType, words: number, box: number[]): Uint8Array {
  const b = new DataView(new ArrayBuffer(100))
  b.setInt32(0, 9994, false)
  b.setInt32(24, words, false)
  b.setInt32(28, 1000, true)
  b.setInt32(32, type, true)
  box.forEach((v, i) => b.setFloat64(36 + i * 8, v, true))
  return new Uint8Array(b.buffer)
}

const encoder = new TextEncoder()

/** UTF-8 bytes of `s`, cut to at most `max` bytes on a character boundary. */
function cutUtf8(s: string, max: number): Uint8Array {
  const all = encoder.encode(s)
  if (all.length <= max) return all
  let end = max
  while (end > 0 && (all[end] & 0xc0) === 0x80) end--
  return all.slice(0, end)
}

interface DbfField {
  name: string
  type: 'C' | 'N' | 'L' | 'D'
  length: number
  decimals: number
}

function dbfValue(kind: WriterColumn['kind'], v: unknown): string | Uint8Array {
  if (v === null || v === undefined) return ''
  switch (kind) {
    case 'bool':
      return v ? 'T' : 'F'
    case 'int':
    case 'bigint':
      return typeof v === 'bigint' ? v.toString() : String(Math.trunc(toNumber(v) ?? 0))
    case 'double': {
      const n = toNumber(v)
      return n === null ? '' : String(n)
    }
    case 'date':
      return textOf(v).slice(0, 10).replace(/-/g, '')
    default:
      return cutUtf8(textOf(v), 254)
  }
}

/** The .dbf table of `rows` (values already converted by dbfValue). */
function dbf(columns: readonly WriterColumn[], names: string[], rows: Array<Array<string | Uint8Array>>): Uint8Array {
  const fields: DbfField[] = columns.map((c, i) => {
    const longest = rows.reduce((n, r) => Math.max(n, r[i].length), 0)
    switch (c.kind) {
      case 'bool':
        return { name: names[i], type: 'L', length: 1, decimals: 0 }
      case 'int':
        return { name: names[i], type: 'N', length: Math.max(11, longest), decimals: 0 }
      case 'bigint':
        return { name: names[i], type: 'N', length: Math.max(20, longest), decimals: 0 }
      case 'double':
        return { name: names[i], type: 'N', length: Math.min(254, Math.max(24, longest)), decimals: 15 }
      case 'date':
        return { name: names[i], type: 'D', length: 8, decimals: 0 }
      default:
        return { name: names[i], type: 'C', length: Math.max(1, Math.min(254, longest)), decimals: 0 }
    }
  })
  const headerLength = 32 + 32 * fields.length + 1
  const recordLength = 1 + fields.reduce((n, f) => n + f.length, 0)
  const out = new Uint8Array(headerLength + recordLength * rows.length + 1)
  const view = new DataView(out.buffer)
  const now = new Date()
  out[0] = 0x03
  out[1] = now.getFullYear() - 1900
  out[2] = now.getMonth() + 1
  out[3] = now.getDate()
  view.setUint32(4, rows.length, true)
  view.setUint16(8, headerLength, true)
  view.setUint16(10, recordLength, true)
  fields.forEach((f, i) => {
    const at = 32 + i * 32
    out.set(encoder.encode(f.name).slice(0, 10), at)
    out[at + 11] = f.type.charCodeAt(0)
    out[at + 16] = f.length
    out[at + 17] = f.decimals
  })
  out[headerLength - 1] = 0x0d
  let o = headerLength
  for (const r of rows) {
    out[o++] = 0x20 // not deleted
    fields.forEach((f, i) => {
      const v = r[i]
      const bytes = typeof v === 'string' ? encoder.encode(v) : v
      const cell = new Uint8Array(f.length).fill(0x20)
      // Numbers are right-aligned; everything else left-aligned.
      if (f.type === 'N') cell.set(bytes.slice(0, f.length), Math.max(0, f.length - bytes.length))
      else cell.set(bytes.slice(0, f.length))
      out.set(cell, o)
      o += f.length
    })
  }
  out[o] = 0x1a
  return out
}

interface Part {
  type: ShapeType
  records: Uint8Array[]
  rows: Array<Array<string | Uint8Array>>
  box: [number, number, number, number] | null
}

/** Writes a zipped Shapefile set (or one set per geometry type) named after `baseName`. */
export function shapefileWriter(columns: readonly WriterColumn[], baseName: string, prjWkt: string | null): RowWriter {
  const names = dbfFieldNames(columns.map((c) => c.name))
  const parts = new Map<ShapeType, Part>()
  /** Rows without geometry, kept as null shapes in the first part. */
  const nullRows: Array<Array<string | Uint8Array>> = []
  let size = 0
  return {
    add({ values, geometry }: ExportRow) {
      const row = columns.map((c, i) => dbfValue(c.kind, values[i]))
      const type = shapeTypeOf(geometry)
      if (type === null) {
        nullRows.push(row)
        return
      }
      let part = parts.get(type)
      if (!part) parts.set(type, (part = { type, records: [], rows: [], box: null }))
      const content = shapeContent(type, geometry)
      part.records.push(content)
      part.rows.push(row)
      size += content.length + 8 + row.reduce((n, v) => n + v.length, 1)
      if (size > SHAPEFILE_MAX_BYTES) throw new Error('This export is over 2 GB, the Shapefile limit. Filter the result, or choose GeoPackage or GeoParquet.')
      const b = bboxOf(geometry)
      if (b) part.box = part.box ? [Math.min(part.box[0], b[0]), Math.min(part.box[1], b[1]), Math.max(part.box[2], b[2]), Math.max(part.box[3], b[3])] : b
    },
    get size() {
      return size
    },
    finish() {
      if (!parts.size) parts.set(POINT, { type: POINT, records: [], rows: [], box: null })
      const first = [...parts.values()][0]
      for (const row of nullRows) {
        first.records.push(shapeContent(first.type, null))
        first.rows.push(row)
      }
      const files: Record<string, Uint8Array> = {}
      const several = parts.size > 1
      for (const part of parts.values()) {
        const name = several ? `${baseName}_${SUFFIX[part.type]}` : baseName
        const box = [...(part.box ?? [0, 0, 0, 0]), 0, 0, 0, 0]
        const shpWords = (100 + part.records.reduce((n, r) => n + 8 + r.length, 0)) / 2
        const shp = new Uint8Array(shpWords * 2)
        const shx = new Uint8Array(100 + 8 * part.records.length)
        shp.set(fileHeader(part.type, shpWords, box))
        shx.set(fileHeader(part.type, shx.length / 2, box))
        const shpView = new DataView(shp.buffer)
        const shxView = new DataView(shx.buffer)
        let o = 100
        part.records.forEach((r, i) => {
          shpView.setInt32(o, i + 1, false)
          shpView.setInt32(o + 4, r.length / 2, false)
          shxView.setInt32(100 + i * 8, o / 2, false)
          shxView.setInt32(104 + i * 8, r.length / 2, false)
          shp.set(r, o + 8)
          o += 8 + r.length
        })
        files[`${name}.shp`] = shp
        files[`${name}.shx`] = shx
        files[`${name}.dbf`] = dbf(columns, names, part.rows)
        files[`${name}.cpg`] = encoder.encode('UTF-8')
        if (prjWkt) files[`${name}.prj`] = encoder.encode(prjWkt)
      }
      return zipSync(files, { level: 6 })
    },
  }
}
