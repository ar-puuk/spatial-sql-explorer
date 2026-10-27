// Files with several layers (spec 008 US3, FR-015–FR-018, research §1–§2).
// GeoPackage (and any GDAL format with more than one layer) is listed with
// ST_Read_Meta, which reads only the file's catalog (~50 ms): every layer's
// name, feature count, geometry type and CRS, attribute-only tables included.
// One layer is read as `layer`; every layer is a view in the file's schema
// (`us_boundaries.counties`), the others read only when a query uses them. File Geodatabase has no driver in this
// runtime (research §2): the shells read it themselves (spec 013, packages/core/src/gdb/).
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { GeometryType } from '../models.js'
import { normalizeGeometryType, quoteLiteral } from '../query/util.js'

export interface FileLayer {
  name: string
  /** null: an attribute-only table (no geometry field). */
  geometryType: GeometryType | null
  /** The geometry field's name, null for an attribute-only table. */
  geometryColumn: string | null
  featureCount: number | null
  /** EPSG code of the layer's geometry, when the file states one. */
  srid: number | null
}

/** A format GDAL may hold several layers in (ST_Read_Meta applies). */
export function mayHaveLayers(format: string): boolean {
  return format === 'geopackage' || format === 'gml' || format === 'sqlite'
}

/** A path inside a File Geodatabase folder, the folder itself, or a zip of one. */
export function isFileGeodatabase(name: string): boolean {
  return /\.gdb([\\/]|$)/i.test(name) || /\.gdb\.zip$/i.test(name) || /\.gdbtable$/i.test(name)
}

export function geometryTypeOf(raw: string | null | undefined): GeometryType | null {
  if (!raw) return null
  const t = normalizeGeometryType(raw)
  return t ?? 'Mixed'
}

/** The layers of a registered file, in file order, without reading their contents. */
export async function listLayers(conn: AsyncDuckDBConnection, path: string): Promise<FileLayer[]> {
  const res = await conn.query(`
    SELECT l.name AS name, l.feature_count AS n,
           l.geometry_fields[1].type AS gtype,
           l.geometry_fields[1].name AS gname,
           l.geometry_fields[1].crs.auth_name AS auth_name,
           l.geometry_fields[1].crs.auth_code AS auth_code,
           len(l.geometry_fields) AS gcount
    FROM (SELECT unnest(layers) AS l FROM ST_Read_Meta(${quoteLiteral(path)}))`)
  return res.toArray().map((r) => {
    const j = r.toJSON() as { name: string; n: bigint | number | null; gtype: string | null; gname: string | null; auth_name: string | null; auth_code: string | null; gcount: bigint | number | null }
    const code = j.auth_name === 'EPSG' && j.auth_code ? Number(j.auth_code) : null
    const hasGeometry = Number(j.gcount ?? 0) > 0
    return {
      name: String(j.name),
      geometryType: hasGeometry ? geometryTypeOf(j.gtype) : null,
      geometryColumn: hasGeometry && j.gname ? String(j.gname) : null,
      featureCount: j.n === null || j.n === undefined || Number(j.n) < 0 ? null : Number(j.n),
      srid: code !== null && Number.isFinite(code) ? code : null,
    }
  })
}

/** The layer to open: the requested one, else the first with geometry, else the first. */
export function activeLayerOf(layers: readonly FileLayer[], requested?: string): FileLayer | null {
  if (requested !== undefined) {
    const hit = layers.find((l) => l.name === requested)
    if (hit) return hit
  }
  return layers.find((l) => l.geometryType !== null) ?? layers[0] ?? null
}

/** ST_Read of one layer of a registered file. */
export function readLayerSql(path: string, layer: string | null): string {
  return layer === null ? `ST_Read(${quoteLiteral(path)})` : `ST_Read(${quoteLiteral(path)}, layer = ${quoteLiteral(layer)})`
}
