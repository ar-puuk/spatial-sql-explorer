// Spec 007 (large files): opening in the real web build. T018 covers US1 (facts
// first, overview, cancel); US4 (whole-read formats) and the FlatGeobuf
// "load for queries" flow are added by later tasks. The `?e2e=1` overrides
// (cap, wholeThreshold, slowParse, …) let 10,000-row fixtures exercise the
// large-file paths; see helpers.ts.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFixture } from './helpers'

interface OpenState {
  phase: string
  facts: { rows: number; readMode: string; spatialIndex: string; crs: { label: string }; geometryType: string; fallback: string | null } | null
}

const openState = (page: Page): Promise<OpenState> =>
  page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { openState: () => OpenState } }).__spatialExplorerE2E.openState())

const statusBar = (page: Page) => page.locator('.status-bar')

test.describe('US1: open a large file and see it quickly', () => {
  test('GeoParquet with a covering bbox: whole-file facts, read in parts', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1&cap=1000')
    await expect(statusBar(page)).toContainText('10,000 features')
    await expect(statusBar(page)).toContainText('EPSG:4326')
    await expect(statusBar(page)).toContainText('Polygon')
    const s = await openState(page)
    expect(s.phase).toBe('ready')
    expect(s.facts).toMatchObject({ rows: 10000, readMode: 'partial', spatialIndex: 'covering', fallback: null })
  })

  test('GeoParquet without a covering bbox: a bbox index is built once', async ({ page }) => {
    await openFixture(page, 'parcels-10k-nobbox.parquet', '?e2e=1&cap=1000')
    await expect(statusBar(page)).toContainText('10,000 features')
    await expect.poll(async () => (await openState(page)).facts?.spatialIndex).toBe('built')
    expect((await openState(page)).facts?.readMode).toBe('partial')
  })

  test('FlatGeobuf read in parts: facts from the header', async ({ page }) => {
    await openFixture(page, 'parcels-10k.fgb', '?e2e=1&cap=1000&wholeThreshold=1')
    // Validity isn't scanned when reading in parts: rows, not features (FR-016).
    await expect(statusBar(page)).toContainText('10,000 rows')
    await expect(statusBar(page)).toContainText('EPSG:4326')
    expect((await openState(page)).facts).toMatchObject({ rows: 10000, readMode: 'partial-view', spatialIndex: 'file' })
  })

  test('the map shows a thinned overview of the whole extent, and says so', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1&cap=1000')
    await expect(page.locator('.map-notice')).toContainText(/Showing (9\d\d|1,000) of 10,000 in view\. Zoom in to see all\./)
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached' })
    const rendered = Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))
    expect(rendered).toBeGreaterThan(0)
  })

  test('Cancel during an open returns to the previous state, and the next open works', async ({ page }) => {
    await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } })
    )
    await page.goto('/?e2e=1&slowParse=1')
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.parquet'))
    const cancel = page.getByRole('button', { name: 'Cancel opening' })
    await expect(cancel).toBeVisible({ timeout: 10000 })
    const t0 = Date.now()
    await cancel.click()
    await expect(page.getByText('Drag a geospatial file here')).toBeVisible({ timeout: 3000 })
    expect(Date.now() - t0).toBeLessThan(3000)
    await expect(page.locator('.error-banner')).toHaveCount(0)

    await page.goto('/?e2e=1')
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.parquet'))
    await expect(statusBar(page)).toContainText('10,000 features', { timeout: 60000 })
  })
})
