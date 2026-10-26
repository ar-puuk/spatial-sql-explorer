// Spec 026: a GeoTIFF or COG opens as the one layer, replaces the vector layer, and is drawn where it belongs.
// Fixtures: scripts/fixtures-026.mjs (tests/vscode-ext/fixtures/raster/, see its README); the 4.9 GB file for the
// range-read check comes from `npm run large-data -- --raster` (skipped when it is not there). Run with npm run test:web:chrome.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

type Facts = { width: number; height: number; bands: Array<{ name: string; p2?: number; p98?: number }>; dataType: string; crs: { code?: number; label: string; units?: string }; overviews: number; nodata: number | string | null; hasPalette: boolean; extentWgs84: number[]; origin: string; warnings: string[]; mode: string; compression: string; tiled: boolean }
type Pixel = { lon: number; lat: number; outside: boolean; values: Array<{ band: number; name: string; value: number | null }> }
type RasterState = {
  pixel: Pixel | null
  kind: 'vector' | 'raster'
  facts: Facts | null
  style: { mode: string; colormap: string; min: number; max: number; bands: number[] } | null
  version: number
  tiles: { built: number; cacheHits: number }
  capabilities: { kind: string; query: boolean }
}

const raster = (name: string): string => fixture(`raster/${name}`)
const e2e = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => unknown> }).__spatialExplorerE2E[n]() as T, name)
const state = (page: Page): Promise<RasterState> => e2e<RasterState>(page, 'raster')
const here = path.dirname(fileURLToPath(import.meta.url))
const BIG = path.resolve(here, '../../.large-data/raster-big.tif')

async function stubBasemap(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
  )
}

/** Opens a file in the app (the page starts fresh the first time). */
async function open(page: Page, files: string | string[]): Promise<void> {
  if (page.url() === 'about:blank') {
    await stubBasemap(page)
    await page.goto('/?e2e=1')
  }
  await page.locator('input[type="file"]').setInputFiles(files)
}

/** The map's marker that a raster's tiles in view are drawn: key/version/resampling, so a new raster or picture is a new value. */
const readyMarker = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('.canvas-host')?.getAttribute('data-raster-ready') ?? null)

/** Opens a raster and waits until its tiles in view are drawn (a different marker from before, for a second raster). */
async function openRaster(page: Page, file: string | string[]): Promise<void> {
  const before = page.url() === 'about:blank' ? null : await readyMarker(page)
  await open(page, file)
  // (The marker is removed while the old raster goes: wait for a new, non-empty one.)
  await expect.poll(async () => {
    const now = await readyMarker(page)
    return now !== null && now !== before
  }, { timeout: 90000 }).toBe(true)
}

const banner = (page: Page) => page.getByRole('alert').first()

/** The map as the user sees it: how many pixels differ from the basemap background, and how many colours there are. */
async function mapColors(page: Page): Promise<{ drawnShare: number; distinct: number }> {
  return page.evaluate(async () => {
    const e = (window as unknown as { __spatialExplorerE2E: { captureMap: (s: 1 | 2) => Promise<{ base64: string }> } }).__spatialExplorerE2E
    const shot = await e.captureMap(1)
    const blob = await (await fetch(`data:image/png;base64,${shot.base64}`)).blob()
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let drawn = 0
    const seen = new Set<number>()
    for (let i = 0; i < d.length; i += 4) {
      // the stub basemap is #ddd
      if (!(Math.abs(d[i] - 221) < 3 && Math.abs(d[i + 1] - 221) < 3 && Math.abs(d[i + 2] - 221) < 3)) drawn++
      if (i % 64 === 0) seen.add((d[i] >> 3) * 1024 + (d[i + 1] >> 3) * 32 + (d[i + 2] >> 3))
    }
    return { drawnShare: drawn / (d.length / 4), distinct: seen.size }
  })
}

test.describe('opening a raster', () => {
  test('a float DEM in UTM: it is the layer, drawn with the colors of a ramp', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    const s = await state(page)
    expect(s.kind).toBe('raster')
    expect(s.capabilities).toMatchObject({ kind: 'raster', query: false })
    expect(s.facts).toMatchObject({ width: 428, height: 450, dataType: 'float32', origin: 'file', tiled: true })
    expect(s.facts!.crs.code).toBe(32612)
    expect(s.style).toMatchObject({ mode: 'single', colormap: 'viridis', bands: [1] })
    if (process.env.SE_SHOTS) await page.screenshot({ path: `${process.env.SE_SHOTS}/dem-utm12.png` })
    const colors = await mapColors(page)
    // A portrait raster fitted by height in a wide window: a fifth of the map, in many colors, not one.
    expect(colors.drawnShare).toBeGreaterThan(0.15)
    expect(colors.distinct).toBeGreaterThan(20)
  })

  test('a colour image keeps its colors: three 8-bit bands', async ({ page }) => {
    await openRaster(page, raster('ortho-rgb.tif'))
    const s = await state(page)
    expect(s.style).toMatchObject({ mode: 'rgb', bands: [1, 2, 3] })
    expect((await mapColors(page)).distinct).toBeGreaterThan(20)
  })

  test('the Web Mercator file takes the fast path; a state plane in feet says feet', async ({ page }) => {
    await openRaster(page, raster('dem-3857.tif'))
    expect((await state(page)).facts).toMatchObject({ mode: '3857', crs: { code: 3857, units: 'metres' } })
    await openRaster(page, raster('dem-stateplane-ft.tif'))
    expect((await state(page)).facts).toMatchObject({ mode: 'warp', crs: { code: 3567, units: 'feet' } })
  })

  test('a colour table raster is drawn with its own colors, as classes', async ({ page }) => {
    await openRaster(page, raster('classes.tif'))
    const s = await state(page)
    expect(s.facts!.hasPalette).toBe(true)
    expect(s.style).toMatchObject({ mode: 'paletted', bands: [1] })
    expect((await mapColors(page)).distinct).toBeGreaterThanOrEqual(4)
  })

  test('a 16-bit four band image opens as a colour image', async ({ page }) => {
    await openRaster(page, raster('ortho-u16.tif'))
    const s = await state(page)
    expect(s.facts).toMatchObject({ dataType: 'uint16' })
    expect(s.facts!.bands).toHaveLength(4)
    expect(s.style!.mode).toBe('rgb')
  })
})

/** The fixtures' surface (scripts/fixtures-026.mjs `surface`): elevation in metres at a place. */
function surface(lon: number, lat: number): number {
  const x = (lon + 111.95) / 0.1
  const y = (lat - 40.7) / 0.08
  return 1300 + 1100 * (0.5 + 0.5 * Math.sin(3.1 * x + 0.4)) * (0.35 + 0.65 * (1 - y)) + 120 * Math.cos(9 * y)
}

/** Puts a place at the middle of the map and rests the mouse there; resolves with the reading the app made. */
async function hoverAt(page: Page, lon: number, lat: number): Promise<Pixel | null> {
  await page.evaluate(([x, y]) => (window as unknown as { __spatialExplorerE2E: { jumpTo(lon: number, lat: number, zoom: number): void } }).__spatialExplorerE2E.jumpTo(x, y, 13), [lon, lat])
  await page.waitForTimeout(600)
  const box = (await page.locator('.canvas-host').boundingBox())!
  // Wiggle: the first move after a jump is what reports the place.
  await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2 - 20)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  // The reading for THIS place (the one of the place before stays until the new answer comes).
  await expect
    .poll(async () => {
      const p = (await state(page)).pixel
      return p !== null && Math.abs(p.lon - lon) < 1e-3 && Math.abs(p.lat - lat) < 1e-3
    }, { timeout: 10000 })
    .toBe(true)
  return (await state(page)).pixel
}

test.describe('what a raster is, and the value under the cursor', () => {
  test('the card is one line until opened, then lists every fact; it says where the SQL went', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    const card = page.getByRole('region', { name: 'Raster' })
    await expect(card).toContainText('Raster')
    await expect(card).toContainText('428 × 450 pixels, 1 band')
    await expect(card.getByText('Coordinate system')).toHaveCount(0)
    const toggle = card.getByRole('button').first()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (const [label, value] of [
      ['Coordinate system', 'EPSG:32612 (WGS 84 / UTM zone 12N)'],
      ['Size', '428 × 450 pixels'],
      ['Bands', '1 band: Band 1'],
      ['Data type', '32-bit floating point'],
      ['No data', '−9,999'],
      ['Compression', 'Deflate'],
      ['Storage', 'Tiled, 256 × 256 pixels'],
    ]) {
      await expect(card.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=following-sibling::dd[1]')).toHaveText(value)
    }
    await expect(card).toContainText('Queries, the table and the vector tools need a vector layer.')
    // Closed again, and the button says what it does.
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(card.getByText('Coordinate system')).toHaveCount(0)
  })

  test('the status bar says what is open (not a feature count) and shows the cursor and its values', async ({ page }) => {
    await openRaster(page, raster('ortho-rgb.tif'))
    const bar = page.locator('.status-bar')
    await expect(bar).toContainText('480 × 384 pixels')
    await expect(bar).toContainText('3 bands')
    await expect(bar).toContainText('8-bit unsigned integer')
    await expect(bar).not.toContainText('features')
    await expect(bar).not.toContainText('Mixed')
    await hoverAt(page, -111.88, 40.77)
    await expect(bar.locator('.cursor')).toContainText(/Band 1 \d+, Band 2 \d+, Band 3 \d+/)
  })

  test('a DEM: the stored elevation under the cursor (within a pixel of the surface), in every band, no styling applied', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    for (const [lon, lat] of [[-111.88, 40.77], [-111.935, 40.715], [-111.86, 40.745]] as const) {
      const p = (await hoverAt(page, lon, lat))!
      expect(p.outside).toBe(false)
      expect(p.values).toHaveLength(1)
      expect(p.values[0]).toMatchObject({ band: 1, name: 'Band 1' })
      expect(Math.abs(p.values[0].value! - surface(lon, lat))).toBeLessThan(25)
    }
  })

  test('the hole of nodata says "no data", not -9999', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    const p = (await hoverAt(page, -111.91, 40.74))!
    expect(p.values[0].value).toBeNull()
    await expect(page.locator('.status-bar .cursor')).toContainText('no data')
    await expect(page.locator('.status-bar .cursor')).not.toContainText('9999')
  })

  test('off the raster there is nothing to show', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await hoverAt(page, -111.88, 40.77)
    await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { jumpTo(lon: number, lat: number, zoom: number): void } }).__spatialExplorerE2E.jumpTo(-111.5, 40.74, 13))
    await page.waitForTimeout(600)
    const box = (await page.locator('.canvas-host').boundingBox())!
    await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3)
    await expect.poll(async () => (await state(page)).pixel, { timeout: 10000 }).toBeNull()
    await expect(page.locator('.status-bar .cursor')).not.toContainText(/Band|no data/)
  })

  test('a colour table raster: the class number', async ({ page }) => {
    await openRaster(page, raster('classes.tif'))
    const p = (await hoverAt(page, -111.88, 40.77))!
    expect(Number.isInteger(p.values[0].value)).toBe(true)
    expect(p.values[0].value).toBeGreaterThanOrEqual(1)
    expect(p.values[0].value).toBeLessThanOrEqual(5)
  })

  test('right-click offers the location and the values, and copies them', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await openRaster(page, raster('ortho-u16.tif'))
    await hoverAt(page, -111.88, 40.77)
    const box = (await page.locator('.canvas-host').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    // The real mouse at the item (Playwright's own scroll-into-view shifts this clipped container, and the click then misses).
    const item = page.getByRole('menuitem', { name: 'Copy location and values' })
    await expect(item).toBeVisible()
    const at = (await item.boundingBox())!
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2)
    // (The clipboard turns line breaks into CRLF on Windows.)
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^40\.7\d{4}, -111\.88\d{3}\r?\nBand 1: [\d,]+\r?\nBand 2: [\d,]+\r?\nBand 3: [\d,]+\r?\nBand 4: [\d,]+$/)
  })
})

test.describe('a GeoTIFF that is not stored in tiles', () => {
  test('is prepared as a COG in memory, drawn, and the card says so', async ({ page }) => {
    await openRaster(page, raster('striped.tif'))
    const s = await state(page)
    expect(s.facts).toMatchObject({ origin: 'converted', width: 480, height: 384, dataType: 'float32', tiled: true })
    expect(s.facts!.warnings.join(' ')).toMatch(/Prepared in memory from a GeoTIFF that is not stored in tiles/)
    expect((await mapColors(page)).distinct).toBeGreaterThan(20)
  })

  test('the converter engine is only fetched for such a file', async ({ page }) => {
    const fetched: string[] = []
    page.on('request', (r) => {
      if (/engine-mirror\/.*\.wasm$/.test(r.url())) fetched.push(path.basename(r.url()))
    })
    await openRaster(page, raster('dem-utm12.tif'))
    expect(fetched).toContain('whitebox_wasm_bg.wasm')
    expect(fetched).toContain('cog_tiler_wasm_bg.wasm')
    expect(fetched).not.toContain('geolibre_wasm_bg.wasm')
    await openRaster(page, raster('striped.tif'))
    expect(fetched).toContain('geolibre_wasm_bg.wasm')
  })
})

test.describe('files that cannot be shown', () => {
  test('no georeferencing: a plain message', async ({ page }) => {
    await open(page, raster('not-georeferenced.tif'))
    await expect(banner(page)).toContainText('not-georeferenced.tif has no georeferencing, so it cannot be placed on the map.')
  })

  test('placed only by a world file: says so and what to do', async ({ page }) => {
    await open(page, [raster('world-file.tif'), raster('world-file.tfw')])
    await expect(banner(page)).toContainText('placed by a world file (.tfw), which Spatial Explorer does not read yet')
  })

  test('no overviews on a huge file: it opens, and the card says it can only be drawn zoomed in', async ({ page }) => {
    await openRaster(page, raster('no-overviews.tif'))
    const s = await state(page)
    expect(s.facts).toMatchObject({ width: 40000, height: 40000, overviews: 0 })
    expect(s.facts!.warnings.join(' ')).toMatch(/no overviews.*zoomed in/i)
  })

  test('a failed raster open leaves the layer that was open', async ({ page }) => {
    await open(page, fixture('sample.geojson'))
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
    await open(page, raster('not-georeferenced.tif'))
    await expect(banner(page)).toContainText('no georeferencing')
    const s = await state(page)
    expect(s.kind).toBe('vector')
    expect(s.capabilities.query).toBe(true)
    // ... and it is still drawn.
    expect(Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))).toBeGreaterThan(0)
  })
})

test.describe('one layer at a time', () => {
  test('a raster replaces the vector layer, and a vector file replaces the raster', async ({ page }) => {
    await open(page, fixture('sample.geojson'))
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
    expect((await state(page)).kind).toBe('vector')
    await openRaster(page, raster('dem-utm12.tif'))
    expect((await state(page)).kind).toBe('raster')
    await open(page, fixture('sample.geojson'))
    await expect.poll(async () => (await state(page)).kind, { timeout: 60000 }).toBe('vector')
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
    // The raster is gone from the map.
    expect(await readyMarker(page)).toBeNull()
    expect((await state(page)).facts).toBeNull()
  })

  test('a second raster replaces the first', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    const first = await state(page)
    await open(page, raster('ortho-rgb.tif'))
    await expect.poll(async () => (await state(page)).style?.mode, { timeout: 60000 }).toBe('rgb')
    const second = await state(page)
    expect(second.facts!.bands).toHaveLength(3)
    expect(second.version).toBeGreaterThan(first.version)
  })
})

test.describe('the raster engine (downloaded, checked, kept)', () => {
  test('offline the first time: a message that names the raster engine, and the app stays usable', async ({ page }) => {
    await stubBasemap(page)
    await page.route('**/engine-mirror/npm/whitebox-wasm@*/**', (route) => route.abort())
    await page.goto('/?e2e=1')
    await open(page, raster('dem-utm12.tif'))
    await expect(banner(page)).toContainText(/could not download its raster engine/i)
    expect((await state(page)).kind).toBe('vector')
  })

  test('a file that does not match its recorded hash is refused, never run', async ({ page }) => {
    await stubBasemap(page)
    await page.route('**/engine-mirror/npm/cog-tiler-wasm@*/**', (route) => route.fulfill({ body: Buffer.from('not the engine'), contentType: 'application/wasm' }))
    await page.goto('/?e2e=1')
    await open(page, raster('dem-utm12.tif'))
    await expect(banner(page)).toContainText(/refused to run its raster engine/i)
    expect((await state(page)).kind).toBe('vector')
  })

  test('after a failed first try, the next one works (the failure is not remembered)', async ({ page }) => {
    await stubBasemap(page)
    let blocked = true
    await page.route('**/engine-mirror/npm/whitebox-wasm@*/**', (route) => (blocked ? route.abort() : route.continue()))
    await page.goto('/?e2e=1')
    await open(page, raster('dem-utm12.tif'))
    await expect(banner(page)).toContainText(/raster engine/i)
    blocked = false
    await openRaster(page, raster('dem-utm12.tif'))
    expect((await state(page)).kind).toBe('raster')
  })
})

test.describe('a very large COG (needs npm run large-data -- --raster)', () => {
  test.skip(!fs.existsSync(BIG), 'tests/.large-data/raster-big.tif is not there')
  test.setTimeout(180000)

  test('the first view reads a small part of the file and shows quickly (SC-001)', async ({ page }) => {
    // The tiler reads the picked File by slices: count the bytes asked for.
    await page.addInitScript(() => {
      const slice = Blob.prototype.slice
      const log = { bytes: 0, calls: 0, size: 0 }
      ;(window as unknown as { __sliced: typeof log }).__sliced = log
      Blob.prototype.slice = function (this: Blob, start?: number, end?: number, type?: string) {
        if (this.size > 1e9) {
          const s = Math.max(0, start ?? 0)
          const e = Math.min(this.size, end ?? this.size)
          log.bytes += Math.max(0, e - s)
          log.calls++
          log.size = this.size
        }
        return slice.call(this, start, end, type)
      }
    })
    const t0 = Date.now()
    await openRaster(page, BIG)
    const took = Date.now() - t0
    const sliced = await page.evaluate(() => (window as unknown as { __sliced: { bytes: number; calls: number; size: number } }).__sliced)
    const s = await state(page)
    console.log(`raster-big: ${(sliced.size / 1e9).toFixed(2)} GB, first view ${took} ms, ${(sliced.bytes / 1e6).toFixed(1)} MB asked for in ${sliced.calls} slices = ${((100 * sliced.bytes) / sliced.size).toFixed(3)}%`)
    expect(s.facts).toMatchObject({ width: 30000, height: 30000, dataType: 'float32' })
    expect(s.facts!.overviews).toBeGreaterThan(3)
    expect(sliced.size).toBeGreaterThan(4e9)
    expect(sliced.bytes / sliced.size).toBeLessThan(0.1)
    expect(took).toBeLessThan(15000)
  })
})

test.describe('with a raster open, nothing that needs rows is shown (FR-013, SC-007)', () => {
  const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

  test('the map tools, the query panel, the table and the Labels panel are gone; the rest stays', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    for (const gone of ['Draw', 'Measure', 'Select by shape', 'Bin into cells…', 'Dot density…', 'Time slider']) await expect(button(page, gone), gone).toHaveCount(0)
    for (const kept of ['Zoom in', 'Zoom out', 'Zoom to layer', 'Globe view', 'Terrain', 'Print map…']) await expect(button(page, kept), kept).toHaveCount(1)
    await expect(page.getByRole('combobox', { name: 'Search' })).toHaveCount(0)
    // No bottom panel at all: no tabs, no splitter, no table, no query.
    await expect(page.getByRole('tab', { name: 'Table' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'SQL' })).toHaveCount(0)
    await expect(page.getByRole('separator', { name: 'Resize panel' })).toHaveCount(0)
    await expect(page.getByRole('grid', { name: 'Attribute table' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Query' })).toHaveCount(0)
    await expect(button(page, 'Export data…')).toHaveCount(0)
    // The rail: Style, Basemap and Map controls; no Labels.
    await expect(page.getByRole('button', { name: 'Labels', exact: true })).toHaveCount(0)
    for (const kept of ['Style', 'Basemap', 'Map controls']) await expect(page.getByRole('button', { name: kept, exact: true })).toHaveCount(1)
  })

  test('the map takes the room the panel had', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    const box = (await page.locator('.canvas-host').boundingBox())!
    // 720 px window, 41 px header, 25 px status bar: with no panel the map is most of what is left.
    expect(box.height).toBeGreaterThan(600)
  })

  test('the shortcut for the SQL panel does nothing', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await page.keyboard.press('Control+Shift+Q')
    await page.waitForTimeout(300)
    await expect(page.getByRole('textbox', { name: 'SQL query' })).toHaveCount(0)
  })

  test('the Map controls panel offers only what a raster can use', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await page.getByRole('button', { name: 'Map controls', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Map controls' })
    for (const gone of ['Search', 'Draw shapes', 'Measure', 'Select by shape', 'Bin into cells', 'Dot density', 'Time slider', 'Hover tooltip']) await expect(panel.getByRole('switch', { name: new RegExp(`^${gone}`) }), gone).toHaveCount(0)
    for (const kept of ['Zoom in and out', 'Globe view', 'Terrain', 'Print map', 'Coordinates', 'Scale bar']) await expect(panel.getByRole('switch', { name: new RegExp(`^${kept}`) }), kept).toHaveCount(1)
  })

  test('opening a vector file brings everything back, in the state it was left', async ({ page }) => {
    await open(page, fixture('sample.geojson'))
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
    await expect(button(page, 'Draw')).toHaveCount(1)
    // Leave the SQL tab selected, then go through a raster.
    await page.getByRole('tab', { name: 'SQL' }).click()
    await expect(page.getByRole('textbox', { name: 'SQL query' })).toBeVisible()
    await openRaster(page, raster('dem-utm12.tif'))
    await expect(button(page, 'Draw')).toHaveCount(0)
    await open(page, fixture('sample.geojson'))
    await expect.poll(async () => (await state(page)).kind, { timeout: 60000 }).toBe('vector')
    await expect(button(page, 'Draw')).toHaveCount(1)
    await expect(button(page, 'Time slider')).toHaveCount(1)
    await expect(page.getByRole('tab', { name: 'SQL' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('textbox', { name: 'SQL query' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Search' })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Labels', exact: true })).toHaveCount(1)
  })
})

// --- US3: styling -------------------------------------------------------------------------------------------------

async function openStylePanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Range' })).toBeVisible()
}
const setField = async (page: Page, name: string, value: string): Promise<void> => {
  const f = page.getByRole('textbox', { name })
  await f.fill(value)
  await f.press('Enter')
}

test.describe('styling a raster', () => {
  test('the default: one band, viridis, the 2nd to 98th percentile of the file (not the extremes)', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    const s = await state(page)
    const band = s.facts!.bands[0]
    expect(s.style).toMatchObject({ mode: 'single', colormap: 'viridis', bands: [1] })
    expect(s.style!.min).toBe(band.p2)
    expect(s.style!.max).toBe(band.p98)
  })

  test('a colormap picked from previews redraws the map; reversing it changes it again; opacity only dims', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openStylePanel(page)
    const before = await state(page)
    // The picker lists previews (a gradient and a name each): the short list first, then "More colormaps".
    await page.getByRole('button', { name: 'Colormap: viridis' }).click()
    const list = page.getByRole('listbox', { name: 'Colormap choices' })
    await expect(list.getByRole('option', { name: 'magma' })).toBeVisible()
    await expect(list.getByRole('option').first().locator('.strip')).toHaveCSS('background-image', /linear-gradient/)
    await list.getByRole('option', { name: 'magma' }).click()
    await expect(page.getByRole('button', { name: 'Colormap: magma' })).toBeVisible()
    const picked = await state(page)
    expect(picked.style!.colormap).toBe('magma')
    expect(picked.version).toBeGreaterThan(before.version)
    // The new picture is drawn (the marker names the version).
    await expect.poll(() => readyMarker(page), { timeout: 30000 }).toContain(`/${picked.version}/`)
    // Reverse.
    await page.getByRole('switch', { name: 'Reverse' }).click()
    expect((await state(page)).style!.reversed).toBe(true)
    // Opacity is a paint property: no new picture, no new tiles.
    const v = (await state(page)).version
    await page.getByRole('slider', { name: 'Opacity', exact: true }).fill('50')
    const dim = await state(page)
    expect(dim.style!.opacity).toBe(0.5)
    expect(dim.version).toBe(v)
  })

  test('the range: typing low and high redraws; the presets go back to the values of the file; the histogram and the color bar show it', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openStylePanel(page)
    const start = await state(page)
    await setField(page, 'Low end of the range', '1500')
    await setField(page, 'High end of the range', '1900')
    const s = await state(page)
    expect([s.style!.min, s.style!.max]).toEqual([1500, 1900])
    expect(s.version).toBeGreaterThan(start.version)
    await expect(page.getByRole('img', { name: /histogram of values/ })).toHaveAttribute('aria-label', /stretch from 1,500 to 1,900/)
    // The legend on the map: a gradient with the same ends.
    const legend = page.getByRole('region', { name: 'Legend' })
    await expect(legend.getByRole('img', { name: /Band 1: 1,500 to 1,900/ })).toBeVisible()
    // The high end must stay above the low end: a value under it is put back.
    await setField(page, 'High end of the range', '1000')
    expect((await state(page)).style!.max).toBe(1900)
    // Presets.
    await page.getByRole('button', { name: '2 to 98 percent' }).click()
    const p = await state(page)
    expect([p.style!.min, p.style!.max]).toEqual([start.style!.min, start.style!.max])
    await page.getByRole('button', { name: 'Lowest to highest' }).click()
    const f = await state(page)
    expect([f.style!.min, f.style!.max]).toEqual([f.facts!.bands[0].min, f.facts!.bands[0].max])
  })

  test('no data: None draws the hole like any other value, From file makes it transparent again', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openStylePanel(page)
    // The middle of the map is in the hole of nodata (-111.92 to -111.90, 40.73 to 40.75): the basemap shows through.
    await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { jumpTo(lon: number, lat: number, zoom: number): void } }).__spatialExplorerE2E.jumpTo(-111.91, 40.74, 13))
    const isBackground = async (): Promise<boolean> => {
      const box = (await page.locator('.canvas-host').boundingBox())!
      const shot = await page.screenshot({ clip: { x: box.x + box.width / 2 - 3, y: box.y + box.height / 2 - 3, width: 6, height: 6 } })
      return page.evaluate(async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
        const c = new OffscreenCanvas(bmp.width, bmp.height)
        const ctx = c.getContext('2d')!
        ctx.drawImage(bmp, 0, 0)
        const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
        // the stub basemap is #ddd
        return Math.abs(d[0] - 221) < 4 && Math.abs(d[1] - 221) < 4 && Math.abs(d[2] - 221) < 4
      }, shot.toString('base64'))
    }
    await expect.poll(isBackground, { timeout: 30000 }).toBe(true)
    await page.getByRole('radio', { name: 'None' }).click()
    expect((await state(page)).style!.nodata).toEqual({ mode: 'none' })
    await expect.poll(isBackground, { timeout: 30000 }).toBe(false)
    await page.getByRole('radio', { name: 'From file' }).click()
    expect((await state(page)).style!.nodata).toEqual({ mode: 'file' })
    await expect.poll(isBackground, { timeout: 30000 }).toBe(true)
  })

  test('a colour image: switch between colour bands and one band; a colour table has classes and no ramp', async ({ page }) => {
    await openRaster(page, raster('ortho-u16.tif'))
    await openStylePanel(page)
    expect((await state(page)).style).toMatchObject({ mode: 'rgb', bands: [1, 2, 3] })
    await page.getByRole('radio', { name: 'One band' }).click()
    expect((await state(page)).style).toMatchObject({ mode: 'single', bands: [1] })
    await expect(page.getByRole('button', { name: /Colormap:/ })).toBeVisible()
    await page.getByRole('radio', { name: 'Colors' }).click()
    expect((await state(page)).style!.mode).toBe('rgb')
    await expect(page.getByRole('button', { name: /Colormap:/ })).toHaveCount(0)
    await openRaster(page, raster('classes.tif'))
    await expect(page.getByRole('heading', { name: 'Classes' })).toBeVisible()
    await expect(page.getByRole('list', { name: /classes/ }).first().locator('li')).toHaveCount(5)
    await expect(page.getByRole('button', { name: /Colormap:/ })).toHaveCount(0)
  })

  test('the style is saved as a QGIS .qml (a download on the web), with the raster renderer and our settings', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openStylePanel(page)
    await setField(page, 'Low end of the range', '1600')
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download dem-utm12.qml' }).click()])
    expect(download.suggestedFilename()).toBe('dem-utm12.qml')
    const text = fs.readFileSync((await download.path())!, 'utf8')
    expect(text).toMatch(/<rasterrenderer type="singlebandpseudocolor" band="1"/)
    expect(text).toMatch(/classificationMin="1600"/)
    expect(text).toContain('spatialExplorer/raster')
    expect((text.match(/<item value=/g) ?? []).length).toBe(16)
  })

  test('the style is remembered for the file: open it again and it is back', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openStylePanel(page)
    await page.getByRole('button', { name: 'Colormap: viridis' }).click()
    await page.getByRole('listbox', { name: 'Colormap choices' }).getByRole('option', { name: 'plasma' }).click()
    await setField(page, 'High end of the range', '1800')
    await page.waitForTimeout(700) // saved a moment after the last edit
    await page.goto('/?e2e=1')
    await page.locator('input[type="file"]').setInputFiles(raster('dem-utm12.tif'))
    await expect.poll(async () => (await state(page)).style?.colormap, { timeout: 60000 }).toBe('plasma')
    expect((await state(page)).style!.max).toBe(1800)
  })

  test('a .qml opened with the file is its style; a style for a vector layer is ignored, and says so', async ({ page }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-qml-'))
    fs.copyFileSync(raster('dem-utm12.tif'), path.join(dir, 'dem-utm12.tif'))
    const qgis = '<!DOCTYPE qgis PUBLIC "http://mrcc.com/qgis.dtd" "SYSTEM"><qgis version="3.34.2"><pipe><rasterrenderer type="singlebandgray" grayBand="1" gradient="BlackToWhite" opacity="0.7"><contrastEnhancement><minValue>1400</minValue><maxValue>2200</maxValue></contrastEnhancement></rasterrenderer></pipe></qgis>'
    fs.writeFileSync(path.join(dir, 'dem-utm12.qml'), qgis)
    await openRaster(page, [path.join(dir, 'dem-utm12.tif'), path.join(dir, 'dem-utm12.qml')])
    expect((await state(page)).style).toMatchObject({ mode: 'single', colormap: 'gray', min: 1400, max: 2200, opacity: 0.7 })
    await openStylePanel(page)
    await expect(page.getByText('From dem-utm12.qml')).toBeVisible()
    // A vector style next to a raster.
    fs.writeFileSync(path.join(dir, 'dem-utm12.qml'), '<qgis><renderer-v2 type="singleSymbol"/></qgis>')
    await page.goto('/?e2e=1')
    await page.locator('input[type="file"]').setInputFiles([path.join(dir, 'dem-utm12.tif'), path.join(dir, 'dem-utm12.qml')])
    await page.locator('.canvas-host[data-raster-ready]').waitFor({ state: 'attached', timeout: 60000 })
    await page.getByRole('button', { name: 'Style', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'it is a style for a vector layer' })).toBeVisible({ timeout: 30000 })
  })
})

// --- US4: the rest of the map keeps working; US-polish: accessibility -----------------------------------------------

test.describe('the rest of the map with a raster open', () => {
  test('a basemap change keeps the raster on top and unchanged; blank works', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    const before = await mapColors(page)
    await page.getByRole('button', { name: 'Basemap', exact: true }).click()
    // Blank background: the raster stays, the basemap's own drawing goes.
    await page.getByRole('radio', { name: /Blank/ }).click()
    await expect(page.getByRole('radio', { name: /Blank/ })).toHaveAttribute('aria-checked', 'true')
    await page.waitForTimeout(800)
    const after = await mapColors(page)
    expect(after.distinct).toBeGreaterThan(20)
    // (The blank background is not the stub basemap's grey, so the share of non-background pixels is not comparable.)
    expect(before.distinct).toBeGreaterThan(20)
    // The raster source and layer are still ours (`se-raster`), above the basemap.
    expect(await readyMarker(page)).not.toBeNull()
  })

  test('the globe draws it; flat again', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await page.getByRole('button', { name: 'Globe view' }).click()
    await expect(page.getByRole('button', { name: 'Globe view' })).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(1500)
    expect((await mapColors(page)).distinct).toBeGreaterThan(20)
    await page.getByRole('button', { name: 'Globe view' }).click()
    await expect(page.getByRole('button', { name: 'Globe view' })).toHaveAttribute('aria-pressed', 'false')
    await page.waitForTimeout(800)
    expect((await mapColors(page)).distinct).toBeGreaterThan(20)
  })

  test('the Print map page has the raster, its color bar as the legend and the raster\'s coordinate system in the info block; no data blocks or atlas', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await page.getByRole('button', { name: 'Print map…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Print map' })
    await expect(dialog.getByRole('button', { name: 'Export PNG' })).toBeEnabled({ timeout: 30000 })
    // Nothing that reads rows is offered.
    await expect(dialog.getByText('Attribute table')).toHaveCount(0)
    await expect(dialog.getByRole('checkbox', { name: /atlas/i })).toHaveCount(0)
    await expect(dialog.getByText(/Atlas/)).toHaveCount(0)
    // The info block takes the raster's own system until another is typed.
    const info = dialog.getByRole('checkbox', { name: /info block/i })
    if (await info.count()) await info.check()
    await expect(dialog.locator('input[placeholder="EPSG:4326"]')).toHaveCount(await dialog.locator('input[placeholder="EPSG:4326"]').count())
    const [png] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export PNG' }).click()])
    const bytes = fs.readFileSync((await png.path())!)
    expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
    expect(bytes.length).toBeGreaterThan(20000)
    const [pdf] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export PDF' }).click()])
    expect(fs.readFileSync((await pdf.path())!).subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})

test.describe('accessibility with a raster open', () => {
  async function audit(page: Page, state: string): Promise<void> {
    const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze()
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    expect(summary, `axe violations in state "${state}"`).toEqual([])
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: no violations in the raster states (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await openRaster(page, raster('dem-utm12.tif'))
      await audit(page, 'raster open, card closed')
      await page.getByRole('region', { name: 'Raster' }).getByRole('button').first().click()
      await audit(page, 'card open')
      await openStylePanel(page)
      await audit(page, 'style panel')
      await page.getByRole('button', { name: /Colormap:/ }).click()
      await audit(page, 'colormap list')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Map controls', exact: true }).click()
      await audit(page, 'map controls')
    })
  }

  test('the style panel and the colormap list work from the keyboard', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openStylePanel(page)
    const trigger = page.getByRole('button', { name: /Colormap:/ })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const list = page.getByRole('listbox', { name: 'Colormap choices' })
    await expect(list).toBeVisible()
    // The current one has focus; arrows move; Enter picks; Esc closes and returns focus.
    await expect(list.getByRole('option', { name: 'viridis' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(list).toHaveCount(0)
    await expect(trigger).toBeFocused()
    expect((await state(page)).style!.colormap).not.toBe('viridis')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })
})

// A real file, when one is given (SE_RASTER_SAMPLE=<path to a GeoTIFF>), like SE_GDB_SAMPLE for geodatabases. The numbers are
// those of the first one used, a 1001 x 1001, 3 band, 16 bit, striped scene in UTM 31N (`gdalinfo`: origin 590520, 5790630,
// pixel 10 m); another file is only checked for opening and drawing.
test.describe('a real file (SE_RASTER_SAMPLE)', () => {
  const sample = process.env.SE_RASTER_SAMPLE
  test.skip(!sample || !fs.existsSync(sample), 'SE_RASTER_SAMPLE is not set')
  test.setTimeout(180000)

  test('opens, is placed where gdalinfo says, and draws', async ({ page }) => {
    await openRaster(page, sample as string)
    const s = await state(page)
    expect(s.facts!.width).toBeGreaterThan(0)
    expect(s.facts!.crs.code ?? 0).toBeGreaterThan(0)
    expect((await mapColors(page)).distinct).toBeGreaterThan(20)
    if (path.basename(sample as string) === 'sample.tif') {
      expect(s.facts).toMatchObject({ width: 1001, height: 1001, origin: 'converted', crs: { code: 32631, units: 'metres' }, pixelSize: [10, 10] })
      expect(s.facts!.extent).toEqual([590520, 5780620, 600530, 5790630])
      expect(s.facts!.bands).toHaveLength(3)
      // Three 16-bit bands are an image, converted or not.
      expect(s.style).toMatchObject({ mode: 'rgb', bands: [1, 2, 3] })
    }
  })
})
