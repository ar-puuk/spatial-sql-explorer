// Spec 013 fixtures, written into tests/vscode-ext/fixtures/ (used by the web, extension and core tests):
//   network.gdb/          a File Geodatabase with a feature dataset, coded and range domains and a plain table
//   network.gdb.zip       the same, zipped with the folder at the first level
//   roads.shp.zip         a Shapefile and its parts, zipped
//   multi-layer.gpkg.zip  a zipped GeoPackage
//   two-datasets.zip      a GeoJSON and a CSV in one zip (the user is asked which)
//
//   node scripts/fixtures-013.mjs
//
// Needs GDAL with Python bindings (OSGeo4W on Windows: C:\OSGeo4W, or OSGEO4W_ROOT) for the geodatabase and
// the Shapefile. Existing files are kept: delete one to regenerate it.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync } from 'fflate'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'tests', 'vscode-ext', 'fixtures')
const exists = (f) => fs.existsSync(path.join(dir, f))

function gdal(command) {
  const osgeo = process.env.OSGEO4W_ROOT ?? 'C:\\OSGeo4W'
  if (process.platform === 'win32' && fs.existsSync(path.join(osgeo, 'bin', 'o4w_env.bat'))) {
    const script = path.join(dir, '.gdal.bat')
    fs.writeFileSync(script, `@echo off\r\ncall "${path.join(osgeo, 'bin', 'o4w_env.bat')}"\r\n${command}\r\n`)
    try {
      return spawnSync('cmd', ['/c', script], { encoding: 'utf8' })
    } finally {
      fs.rmSync(script, { force: true })
    }
  }
  return spawnSync(command, { encoding: 'utf8', shell: true })
}

function run(command) {
  const r = gdal(command)
  if (r.status !== 0) throw new Error(`failed: ${command}\n${r.stdout}\n${r.stderr}`)
}

/** Every file under `folder`, with its path inside the zip (`prefix/name`). */
function entries(folder, prefix) {
  const out = {}
  for (const name of fs.readdirSync(folder)) {
    const full = path.join(folder, name)
    if (fs.statSync(full).isFile()) out[`${prefix}${name}`] = new Uint8Array(fs.readFileSync(full))
  }
  return out
}

if (!exists('network.gdb')) {
  run(`python "${path.join(root, 'scripts', 'fixtures-013.py').replace(/\\/g, '/')}" "${path.join(dir, 'network.gdb').replace(/\\/g, '/')}"`)
  console.log('network.gdb')
}
if (!exists('network.gdb.zip')) {
  fs.writeFileSync(path.join(dir, 'network.gdb.zip'), zipSync(entries(path.join(dir, 'network.gdb'), 'network.gdb/')))
  console.log('network.gdb.zip')
}
if (!exists('roads.shp.zip')) {
  const tmp = fs.mkdtempSync(path.join(dir, '.shp-'))
  try {
    run(`ogr2ogr -f "ESRI Shapefile" "${path.join(tmp, 'roads.shp').replace(/\\/g, '/')}" "${path.join(dir, 'roads-traffic.geojson').replace(/\\/g, '/')}"`)
    fs.writeFileSync(path.join(dir, 'roads.shp.zip'), zipSync(entries(tmp, '')))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  console.log('roads.shp.zip')
}
if (!exists('multi-layer.gpkg.zip')) {
  fs.writeFileSync(path.join(dir, 'multi-layer.gpkg.zip'), zipSync({ 'multi-layer.gpkg': new Uint8Array(fs.readFileSync(path.join(dir, 'multi-layer.gpkg'))) }))
  console.log('multi-layer.gpkg.zip')
}
if (!exists('two-datasets.zip')) {
  fs.writeFileSync(
    path.join(dir, 'two-datasets.zip'),
    zipSync({ 'places/points.csv': new Uint8Array(fs.readFileSync(path.join(dir, 'points.csv'))), 'places/crashes.geojson': new Uint8Array(fs.readFileSync(path.join(dir, 'crashes.geojson'))) })
  )
  console.log('two-datasets.zip')
}
