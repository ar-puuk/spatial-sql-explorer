// Whole-file facts for formats read in parts (spec 007 FR-001,
// contracts/core-data-access.md readFacts): the Parquet footer and `geo`
// metadata, the FlatGeobuf header. No full scan: a 762 MB GeoParquet answers
// in under 50 ms, a 1.45 GB FlatGeobuf in 38 ms (research §2, §4). Whole-read
// formats take their facts from the parsed table instead (openFile).
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { reprojectToWgs84Sql } from '../crs.js'
import type { Bbox } from '../models.js'
import { quoteIdent, singleRow } from '../query/util.js'

const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`

/**
 * `EPSG:<code>` from a DuckDB GEOMETRY type (`GEOMETRY('EPSG:4326')`) or a PROJJSON `id`.
 * OGC:CRS84 (WGS84 lon/lat, which DuckDB 1.5 types GeoParquet's default CRS as) is 4326 here.
 */
export function epsgFrom(text: string | null | undefined): number | null {
  const m = /EPSG[:"\s,]*(?:code"?\s*:\s*)?(\d{4,6})/i.exec(text ?? '')
  if (m) return Number(m[1])
  return /\bCRS:?84\b|"code"\s*:\s*"CRS84"/i.test(text ?? '') ? 4326 : null
}

export interface ParquetFacts {
  rows: number
  /** Every column the reader exposes, in order. */
  columns: Array<{ name: string; type: string }>
  geometryColumn: string
  /** SQL yielding a GEOMETRY in the source CRS. */
  geomExpr: string
  srid: number | null
  /** The bbox covering struct column (GeoParquet 1.1 `covering.bbox`, or a struct named `bbox`), or null. */
  covering: string | null
  /** In the source CRS, from the `geo` metadata or the covering column's statistics. */
  sourceExtent: Bbox | null
  /** From the `geo` metadata (`Polygon`, `MultiPolygon`…), empty when not declared. */
  geometryTypes: string[]
}

interface GeoMetadata {
  primary_column?: string
  columns?: Record<string, { crs?: unknown; bbox?: number[]; geometry_types?: string[]; covering?: { bbox?: Record<string, string[]> } }>
}

const STRUCT_BBOX = /^STRUCT\(.*\bxmin\b.*\bymin\b.*\bxmax\b.*\bymax\b.*\)$/i

export async function parquetFacts(conn: AsyncDuckDBConnection, path: string, isCancelled: () => boolean): Promise<ParquetFacts> {
  const p = literal(path)
  const described = await conn.query(`DESCRIBE SELECT * FROM read_parquet(${p})`)
  const columns = described.toArray().map((r) => {
    const j = r.toJSON() as { column_name: string; column_type: string }
    return { name: String(j.column_name), type: String(j.column_type) }
  })
  const count = await singleRow<{ n: bigint | number }>(conn, `SELECT count(*) AS n FROM read_parquet(${p})`, isCancelled)

  let geo: GeoMetadata | null = null
  try {
    const meta = await conn.query(`SELECT decode(value) AS geo FROM parquet_kv_metadata(${p}) WHERE decode(key) = 'geo'`)
    const raw = meta.toArray()[0]?.toJSON().geo as string | undefined
    if (raw) geo = JSON.parse(raw) as GeoMetadata
  } catch {
    // Not GeoParquet metadata we can read; fall back to column types.
  }

  const primary = geo?.primary_column ?? null
  const pick =
    columns.find((c) => c.name === primary) ??
    columns.find((c) => c.type.toUpperCase().startsWith('GEOMETRY')) ??
    columns.find((c) => c.name.toLowerCase() === 'geometry' || c.name.toLowerCase() === 'geom')
  if (!pick) throw new Error('This Parquet file has no geometry column (no GeoParquet metadata, GEOMETRY column, or WKB "geometry" column).')
  const meta = geo?.columns?.[pick.name]
  // GeoParquet: an absent crs means OGC:CRS84 (WGS84 lon/lat), stated, not assumed.
  const metaSrid = !geo ? undefined : meta?.crs === undefined ? 4326 : meta.crs === null ? null : epsgFrom(JSON.stringify((meta.crs as { id?: unknown }).id ?? meta.crs))
  const col = quoteIdent(pick.name)
  let geomExpr: string
  let srid: number | null
  if (pick.type.toUpperCase().startsWith('GEOMETRY')) {
    // Current DuckDB decodes GeoParquet geometry to GEOMETRY (typed with its CRS).
    geomExpr = col
    srid = epsgFrom(pick.type) ?? metaSrid ?? null
  } else if (pick.type.toUpperCase() === 'BLOB') {
    geomExpr = `ST_GeomFromWKB(${col})`
    srid = metaSrid ?? null
  } else {
    throw new Error(`The Parquet column "${pick.name}" (${pick.type}) is not a geometry or WKB column.`)
  }

  // Covering: GeoParquet 1.1 names it (`covering.bbox.xmin = ["bbox", "xmin"]`); older writers just add a `bbox` struct.
  const declared = meta?.covering?.bbox?.xmin?.[0]
  const covering =
    (declared && columns.some((c) => c.name === declared) ? declared : null) ??
    columns.find((c) => c.name.toLowerCase() === 'bbox' && STRUCT_BBOX.test(c.type.replace(/\s+/g, ' ')))?.name ??
    null

  let sourceExtent: Bbox | null = null
  if (meta?.bbox && meta.bbox.length >= 4) {
    const b = meta.bbox
    // 2D: [xmin, ymin, xmax, ymax]; 3D: [xmin, ymin, zmin, xmax, ymax, zmax].
    sourceExtent = b.length >= 6 ? [b[0], b[1], b[3], b[4]] : [b[0], b[1], b[2], b[3]]
  } else if (covering) {
    // Row-group statistics answer these without reading the data.
    const c = quoteIdent(covering)
    const e = await singleRow<{ x0: number | null; y0: number | null; x1: number | null; y1: number | null }>(
      conn,
      `SELECT min(${c}.xmin) AS x0, min(${c}.ymin) AS y0, max(${c}.xmax) AS x1, max(${c}.ymax) AS y1 FROM read_parquet(${p})`,
      isCancelled
    )
    if (e.x0 !== null && e.y0 !== null && e.x1 !== null && e.y1 !== null) sourceExtent = [e.x0, e.y0, e.x1, e.y1]
  }

  return {
    rows: Number(count.n),
    columns,
    geometryColumn: pick.name,
    geomExpr,
    srid,
    covering,
    sourceExtent,
    geometryTypes: (meta?.geometry_types ?? []).map((t) => t.replace(/\s*Z$/i, '')),
  }
}

export interface FlatGeobufFacts {
  rows: number
  srid: number | null
  geometryType: string
  /** Every column ST_Read exposes (including GDAL's OGC_FID, the stable feature id). */
  columns: Array<{ name: string; type: string }>
}

/** Count, CRS and geometry type from the header via ST_Read_Meta; the extent comes from parseFgbHeader. */
export async function flatGeobufFacts(conn: AsyncDuckDBConnection, path: string, isCancelled: () => boolean): Promise<FlatGeobufFacts> {
  const p = literal(path)
  const m = await singleRow<{ n: bigint | number | null; gtype: string | null; auth_name: string | null; auth_code: string | null }>(
    conn,
    `SELECT layers[1].feature_count AS n, layers[1].geometry_fields[1].type AS gtype,
            layers[1].geometry_fields[1].crs.auth_name AS auth_name, layers[1].geometry_fields[1].crs.auth_code AS auth_code
     FROM ST_Read_Meta(${p})`,
    isCancelled
  )
  const described = await conn.query(`DESCRIBE SELECT * FROM ST_Read(${p})`)
  const columns = described.toArray().map((r) => {
    const j = r.toJSON() as { column_name: string; column_type: string }
    return { name: String(j.column_name), type: String(j.column_type) }
  })
  const code = m.auth_name === 'EPSG' && m.auth_code ? Number(m.auth_code) : NaN
  return { rows: Number(m.n ?? 0), srid: Number.isFinite(code) ? code : null, geometryType: m.gtype ?? 'Unknown', columns }
}

/** A source-CRS extent as WGS84 (envelope corners reprojected by the engine). */
export async function extentToWgs84(conn: AsyncDuckDBConnection, extent: Bbox | null, srid: number | null, isCancelled: () => boolean): Promise<Bbox | null> {
  if (!extent) return null
  if (srid === null || srid === 4326) return extent
  const env = `ST_MakeEnvelope(${extent.join(', ')})`
  const w = reprojectToWgs84Sql(env, srid)
  const r = await singleRow<{ x0: number; y0: number; x1: number; y1: number }>(
    conn,
    `SELECT ST_XMin(w) AS x0, ST_YMin(w) AS y0, ST_XMax(w) AS x1, ST_YMax(w) AS y1 FROM (SELECT ${w} AS w)`,
    isCancelled
  )
  return [r.x0, r.y0, r.x1, r.y1]
}
