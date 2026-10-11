// T026 (spec 007 US2, FR-005–FR-008): the map draws the result's features in
// the current view, capped and spread, refreshed on pan and zoom. 10,000-row
// fixtures with `?e2e=1&cap=1000` exercise the large-file paths.
import { test, expect, type Page } from '@playwright/test'
import { openFixture } from './helpers'

interface ViewState {
  generation: number
  drawn: number
  inView: number
  thinned: boolean
}

const viewState = (page: Page): Promise<ViewState | null> =>
  page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { viewState: () => ViewState | null } }).__spatialExplorerE2E.viewState())

/** Moves the map (center lon/lat, zoom) through the e2e hook and waits for that view's features. */
async function jumpTo(page: Page, lon: number, lat: number, zoom: number): Promise<ViewState> {
  const before = (await viewState(page))?.generation ?? 0
  await page.evaluate(([x, y, z]) => (window as unknown as { __spatialExplorerE2E: { jumpTo: (a: number, b: number, c: number) => void } }).__spatialExplorerE2E.jumpTo(x, y, z), [lon, lat, zoom])
  await expect.poll(async () => (await viewState(page))?.generation ?? 0, { timeout: 15000 }).toBeGreaterThan(before)
  await page.waitForTimeout(300)
  return (await viewState(page))!
}

const rendered = async (page: Page): Promise<number> => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))

test.describe('US2: pan and zoom through a large file', () => {
  test('the full extent is a spread subset with a notice; zooming in draws every feature in view', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1&cap=1000')
    await expect.poll(async () => (await viewState(page))?.thinned).toBe(true)
    const overview = (await viewState(page))!
    // One feature per occupied grid cell, up to the cap: clustered data may fill slightly fewer.
    expect(overview.drawn).toBeLessThanOrEqual(1000)
    expect(overview.drawn).toBeGreaterThan(900)
    expect(overview.inView).toBe(10000)
    await expect(page.locator('.map-notice')).toContainText(`Showing ${overview.drawn.toLocaleString('en-US')} of 10,000 in view. Zoom in to see all.`)

    // One "city" of the generator: zoom 13 holds well under 1,000 parcels.
    const city = await jumpTo(page, -112.6, 37.4, 13)
    expect(city.thinned).toBe(false)
    expect(city.drawn).toBe(city.inView)
    expect(city.inView).toBeGreaterThan(0)
    await expect(page.locator('.map-notice')).toHaveCount(0)
  })

  test('rapid pans end with the last view only, and the map never goes blank', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1&cap=1000')
    await expect.poll(async () => (await viewState(page))?.drawn ?? 0).toBeGreaterThan(0)
    // "Never blank": the drawn set is never emptied between views (FR-007).
    const samples: number[] = []
    const sampler = setInterval(() => void viewState(page).then((v) => samples.push(v?.drawn ?? -1)).catch(() => {}), 50)
    for (const [x, y] of [[-112.6, 37.4], [-111.85, 37.4], [-111.1, 37.4], [-112.6, 38.6], [-111.85, 38.6]]) {
      await page.evaluate(([a, b]) => (window as unknown as { __spatialExplorerE2E: { jumpTo: (a: number, b: number, c: number) => void } }).__spatialExplorerE2E.jumpTo(a, b, 12), [x, y])
      await page.waitForTimeout(40)
    }
    const last = await jumpTo(page, -111.85, 38.6, 12)
    clearInterval(sampler)
    expect(samples.length).toBeGreaterThan(3)
    expect(samples.every((n) => n > 0), `drawn counts while panning: ${samples.join(',')}`).toBe(true)
    // The final view is the one drawn: its features lie inside it.
    const inside = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { drawnInsideView: () => boolean } }).__spatialExplorerE2E.drawnInsideView())
    expect(inside).toBe(true)
    expect(last.drawn).toBeGreaterThan(0)
  })

  test('clicking a drawn feature opens the inspector with all its attributes', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1&cap=1000')
    await jumpTo(page, -112.6, 37.4, 13)
    // Center the map on a drawn parcel, close enough that it fills the middle of the canvas, then click there.
    const [lon, lat] = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { drawnCenter: () => [number, number] } }).__spatialExplorerE2E.drawnCenter())
    await jumpTo(page, lon, lat, 18)
    await page.waitForTimeout(500)
    const box = (await page.locator('.canvas-host').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const inspector = page.locator('.inspector-slot')
    await expect(inspector).toContainText('parcel_code')
    await expect(inspector).toContainText('year_built')
  })

  test('selecting a row outside the drawn set zooms to it and draws it highlighted (FR-008)', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1&cap=1000')
    await jumpTo(page, -112.6, 37.4, 14)
    // Row 9,999 (the last parcel in file order) is elsewhere: fetched by id, then zoomed to.
    await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { zoomToFeature: (id: number) => void } }).__spatialExplorerE2E.zoomToFeature(9999))
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { outsideFeatureId: () => number | null } }).__spatialExplorerE2E.outsideFeatureId())).toBe(9999)
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { drawnIds: () => number[] } }).__spatialExplorerE2E.drawnIds().includes(9999))).toBe(true)
  })

  test('a loading cue appears only for slow views', async ({ page }) => {
    await openFixture(page, 'parcels-10k.parquet', '?e2e=1&cap=1000&slowViewMs=800')
    await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { jumpTo: (a: number, b: number, c: number) => void } }).__spatialExplorerE2E.jumpTo(-112.6, 37.4, 12))
    await expect(page.getByRole('progressbar', { name: 'Loading the features in view' })).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Loading the features in view' })).toHaveCount(0, { timeout: 10000 })
  })

  test('FlatGeobuf read in parts: views are capped at its smaller cap, with the notice', async ({ page }) => {
    await openFixture(page, 'parcels-10k.fgb', '?e2e=1&wholeThreshold=1&cap=500')
    await expect.poll(async () => (await viewState(page))?.thinned).toBe(true)
    const v = (await viewState(page))!
    expect(v.drawn).toBeLessThanOrEqual(500)
    await expect(page.locator('.map-notice')).toContainText(/Showing [\d,]+ of about [\d,]+ in view\. Zoom in to see all\./)

    // Zoomed into one city: the features themselves, read from the file, with their attributes.
    const city = await jumpTo(page, -112.6, 37.4, 15)
    expect(city.thinned).toBe(false)
    expect(city.drawn).toBeGreaterThan(0)
    await expect.poll(() => rendered(page), { timeout: 15000 }).toBeGreaterThan(0)
    const ids = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { drawnIds: () => number[] } }).__spatialExplorerE2E.drawnIds())
    expect(ids.every((id) => id < 2 ** 40)).toBe(true)
  })
})
