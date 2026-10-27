// Spec 027 US2: shaded relief for a raster of heights. MapLibre's hillshade layer is fed by a second tile protocol that serves
// the raster's values packed into red, green and blue (custom DEM encoding). SPIKE (T015) first: does that drive the hillshade
// correctly, and is the packing precise? Run with npm run test:web:chrome.
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

const raster = (name: string): string => fixture(`raster/${name}`)
const e2e = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => unknown> }).__spatialExplorerE2E[n]() as T, name)
const readyMarker = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('.canvas-host')?.getAttribute('data-raster-ready') ?? null)
const reliefReady = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('.canvas-host')?.getAttribute('data-relief-ready') ?? null)
const reliefPaint = (page: Page): Promise<Record<string, number | string> | null> =>
  page.evaluate(() => {
    const v = document.querySelector('.canvas-host')?.getAttribute('data-relief-paint')
    return v ? JSON.parse(v) : null
  })
const tiles = (page: Page) => e2e<{ tiles: { built: number; demBuilt: number } }>(page, 'raster').then((s) => s.tiles)

async function openRaster(page: Page, file: string): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect.poll(async () => (await readyMarker(page)) !== null, { timeout: 90000 }).toBe(true)
}

async function openReliefPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Relief' })).toBeVisible()
}

/** The map as the user sees it: a flat list of RGB values of a grid of points in the middle. */
async function mapPixels(page: Page): Promise<number[]> {
  return page.evaluate(async () => {
    const e = (window as unknown as { __spatialExplorerE2E: { captureMap: (s: 1 | 2) => Promise<{ base64: string }> } }).__spatialExplorerE2E
    const shot = await e.captureMap(1)
    const blob = await (await fetch(`data:image/png;base64,${shot.base64}`)).blob()
    const bmp = await createImageBitmap(blob)
    const c = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0)
    const out: number[] = []
    const step = 6
    for (let y = Math.floor(bmp.height * 0.2); y < bmp.height * 0.8; y += step) {
      for (let x = Math.floor(bmp.width * 0.3); x < bmp.width * 0.7; x += step) {
        const d = ctx.getImageData(x, y, 1, 1).data
        out.push(d[0], d[1], d[2])
      }
    }
    return out
  })
}
const meanAbsDiff = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length

test.describe('shaded relief (US2)', () => {
  test('SPIKE: the hillshade layer, fed by our value tiles, draws relief; off puts the plain colors back', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openReliefPanel(page)
    await page.waitForTimeout(500)
    const plain = await mapPixels(page)
    await page.getByRole('switch', { name: 'Shaded relief' }).click()
    await expect.poll(() => reliefReady(page), { timeout: 60000 }).not.toBeNull()
    await page.waitForTimeout(800)
    expect((await tiles(page)).demBuilt).toBeGreaterThan(0)
    if (process.env.SE_SHOTS) await page.screenshot({ path: `${process.env.SE_SHOTS}/relief-on.png` })
    const shaded = await mapPixels(page)
    // The relief changes the picture noticeably (the plain ramp is smooth; the shading adds light and dark).
    expect(meanAbsDiff(plain, shaded)).toBeGreaterThan(2)
    await page.getByRole('switch', { name: 'Shaded relief' }).click()
    await expect.poll(() => reliefReady(page), { timeout: 30000 }).toBeNull()
    await page.waitForTimeout(500)
    expect(meanAbsDiff(plain, await mapPixels(page))).toBeLessThan(1)
  })

  test('SPIKE: the packing is precise (a tile unpacks to within the step of the file\'s values)', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openReliefPanel(page)
    // A tile over the middle of the raster at a zoom where a cell is about a pixel.
    const ext = (await e2e<{ facts: { extentWgs84: number[] } }>(page, 'raster')).facts.extentWgs84
    const lon = (ext[0] + ext[2]) / 2
    const lat = (ext[1] + ext[3]) / 2
    const z = 12
    const n = 2 ** z
    const x = Math.floor(((lon + 180) / 360) * n)
    const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n)
    const tile = await page.evaluate(([zz, xx, yy]) => (window as unknown as { __spatialExplorerE2E: { rasterDemTile: (a: number, b: number, c: number) => Promise<{ base64: string; base: number; step: number } | null> } }).__spatialExplorerE2E.rasterDemTile(zz, xx, yy), [z, x, y])
    expect(tile).not.toBeNull()
    const decoded = await page.evaluate(async ({ base64, base, step }) => {
      const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob()
      const bmp = await createImageBitmap(blob)
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d')!
      ctx.drawImage(bmp, 0, 0)
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
      let min = Infinity
      let max = -Infinity
      let sum = 0
      for (let i = 0; i < d.length; i += 4) {
        const v = base + (d[i] * 65536 + d[i + 1] * 256 + d[i + 2]) * step
        min = Math.min(min, v)
        max = Math.max(max, v)
        sum += v
      }
      return { w: bmp.width, h: bmp.height, min, max, mean: sum / (d.length / 4), alpha: d[3] }
    }, tile!)
    expect([decoded.w, decoded.h]).toEqual([256, 256])
    expect(decoded.alpha).toBe(255)
    const band = (await e2e<{ facts: { bands: Array<{ min: number; max: number }> } }>(page, 'raster')).facts.bands[0]
    // Inside the file's own range (the estimate is from a reduced level, so allow a little room) and not flat.
    expect(decoded.min).toBeGreaterThan(band.min - (band.max - band.min) * 0.2)
    expect(decoded.max).toBeLessThan(band.max + (band.max - band.min) * 0.2)
    expect(decoded.max - decoded.min).toBeGreaterThan(1)
    expect(tile!.step).toBeLessThan(0.01)
  })

  test('the light only changes the paint: no tile is read again', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openReliefPanel(page)
    await page.getByRole('switch', { name: 'Shaded relief' }).click()
    await expect.poll(() => reliefReady(page), { timeout: 60000 }).not.toBeNull()
    await page.waitForTimeout(800)
    const before = await tiles(page)
    await page.getByRole('slider', { name: 'Light direction', exact: true }).fill('90')
    await page.getByRole('slider', { name: 'Light height', exact: true }).fill('20')
    await page.getByRole('slider', { name: 'Relief strength', exact: true }).fill('0.9')
    await expect.poll(() => reliefPaint(page)).toMatchObject({ 'hillshade-illumination-direction': 90, 'hillshade-illumination-altitude': 20, 'hillshade-exaggeration': 0.9 })
    const after = await tiles(page)
    expect(after.demBuilt).toBe(before.demBuilt)
    expect(after.built).toBe(before.built)
  })

  test('a colour image and a colour table are not offered relief, with the reason', async ({ page }) => {
    await openRaster(page, raster('ortho-rgb.tif'))
    await openReliefPanel(page)
    await expect(page.getByRole('switch', { name: 'Shaded relief' })).toHaveCount(0)
    await expect(page.getByText(/needs one band of heights/)).toBeVisible()
    await page.locator('input[type="file"]').setInputFiles(raster('classes.tif'))
    await expect(page.getByText(/this one has classes/)).toBeVisible({ timeout: 60000 })
  })

  test('the relief is remembered with the style', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openReliefPanel(page)
    await page.getByRole('switch', { name: 'Shaded relief' }).click()
    await page.getByRole('slider', { name: 'Light direction', exact: true }).fill('200')
    await page.waitForTimeout(700)
    await page.goto('/?e2e=1')
    await page.locator('input[type="file"]').setInputFiles(raster('dem-utm12.tif'))
    await expect.poll(() => reliefPaint(page), { timeout: 60000 }).toMatchObject({ 'hillshade-illumination-direction': 200 })
  })

  test('the relief panel has no accessibility violations', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openReliefPanel(page)
    await page.getByRole('switch', { name: 'Shaded relief' }).click()
    await expect.poll(() => reliefReady(page), { timeout: 60000 }).not.toBeNull()
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})
