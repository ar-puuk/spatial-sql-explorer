// SQLite-based sources (spec 008 research §16, spec 010 phase 6): GeoPackage
// layers GDAL can't stream in this runtime, and SQLite / SpatiaLite databases
// (e.g. Bentley Cube 7 networks).
//
// - GDAL streams a GeoPackage layer through a worker thread unless its ids
//   run exactly 1..N; this single-threaded engine can't start one ("thread
//   constructor failed"). Such layers are read with GDAL's SQLite driver from
//   an in-memory copy whose GeoPackage application id is cleared (the driver
//   refuses GeoPackages), and their geometry blobs are decoded in SQL.
// - Since DuckDB 1.5, ST_Read returns the feature id under its own name (a
//   GeoPackage `fid`, Cube's node number `n`), gaps and all (spec 010
//   research.md S5): nothing to restore.
// - GDAL lists only a SQLite file's spatial tables; its attribute tables
//   (Cube transit, tolls, junctions) are listed with the sqlite_scanner
//   extension (research.md S8) and read with LIST_ALL_TABLES.
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import { SOURCE_DIR } from '../duckdbService.js'
import { quoteIdent, quoteLiteral } from '../query/util.js'
import { geometryTypeOf, type FileLayer } from './layers.js'

/** Lets GDAL's SQLite driver open attribute-only tables by name. */
export const SQLITE_OPEN_OPTIONS = ['LIST_ALL_TABLES=YES'] as const

/** GDAL's GeoPackage reader needed a thread (ids not exactly 1..N). */
export function isThreadSpawnError(err: unknown): boolean {
  return /thread constructor failed/i.test(err instanceof Error ? err.message : String(err))
}

/**
 * Clears a GeoPackage's SQLite application id ('GPKG', or 'GP10'/'GP11' in
 * GeoPackage 1.0/1.1) in place, so GDAL's SQLite driver accepts the file.
 */
export function clearGeoPackageId(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 72 && bytes[68] === 0x47 && bytes[69] === 0x50) bytes.fill(0, 68, 72)
  return bytes
}

/**
 * A GeoPackage geometry blob as GEOMETRY: the 8-byte header plus the
 * envelope its flags announce (none, 32, 48, 48 or 64 bytes), then WKB.
 * Anything unreadable becomes NULL (counted as invalid geometry).
 */
export function gpkgGeometrySql(blob: string): string {
  const flags = `('0x' || hex(${blob}[4:4]))::INTEGER`
  const envelope = `[0, 32, 48, 48, 64][((${flags} >> 1) & 7) + 1]`
  return `TRY(ST_GeomFromWKB(${blob}[9 + ${envelope}:]))`
}

/** How one layer is read: its ST_Read, and a geometry to decode. */
export interface LayerRead {
  reader: string
  /** A GeoPackage geometry column read as a raw blob (SQLite driver). */
  decodeGeometry: string | null
}

export function stReadSql(path: string, layer: string, openOptions: readonly string[] = []): string {
  const opts = openOptions.length ? `, open_options := [${openOptions.map(quoteLiteral).join(', ')}]` : ''
  return `ST_Read(${quoteLiteral(path)}, layer := ${quoteLiteral(layer)}${opts})`
}

/** A FROM-able relation for one layer: the reader's columns, the geometry decoded. */
export function layerReadSql(r: LayerRead): string {
  if (!r.decodeGeometry) return r.reader
  const g = quoteIdent(r.decodeGeometry)
  return `(SELECT r.* EXCLUDE (${g}), ${gpkgGeometrySql(`r.${g}`)} AS ${g} FROM ${r.reader} r)`
}

/** SQLite, SpatiaLite and GeoPackage bookkeeping tables: never layers. */
export function isSystemTable(name: string): boolean {
  const n = name.toLowerCase()
  if (n.startsWith('sqlite_') || n.startsWith('gpkg_') || n.startsWith('rtree_') || n.startsWith('idx_')) return true
  if (/^(spatial_ref_sys|geometry_columns|views_geometry_columns|virts_geometry_columns|vector_layers|spatialite_history|sql_statements_log|spatialindex|elementarygeometries|knn2?|data_licenses|geom_cols_ref_sys)(_|$)/.test(n)) return true
  return false
}

export interface SqlitePlanInput {
  db: AsyncDuckDB
  conn: AsyncDuckDBConnection
  format: 'geopackage' | 'sqlite'
  /** The registered file. */
  path: string
  /** Layers ST_Read_Meta listed. */
  layers: FileLayer[]
  /** The whole file, fresh (the registered copy belongs to the engine): only for layers GDAL can't stream. */
  wholeBytes(): Promise<Uint8Array>
  log?(line: string): void
}

export interface SqlitePlan {
  /** Layers, with a SQLite file's attribute tables added. */
  layers: FileLayer[]
  /** How each layer (by name) is read: a FROM-able relation. */
  readers: Map<string, string>
  /** Extra registered files (the GeoPackage read as plain SQLite, sqlite_scanner's empty journal), kept while layers read them. */
  paths: string[]
}

/** Whether ST_Read streams this GeoPackage layer (ids exactly 1..N), or needs the SQLite driver. */
async function streams(conn: AsyncDuckDBConnection, path: string, layer: string): Promise<boolean> {
  try {
    await conn.query(`SELECT 1 FROM ${stReadSql(path, layer)} LIMIT 1`)
    return true
  } catch (err) {
    if (isThreadSpawnError(err)) return false
    throw err
  }
}

/** Plans how each layer of a GeoPackage or SQLite file is read (see the header). */
export async function planSqliteSource(input: SqlitePlanInput): Promise<SqlitePlan> {
  const { db, conn, format, path, log } = input
  const gpkg = format === 'geopackage'
  const blocked = new Set<string>()
  if (gpkg) for (const l of input.layers) if (!(await streams(conn, path, l.name))) blocked.add(l.name)

  const paths: string[] = []
  let layers = input.layers
  // A SQLite file's attribute tables (GDAL lists only spatial ones).
  if (!gpkg) layers = [...layers, ...(await attributeTables(db, conn, path, new Set(layers.map((l) => l.name)), paths, log))]

  let plainPath: string | null = null
  if (blocked.size) {
    let bytes: Uint8Array
    try {
      bytes = await input.wholeBytes()
    } catch (err) {
      throw new Error(`This GeoPackage layer can't be read in this engine without loading the file into memory, and that failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
    }
    plainPath = `${SOURCE_DIR}__se_plain_${path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')}.sqlite`
    await db.registerFileBuffer(plainPath, clearGeoPackageId(bytes))
    paths.push(plainPath)
    log?.(`[open] read through the SQLite driver (feature ids not 1..N): ${[...blocked].join(', ')}`)
  }

  const readers = new Map<string, string>()
  for (const l of layers) {
    const plain = plainPath !== null && blocked.has(l.name) ? plainPath : null
    const reader = plain !== null ? stReadSql(plain, l.name, SQLITE_OPEN_OPTIONS) : stReadSql(path, l.name, gpkg ? [] : SQLITE_OPEN_OPTIONS)
    readers.set(l.name, layerReadSql({ reader, decodeGeometry: plain !== null ? l.geometryColumn : null }))
  }
  return { layers, readers, paths }
}

/**
 * The tables GDAL didn't list (attribute-only), with their row counts, through
 * sqlite_scanner. It refuses a registered database unless a `-journal` file
 * (here empty) sits next to it (research.md S8). Never fatal: without it, the
 * spatial layers still open.
 */
async function attributeTables(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  path: string,
  known: ReadonlySet<string>,
  paths: string[],
  log: SqlitePlanInput['log']
): Promise<FileLayer[]> {
  const journal = `${path}-journal`
  try {
    await db.registerFileBuffer(journal, new Uint8Array(0))
    paths.push(journal)
    const res = await conn.query(`SELECT name FROM sqlite_scan(${quoteLiteral(path)}, 'sqlite_master') WHERE type = 'table'`)
    const names = res.toArray().map((r) => String(r.toJSON().name)).filter((n) => !isSystemTable(n) && !known.has(n))
    const tables: FileLayer[] = []
    for (const name of names) {
      const count = await conn.query(`SELECT count(*) AS n FROM sqlite_scan(${quoteLiteral(path)}, ${quoteLiteral(name)})`)
      const rows = Number(count.toArray()[0]?.toJSON().n ?? 0)
      tables.push({ name, geometryType: null, geometryColumn: null, featureCount: rows, srid: null })
    }
    return tables
  } catch (err) {
    log?.(`[open] attribute tables not listed: ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/**
 * A GeoPackage's layers from its own catalog tables, read with sqlite_scanner. The fallback for a file `ST_Read_Meta` cannot
 * list: in this engine it builds every layer's coordinate system as WKT1 and fails for one that has several datum
 * transformations ("Transformation cannot be formatted as WKT1 TOWGS84 parameters", seen with EPSG:27700), though ST_Read
 * reads the same file. Features and attribute tables, by name; the coordinate system is the registered EPSG code.
 */
export async function listGeoPackageLayers(db: AsyncDuckDB, conn: AsyncDuckDBConnection, path: string, paths: string[]): Promise<FileLayer[]> {
  const journal = `${path}-journal`
  await db.registerFileBuffer(journal, new Uint8Array(0))
  paths.push(journal)
  const scan = (table: string): string => `sqlite_scan(${quoteLiteral(path)}, ${quoteLiteral(table)})`
  const res = await conn.query(`
    SELECT c.table_name AS name, c.data_type AS kind, g.column_name AS gname, g.geometry_type_name AS gtype,
           CASE WHEN upper(s.organization) = 'EPSG' THEN s.organization_coordsys_id END AS epsg
    FROM ${scan('gpkg_contents')} c
    LEFT JOIN ${scan('gpkg_geometry_columns')} g ON g.table_name = c.table_name
    LEFT JOIN ${scan('gpkg_spatial_ref_sys')} s ON s.srs_id = g.srs_id
    WHERE c.data_type IN ('features', 'attributes')
    ORDER BY c.table_name`)
  const layers: FileLayer[] = []
  for (const r of res.toArray()) {
    const j = r.toJSON() as { name: string; gname: string | null; gtype: string | null; epsg: bigint | number | null }
    const count = await conn.query(`SELECT count(*) AS n FROM ${scan(String(j.name))}`)
    const hasGeometry = !!j.gname
    layers.push({
      name: String(j.name),
      geometryType: hasGeometry ? geometryTypeOf(j.gtype) : null,
      geometryColumn: hasGeometry ? String(j.gname) : null,
      featureCount: Number(count.toArray()[0]?.toJSON().n ?? 0),
      srid: j.epsg !== null && j.epsg !== undefined && Number(j.epsg) > 0 ? Number(j.epsg) : null,
    })
  }
  return layers
}
