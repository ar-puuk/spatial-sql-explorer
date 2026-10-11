// T064 (spec 008 US5, FR-023, SC-005): the globe toggle.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile } from './helpers'

type MapState = { projection: string; center?: [number, number]; zoom?: number; pitch?: number; bearing?: number }
const mapState = (page: Page) => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState(): MapState } }).__spatialExplorerE2E.mapState())
const globe = (page: Page) => page.getByRole('button', { name: 'Globe view' })

test('globe on and off keeps the view, and the choice is remembered', async ({ page }) => {
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

  await page.reload()
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await expect(globe(page)).toHaveAttribute('aria-pressed', 'true')
  await globe(page).click()
  await expect(globe(page)).toHaveAttribute('aria-pressed', 'false')
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
