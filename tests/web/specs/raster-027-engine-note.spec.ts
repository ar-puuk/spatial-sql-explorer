// Spec 027: while the raster engine is fetched (the first raster only), the open says what it is waiting for and how big it is.
import { test, expect } from '@playwright/test'
import { fixture } from './helpers'

test('opening the first raster says it is downloading the raster engine, with its size', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }))
  // Slow the big file down, so the message is on screen long enough to read.
  await page.route('**/whitebox_wasm_bg.wasm', async (route) => {
    await new Promise((r) => setTimeout(r, 2500))
    await route.continue()
  })
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('raster/dem-utm12.tif'))
  await expect(page.getByText(/Downloading the raster engine \(4\.\d MB\)\. It is kept, so this happens once\./)).toBeVisible({ timeout: 20000 })
  await page.locator('.canvas-host[data-raster-ready]').waitFor({ state: 'attached', timeout: 90000 })
  await expect(page.getByText(/Downloading the raster engine/)).toHaveCount(0)
})
