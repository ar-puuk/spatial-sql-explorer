// EPSG code -> full PROJJSON, for GeoParquet's `crs` (spec 005 research §3).
// Spatial has no CRS-to-PROJJSON function, but GDAL and PROJ are in the
// build: a feature-less GeoJSON that declares the CRS, read with
// ST_Read_Meta, returns PROJ's PROJJSON. The probe lives in the already
// allowed source directory (the lockdown is unchanged) and is dropped at once.
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { singleRow } from '../query/util.js'
import { SOURCE_DIR } from '../duckdbService.js'

const cache = new WeakMap<AsyncDuckDB, Map<number, object>>()

export async function projjsonFor(db: AsyncDuckDB, conn: AsyncDuckDBConnection, srid: number, isCancelled: () => boolean = () => false): Promise<object> {
  let perDb = cache.get(db)
  if (!perDb) cache.set(db, (perDb = new Map()))
  const hit = perDb.get(srid)
  if (hit) return hit
  if (!Number.isInteger(srid) || srid <= 0) throw new Error(`EPSG:${srid} is not a valid CRS code.`)

  const probe = `${SOURCE_DIR}__se_crs_${srid}.geojson`
  await db.registerFileText(probe, JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${srid}` } }, features: [] }))
  try {
    const row = await singleRow<{ p: string | null }>(conn, `SELECT layers[1].geometry_fields[1].crs.projjson AS p FROM ST_Read_Meta('${probe}')`, isCancelled)
    if (!row?.p) throw new Error(`The CRS EPSG:${srid} is unknown to the engine's PROJ database.`)
    const projjson = JSON.parse(String(row.p)) as object
    perDb.set(srid, projjson)
    return projjson
  } finally {
    await db.dropFile(probe).catch(() => {})
  }
}

const wktCache = new WeakMap<AsyncDuckDB, Map<number, string>>()

/**
 * EPSG code -> WKT (spec 008: Shapefile .prj, GeoPackage spatial_ref_sys),
 * through the same feature-less GeoJSON probe as projjsonFor. GDAL's WKT1,
 * which QGIS and GDAL read in both places.
 */
export async function wktFor(db: AsyncDuckDB, conn: AsyncDuckDBConnection, srid: number, isCancelled: () => boolean = () => false): Promise<string> {
  let perDb = wktCache.get(db)
  if (!perDb) wktCache.set(db, (perDb = new Map()))
  const hit = perDb.get(srid)
  if (hit) return hit
  if (!Number.isInteger(srid) || srid <= 0) throw new Error(`EPSG:${srid} is not a valid CRS code.`)
  const probe = `${SOURCE_DIR}__se_crswkt_${srid}.geojson`
  await db.registerFileText(probe, JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: `urn:ogc:def:crs:EPSG::${srid}` } }, features: [] }))
  try {
    const row = await singleRow<{ w: string | null }>(conn, `SELECT layers[1].geometry_fields[1].crs.wkt AS w FROM ST_Read_Meta('${probe}')`, isCancelled)
    if (!row?.w) throw new Error(`The CRS EPSG:${srid} is unknown to the engine's PROJ database.`)
    perDb.set(srid, String(row.w))
    return String(row.w)
  } finally {
    await db.dropFile(probe).catch(() => {})
  }
}
