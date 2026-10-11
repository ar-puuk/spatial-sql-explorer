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
