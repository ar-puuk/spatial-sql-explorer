// Spec 026: a GeoTIFF or COG opens as the one layer, replaces the vector layer, and is drawn where it belongs.
// Fixtures: scripts/fixtures-026.mjs (tests/vscode-ext/fixtures/raster/, see its README). Run with npm run test:web:chrome.
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

type RasterState = {
  kind: 'vector' | 'raster'
  facts: { width: number; height: number; bands: Array<{ name: string }>; dataType: string; crs: { code?: number; label: string; units?: string }; overviews: number; nodata: number | string | null; hasPalette: boolean; extentWgs84: number[]; origin: string; warnings: string[]; mode: string } | null
  style: { mode: string; colormap: string; min: number; max: number; bands: number[] } | null
  version: number
  tiles: { built: number; cacheHits: number }
  capabilities: { kind: string; query: boolean }
}

const raster = (name: string): string => fixture(`raster/${name}`)
const e2e = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => unknown> }).__spatialExplorerE2E[n]() as T, name)
const state = (page: Page): Promise<RasterState> => e2e<RasterState>(page, 'raster')

async function stubBasemap(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
  )
}

/** Opens a raster in the app and waits until the tiles in view are drawn. */
async function openRaster(page: Page, file: string): Promise<void> {
  await stubBasemap(page)
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.locator('.canvas-host[data-raster-ready]').waitFor({ state: 'attached', timeout: 90000 })
}

/** The map as the user sees it: how many pixels differ from the basemap background, and the colour at the centre. */
async function mapColors(page: Page): Promise<{ width: number; height: number; drawnShare: number; center: number[]; distinct: number }> {
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
    const mid = ((bmp.height >> 1) * bmp.width + (bmp.width >> 1)) * 4
    return { width: bmp.width, height: bmp.height, drawnShare: drawn / (d.length / 4), center: [d[mid], d[mid + 1], d[mid + 2], d[mid + 3]], distinct: seen.size }
  })
}

test.describe('opening a raster', () => {
  test('a float DEM in UTM: it is the layer, drawn with the colors of a ramp, over the whole of the view', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    const s = await state(page)
    expect(s.kind).toBe('raster')
    expect(s.capabilities).toMatchObject({ kind: 'raster', query: false })
    expect(s.facts).toMatchObject({ width: 428, height: 450, dataType: 'float32', origin: 'file' })
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

  test('the status bar says what is open (crs and size) and not a feature count', async ({ page }) => {
    await openRaster(page, raster('dem-3857.tif'))
    const s = await state(page)
    expect(s.facts!.mode).toBe('3857')
    expect(s.facts!.crs.units).toBe('metres')
  })
})
