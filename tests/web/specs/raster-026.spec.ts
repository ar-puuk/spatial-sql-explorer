// Spec 026: a GeoTIFF or COG opens as the one layer, replaces the vector layer, and is drawn where it belongs.
// Fixtures: scripts/fixtures-026.mjs (tests/vscode-ext/fixtures/raster/, see its README); the 4.9 GB file for the
// range-read check comes from `npm run large-data -- --raster` (skipped when it is not there). Run with npm run test:web:chrome.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

type Facts = { width: number; height: number; bands: Array<{ name: string; p2?: number; p98?: number }>; dataType: string; crs: { code?: number; label: string; units?: string }; overviews: number; nodata: number | string | null; hasPalette: boolean; extentWgs84: number[]; origin: string; warnings: string[]; mode: string; compression: string; tiled: boolean }
type RasterState = {
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
