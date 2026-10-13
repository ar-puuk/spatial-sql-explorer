// T086 (spec 008 US8, FR-032, SC-008): sample data with no network beyond
// the app itself: it opens and draws within 3 s, and styling and export work.
import { test, expect } from '@playwright/test'
import { exportVia, inspectParquet } from './helpers'

test('Try sample data: draws within 3 s with no outside network; style and export work', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/?e2e=1')
  // After the app and engine load (T086): the engine fetches its spatial
  // extension from extensions.duckdb.org when it starts.
  await expect(page.getByText('SQL engine ready')).toBeVisible({ timeout: 60000 })
  // Then no internet: only the app's own origin answers (tiles, fonts, search all fail).
  await page.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort())
  const started = Date.now()
  await page.getByRole('button', { name: /Try sample data/ }).click()
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 30000 })
  const ms = Date.now() - started
  console.log(`TIMING SC-008 sample drawn: ${ms} ms`)
  expect(ms, `sample drew in ${ms} ms`).toBeLessThan(3000) // SC-008
  await expect(page.locator('.status-bar')).toContainText('3,222')
  expect(Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))).toBeGreaterThan(100)

  // A style works on the sample.
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await page.getByRole('radio', { name: 'Graduated' }).click()
  await expect(page.getByRole('region', { name: 'Legend' })).toContainText(/Quantile, 5 classes/)
  await page.getByRole('button', { name: 'Style', exact: true }).click()

  // So does an export, written and read back by the engine.
  const out = await exportVia(page, { format: 'GeoParquet' })
  expect(out.name).toBe('us-counties-export.parquet')
  expect((await inspectParquet(page, out.bytes)).rows).toBe(3222)
})
