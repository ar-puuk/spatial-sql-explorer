// Spec 007 (large files): opening in the real web build. T018 covers US1 (facts
// first, overview, cancel); US4 (whole-read formats) and the FlatGeobuf
// "load for queries" flow are added by later tasks. The `?e2e=1` overrides
// (cap, wholeThreshold, slowParse, …) let 10,000-row fixtures exercise the
// large-file paths; see helpers.ts.
import { test, expect, type Page } from '@playwright/test'
import { fixture, largeData, openFixture } from './helpers'

interface OpenState {
  phase: string
  facts: { rows: number; readMode: string; spatialIndex: string; crs: { label: string }; geometryType: string; fallback: string | null; needsLoad: boolean } | null
}

const openState = (page: Page): Promise<OpenState> =>
  page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { openState: () => OpenState } }).__spatialExplorerE2E.openState())

const statusBar = (page: Page) => page.locator('.status-bar')

test.describe('US1: open a large file and see it quickly', () => {
  test('GeoParquet with a covering bbox: whole-file facts, read in parts', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1')
    await expect(statusBar(page)).toContainText('10,000 features')
    await expect(statusBar(page)).toContainText('EPSG:4326')
    await expect(statusBar(page)).toContainText('Polygon')
    const s = await openState(page)
    expect(s.phase).toBe('ready')
    expect(s.facts).toMatchObject({ rows: 10000, readMode: 'partial', spatialIndex: 'covering', fallback: null })
  })

  test('GeoParquet without a covering bbox: a bbox index is built once', async ({ page }) => {
    await openFixture(page, 'parcels-10k-nobbox.parquet', '?e2e=1')
    await expect(statusBar(page)).toContainText('10,000 features')
    await expect.poll(async () => (await openState(page)).facts?.spatialIndex).toBe('built')
    expect((await openState(page)).facts?.readMode).toBe('partial')
  })

  test('FlatGeobuf read in parts: facts from the header', async ({ page }) => {
    await openFixture(page, 'parcels-10k.fgb', '?e2e=1&wholeThreshold=1')
    // Validity isn't scanned when reading in parts: rows, not features (FR-016).
    await expect(statusBar(page)).toContainText('10,000 rows')
    await expect(statusBar(page)).toContainText('EPSG:4326')
    expect((await openState(page)).facts).toMatchObject({ rows: 10000, readMode: 'partial-view', spatialIndex: 'file' })
  })

  // Spec 010: the whole result is drawn (GeoJSON under 100,000 rows); no subset, no notice.
  test('the map draws the whole extent, with no subset notice', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1')
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached' })
    await expect(page.locator('.map-notice')).toHaveCount(0)
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
    console.log(`TIMING SC-002 cancel during open: ${Date.now() - t0} ms`)
    expect(Date.now() - t0).toBeLessThan(3000)
    await expect(page.locator('.error-banner')).toHaveCount(0)

    await page.goto('/?e2e=1')
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.parquet'))
    await expect(statusBar(page)).toContainText('10,000 features', { timeout: 60000 })
  })
})

// T044/T045: a FlatGeobuf read in parts draws the map from its index; whole-file
// work waits for "Load", which re-opens it in memory with queries enabled.
test.describe('FlatGeobuf: load the whole file to query it', () => {
  test('the query panel, table and export offer Load; after it, queries run on all rows', async ({ page }) => {
    test.setTimeout(120000)
    await openFixture(page, 'parcels-10k.fgb', '?e2e=1&wholeThreshold=1')
    expect((await openState(page)).facts).toMatchObject({ readMode: 'partial-view', needsLoad: true })

    const notice = page.getByRole('status').filter({ hasText: /Load the whole file \(.+ MB\) to list its rows\./ })
    await expect(notice).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export data…' })).toBeDisabled()
    await page.keyboard.press('Control+Shift+Q')
    const queryNotice = page.getByRole('status').filter({ hasText: /Load the whole file \(.+ MB\) to query it\./ })
    await expect(queryNotice).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled()

    const t0 = Date.now()
    await queryNotice.getByRole('button', { name: 'Load' }).click()
    await expect.poll(async () => (await openState(page)).facts?.needsLoad, { timeout: 60000 }).toBe(false)
    console.log(`TIMING T044 load whole (parcels-10k.fgb): ${Date.now() - t0} ms`)
    expect((await openState(page)).facts).toMatchObject({ rows: 10000, readMode: 'whole' })
    await expect(notice).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Export data…' })).toBeEnabled()
    await expect(page.getByRole('grid', { name: 'Attribute table' }).locator('tbody tr:not(.spacer):not(.skeleton)').first()).toBeVisible()
  })
})

// T046/T050 (US4): formats that must be read whole are parsed once into an
// indexed table, announced above the threshold, and Cancel always ends the
// open within 3 s.
test.describe('US4: an honest path for formats read whole', () => {
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Read the whole file?' })

  test('below the threshold: no announcement; facts from the parsed table', async ({ page }) => {
    await openFixture(page, 'parcels-10k.geojson')
    await expect(dialog(page)).toHaveCount(0)
    expect((await openState(page)).facts).toMatchObject({ rows: 10000, readMode: 'whole', spatialIndex: 'built' })
    await expect(statusBar(page)).toContainText('10,000 features')
  })

  test('above the threshold: announced first; Open reads it', async ({ page }) => {
    await page.goto('/?e2e=1&wholeThreshold=1000000')
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.geojson'))
    await expect(dialog(page)).toBeVisible({ timeout: 10000 })
    await expect(dialog(page)).toContainText('GeoJSON files must be read in full. This one is 5 MB and may take about 5 seconds. GeoParquet and FlatGeobuf open at any size.')
    await expect(dialog(page).getByRole('button', { name: 'Open' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(statusBar(page)).toContainText('10,000 features', { timeout: 60000 })
    expect((await openState(page)).facts).toMatchObject({ readMode: 'whole', spatialIndex: 'built' })
  })

  test('Esc on the announcement cancels: empty state, focus back, and the next open works', async ({ page }) => {
    await page.goto('/?e2e=1&wholeThreshold=1000000')
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.geojson'))
    await expect(dialog(page)).toBeVisible({ timeout: 10000 })
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByText('Drag a geospatial file here')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose a file' })).toBeFocused()
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.parquet'))
    await expect(statusBar(page)).toContainText('10,000 features', { timeout: 60000 })
  })

  test('Cancel during a read the engine ignores: the engine is reset within 3 s, and the next open works', async ({ page }) => {
    await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } })
    )
    await page.goto('/?e2e=1&slowParse=stuck')
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.geojson'))
    const cancel = page.getByRole('button', { name: 'Cancel opening' })
    await expect(cancel).toBeVisible({ timeout: 10000 })
    const t0 = Date.now()
    await cancel.click()
    await expect(page.getByText('Drag a geospatial file here')).toBeVisible({ timeout: 3000 })
    const ms = Date.now() - t0
    console.log(`TIMING SC-005 cancel (engine reset): ${ms} ms`)
    expect(ms).toBeLessThan(3000)
    await expect(page.locator('.error-banner')).toHaveCount(0)

    await page.goto('/?e2e=1')
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.geojson'))
    await expect(statusBar(page)).toContainText('10,000 features', { timeout: 60000 })
  })

  test('Cancel during a 325 MB GeoJSON parse stops within 3 s (SC-005)', async ({ page }) => {
    test.setTimeout(180000)
    const file = largeData('parcels-460k.geojson')
    await page.goto('/?e2e=1&wholeThreshold=1000000000')
    await page.locator('input[type="file"]').setInputFiles(file)
    const cancel = page.getByRole('button', { name: 'Cancel opening' })
    await expect(cancel).toBeVisible({ timeout: 30000 })
    await expect.poll(async () => (await openState(page)).phase, { timeout: 30000 }).toBe('reading')
    await page.waitForTimeout(3000)
    const t0 = Date.now()
    await cancel.click()
    await expect(page.getByText('Drag a geospatial file here')).toBeVisible({ timeout: 3000 })
    console.log(`TIMING SC-005 cancel (325 MB GeoJSON parse): ${Date.now() - t0} ms`)
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.parquet'))
    await expect(statusBar(page)).toContainText('10,000 features', { timeout: 60000 })
  })
})

// T051 (FR-014): running out of memory ends in a clear message, never a blank
// viewer, and the next open or query works.
test.describe('US4: out of memory', () => {
  test('opening a whole-read file that does not fit: the message, then another file opens', async ({ page }) => {
    await page.goto('/?e2e=1&memoryLimit=8MB')
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.geojson'))
    await expect(page.getByText('This file is too large to read in full here (out of memory). Convert it to GeoParquet or FlatGeobuf to open it at any size.')).toBeVisible({
      timeout: 60000,
    })
    await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.parquet'))
    await expect(statusBar(page)).toContainText('10,000 features', { timeout: 60000 })
  })

  test('a query that runs out: the message, the source recovered, the next query works', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1&memoryLimit=24MB')
    await page.keyboard.press('Control+Shift+Q')
    const { runQuery } = await import('./helpers')
    await runQuery(page, 'SELECT a.*, b.* FROM layer a, layer b ORDER BY a.value, b.value')
    await expect(page.locator('.query-status')).toContainText(/That ran out of memory \([\d.]+ MB limit\)\. Filter the result, or select fewer columns\./, { timeout: 60000 })
    await runQuery(page, 'SELECT count(*) AS n FROM layer')
    await expect(page.locator('.query-status')).toContainText('1 row', { timeout: 60000 })
    await expect(page.getByRole('grid', { name: 'Attribute table' }).locator('tbody tr:not(.spacer):not(.skeleton)').first()).toContainText('10000')
  })
})

// T052: a shapefile's sidecars travel with it through file handles (wholeBytes=0
// skips the small-file memory fetch).
test('US4: a shapefile with its sidecars opens through file handles', async ({ page }) => {
  await page.goto('/?e2e=1&wholeBytes=0')
  await page.locator('input[type="file"]').setInputFiles(['shp', 'shx', 'dbf', 'prj', 'cpg'].map((ext) => fixture(`sample.${ext}`)))
  await expect(statusBar(page)).toContainText('179 features', { timeout: 60000 })
  expect((await openState(page)).facts).toMatchObject({ rows: 180, readMode: 'whole', spatialIndex: 'built' })
})
