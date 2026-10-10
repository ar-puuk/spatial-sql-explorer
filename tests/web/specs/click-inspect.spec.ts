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

  // Closing the inspector keeps the selection; Escape in the grid clears both.
  await inspector.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.inspector')).toHaveCount(0)
  await expect(page.locator('.attribute-table tbody tr.selected')).toHaveCount(1)
})
