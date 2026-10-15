// Spec 012: basemap thumbnails, rendered once from each keyless vector style
// and bundled (packages/core/src/basemapThumbnails.json), so the Basemap panel
// and the gallery show the real map, offline, with no request on open.
//
// Every thumbnail frames the same place: GeoLibre's preview center (8°E, 47°N:
// Zurich and its lake) at city scale, as ArcGIS's basemap gallery does, so
// water, roads, parks and labels tell styles apart (at GeoLibre's zoom 2,
// every light style looks alike). Raster rows aren't bundled (their imagery
// isn't ours to ship): the app loads one live tile of the same place
// (basemapPreviewTile). Keyed styles get a "Needs key" tile.
//
// Rerun after scripts/basemap-catalog.mjs, or when a provider restyles:
//   node scripts/basemap-thumbnails.mjs            (installed Google Chrome)
//   node scripts/basemap-thumbnails.mjs --bundled  (Playwright's Chromium)
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/* global window */
import { chromium } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(root, 'packages/core/src/basemapThumbnails.json')
const DIST = path.join(root, 'node_modules/maplibre-gl/dist')

/** Kept in step with BASEMAP_PREVIEW_VIEW in packages/core/src/basemapThumbnails.ts. */
const VIEW = { center: [8.54, 47.37], zoom: 10 }
/** CSS px; rendered at 2x. 5:3, the cards' shape. */
const SIZE = { width: 120, height: 72 }
const QUALITY = 0.72

const gallery = JSON.parse(fs.readFileSync(path.join(root, 'packages/core/src/basemapGallery.json'), 'utf8')).basemaps
// Featured rows are keyed by their own id (the gallery's duplicates point at them through featuredId).
const styles = gallery
  .filter((g) => g.kind === 'vector' && g.key === 'none')
  .map((g) => ({ id: g.featuredId ?? g.id, url: g.url }))

const page = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/maplibre-gl.css">
<style>html,body{margin:0}#map{width:${SIZE.width}px;height:${SIZE.height}px}</style>
<div id="map"></div>
<script type="module">
  import * as maplibregl from '/maplibre-gl.mjs'
  window.render = (url) => new Promise((resolve, reject) => {
    const old = window.current
    if (old) old.remove()
    const map = (window.current = new maplibregl.Map({
      container: 'map', style: url, center: ${JSON.stringify(VIEW.center)}, zoom: ${VIEW.zoom},
      attributionControl: false, interactive: false, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true },
    }))
    const timer = setTimeout(() => reject(new Error('timed out')), 30000)
    map.once('idle', () => {
      clearTimeout(timer)
      resolve(map.getCanvas().toDataURL('image/webp', ${QUALITY}))
    })
  })
  window.ready = true
</script>`

const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' }
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (name === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(page)
  const file = path.join(DIST, path.basename(name))
  if (!fs.existsSync(file)) return res.writeHead(404).end()
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch(process.argv.includes('--bundled') ? {} : { channel: 'chrome' })
const tab = await browser.newPage({ viewport: SIZE, deviceScaleFactor: 2 })
await tab.goto(origin)
await tab.waitForFunction(() => window.ready)

const thumbnails = {}
let failed = 0
for (const s of styles) {
  try {
    thumbnails[s.id] = await tab.evaluate((url) => window.render(url), s.url)
    console.log(`${s.id}: ${Math.round((thumbnails[s.id].length * 3) / 4 / 1024)} KB`)
  } catch (err) {
    failed++
    console.error(`${s.id}: ${err.message}`)
  }
}
await browser.close()
server.close()

const doc = { view: VIEW, size: SIZE, made: new Date().toISOString().slice(0, 10), thumbnails }
fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n')
const kb = Math.round(fs.statSync(OUT).size / 1024)
console.log(`${Object.keys(thumbnails).length} thumbnails, ${kb} KB → ${path.relative(root, OUT)}${failed ? ` (${failed} failed)` : ''}`)
process.exit(failed ? 1 : 0)
