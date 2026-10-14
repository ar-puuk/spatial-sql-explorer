// Spec 010 T023: the map draws a small result once as GeoJSON (panning does no
// engine work) and a big one from engine vector tiles; "Load all" switches.
// Replaces spec 007's viewport.spec.ts (thinning and the view cap are gone).
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile, openQueryPanel, runQuery, chooseStyleType } from './helpers'

type DrawState = { mode: 'geojson' | 'tiles' | null; features: number | null; tileUrl: string | null; loading: boolean; loadedAll: boolean }
const hook = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([n, a]) => (window as unknown as { __spatialExplorerE2E: Record<string, (...x: unknown[]) => unknown> }).__spatialExplorerE2E[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>
const drawState = (page: Page) => hook<DrawState>(page, 'drawState')
const drawCalls = (page: Page) => hook<number>(page, 'drawCalls')
const statusBar = (page: Page) => page.locator('.status-bar')
const canvas = (page: Page) => page.locator('.canvas-host')
const rendered = async (page: Page) => Number(await canvas(page).getAttribute('data-rendered-features'))

async function pan(page: Page, dx: number, dy: number): Promise<void> {
  const box = (await canvas(page).boundingBox())!
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 8 })
  await page.mouse.up()
}

test('a result under 100,000 rows is drawn once as GeoJSON: panning runs no engine work', async ({ page }) => {
  await openFile(page, fixture('parcels-10k.geojson'), '?e2e=1')
  await expect.poll(async () => (await drawState(page)).mode).toBe('geojson')
  expect((await drawState(page)).features).toBe(10_000)
  await expect.poll(() => rendered(page)).toBeGreaterThan(0)
  await expect(statusBar(page)).toContainText('All drawn · 10,000 features')
  await expect(statusBar(page).getByRole('button', { name: 'Load all' })).toHaveCount(0)

  const before = await drawCalls(page)
  await pan(page, 120, 40)
  await pan(page, -200, -60)
  await pan(page, 60, 90)
  await page.waitForTimeout(500)
  expect(await drawCalls(page)).toBe(before)
  await expect.poll(() => rendered(page)).toBeGreaterThan(0)
})

test('over the tile threshold the engine draws tiles; Load all switches to GeoJSON and back', async ({ page }) => {
  await openFile(page, fixture('parcels-10k.geojson'), '?e2e=1&tileRows=1000')
  await expect.poll(async () => (await drawState(page)).mode).toBe('tiles')
  expect((await drawState(page)).tileUrl).toMatch(/^se-tiles:\/\/.+\/\{z\}\/\{x\}\/\{y\}$/)
  await expect.poll(() => rendered(page)).toBeGreaterThan(0)
  await expect(statusBar(page)).toContainText('Tiles')
  const loadAll = statusBar(page).getByRole('button', { name: 'Load all' })
  await expect(loadAll).toBeVisible()

  // A pan asks the engine for the tiles that come into view.
  const before = await drawCalls(page)
  await pan(page, 300, 200)
  await expect.poll(() => drawCalls(page)).toBeGreaterThan(before)

  await loadAll.click()
  await expect.poll(async () => (await drawState(page)).mode).toBe('geojson')
  expect((await drawState(page)).features).toBe(10_000)
  await expect(statusBar(page)).toContainText('All drawn')
  await statusBar(page).getByRole('button', { name: 'Draw as tiles' }).click()
  await expect.poll(async () => (await drawState(page)).mode).toBe('tiles')
  await expect(statusBar(page).getByRole('button', { name: 'Load all' })).toBeVisible()
})

test('tiles: a clicked feature shows its attributes; a selected row is drawn highlighted', async ({ page }) => {
  await openFile(page, fixture('parcels-10k.geojson'), '?e2e=1&tileRows=1000')
  await expect.poll(async () => (await drawState(page)).mode).toBe('tiles')
  // Bring feature 0 to the map's center (fetched by id: FR-008), then click it.
  await hook(page, 'zoomToFeature', 0)
  await expect.poll(() => hook<number | null>(page, 'outsideFeatureId')).toBe(0)
  await page.waitForTimeout(1200)
  const box = (await canvas(page).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const inspector = page.getByRole('region', { name: 'Feature attributes' })
  await expect(inspector).toBeVisible()
  await expect(inspector).toContainText('parcel_code')
  await expect(page.locator('.attribute-table tbody tr.selected')).toHaveCount(1)
})

test('a query returning 50 rows is drawn as GeoJSON whatever the threshold', async ({ page }) => {
  await openFile(page, fixture('parcels-10k.geojson'), '?e2e=1&tileRows=1000')
  await expect.poll(async () => (await drawState(page)).mode).toBe('tiles')
  await openQueryPanel(page)
  await runQuery(page, 'SELECT * FROM layer LIMIT 50')
  await expect.poll(async () => (await drawState(page)).mode).toBe('geojson')
  expect((await drawState(page)).features).toBe(50)
})

test('tiles: a categorized style asks for tiles with its column; the legend still counts in SQL', async ({ page }) => {
  await openFile(page, fixture('parcels-10k.geojson'), '?e2e=1&tileRows=1000')
  await expect.poll(async () => (await drawState(page)).mode).toBe('tiles')
  await expect.poll(() => rendered(page)).toBeGreaterThan(0)
  const url = (await drawState(page)).tileUrl
  const before = await drawCalls(page)
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await chooseStyleType(page, 'Categorized')
  await page.getByLabel('Column', { exact: true }).selectOption('zone')
  await expect.poll(async () => (await drawState(page)).tileUrl).not.toBe(url)
  await expect.poll(() => drawCalls(page)).toBeGreaterThan(before)
  const legend = page.getByRole('region', { name: 'Legend' })
  await expect.poll(async () => (await legend.locator('li .count').allTextContents()).reduce((a, t) => a + Number(t.replace(/,/g, '')), 0)).toBe(10_000)
})
