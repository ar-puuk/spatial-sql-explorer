// SQLite-based sources (spec 008 research §16): GeoPackage layers GDAL can't
// stream in this runtime, SQLite / SpatiaLite databases (e.g. Bentley Cube 7
// networks), and the integer primary key GDAL turns into a feature id.
//
// - GDAL streams a GeoPackage layer through a worker thread unless its ids
//   run exactly 1..N; this single-threaded engine can't start one ("thread
//   constructor failed"). Such layers are read with GDAL's SQLite driver from
//   an in-memory copy whose GeoPackage application id is cleared (the driver
//   refuses GeoPackages), and their geometry blobs are decoded in SQL.
// - ST_Read never returns the feature id, so a GeoPackage `fid` or a Cube
//   node number `n` was lost. sql.js (the engine can't read SQLite files it
//   didn't open through GDAL, research §16) reads only that column, in rowid
//   order, and it is joined to the engine's rows by position.
// - GDAL lists only a SQLite file's spatial tables; its attribute tables
//   (Cube transit, tolls, junctions) are listed from sql.js and read with
//   LIST_ALL_TABLES.
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { Database } from 'sql.js'
import { SOURCE_DIR } from '../duckdbService.js'
import { loadSqlJs } from '../sqlJs.js'
import { quoteIdent, quoteLiteral } from '../query/util.js'
import type { FileLayer } from './layers.js'

/** Lets GDAL's SQLite driver open attribute-only tables by name. */
export const SQLITE_OPEN_OPTIONS = ['LIST_ALL_TABLES=YES'] as const

/** sql.js holds a copy of the file: keys of larger files aren't restored (the open still works). */
export const KEY_READ_MAX_BYTES = 512 * 1024 * 1024

/** Internal tables holding restored keys, one per layer; dropped with the session. */
export const KEY_TABLE_PREFIX = '__se_key_'

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

/** How one layer is read: its ST_Read, plus a restored key and a geometry to decode. */
export interface LayerRead {
  reader: string
  /** The restored key column and the table holding its values in read order. */
  key: { column: string; table: string } | null
  /** A GeoPackage geometry column read as a raw blob (SQLite driver). */
  decodeGeometry: string | null
}

export function stReadSql(path: string, layer: string, openOptions: readonly string[] = []): string {
  const opts = openOptions.length ? `, open_options := [${openOptions.map(quoteLiteral).join(', ')}]` : ''
  return `ST_Read(${quoteLiteral(path)}, layer := ${quoteLiteral(layer)}${opts})`
}

/** A FROM-able relation for one layer: the key first, then the reader's columns, the geometry decoded. */
export function layerReadSql(r: LayerRead): string {
  if (!r.key && !r.decodeGeometry) return r.reader
  const g = r.decodeGeometry === null ? null : quoteIdent(r.decodeGeometry)
  const cols = g ? `r.* EXCLUDE (${g}), ${gpkgGeometrySql(`r.${g}`)} AS ${g}` : 'r.*'
  if (!r.key) return `(SELECT ${cols} FROM ${r.reader} r)`
  return `(SELECT k.k AS ${quoteIdent(r.key.column)}, ${cols} FROM ${r.key.table} k POSITIONAL JOIN ${r.reader} r)`
}

/** SQLite, SpatiaLite and GeoPackage bookkeeping tables: never layers. */
export function isSystemTable(name: string): boolean {
  const n = name.toLowerCase()
  if (n.startsWith('sqlite_') || n.startsWith('gpkg_') || n.startsWith('rtree_') || n.startsWith('idx_')) return true
  if (/^(spatial_ref_sys|geometry_columns|views_geometry_columns|virts_geometry_columns|vector_layers|spatialite_history|sql_statements_log|spatialindex|elementarygeometries|knn2?|data_licenses|geom_cols_ref_sys)(_|$)/.test(n)) return true
  return false
}

interface KeyColumn {
  column: string
  values: Array<number | bigint>
}

interface Catalog {
  /** User tables, in file order (views excluded: they have no stable rowid). */
  tables: Array<{ name: string; rows: number }>
  keys: Map<string, KeyColumn>
}

/** The single INTEGER PRIMARY KEY of each table (the rowid), read in rowid order. */
function readCatalog(db: Database, names: ReadonlySet<string> | null): Catalog {
  const tables: Catalog['tables'] = []
  const keys = new Map<string, KeyColumn>()
  const listed = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid")[0]?.values ?? []
  for (const [raw] of listed) {
    const name = String(raw)
    if (isSystemTable(name)) continue
    if (names && !names.has(name)) continue
    const info = db.exec(`PRAGMA table_info(${quoteIdent(name)})`)[0]
    const cols = (info?.values ?? []).map((v) => ({ name: String(v[1]), type: String(v[2]).toUpperCase(), pk: Number(v[5]) }))
    const pk = cols.filter((c) => c.pk > 0)
    const stmt = db.prepare(pk.length === 1 && pk[0].type === 'INTEGER' ? `SELECT rowid FROM ${quoteIdent(name)} ORDER BY rowid` : `SELECT count(*) FROM ${quoteIdent(name)}`)
    const values: Array<number | bigint> = []
    try {
      if (pk.length === 1 && pk[0].type === 'INTEGER') {
        while (stmt.step()) values.push(stmt.get()[0] as number)
        keys.set(name, { column: pk[0].name, values })
        tables.push({ name, rows: values.length })
      } else {
        stmt.step()
        tables.push({ name, rows: Number(stmt.get()[0]) })
      }
    } finally {
      stmt.free()
    }
  }
  return { tables, keys }
}

export interface SqlitePlanInput {
  db: AsyncDuckDB
  conn: AsyncDuckDBConnection
  format: 'geopackage' | 'sqlite'
  /** The registered file. */
  path: string
  /** Layers ST_Read_Meta listed. */
  layers: FileLayer[]
  /** The whole file, fresh (the registered copy belongs to the engine). */
  wholeBytes(): Promise<Uint8Array>
  sizeBytes: number
  loadSqlWasm(): Promise<ArrayBuffer>
  log?(line: string): void
}

export interface SqlitePlan {
  /** Layers, with a SQLite file's attribute tables added. */
  layers: FileLayer[]
  /** How each layer (by name) is read: a FROM-able relation. */
  readers: Map<string, string>
  /** Extra registered files (the GeoPackage read as plain SQLite), kept while layers read them. */
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
  const opts = gpkg ? [] : SQLITE_OPEN_OPTIONS
  const blocked = new Set<string>()
  if (gpkg) for (const l of input.layers) if (!(await streams(conn, path, l.name))) blocked.add(l.name)

  let layers = input.layers
  let catalog: Catalog | null = null
  let bytes: Uint8Array | null = null
  const needBytes = blocked.size > 0 || input.sizeBytes <= KEY_READ_MAX_BYTES
  if (needBytes) bytes = await input.wholeBytes()
  if (bytes && input.sizeBytes <= KEY_READ_MAX_BYTES) {
    try {
      const SQL = await loadSqlJs(input.loadSqlWasm)
      const file = new SQL.Database(bytes)
      try {
        catalog = readCatalog(file, gpkg ? new Set(layers.map((l) => l.name)) : null)
      } finally {
        file.close()
      }
    } catch (err) {
      // The data still opens; only the key column is missing.
      log?.(`[open] feature ids not restored: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else if (!blocked.size) {
    log?.(`[open] feature ids not restored: the file is over ${KEY_READ_MAX_BYTES / 1024 / 1024} MB`)
  }

  // A SQLite file's attribute tables (GDAL lists only spatial ones).
  if (!gpkg && catalog) {
    const known = new Set(layers.map((l) => l.name))
    const extra = catalog.tables
      .filter((t) => !known.has(t.name))
      .map((t): FileLayer => ({ name: t.name, geometryType: null, geometryColumn: null, featureCount: t.rows, srid: null, sqlName: quoteIdent(t.name) }))
    layers = [...layers, ...extra]
  }

  const paths: string[] = []
  let plainPath: string | null = null
  if (blocked.size) {
    if (!bytes) throw new Error('This GeoPackage could not be read.')
    plainPath = `${SOURCE_DIR}__se_plain_${path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')}.sqlite`
    await db.registerFileBuffer(plainPath, clearGeoPackageId(bytes))
    paths.push(plainPath)
    log?.(`[open] read through the SQLite driver (feature ids not 1..N): ${[...blocked].join(', ')}`)
  }

  const readers = new Map<string, string>()
  for (const [i, l] of layers.entries()) {
    const plain = blocked.has(l.name)
    const reader = plain && plainPath ? stReadSql(plainPath, l.name, SQLITE_OPEN_OPTIONS) : stReadSql(path, l.name, opts)
    let key: LayerRead['key'] = null
    let k = catalog?.keys.get(l.name)
    // DuckDB 1.5's ST_Read returns the feature id under its own name (`fid`, Cube's `n`): nothing to restore.
    if (k && (await readerColumns(conn, reader)).some((c) => c.toLowerCase() === k?.column.toLowerCase())) {
      log?.(`[open] ${l.name}: ${k.column} read by the engine`)
      k = undefined
    }
    if (k && !/^ogc_fid$/i.test(k.column) && (l.featureCount === null || l.featureCount === k.values.length)) {
      const table = `${KEY_TABLE_PREFIX}${i}`
      if (await loadKeys(db, conn, table, k.values)) key = { column: k.column, table }
    } else if (k && l.featureCount !== null && l.featureCount !== k.values.length) {
      log?.(`[open] ${l.name}: ${k.values.length} ids for ${l.featureCount} features; ids not restored`)
    }
    readers.set(l.name, layerReadSql({ reader, key, decodeGeometry: plain ? l.geometryColumn : null }))
  }
  return { layers, readers, paths }
}

/** The columns a layer reader returns (a DESCRIBE: GDAL reads the schema, not the rows). */
async function readerColumns(conn: AsyncDuckDBConnection, reader: string): Promise<string[]> {
  try {
    const res = await conn.query(`DESCRIBE SELECT * FROM ${reader}`)
    return res.toArray().map((r) => String(r.toJSON().column_name))
  } catch {
    return []
  }
}

/** Key values into an engine table, in order, through a CSV (no per-row statements). */
async function loadKeys(db: AsyncDuckDB, conn: AsyncDuckDBConnection, table: string, values: ReadonlyArray<number | bigint>): Promise<boolean> {
  if (!values.length) {
    await conn.query(`CREATE OR REPLACE TABLE ${table} (k BIGINT)`)
    return true
  }
  const csv = `${SOURCE_DIR}${table}.csv`
  await db.registerFileBuffer(csv, new TextEncoder().encode(values.join('\n') + '\n'))
  try {
    await conn.query(`CREATE OR REPLACE TABLE ${table} AS SELECT k FROM read_csv(${quoteLiteral(csv)}, header = false, columns = {'k': 'BIGINT'})`)
    return true
  } catch {
    return false
  } finally {
    await db.dropFile(csv).catch(() => {})
  }
}

/** Drops every restored-key table (session end, failed open). */
export async function dropKeyTables(conn: AsyncDuckDBConnection): Promise<void> {
  const res = await conn.query(`SELECT table_name AS t FROM duckdb_tables() WHERE starts_with(table_name, '${KEY_TABLE_PREFIX}')`)
  for (const r of res.toArray()) await conn.query(`DROP TABLE IF EXISTS ${quoteIdent(String(r.toJSON().t))}`).catch(() => {})
}
