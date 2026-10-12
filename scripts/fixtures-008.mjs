// Spec 008 fixtures (tasks.md T002), written into tests/vscode-ext/fixtures/:
//   wide-50.parquet       200 points, 50 columns of mixed types (column chooser, filters, Shapefile renames)
//   buildings-10k.parquet 10,000 squares in Salt Lake City with height_m (some null, zero, negative) (extrusion)
//   mixed-types.geojson   points and polygons in one file (Shapefile per-type split)
//   three-layers.gpkg     countries (polygons), "city points" (points), lookup_table (no geometry)
//   two.gdb/              a 2-layer File Geodatabase (the "not supported" message)
//
//   node scripts/fixtures-008.mjs
//
// Needs the native DuckDB CLI on PATH and GDAL's ogr2ogr (PATH or OSGeo4W).
// Existing files are kept: delete one to regenerate it.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'tests', 'vscode-ext', 'fixtures')
const out = (f) => path.join(dir, f).replace(/\\/g, '/')
const exists = (f) => fs.existsSync(path.join(dir, f))

function duckdb(sql) {
  const r = spawnSync('duckdb', [], { input: sql, encoding: 'utf8', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`duckdb failed:\n${r.stderr || r.error}`)
}

function ogr2ogr(argv) {
  const osgeo = process.env.OSGEO4W_ROOT ?? 'C:\\OSGeo4W'
  let r
  if (process.platform === 'win32' && fs.existsSync(path.join(osgeo, 'bin', 'o4w_env.bat'))) {
    const quoted = argv.map((a) => (/[\s%"]/.test(a) ? `"${a.replace(/%/g, '%%')}"` : a)).join(' ')
    const script = path.join(dir, '.ogr2ogr.bat')
    fs.writeFileSync(script, `@echo off\r\ncall "${path.join(osgeo, 'bin', 'o4w_env.bat')}"\r\nogr2ogr ${quoted}\r\n`)
    try {
      r = spawnSync('cmd', ['/c', script], { encoding: 'utf8' })
    } finally {
      fs.rmSync(script, { force: true })
    }
  } else r = spawnSync('ogr2ogr', argv, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ogr2ogr failed:\n${r.stderr || r.error}`)
}

if (!exists('wide-50.parquet')) {
  // 50 columns: id, geom, then 48 more cycling through text, integer, double, boolean, date and long names.
  const cols = []
  for (let k = 1; k <= 48; k++) {
    switch (k % 6) {
      case 0: cols.push(`'name ' || (i % ${k + 3}) AS text_${k}`); break
      case 1: cols.push(`(i * ${k}) % 1000 AS int_${k}`); break
      case 2: cols.push(`round((i * ${k}) % 997 / 7.0, 2) AS dbl_${k}`); break
      case 3: cols.push(`(i % ${k + 1}) = 0 AS flag_${k}`); break
      case 4: cols.push(`DATE '2020-01-01' + CAST((i * ${k}) % 1500 AS INTEGER) AS date_${k}`); break
      case 5: cols.push(`'v' || i AS "a very long column name ${k}"`); break
    }
  }
  duckdb(`INSTALL spatial; LOAD spatial;
COPY (SELECT i AS id, ${cols.join(', ')}, ST_Point(-111.9 + (i % 20) * 0.01, 40.7 + (i // 20) * 0.01) AS geom
      FROM range(200) t(i)) TO '${out('wide-50.parquet')}' (FORMAT parquet);`)
  console.log('wrote wide-50.parquet')
}

if (!exists('buildings-10k.parquet')) {
  // 100 x 100 grid of ~40 m squares. height_m: null every 50th row, 0 and negative on the next two.
  duckdb(`INSTALL spatial; LOAD spatial;
COPY (
  SELECT i AS building_id,
    CASE i % 50 WHEN 0 THEN NULL WHEN 1 THEN 0 WHEN 2 THEN -5 ELSE 3 + (hash(i) % 120) END::DOUBLE AS height_m,
    CASE i % 4 WHEN 0 THEN 'residential' WHEN 1 THEN 'commercial' WHEN 2 THEN 'industrial' ELSE 'civic' END AS use,
    ST_MakeEnvelope(x, y, x + 0.0004, y + 0.0003) AS geom
  FROM (SELECT i, -111.92 + (i % 100) * 0.0006 AS x, 40.74 + (i // 100) * 0.0005 AS y FROM range(10000) t(i))
) TO '${out('buildings-10k.parquet')}' (FORMAT parquet);`)
  console.log('wrote buildings-10k.parquet')
}

if (!exists('mixed-types.geojson')) {
  const sq = (x, y, d) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]]
  const features = [
    { type: 'Feature', properties: { name: 'Salt Lake City', kind: 'city', population: 200133 }, geometry: { type: 'Point', coordinates: [-111.891, 40.761] } },
    { type: 'Feature', properties: { name: 'Provo', kind: 'city', population: 115162 }, geometry: { type: 'Point', coordinates: [-111.659, 40.234] } },
    { type: 'Feature', properties: { name: 'Downtown', kind: 'district', population: 9000 }, geometry: { type: 'Polygon', coordinates: sq(-111.9, 40.75, 0.02) } },
    { type: 'Feature', properties: { name: 'Sugar House', kind: 'district', population: 33000 }, geometry: { type: 'Polygon', coordinates: sq(-111.87, 40.71, 0.03) } },
  ]
  fs.writeFileSync(path.join(dir, 'mixed-types.geojson'), JSON.stringify({ type: 'FeatureCollection', features }, null, 1))
  console.log('wrote mixed-types.geojson')
}

if (!exists('three-layers.gpkg')) {
  const gpkg = path.join(dir, 'three-layers.gpkg')
  ogr2ogr(['-f', 'GPKG', gpkg, path.join(dir, 'world-boundaries.geojson'), '-nln', 'countries'])
  ogr2ogr(['-f', 'GPKG', '-update', gpkg, path.join(dir, 'points.csv'), '-nln', 'city points', '-oo', 'X_POSSIBLE_NAMES=lon*', '-oo', 'Y_POSSIBLE_NAMES=lat*', '-a_srs', 'EPSG:4326'])
  ogr2ogr(['-f', 'GPKG', '-update', gpkg, path.join(dir, 'points.csv'), '-nln', 'lookup_table', '-nlt', 'NONE'])
  console.log('wrote three-layers.gpkg')
}

if (!exists('two.gdb')) {
  const gdb = path.join(dir, 'two.gdb')
  ogr2ogr(['-f', 'OpenFileGDB', gdb, path.join(dir, 'world-boundaries.geojson'), '-nln', 'countries', '-nlt', 'MULTIPOLYGON', '-dim', 'XY'])
  ogr2ogr(['-f', 'OpenFileGDB', '-update', gdb, path.join(dir, 'mixed-types.geojson'), '-nln', 'cities', '-where', "kind = 'city'", '-nlt', 'POINT'])
  console.log('wrote two.gdb/')
}

// Research §16 (bug fix, 2026-10-11): GeoPackage layers whose feature ids
// don't run 1..N (GDAL streams them through a thread this engine can't start),
// and a SQLite / SpatiaLite network shaped like a Bentley Cube 7 export.
const tmpGeoJson = (name, features) => {
  const file = path.join(dir, `.${name}.geojson`)
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  return file
}
const square = (x, y, d) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] })

if (!exists('gapped-ids.gpkg')) {
  // `zones`: 12 polygons, ids 101, 103, ... (a subset exported with its ids); `stops`: 5 points, ids 1..5;
  // `notes`: no geometry, ids 7, 9, 11.
  const gpkg = path.join(dir, 'gapped-ids.gpkg')
  const zones = tmpGeoJson('zones', Array.from({ length: 12 }, (_, i) => ({
    type: 'Feature', id: 101 + 2 * i,
    properties: { zone: `Z${i + 1}`, households: 100 + i * 7, opened: `2020-0${(i % 9) + 1}-15`, active: i % 3 !== 0 },
    geometry: square(-112 + (i % 4) * 0.05, 40.6 + Math.floor(i / 4) * 0.05, 0.04),
  })))
  const stops = tmpGeoJson('stops', Array.from({ length: 5 }, (_, i) => ({
    type: 'Feature', id: i + 1, properties: { stop: `S${i + 1}` }, geometry: { type: 'Point', coordinates: [-111.98 + i * 0.03, 40.65] },
  })))
  const notes = tmpGeoJson('notes', [7, 9, 11].map((id) => ({ type: 'Feature', id, properties: { note: `note ${id}` }, geometry: null })))
  try {
    ogr2ogr(['-f', 'GPKG', gpkg, zones, '-nln', 'zones', '-preserve_fid', '-a_srs', 'EPSG:4326'])
    ogr2ogr(['-f', 'GPKG', '-update', gpkg, stops, '-nln', 'stops', '-preserve_fid', '-a_srs', 'EPSG:4326'])
    ogr2ogr(['-f', 'GPKG', '-update', gpkg, notes, '-nln', 'notes', '-preserve_fid', '-nlt', 'NONE'])
  } finally {
    for (const f of [zones, stops, notes]) fs.rmSync(f, { force: true })
  }
  console.log('wrote gapped-ids.gpkg')
}

if (!exists('cube-network.sqlite')) {
  // SpatiaLite, NAD83 / UTM 12N, like a Cube 7 network: nodes keyed by `n` (the INTEGER PRIMARY KEY,
  // numbered with gaps), links from `a` to `b`, and an attribute-only `cubedb__BY__transit_mode`.
  const db = path.join(dir, 'cube-network.sqlite')
  const ids = [1, 2, 3, 10, 11, 12, 105, 106]
  const xy = (i) => [420000 + (i % 4) * 1500, 4500000 + Math.floor(i / 4) * 1500]
  const nodes = tmpGeoJson('nodes', ids.map((n, i) => ({ type: 'Feature', id: n, properties: { nodename: `node ${n}`, tazid: i < 4 ? i + 1 : null }, geometry: { type: 'Point', coordinates: xy(i) } })))
  const pairs = [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7], [0, 4], [3, 7]]
  const links = tmpGeoJson('links', pairs.map(([p, q]) => ({ type: 'Feature', properties: { a: ids[p], b: ids[q], distance: 0.93, lanes: 2 }, geometry: { type: 'LineString', coordinates: [xy(p), xy(q)] } })))
  const modes = tmpGeoJson('modes', [4, 5, 6].map((id) => ({ type: 'Feature', id, properties: { name: ['Local bus', 'Core bus', 'Light rail'][id - 4] }, geometry: null })))
  try {
    const layer = ['-lco', 'LAUNDER=NO', '-lco', 'GEOMETRY_NAME=geom']
    ogr2ogr(['-f', 'SQLite', '-dsco', 'SPATIALITE=YES', '-dsco', 'INIT_WITH_EPSG=NO', db, nodes, '-nln', 'cubedb__BY__node', ...layer, '-lco', 'FID=n', '-preserve_fid', '-a_srs', 'EPSG:26912'])
    ogr2ogr(['-f', 'SQLite', '-update', db, links, '-nln', 'cubedb__BY__link', ...layer, '-a_srs', 'EPSG:26912'])
    ogr2ogr(['-f', 'SQLite', '-update', db, modes, '-nln', 'cubedb__BY__transit_mode', '-lco', 'LAUNDER=NO', '-lco', 'FID=mode', '-preserve_fid', '-nlt', 'NONE'])
  } finally {
    for (const f of [nodes, links, modes]) fs.rmSync(f, { force: true })
  }
  console.log('wrote cube-network.sqlite')
}
