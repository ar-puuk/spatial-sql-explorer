// FlatGeobuf (spec 008 FR-020, research §3): the `flatgeobuf` library's own
// header and feature encoders, fed one row at a time; no spatial index. The
// header is written last, once the feature count and geometry types are known
// (one type: that type; several: Unknown, with each feature's type in it).
import { buildFeature } from 'flatgeobuf/lib/mjs/generic/feature.js'
import { buildHeader } from 'flatgeobuf/lib/mjs/generic/featurecollection.js'
import { parseGC, parseGeometry } from 'flatgeobuf/lib/mjs/geojson/geometry.js'
import { ColumnType } from 'flatgeobuf/lib/mjs/flat-geobuf/column-type.js'
import { GeometryType } from 'flatgeobuf/lib/mjs/flat-geobuf/geometry-type.js'
import { magicbytes } from 'flatgeobuf/lib/mjs/constants.js'
import type { ColumnMeta } from 'flatgeobuf/lib/mjs/column-meta.js'
import type { HeaderMeta } from 'flatgeobuf/lib/mjs/header-meta.js'
import type { IParsedGeometry } from 'flatgeobuf/lib/mjs/generic/geometry.js'
import type { Geometry } from 'geojson'
import { ChunkBuffer, toNumber, textOf, type ExportRow, type RowWriter, type WriterColumn, type WriterKind } from './common.js'

const COLUMN_TYPE: Record<WriterKind, ColumnType> = {
  bool: ColumnType.Bool,
  int: ColumnType.Int,
  bigint: ColumnType.Long,
  double: ColumnType.Double,
  date: ColumnType.DateTime,
  datetime: ColumnType.DateTime,
  text: ColumnType.String,
  json: ColumnType.Json,
}

const GEOMETRY_TYPE: Record<Geometry['type'], GeometryType> = {
  Point: GeometryType.Point,
  LineString: GeometryType.LineString,
  Polygon: GeometryType.Polygon,
  MultiPoint: GeometryType.MultiPoint,
  MultiLineString: GeometryType.MultiLineString,
  MultiPolygon: GeometryType.MultiPolygon,
  GeometryCollection: GeometryType.GeometryCollection,
}

/** An empty geometry (no coordinates); the library reads `ends`/`parts` only when present. */
const EMPTY_GEOMETRY = { xy: [], type: GeometryType.Unknown } as unknown as IParsedGeometry

function value(kind: WriterKind, v: unknown): unknown {
  if (v === null || v === undefined) return null
  switch (kind) {
    case 'bool':
      return v ? 1 : 0
    case 'int':
    case 'double':
      return toNumber(v)
    case 'bigint':
      return typeof v === 'bigint' ? v : BigInt(Math.trunc(toNumber(v) ?? 0))
    case 'json':
      return typeof v === 'string' ? JSON.parse(v) : v
    default:
      return textOf(v)
  }
}

export function flatGeobufWriter(columns: readonly WriterColumn[], srid: number | null): RowWriter {
  const meta: HeaderMeta = {
    geometryType: GeometryType.Unknown,
    columns: columns.map(
      (c): ColumnMeta => ({ name: c.name, type: COLUMN_TYPE[c.kind], title: null, description: null, width: -1, precision: -1, scale: -1, nullable: true, unique: false, primary_key: false })
    ),
    envelope: null,
    featuresCount: 0,
    indexNodeSize: 0,
    crs: null,
    title: null,
    description: null,
    metadata: null,
  }
  const features = new ChunkBuffer()
  const types = new Set<GeometryType>()
  let count = 0
  return {
    add({ values, geometry }: ExportRow) {
      const properties: Record<string, unknown> = {}
      columns.forEach((c, i) => (properties[c.name] = value(c.kind, values[i])))
      // A row without geometry keeps an empty one (the plan says so).
      const parsed = geometry ? (geometry.type === 'GeometryCollection' ? parseGC(geometry) : parseGeometry(geometry)) : EMPTY_GEOMETRY
      if (geometry) types.add(GEOMETRY_TYPE[geometry.type])
      // bigints for Long columns: the encoder takes them (BigInt(value)), though its type says JSON values.
      features.push(buildFeature(parsed, properties as Parameters<typeof buildFeature>[1], meta))
      count++
    },
    get size() {
      return features.size
    },
    finish() {
      meta.featuresCount = count
      meta.geometryType = types.size === 1 ? [...types][0] : GeometryType.Unknown
      const header = buildHeader(meta, srid ?? 0)
      const body = features.bytes()
      const out = new Uint8Array(magicbytes.length + header.length + body.length)
      out.set(magicbytes)
      out.set(header, magicbytes.length)
      out.set(body, magicbytes.length + header.length)
      return out
    },
  }
}
