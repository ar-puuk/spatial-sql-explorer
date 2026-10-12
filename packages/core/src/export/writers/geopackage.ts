// GeoPackage (spec 008 FR-020, research §3), per OGC 12-128r18: an SQLite
// database built in memory with sql.js (the engine's SQLite and GDAL writers
// fail in this runtime), holding the required tables (gpkg_spatial_ref_sys,
// gpkg_contents, gpkg_geometry_columns) and one feature table. Geometry is a
// GeoPackage binary: the "GP" header with an XY envelope, then WKB. sql.js is
// loaded only when a GeoPackage is exported, from the shell's own copy of its
// wasm (never a CDN). Output over GEOPACKAGE_MAX_BYTES stops with a message.
import type { Geometry } from 'geojson'
import type { Database } from 'sql.js'
import { loadSqlJs } from '../../sqlJs.js'
import { GEOPACKAGE_MAX_BYTES } from '../formats.js'
import { bboxOf, toNumber, textOf, toWkb, type ExportRow, type RowWriter, type WriterColumn, type WriterKind } from './common.js'

const SQL_TYPE: Record<WriterKind, string> = {
  bool: 'BOOLEAN',
  int: 'INTEGER',
  bigint: 'INTEGER',
  double: 'DOUBLE',
  date: 'DATE',
  datetime: 'DATETIME',
  text: 'TEXT',
  json: 'TEXT',
}

const GPKG_TYPE: Record<Geometry['type'], string> = {
  Point: 'POINT',
  LineString: 'LINESTRING',
  Polygon: 'POLYGON',
  MultiPoint: 'MULTIPOINT',
  MultiLineString: 'MULTILINESTRING',
  MultiPolygon: 'MULTIPOLYGON',
  GeometryCollection: 'GEOMETRYCOLLECTION',
}

const q = (name: string): string => `"${name.replace(/"/g, '""')}"`

/** GeoPackage binary geometry: header, XY envelope, then WKB (little endian). */
export function gpkgGeometry(g: Geometry, srsId: number): Uint8Array {
  const wkb = toWkb(g)
  const box = bboxOf(g)
  const headerLength = box ? 40 : 8
  const out = new Uint8Array(headerLength + wkb.length)
  const view = new DataView(out.buffer)
  out[0] = 0x47 // 'G'
  out[1] = 0x50 // 'P'
  out[2] = 0 // version 1
  // Flags: little endian (bit 0); envelope XY (1 << 1) or none; empty (1 << 4) when there are no coordinates.
  out[3] = 0b1 | (box ? 0b10 : 0) | (box ? 0 : 0b10000)
  view.setInt32(4, srsId, true)
  if (box) {
    view.setFloat64(8, box[0], true)
    view.setFloat64(16, box[2], true)
    view.setFloat64(24, box[1], true)
    view.setFloat64(32, box[3], true)
  }
  out.set(wkb, headerLength)
  return out
}

function sqlValue(kind: WriterKind, v: unknown): string | number | null {
  if (v === null || v === undefined) return null
  switch (kind) {
    case 'bool':
      return v ? 1 : 0
    case 'int':
    case 'double':
      return toNumber(v)
    case 'bigint':
      return typeof v === 'bigint' && !Number.isSafeInteger(Number(v)) ? v.toString() : toNumber(v)
    default:
      return textOf(v)
  }
}

export interface GeoPackageOptions {
  /** The table name (the source file's base name). */
  table: string
  geometryColumn: string
  /** EPSG code of the geometry, null when unknown. */
  srid: number | null
  /** WKT of `srid`, for gpkg_spatial_ref_sys. */
  wkt: string | null
  /** sql.js's wasm, verified (engineAssets.loadSqlWasm). */
  loadSqlWasm: () => Promise<ArrayBuffer>
}

export async function geoPackageWriter(columns: readonly WriterColumn[], options: GeoPackageOptions): Promise<RowWriter> {
  const SQL = await loadSqlJs(options.loadSqlWasm)
  const db: Database = new SQL.Database()
  const srsId = options.srid ?? 0
  // An attribute named like the key or geometry column is renamed so the table stays valid.
  const taken = new Set(['fid', options.geometryColumn.toLowerCase()])
  const names = columns.map((c) => {
    let name = c.name
    for (let i = 1; taken.has(name.toLowerCase()); i++) name = `${c.name}_${i}`
    taken.add(name.toLowerCase())
    return name
  })
  db.run(`PRAGMA application_id = 1196444487; PRAGMA user_version = 10400;
    CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
    CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
    CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL, geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL, m TINYINT NOT NULL, CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
    INSERT INTO gpkg_spatial_ref_sys VALUES ('Undefined cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined cartesian coordinate reference system'), ('Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system');`)
  if (options.srid !== null && options.wkt) db.run(`INSERT OR REPLACE INTO gpkg_spatial_ref_sys VALUES (?, ?, 'EPSG', ?, ?, NULL)`, [`EPSG:${options.srid}`, options.srid, options.srid, options.wkt])
  const table = q(options.table)
  const geom = q(options.geometryColumn)
  db.run(`CREATE TABLE ${table} (fid INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, ${geom} GEOMETRY${columns.map((c, i) => `, ${q(names[i])} ${SQL_TYPE[c.kind]}`).join('')})`)
  const insert = db.prepare(`INSERT INTO ${table} (${geom}${names.map((n) => `, ${q(n)}`).join('')}) VALUES (?${names.map(() => ', ?').join('')})`)
  db.run('BEGIN')
  const types = new Set<string>()
  let box: [number, number, number, number] | null = null
  let size = 0
  let count = 0
  return {
    add({ values, geometry }: ExportRow) {
      const blob = geometry ? gpkgGeometry(geometry, srsId) : null
      if (geometry) {
        types.add(GPKG_TYPE[geometry.type])
        const b = bboxOf(geometry)
        if (b) box = box ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])] : b
      }
      insert.run([blob, ...columns.map((c, i) => sqlValue(c.kind, values[i]))])
      count++
      size += (blob?.length ?? 0) + 16 * columns.length
      if (size > GEOPACKAGE_MAX_BYTES) throw new Error('This GeoPackage would pass 1.5 GB, more than can be built in memory here. Filter the result, or choose GeoParquet.')
    },
    get size() {
      return size
    },
    finish() {
      insert.free()
      db.run('COMMIT')
      const typeName = types.size === 1 ? [...types][0] : 'GEOMETRY'
      db.run(`INSERT INTO gpkg_contents (table_name, data_type, identifier, min_x, min_y, max_x, max_y, srs_id) VALUES (?, 'features', ?, ?, ?, ?, ?, ?)`, [
        options.table,
        options.table,
        box?.[0] ?? null,
        box?.[1] ?? null,
        box?.[2] ?? null,
        box?.[3] ?? null,
        srsId,
      ])
      db.run(`INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, 0, 0)`, [options.table, options.geometryColumn, typeName, srsId])
      // GDAL's feature-count table. Not required by the standard, but without it
      // GDAL counts features on a worker thread, which the single-threaded WASM
      // build can't start ("thread constructor failed"): our own exports would
      // not reopen here (spec 008 research, US4 outcomes).
      db.run('CREATE TABLE gpkg_ogr_contents (table_name TEXT NOT NULL PRIMARY KEY, feature_count INTEGER DEFAULT NULL)')
      db.run('INSERT INTO gpkg_ogr_contents VALUES (?, ?)', [options.table, count])
      const bytes = db.export()
      db.close()
      return bytes
    },
  }
}
