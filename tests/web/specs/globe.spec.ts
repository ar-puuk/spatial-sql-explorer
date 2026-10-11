// T064 (spec 008 US5, FR-023, SC-005): the globe toggle.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile } from './helpers'

type MapState = { projection: string; center?: [number, number]; zoom?: number; pitch?: number; bearing?: number }
const mapState = (page: Page) => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState(): MapState } }).__spatialExplorerE2E.mapState())
const globe = (page: Page) => page.getByRole('button', { name: 'Globe view' })

test('globe on and off keeps the view; the map always opens flat', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await expect(globe(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await mapState(page)).center).toBeTruthy()
  const before = await mapState(page)
  const started = Date.now()
  await globe(page).click()
  await expect(globe(page)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await mapState(page)).projection).toBe('globe')
  expect(Date.now() - started).toBeLessThan(1000) // SC-005
  const map = await page.evaluate(() => {
    const canvas = document.querySelector('.canvas-host') as HTMLElement
    return canvas.dataset.renderedFeatures
  })
  expect(Number(map)).toBeGreaterThan(0)
  const after = await mapState(page)
  if (after.center && before.center) expect(Math.abs(after.center[0] - before.center[0])).toBeLessThan(1)

  // Not remembered (user decision, 2026-10-11): the map always opens flat.
  await page.reload()
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await expect(globe(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await mapState(page)).projection).toBe('mercator')
})

test('on the globe, views of a file read in parts keep their notices', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('parcels-10k.parquet'), '?e2e=1&cap=500')
  await globe(page).click()
  await expect.poll(async () => (await mapState(page)).projection).toBe('globe')
  await expect(page.locator('.map-notice')).toContainText(/Showing|of/)
})

test('on the globe, a click opens the inspector', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await globe(page).click()
  await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { jumpTo(a: number, b: number, z: number): void } }).__spatialExplorerE2E.jumpTo(-100, 40, 3))
  await page.waitForTimeout(1500)
  const box = (await page.locator('.canvas-host').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const inspector = page.getByRole('region', { name: 'Feature attributes' })
  await expect(inspector).toBeVisible()
  await expect(inspector).toContainText('United States')
})

// Spec 008 (user report): a click in space beside the globe selects nothing.
test('on the globe, a click in space selects nothing', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await globe(page).click()
  await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { jumpTo(a: number, b: number, z: number): void } }).__spatialExplorerE2E.jumpTo(10, 30, 1.3))
  await page.waitForTimeout(1500)
  const box = (await page.locator('.canvas-host').boundingBox())!
  // The globe is centered; its corners are space.
  for (const [fx, fy] of [[0.04, 0.06], [0.96, 0.06], [0.96, 0.9], [0.04, 0.9]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
    await expect(page.getByRole('region', { name: 'Feature attributes' })).toHaveCount(0)
  }
  // The globe still answers.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByRole('region', { name: 'Feature attributes' })).toBeVisible()
})

// Spec 008 (user request): the globe in a night sky with an atmosphere glow; the flat map has neither.
test('the globe sits in a night sky; the flat map does not', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await expect(page.locator('canvas.sky')).toHaveCount(0)
  await globe(page).click()
  const sky = page.locator('canvas.sky')
  await expect(sky).toHaveCount(1)
  await expect(sky).toHaveAttribute('aria-hidden', 'true')
  // Painted: dark space at a corner, with stars somewhere.
  await expect
    .poll(() =>
      sky.evaluate((c: HTMLCanvasElement) => {
        const ctx = c.getContext('2d')
        if (!ctx || !c.width) return null
        const corner = ctx.getImageData(1, 1, 1, 1).data
        const all = ctx.getImageData(0, 0, c.width, c.height).data
        let bright = 0
        for (let i = 0; i < all.length; i += 4) if (all[i] > 200 && all[i + 1] > 200 && all[i + 2] > 200) bright++
        return { dark: corner[0] < 40 && corner[1] < 50 && corner[2] < 80, stars: bright > 20 }
      })
    )
    .toEqual({ dark: true, stars: true })
  await globe(page).click()
  await expect(page.locator('canvas.sky')).toHaveCount(0)
})
