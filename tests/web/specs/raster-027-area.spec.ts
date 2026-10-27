// Spec 027 US4: statistics inside an area drawn over a raster, checked against the same figures worked out from the file
// here (geotiff.js and proj4, not the app's reader). Run with npm run test:web:chrome.
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

const raster = (name: string): string => fixture(`raster/${name}`)
const e2e = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => unknown> }).__spatialExplorerE2E[n]() as T, name)
const readyMarker = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('.canvas-host')?.getAttribute('data-raster-ready') ?? null)

async function openRaster(page: Page, file: string): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect.poll(async () => (await readyMarker(page)) !== null, { timeout: 90000 }).toBe(true)
}

type AreaProbe = {
  kind: string
  status: string
  message?: string
  area?: { areaM2: number; approximate: boolean; cellMeters: number | null; bands: Array<{ band: number; name: string; count: number; excluded: number; min: number | null; max: number | null; mean: number | null; sum: number | null; std: number | null; histogram: number[] }> }
}
const areaProbe = (page: Page): Promise<AreaProbe | null> => e2e<AreaProbe | null>(page, 'rasterProbe')
const mapBox = async (page: Page) => (await page.locator('.canvas-host').boundingBox())!

async function pickAreaTool(page: Page): Promise<void> {
  await page.locator('.map-view .corner').getByRole('button', { name: 'Area statistics', exact: true }).click()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
}

/** Corner, move, corner: a rectangle (the second click finishes it). */
async function drawRectangle(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1])
  await page.mouse.click(from[0], from[1])
  await page.waitForTimeout(80)
  await page.mouse.move(to[0], to[1], { steps: 6 })
  await page.waitForTimeout(80)
  await page.mouse.click(to[0], to[1])
}

/** The figures from the file: a cell counts when its center is inside the rectangle (straight in longitude and latitude, as drawn). */
async function expectedFromFile(ring: Array<[number, number]>): Promise<{ count: number; excluded: number; sum: number; min: number; max: number }> {
  const { fromFile } = await import('geotiff')
  const proj4 = (await import('proj4')).default
  const tiff = await fromFile(raster('dem-utm12.tif'))
  const image = await tiff.getImage()
  const [w, h] = [image.getWidth(), image.getHeight()]
  const [ox, oy] = image.getOrigin()
  const [rx, ry] = image.getResolution()
  const data = (await image.readRasters({ interleave: true })) as Float32Array
  const toLonLat = proj4('EPSG:32612', 'EPSG:4326')
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  let count = 0
  let excluded = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const [lon, lat] = toLonLat.forward([ox + (c + 0.5) * rx, oy + (r + 0.5) * ry])
      if (lon < minX || lon >= maxX || lat < minY || lat >= maxY) continue
      const v = data[r * w + c]
      if (!Number.isFinite(v) || v === -9999) excluded++
      else {
        count++
        sum += v
        min = Math.min(min, v)
        max = Math.max(max, v)
      }
    }
  }
  return { count, excluded, sum, min, max }
}

test.describe('statistics inside an area (US4)', () => {
  test('a rectangle over the DEM gives the figures of the cells under it, as worked out from the file', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await pickAreaTool(page)
    const m = await mapBox(page)
    const cx = m.x + m.width / 2
    const cy = m.y + m.height / 2
    await drawRectangle(page, [cx - 40, cy - 60], [cx + 50, cy + 40])
    await expect(page.getByRole('region', { name: 'Statistics inside the area' })).toBeVisible()
    await expect.poll(async () => (await areaProbe(page))?.status, { timeout: 30000 }).toBe('done')
    const got = (await areaProbe(page))!.area!
    expect(got.approximate).toBe(false)
    expect(got.areaM2).toBeGreaterThan(1e6)
    const ring = await e2e<Array<[number, number]> | null>(page, 'rasterProbeShape')
    expect(ring, 'the drawn ring is available to the test').not.toBeNull()
    const want = await expectedFromFile(ring!)
    const b = got.bands[0]
    expect(b.count).toBe(want.count)
    expect(b.excluded).toBe(want.excluded)
    expect(b.min).toBe(want.min)
    expect(b.max).toBe(want.max)
    expect(b.sum).toBeCloseTo(want.sum, 3)
    expect(b.mean).toBeCloseTo(want.sum / want.count, 8)
    expect(b.histogram.reduce((a, c) => a + c, 0)).toBe(want.count)
    await expect(page.getByRole('table', { name: 'Statistics per band' })).toContainText(want.count.toLocaleString('en-US'))
  })

  test('an area over nothing says so, and the panel closes with its shape', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await pickAreaTool(page)
    const m = await mapBox(page)
    // The far left of the map is outside the portrait raster.
    await drawRectangle(page, [m.x + 20, m.y + 80], [m.x + 70, m.y + 140])
    await expect.poll(async () => (await areaProbe(page))?.status, { timeout: 30000 }).toBe('done')
    expect((await areaProbe(page))!.area!.bands[0]).toMatchObject({ count: 0, min: null, mean: null })
    await expect(page.getByText(/no values inside the area/)).toBeVisible()
    await page.getByRole('button', { name: 'Close the statistics' }).click()
    await expect(page.getByRole('region', { name: 'Statistics inside the area' })).toHaveCount(0)
  })

  test('a colour image gives the figures of each of its three bands', async ({ page }) => {
    await openRaster(page, raster('ortho-rgb.tif'))
    await pickAreaTool(page)
    const m = await mapBox(page)
    await drawRectangle(page, [m.x + m.width / 2 - 30, m.y + m.height / 2 - 30], [m.x + m.width / 2 + 30, m.y + m.height / 2 + 30])
    await expect.poll(async () => (await areaProbe(page))?.status, { timeout: 30000 }).toBe('done')
    const bands = (await areaProbe(page))!.area!.bands
    expect(bands).toHaveLength(3)
    expect(bands[0].count).toBe(bands[1].count)
    expect(bands[0].count).toBeGreaterThan(0)
  })

  test('the statistics panel has no accessibility violations', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await pickAreaTool(page)
    const m = await mapBox(page)
    await drawRectangle(page, [m.x + m.width / 2 - 30, m.y + m.height / 2 - 30], [m.x + m.width / 2 + 30, m.y + m.height / 2 + 30])
    await expect.poll(async () => (await areaProbe(page))?.status, { timeout: 30000 }).toBe('done')
    const results = await new AxeBuilder({ page }).include('[aria-label="Statistics inside the area"]').analyze()
    expect(results.violations).toEqual([])
  })
})
