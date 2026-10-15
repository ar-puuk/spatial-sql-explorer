// A feature picked on the map brings its row into view in the table, even when the row is on a page the table has not
// loaded (a long table): the table asks the engine where the row sits, scrolls there, and the page loads as for any scroll.
import { test, expect } from '@playwright/test'
import { grid } from './helpers'

test('a click on the map scrolls the table to the selected row, on a page that was not loaded', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/?e2e=1')
  await expect(page.getByText('SQL engine ready')).toBeVisible({ timeout: 60000 })
  await page.getByRole('button', { name: /Try sample data/ }).click()
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 30000 })
  // The lower 48 (zoom to layer reaches across the date line for Alaska, and shows the world).
  await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { jumpTo(a: number, b: number, z: number): void } }).__spatialExplorerE2E.jumpTo(-98, 38.5, 4))
  await page.waitForTimeout(2000)

  const box = (await page.locator('.canvas-host').boundingBox())!
  // A few places across the country: at least one of 3,222 counties is far down the table (pages are 200 rows).
  let deepRow = 0
  for (const [fx, fy] of [[0.5, 0.5], [0.35, 0.5], [0.65, 0.45], [0.5, 0.7], [0.5, 0.3], [0.3, 0.65]]) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
    const selected = grid(page).locator('tbody tr.selected')
    await expect(selected).toHaveCount(1, { timeout: 10000 })
    // The selected row is on screen, inside the table's scroll area.
    await expect(selected).toBeInViewport({ ratio: 0.9 })
    const index = Number(await selected.locator('td.id').innerText())
    deepRow = Math.max(deepRow, index)
  }
  // The test means something only if a click landed on a row beyond the first page.
  expect(deepRow).toBeGreaterThan(200)
})
