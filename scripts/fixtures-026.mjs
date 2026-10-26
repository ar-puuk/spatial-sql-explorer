// Spec 026 fixtures (raster view), written into tests/vscode-ext/fixtures/raster/ (used by the web, extension and core tests).
// Every file is small (under 1 MB); a synthetic, smooth surface so the expected value anywhere is a formula
// (`surface(lon, lat)` below, also what the README documents).
//
//   dem-4326.tif, dem-utm12.tif, dem-3857.tif, dem-albers.tif, dem-stateplane-ft.tif   float32 COGs of the same surface, with a hole of nodata
//   ortho-rgb.tif         three 8-bit bands, a COG
//   ortho-u16.tif         four 16-bit bands, a COG
//   classes.tif           one 8-bit band with a colour table (5 classes), a COG
//   striped.tif           the surface as a plain GeoTIFF that is not tiled (the browser converts it)
//   no-overviews.tif      tiled, 40,000 x 40,000 cells, written sparse (a few KB): cannot be drawn zoomed out
//   not-georeferenced.tif a plain image with no georeferencing
//   world-file.tif + .tfw an image georeferenced only by a world file
//
//   node scripts/fixtures-026.mjs
//
// Needs GDAL (OSGeo4W on Windows: C:\OSGeo4W, or OSGEO4W_ROOT; elsewhere gdal on PATH). Existing files are kept:
// delete one to regenerate it. The 8 GB COG for the range-read test is separate: `npm run large-data -- --raster`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeArrayBuffer } from 'geotiff'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'tests', 'vscode-ext', 'fixtures', 'raster')
fs.mkdirSync(dir, { recursive: true })
const exists = (f) => fs.existsSync(path.join(dir, f))
const out = (f) => path.join(dir, f)
const q = (p) => `"${p.replace(/\\/g, '/')}"`

/** The surface, in metres. lon and lat in degrees. Smooth, so a nearest pixel is within a pixel's gradient of this. */
export function surface(lon, lat) {
  const x = (lon - WEST) / (EAST - WEST)
  const y = (lat - SOUTH) / (NORTH - SOUTH)
  return 1300 + 1100 * (0.5 + 0.5 * Math.sin(3.1 * x + 0.4)) * (0.35 + 0.65 * (1 - y)) + 120 * Math.cos(9 * y)
}
const WEST = -111.95
const EAST = -111.85
const SOUTH = 40.7
const NORTH = 40.78
const WIDTH = 480
const HEIGHT = 384
/** The hole of nodata, in degrees (burned into the base before it is warped). */
const HOLE = [-111.92, 40.73, -111.9, 40.75]

function gdal(command) {
  const osgeo = process.env.OSGEO4W_ROOT ?? 'C:\\OSGeo4W'
  let r
  if (process.platform === 'win32' && fs.existsSync(path.join(osgeo, 'bin', 'o4w_env.bat'))) {
    const script = path.join(os.tmpdir(), `.gdal-026-${process.pid}.bat`)
    fs.writeFileSync(script, `@echo off\r\ncall "${path.join(osgeo, 'bin', 'o4w_env.bat')}"\r\n${command}\r\n`)
    try {
      r = spawnSync('cmd', ['/c', script], { encoding: 'utf8' })
    } finally {
      fs.rmSync(script, { force: true })
    }
  } else r = spawnSync(command, { encoding: 'utf8', shell: true })
  if (r.status !== 0) throw new Error(`failed: ${command}\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixtures-026-'))
const t = (f) => path.join(tmp, f)
try {
  // The base: float32, EPSG:4326, nodata -9999, with the hole.
  const base = t('base.tif')
  {
    const a = new Float32Array(WIDTH * HEIGHT)
    for (let row = 0; row < HEIGHT; row++) {
      for (let col = 0; col < WIDTH; col++) {
        const lon = WEST + ((col + 0.5) / WIDTH) * (EAST - WEST)
        const lat = NORTH - ((row + 0.5) / HEIGHT) * (NORTH - SOUTH)
        a[row * WIDTH + col] = surface(lon, lat)
      }
    }
    const buf = writeArrayBuffer(a, {
      width: WIDTH,
      height: HEIGHT,
      GeographicTypeGeoKey: 4326,
      ModelPixelScale: [(EAST - WEST) / WIDTH, (NORTH - SOUTH) / HEIGHT, 0],
      ModelTiepoint: [0, 0, 0, WEST, NORTH, 0],
      GDAL_NODATA: '-9999',
    })
    fs.writeFileSync(t('base0.tif'), Buffer.from(buf))
    const [w, s, e, n] = HOLE
    fs.writeFileSync(t('hole.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }] }))
    // GDAL knows the CRS now (the geotiff.js header alone leaves the datum implicit).
    gdal(`gdal_translate -q -a_srs EPSG:4326 -a_nodata -9999 ${q(t('base0.tif'))} ${q(base)}`)
    gdal(`gdal_rasterize -q -burn -9999 ${q(t('hole.geojson'))} ${q(base)}`)
  }
  const cog = (src, name, extra = '') => gdal(`gdal_translate -q -of COG -co COMPRESS=DEFLATE -co BLOCKSIZE=256 -co OVERVIEWS=AUTO ${extra} ${q(src)} ${q(out(name))}`)

  if (!exists('dem-4326.tif')) cog(base, 'dem-4326.tif', '-co PREDICTOR=YES')
  for (const [name, epsg] of [['dem-utm12.tif', 32612], ['dem-3857.tif', 3857], ['dem-albers.tif', 5070], ['dem-stateplane-ft.tif', 3567]]) {
    if (exists(name)) continue
    gdal(`gdalwarp -q -s_srs EPSG:4326 -t_srs EPSG:${epsg} -r bilinear -dstnodata -9999 ${q(base)} ${q(t(`w${epsg}.tif`))}`)
    cog(t(`w${epsg}.tif`), name, '-co PREDICTOR=YES')
  }

  // An image: the surface through a colour ramp (nodata black).
  const rgb = t('rgb.tif')
  fs.writeFileSync(t('ramp.txt'), '1300 40 90 160\n1700 60 160 80\n2100 200 180 100\n2500 255 255 255\nnv 0 0 0\n')
  gdal(`gdaldem color-relief -q ${q(base)} ${q(t('ramp.txt'))} ${q(rgb)}`)
  if (!exists('ortho-rgb.tif')) cog(rgb, 'ortho-rgb.tif')
  if (!exists('ortho-u16.tif')) {
    gdal(`gdal_translate -q -ot UInt16 -scale 0 255 0 65535 -b 1 -b 2 -b 3 -b 1 ${q(rgb)} ${q(t('u16.tif'))}`)
    cog(t('u16.tif'), 'ortho-u16.tif')
  }
  if (!exists('classes.tif')) {
    gdal(`gdal_translate -q -ot Byte -scale 1300 2500 1 5 -a_nodata 0 ${q(base)} ${q(t('cls.tif'))}`)
    gdal(`gdal_translate -q -of VRT ${q(t('cls.tif'))} ${q(t('cls.vrt'))}`)
    const entries = [[200, 60, 40], [240, 150, 50], [240, 220, 80], [90, 170, 90], [40, 90, 170]].map(([r, g, b]) => `<Entry c1="${r}" c2="${g}" c3="${b}" c4="255"/>`).join('')
    const vrt = fs.readFileSync(t('cls.vrt'), 'utf8').replace(/<ColorInterp>[^<]*<\/ColorInterp>/, `<ColorInterp>Palette</ColorInterp><ColorTable>${'<Entry c1="0" c2="0" c3="0" c4="0"/>' + entries}</ColorTable>`)
    fs.writeFileSync(t('cls.vrt'), vrt)
    cog(t('cls.vrt'), 'classes.tif')
  }
  if (!exists('striped.tif')) gdal(`gdal_translate -q -co TILED=NO -co COMPRESS=DEFLATE ${q(base)} ${q(out('striped.tif'))}`)
  if (!exists('no-overviews.tif')) {
    gdal(`gdal_create -q -outsize 40000 40000 -bands 1 -ot Byte -a_srs EPSG:32612 -a_ullr 400000 4500000 800000 4100000 -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 -co COMPRESS=NONE -co SPARSE_OK=TRUE ${q(out('no-overviews.tif'))}`)
  }
  if (!exists('not-georeferenced.tif')) gdal(`gdal_create -q -outsize 200 200 -bands 1 -ot Byte -burn 128 ${q(out('not-georeferenced.tif'))}`)
  if (!exists('world-file.tif')) {
    gdal(`gdal_translate -q -outsize 200 200 -co PROFILE=BASELINE -co TFW=YES ${q(rgb)} ${q(out('world-file.tif'))}`)
    fs.rmSync(out('world-file.tif.aux.xml'), { force: true })
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

for (const f of fs.readdirSync(dir).sort()) {
  if (f === 'README.md') continue
  console.log(`${f.padEnd(26)} ${(fs.statSync(out(f)).size / 1024).toFixed(1).padStart(8)} KB`)
}
