// Spec 007 test data (research.md "Test data"). Writes GeoParquet variants
// with the native DuckDB CLI from scripts/large-data.sql, then derives
// FlatGeobuf, GeoJSON and PMTiles with GDAL's ogr2ogr when it is available.
//
//   npm run large-data              -> tests/.large-data/ (gitignored, ~4 GB)
//   npm run large-data -- --huge    -> also the ~5 GB parcels-27m.parquet (SC-002)
//   npm run large-data -- --fixtures -> the small committed fixtures in tests/vscode-ext/fixtures/
//   npm run large-data -- --raster  -> only tests/.large-data/raster-big.tif (spec 026: a 30,000 x 30,000 float32 COG, about 4.8 GB,
//                                      with overviews; needs GDAL; the small raster fixtures are `node scripts/fixtures-026.mjs`)
//
// Existing files are kept: delete one to regenerate it.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const fixtures = args.has('--fixtures')
const dir = fixtures ? path.join(root, 'tests', 'vscode-ext', 'fixtures') : path.join(root, 'tests', '.large-data')
fs.mkdirSync(dir, { recursive: true })
const template = fs.readFileSync(path.join(root, 'scripts', 'large-data.sql'), 'utf8')

const ALL = 'parcel_id, parcel_code, zone, acres, value, year_built, geom, bbox'
const NO_BBOX = 'parcel_id, parcel_code, zone, acres, value, year_built, geom'

/** [file, rows, select] */
const parquet = fixtures
  ? [
      ['parcels-10k.parquet', 10_000, ALL],
      ['parcels-10k-nobbox.parquet', 10_000, NO_BBOX],
    ]
  : [
      ['parcels-4m.parquet', 4_000_000, ALL],
      ['parcels-4m-nobbox.parquet', 4_000_000, NO_BBOX],
      ['parcels-6m.parquet', 6_000_000, ALL],
      ...(args.has('--huge') ? [['parcels-27m.parquet', 27_000_000, ALL]] : []),
    ]

/** [output, input, ogr2ogr arguments] */
const derived = fixtures
  ? [
      ['parcels-10k.fgb', 'parcels-10k-nobbox.parquet', ['-f', 'FlatGeobuf', '-lco', 'SPATIAL_INDEX=YES']],
      ['parcels-10k.geojson', 'parcels-10k-nobbox.parquet', ['-f', 'GeoJSON', '-lco', 'COORDINATE_PRECISION=6']],
      ['sample.pmtiles', 'parcels-10k-nobbox.parquet', ['-f', 'PMTiles', '-dsco', 'MINZOOM=4', '-dsco', 'MAXZOOM=10']],
    ]
  : [
      ['parcels-4m.fgb', 'parcels-4m-nobbox.parquet', ['-f', 'FlatGeobuf', '-lco', 'SPATIAL_INDEX=YES']],
      ['parcels-460k.fgb', 'parcels-4m-nobbox.parquet', ['-f', 'FlatGeobuf', '-lco', 'SPATIAL_INDEX=YES', '-where', 'parcel_id % 9 = 0']],
      ['parcels-77k.geojson', 'parcels-4m-nobbox.parquet', ['-f', 'GeoJSON', '-where', 'parcel_id % 52 = 0']],
      ['parcels-230k.geojson', 'parcels-4m-nobbox.parquet', ['-f', 'GeoJSON', '-where', 'parcel_id % 17 = 0']],
      ['parcels-460k.geojson', 'parcels-4m-nobbox.parquet', ['-f', 'GeoJSON', '-where', 'parcel_id % 9 = 0']],
    ]

const mb = (file) => `${(fs.statSync(file).size / 1e6).toFixed(1)} MB`

function duckdb(sql) {
  const r = spawnSync('duckdb', [], { input: sql, encoding: 'utf8', shell: process.platform === 'win32' })
  if (r.error || r.status !== 0) {
    console.error(r.error?.code === 'ENOENT' || /not recognized|not found/.test(r.stderr ?? '')
      ? 'No DuckDB CLI found: install it (https://duckdb.org/docs/installation) and make `duckdb` available on PATH.'
      : `duckdb failed:\n${r.stderr}`)
    process.exit(1)
  }
}

/** ogr2ogr from PATH, or OSGeo4W on Windows (its environment script sets PROJ/GDAL data). */
function ogr2ogr(argv) {
  const osgeo = process.env.OSGEO4W_ROOT ?? 'C:\\OSGeo4W'
  if (process.platform === 'win32' && fs.existsSync(path.join(osgeo, 'bin', 'o4w_env.bat'))) {
    const quoted = argv.map((a) => (/[\s%"]/.test(a) ? `"${a.replace(/%/g, '%%')}"` : a)).join(' ')
    const script = path.join(dir, '.ogr2ogr.bat')
    fs.writeFileSync(script, `@echo off\r\ncall "${path.join(osgeo, 'bin', 'o4w_env.bat')}"\r\nogr2ogr ${quoted}\r\n`)
    try {
      return spawnSync('cmd', ['/c', script], { encoding: 'utf8' })
    } finally {
      fs.rmSync(script, { force: true })
    }
  }
  return spawnSync('ogr2ogr', argv, { encoding: 'utf8' })
}

/** GDAL command line tools from PATH, or OSGeo4W on Windows. */
function gdalTool(command) {
  const osgeo = process.env.OSGEO4W_ROOT ?? 'C:\\OSGeo4W'
  if (process.platform === 'win32' && fs.existsSync(path.join(osgeo, 'bin', 'o4w_env.bat'))) {
    const script = path.join(dir, '.gdal.bat')
    fs.writeFileSync(script, `@echo off
call "${path.join(osgeo, 'bin', 'o4w_env.bat')}"
${command}
`)
    try {
      return spawnSync('cmd', ['/c', script], { encoding: 'utf8' })
    } finally {
      fs.rmSync(script, { force: true })
    }
  }
  return spawnSync(command, { encoding: 'utf8', shell: true })
}

// Spec 026: the big raster for the range-read checks (SC-001): written uncompressed, so a first view that reads a few MB is
// visible against a multi-GB file. Burned with one value (the reader's cost does not depend on the values).
if (args.has('--raster')) {
  const big = path.join(dir, 'raster-big.tif')
  if (fs.existsSync(big)) {
    console.log(`kept      raster-big.tif (${mb(big)})`)
  } else {
    const q = (f) => `"${f.replaceAll('\\', '/')}"`
    const source = path.join(dir, 'raster-big-source.tif')
    const t0 = Date.now()
    let r = gdalTool(`gdal_create -q -outsize 30000 30000 -bands 1 -ot Float32 -a_srs EPSG:32612 -a_ullr 400000 4500000 700000 4200000 -burn 1 -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 -co COMPRESS=NONE -co BIGTIFF=YES ${q(source)}`)
    if (r.status === 0) r = gdalTool(`gdal_translate -q -of COG -co COMPRESS=NONE -co BIGTIFF=YES -co NUM_THREADS=ALL_CPUS ${q(source)} ${q(big)}`)
    fs.rmSync(source, { force: true })
    if (r.status !== 0 || !fs.existsSync(big)) {
      console.error(`GDAL failed or is unavailable:
${r.stdout ?? ''}${r.stderr ?? ''}`)
      process.exit(1)
    }
    console.log(`wrote     raster-big.tif (${mb(big)}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  }
  process.exit(0)
}

for (const [file, rows, select] of parquet) {
  const out = path.join(dir, file)
  if (fs.existsSync(out)) {
    console.log(`kept      ${file} (${mb(out)})`)
    continue
  }
  const sql = template.replaceAll('{{rows}}', String(rows)).replaceAll('{{out}}', out.replaceAll('\\', '/')).replaceAll('{{select}}', select)
  const t0 = Date.now()
  duckdb(sql)
  console.log(`wrote     ${file} (${mb(out)}, ${((Date.now() - t0) / 1000).toFixed(1)} s)`)
}

let warned = false
for (const [file, input, opts] of derived) {
  const out = path.join(dir, file)
  if (fs.existsSync(out)) {
    console.log(`kept      ${file} (${mb(out)})`)
    continue
  }
  const r = ogr2ogr([...opts, out, path.join(dir, input)])
  if (r.error || r.status !== 0 || !fs.existsSync(out)) {
    if (!warned) console.warn('ogr2ogr (GDAL) is unavailable or failed: FlatGeobuf/GeoJSON/PMTiles variants skipped. Install GDAL (e.g. OSGeo4W) to derive them.')
    warned = true
    if (r.stderr) console.warn(`  ${file}: ${r.stderr.trim().split('\n').slice(-1)[0]}`)
    continue
  }
  console.log(`derived   ${file} (${mb(out)})`)
}
