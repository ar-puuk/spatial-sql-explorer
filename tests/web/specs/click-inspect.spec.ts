// T042 (specs/001-quick-look/tasks.md, User Story 5 / FR-010): clicking a
// rendered feature on the map shows its attributes, both by selecting its
// table row and in the feature inspector card.
import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test('clicking a map feature selects its row and shows its attributes', async ({ page }) => {
  await page.goto('/')
  // One-feature USA layer (EPSG:26912, reprojected). Its extent includes
  // Alaska and Hawaii, so the extent's center is in Canada: compute where a
  // point inside the contiguous US (Kansas, -100/39) lands after the map's
  // fit-to-extent (Web Mercator, 32px padding). With a single world copy the
  // view can't extend past ±180°, so the center is clamped horizontally.
  await page.locator('input[type="file"]').setInputFiles(path.resolve(__dirname, '../../vscode-ext/fixtures/usa-utm12n.gpkg'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await expect(page.locator('.inspector')).toHaveCount(0)

  const box = (await page.locator('.canvas-host').boundingBox())!
  const [minX, minY, maxX, maxY] = [-171.791111, 18.91619, -66.96466, 71.357764] // reported by T034
  const mx = (lon: number): number => (lon + 180) / 360 // world fraction, 0..1
  const my = (lat: number): number => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2
  const pad = 32
  const worldPx = Math.min((box.width - 2 * pad) / (mx(maxX) - mx(minX)), (box.height - 2 * pad) / (my(minY) - my(maxY)))
  const halfW = box.width / 2 / worldPx
  const cx = Math.min(1 - halfW, Math.max(halfW, (mx(minX) + mx(maxX)) / 2))
  const cy = (my(minY) + my(maxY)) / 2
  await page.mouse.click(box.x + box.width / 2 + (mx(-100) - cx) * worldPx, box.y + box.height / 2 + (my(39) - cy) * worldPx)

  const inspector = page.getByRole('region', { name: 'Feature attributes' })
  await expect(inspector).toBeVisible()
  await expect(inspector).toContainText('United States')
  await expect(page.locator('.attribute-table tbody tr.selected')).toHaveCount(1)
  await expect(page.locator('.attribute-table tbody tr.selected')).toContainText('United States')

  // Closing the card keeps the selection.
  await inspector.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.inspector')).toHaveCount(0)
  await expect(page.locator('.attribute-table tbody tr.selected')).toHaveCount(1)
})

// Spec 008 (user request): wide data in the inspector scrolls at a readable
// size and can be filtered; dates show as dates in the inspector and table.
test('the inspector with 50 attributes: readable rows that scroll, a filter, and dates as dates', async ({ page }) => {
  const { fixture, openFile } = await import('./helpers')
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFile(page, fixture('wide-50.parquet'), '?e2e=1')
  // The table: DATE columns as YYYY-MM-DD, not epoch milliseconds.
  await expect(page.getByRole('grid').first()).toContainText('2020-01-01')
  await expect(page.getByRole('grid').first()).not.toContainText('1577836800000')

  await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { jumpTo(a: number, b: number, z: number): void } }).__spatialExplorerE2E.jumpTo(-111.9, 40.7, 16))
  await page.waitForTimeout(1500)
  const box = (await page.locator('.canvas-host').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const inspector = page.getByRole('region', { name: 'Feature attributes' })
  await expect(inspector).toContainText('#1')
  // Every row keeps a readable height; the list scrolls instead.
  await expect.poll(() => inspector.locator('dt').count()).toBeGreaterThan(40)
  const heights = await inspector.locator('dt').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
  expect(heights.length).toBeGreaterThan(40)
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(16)
  const scrolls = await inspector.locator('dl').evaluate((dl) => dl.scrollHeight > dl.clientHeight + 10)
  expect(scrolls).toBe(true)
  // The card stops 8 px above the scale bar, the same gap as under the search box.
  const card = (await inspector.boundingBox())!
  const scale = (await page.locator('.maplibregl-ctrl-scale').boundingBox())!
  expect(Math.round(scale.y - (card.y + card.height))).toBe(8)
  await expect(inspector.locator('dd').filter({ hasText: /^2020-01-01$/ }).first()).toBeVisible()
  // The filter narrows the list by name or value.
  const filter = inspector.getByLabel('Filter attributes')
  await filter.fill('date')
  await expect(inspector.getByRole('status')).toHaveText(/^\d+ of \d+$/)
  const keys = await inspector.locator('dt').allTextContents()
  expect(keys.length).toBeGreaterThan(0)
  expect(keys.every((k) => k.includes('date'))).toBe(true)
  await filter.fill('zzz-no-such')
  await expect(inspector).toContainText('No attribute matches')
})
