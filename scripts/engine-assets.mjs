// Spec 008 research §15 (user decision, 2026-10-11): the SQL engine is not
// bundled. The app loads it from pinned URLs and checks every piece against
// a SHA-256 recorded here, at build time:
//   - DuckDB-WASM's worker and wasm, from jsDelivr (byte-identical to npm:
//     hashed from node_modules);
//   - the spatial, parquet, json, excel, sqlite_scanner and fts extensions, from extensions.duckdb.org, and
//     the h3 and a5 community extensions (spec 017), from community-extensions.duckdb.org
//     (not on npm: downloaded once, hashed, and cached for the test mirror);
//   - sql.js's wasm (the GeoPackage writer), from jsDelivr;
//   - gdal3.js (GDAL in WebAssembly, LGPL), which reads File Geodatabases (spec 013): its browser and Node entry
//     files, wasm and data, from jsDelivr, fetched only when a geodatabase is opened;
//   - the raster engine (spec 026): whitebox_wasm_bg.wasm and cog_tiler_wasm_bg.wasm (GeoTIFF reading and tiling,
//     fetched when the first raster is opened) and geolibre_wasm_bg.wasm (striped GeoTIFF to COG, fetched only
//     for such a file), from jsDelivr, byte-identical to the npm files.
//
//   node scripts/engine-assets.mjs            writes packages/core/src/engineAssets.json
//   node scripts/engine-assets.mjs --mirror   also fills scripts/.engine-cache/ (tests' local mirror)
//
// Run it after upgrading @duckdb/duckdb-wasm, sql.js, gdal3.js, cog-tiler-wasm, whitebox-wasm or geolibre-wasm; a core test fails
// until the recorded hashes match node_modules again.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** The DuckDB release inside @duckdb/duckdb-wasm 1.33.1-dev65.0 (checked against `pragma_version()` at start-up). */
const DUCKDB_VERSION = 'v1.5.6'
const PLATFORM = 'wasm_eh'
const OFFICIAL = 'https://extensions.duckdb.org'
const COMMUNITY = 'https://community-extensions.duckdb.org'
/** [name, host]: community extensions are a different host with a different signing key (spec 017). */
const EXTENSION_HOSTS = [
  ['spatial', OFFICIAL],
  ['parquet', OFFICIAL],
  ['json', OFFICIAL],
  ['excel', OFFICIAL],
  ['sqlite_scanner', OFFICIAL],
  ['fts', OFFICIAL],
  ['h3', COMMUNITY],
  ['a5', COMMUNITY],
]
const EXTENSIONS = EXTENSION_HOSTS.map(([name]) => name)
const hostOf = (name) => EXTENSION_HOSTS.find(([n]) => n === name)[1]
/** Where an extension is kept in the test mirror (official ones keep their old cache path). */
const subdir = (name) => (hostOf(name) === COMMUNITY ? 'community-extensions' : 'extensions')
const cachePath = (name) => path.join(CACHE, ...(hostOf(name) === COMMUNITY ? ['community'] : []), DUCKDB_VERSION, PLATFORM, `${name}.duckdb_extension.wasm`)
const CACHE = path.join(ROOT, 'scripts', '.engine-cache')

const pkgDir = (name) => {
  for (const base of [path.join(ROOT, 'packages', 'core', 'node_modules'), path.join(ROOT, 'node_modules')]) {
    const dir = path.join(base, name)
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
  }
  throw new Error(`${name} is not installed`)
}
const version = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const duckdbDir = pkgDir('@duckdb/duckdb-wasm')
const duckdbVersion = version(duckdbDir)
const sqljsDir = pkgDir('sql.js')
const sqljsVersion = version(sqljsDir)
const npmFile = (dir, pkg, ver, file) => {
  const buf = fs.readFileSync(path.join(dir, 'dist', file))
  return { url: `https://cdn.jsdelivr.net/npm/${pkg}@${ver}/dist/${file}`, sha256: sha256(buf), bytes: buf.length, local: path.join(dir, 'dist', file) }
}

const worker = npmFile(duckdbDir, '@duckdb/duckdb-wasm', duckdbVersion, 'duckdb-browser-eh.worker.js')
const wasm = npmFile(duckdbDir, '@duckdb/duckdb-wasm', duckdbVersion, 'duckdb-eh.wasm')
const sqlWasm = npmFile(sqljsDir, 'sql.js', sqljsVersion, 'sql-wasm.wasm')
const gdalDir = pkgDir('gdal3.js')
const gdalVersion = version(gdalDir)
const gdalFile = (file) => {
  const buf = fs.readFileSync(path.join(gdalDir, 'dist', 'package', file))
  return { url: `https://cdn.jsdelivr.net/npm/gdal3.js@${gdalVersion}/dist/package/${file}`, sha256: sha256(buf), bytes: buf.length, local: path.join(gdalDir, 'dist', 'package', file) }
}
const GDAL_FILES = ['gdal3.js', 'gdal3.node.js', 'gdal3WebAssembly.wasm', 'gdal3WebAssembly.data']
const gdal = Object.fromEntries(GDAL_FILES.map((f) => [f, gdalFile(f)]))

/** Spec 026: the raster engine's wasm files sit at the package root (not in dist/). */
const RASTER_FILES = [
  ['whitebox', 'whitebox-wasm', 'whitebox_wasm_bg.wasm'],
  ['cogTiler', 'cog-tiler-wasm', 'cog_tiler_wasm_bg.wasm'],
  ['converter', 'geolibre-wasm', 'geolibre_wasm_bg.wasm'],
]
const raster = Object.fromEntries(
  RASTER_FILES.map(([key, pkg, file]) => {
    const dir = pkgDir(pkg)
    const ver = version(dir)
    const buf = fs.readFileSync(path.join(dir, file))
    return [key, { package: ver, url: `https://cdn.jsdelivr.net/npm/${pkg}@${ver}/${file}`, sha256: sha256(buf), bytes: buf.length, local: path.join(dir, file), pkg, file }]
  }),
)

const mirror = process.argv.includes('--mirror')
const previous = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'core', 'src', 'engineAssets.json'), 'utf8'))
  } catch {
    return null
  }
})()

const extensions = {}
for (const name of EXTENSIONS) {
  const url = `${hostOf(name)}/${DUCKDB_VERSION}/${PLATFORM}/${name}.duckdb_extension.wasm`
  const cached = cachePath(name)
  let buf = fs.existsSync(cached) ? fs.readFileSync(cached) : null
  if (!buf) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, buf)
  }
  const hash = sha256(buf)
  // A pinned extension must not change silently: refuse a different file for the same version.
  const was = previous?.extensions?.files?.[name]
  if (was && previous.extensions.duckdb === DUCKDB_VERSION && was.sha256 !== hash) {
    throw new Error(`${name}: ${url} no longer matches its recorded SHA-256 (${was.sha256}); got ${hash}. Investigate before accepting it.`)
  }
  extensions[name] = { url, sha256: hash, bytes: buf.length }
}

if (mirror) {
  // The same files, by the same path names, for the e2e build (no network in tests).
  const put = (from, rel) => {
    const to = path.join(CACHE, 'mirror', rel)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
  put(worker.local, `npm/@duckdb/duckdb-wasm@${duckdbVersion}/dist/duckdb-browser-eh.worker.js`)
  put(wasm.local, `npm/@duckdb/duckdb-wasm@${duckdbVersion}/dist/duckdb-eh.wasm`)
  put(sqlWasm.local, `npm/sql.js@${sqljsVersion}/dist/sql-wasm.wasm`)
  for (const r of Object.values(raster)) put(r.local, `npm/${r.pkg}@${r.package}/${r.file}`)
  for (const f of GDAL_FILES) put(gdal[f].local, `npm/gdal3.js@${gdalVersion}/dist/package/${f}`)
  for (const name of EXTENSIONS) put(cachePath(name), `${subdir(name)}/${DUCKDB_VERSION}/${PLATFORM}/${name}.duckdb_extension.wasm`)
}

const strip = ({ local: _local, ...rest }) => rest
const out = {
  note: 'Generated by scripts/engine-assets.mjs. Every file is checked against its SHA-256 before it runs (research §15).',
  duckdb: { package: duckdbVersion, release: DUCKDB_VERSION, worker: strip(worker), wasm: strip(wasm) },
  extensions: { duckdb: DUCKDB_VERSION, platform: PLATFORM, files: extensions },
  sqljs: { package: sqljsVersion, wasm: strip(sqlWasm) },
  gdal: { package: gdalVersion, files: Object.fromEntries(GDAL_FILES.map((f) => [f, strip(gdal[f])])) },
  raster: Object.fromEntries(Object.entries(raster).map(([key, { local: _l, pkg: _p, file: _f, ...rest }]) => [key, rest])),
}
fs.writeFileSync(path.join(ROOT, 'packages', 'core', 'src', 'engineAssets.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`engineAssets.json: DuckDB-WASM ${duckdbVersion} (DuckDB ${DUCKDB_VERSION}), sql.js ${sqljsVersion}, gdal3.js ${gdalVersion}, raster ${Object.values(raster).map((r) => `${r.pkg}@${r.package}`).join(' ')}, extensions ${EXTENSIONS.join(', ')}${mirror ? '; mirror filled' : ''}`)
