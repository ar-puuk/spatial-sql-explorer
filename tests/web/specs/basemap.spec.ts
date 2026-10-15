// User Story 4 (FR-009, FR-016) in the real browser build, network-independent:
// basemap requests are either answered with a stub style or blocked.
// - The default follows the appearance (Positron / Dark, marked "Theme default").
// - Blank keeps the data drawn; its color matches the theme unless the user
//   picks one, and a picked color is remembered across reloads.
// - Blocked basemap requests degrade to blank + a short message; data unaffected.
import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { setColor } from './helpers'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.resolve(__dirname, '../../vscode-ext/fixtures/world-boundaries.geojson')
const STUB_STYLE = { version: 8, sources: {}, layers: [{ id: 'stub-bg', type: 'background', paint: { 'background-color': '#dddddd' } }] }

async function stubBasemap(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ json: STUB_STYLE }))
}

async function open(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
}

async function renderedFeatures(page: Page): Promise<number> {
  return Number((await page.locator('.canvas-host').getAttribute('data-rendered-features')) ?? 0)
}

for (const [scheme, name] of [
  ['light', 'Positron'],
  ['dark', 'Dark'],
] as const) {
  test(`the default basemap matches the ${scheme} appearance (${name})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await stubBasemap(page)
    await open(page)
    await page.getByRole('button', { name: 'Basemap', exact: true }).click()
    const checked = page.getByRole('radio', { checked: true })
    await expect(checked).toHaveCount(1)
    await expect(checked).toContainText(name)
    await expect(checked).toContainText('Theme default')
    // No separate "Match theme" entry (user decision).
    await expect(page.getByRole('radio', { name: /Match theme/ })).toHaveCount(0)
  })
}

test('Blank keeps the data drawn, and a custom blank color is remembered', async ({ page }) => {
  await stubBasemap(page)
  await open(page)
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await page.getByRole('radio', { name: /Blank/ }).click()
  await expect(page.getByRole('radio', { name: /Blank/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: /Blank/ })).toContainText('Theme color')
  await expect.poll(() => renderedFeatures(page)).toBeGreaterThan(0)

  await setColor(page, 'Choose blank background color', '#123456')
  await expect(page.locator('.map-view')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await expect(page.getByRole('radio', { name: /Blank/ })).toContainText('#123456')

  // Remembered across sessions: reload, reopen, the blank color is still set.
  // (Spec 010: the side panel is remembered too, so it may be open already.)
  await page.reload()
  await open(page)
  if (!(await page.getByRole('region', { name: 'Basemap' }).isVisible())) await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await expect(page.getByRole('radio', { name: /Blank/ })).toContainText('#123456')

  // And "Match theme color" clears it.
  await page.getByRole('button', { name: 'Match theme color' }).click()
  await expect(page.getByRole('radio', { name: /Blank/ })).toContainText('Theme color')
})

test('a blocked basemap degrades to blank with a short message; data unaffected (FR-016)', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort('blockedbyclient'))
  await open(page)
  const notice = page.locator('.map-notice')
  await expect(notice).toContainText('basemap unavailable', { timeout: 15000 })
  await expect(notice).toContainText('Showing a blank background')
  await expect(page.getByRole('button', { name: 'Basemap', exact: true })).toHaveAttribute('aria-description', 'Basemap: Blank')
  await expect.poll(() => renderedFeatures(page)).toBeGreaterThan(0)
  await expect(page.locator('.drawer-header .count')).toHaveText('180 rows · 179 mapped')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

// Spec 010 T040 (research.md S3, approach a): one basemap at a time, swapped without touching our data.
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function stubEveryBasemap(page: Page): Promise<void> {
  // Each vector style is told apart by its layer id.
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop()
    return route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: `stub-${name}-bg`, type: 'background', paint: { 'background-color': '#dddddd' } }] } })
  })
  for (const host of ['https://server.arcgisonline.com/**', 'https://*.tile.opentopomap.org/**', 'https://tile.openstreetmap.org/**']) {
    await page.route(host, (route) => route.fulfill({ body: PNG_1PX, contentType: 'image/png' }))
  }
}

/** What the map's style holds besides our own (`se-`) layers and sources. */
function basemapInStyle(page: Page): Promise<{ layers: string[]; sources: Array<{ id: string; type: string; tiles?: string[] }> }> {
  return page.locator('.canvas-host').evaluate((el) => {
    const style = (el as unknown as { seMap: { getStyle(): { layers: Array<{ id: string }>; sources: Record<string, { type: string; tiles?: string[] }> } } }).seMap.getStyle()
    return {
      layers: style.layers.filter((l) => !l.id.startsWith('se-')).map((l) => l.id),
      sources: Object.entries(style.sources)
        .filter(([id]) => !id.startsWith('se-'))
        .map(([id, s]) => ({ id, type: s.type, tiles: s.tiles })),
    }
  })
}

async function choose(page: Page, name: string): Promise<void> {
  await page.getByRole('radio', { name: new RegExp(`^${name}`) }).click()
}

async function openWith(page: Page, search: string): Promise<void> {
  await page.goto('/' + search)
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
}

test('quick switches leave exactly the last basemap in the style, under the data', async ({ page }) => {
  await stubEveryBasemap(page)
  await openWith(page, '?e2e=1')
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  for (const name of ['Positron', 'Satellite', 'OpenStreetMap', 'Dark', 'Blank', 'Topographic']) await choose(page, name)
  await expect.poll(async () => (await basemapInStyle(page)).sources.map((s) => s.tiles?.[0] ?? '').join()).toContain('opentopomap')
  const base = await basemapInStyle(page)
  expect(base.layers).toEqual(['basemap-raster'])
  expect(base.sources).toHaveLength(1)
  expect(base.sources[0].type).toBe('raster')
  // The basemap is under every one of our layers.
  const order = await page.locator('.canvas-host').evaluate((el) => (el as unknown as { seMap: { getStyle(): { layers: Array<{ id: string }> } } }).seMap.getStyle().layers.map((l) => l.id))
  expect(order[0]).toBe('basemap-raster')
  await expect.poll(() => renderedFeatures(page)).toBeGreaterThan(0)
})

test('GeoJSON mode: no basemap swap loads the data again, and the data stays drawn', async ({ page }) => {
  await stubEveryBasemap(page)
  await openWith(page, '?e2e=1')
  const loads = async () => Number((await page.locator('.canvas-host').getAttribute('data-source-loads')) ?? 0)
  await expect.poll(loads).toBeGreaterThan(0)
  const before = await loads()
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  for (const [name, layer] of [['Satellite', 'basemap-raster'], ['OpenStreetMap', 'basemap-raster'], ['Dark', 'stub-dark-bg'], ['Blank', 'basemap-blank'], ['Positron', 'stub-positron-bg']] as const) {
    await choose(page, name)
    await expect.poll(async () => (await basemapInStyle(page)).layers).toEqual([layer])
    await expect.poll(() => renderedFeatures(page)).toBeGreaterThan(0)
  }
  expect(await loads()).toBe(before)
})

test('tiles mode: no basemap swap asks the engine for a tile again', async ({ page }) => {
  await stubEveryBasemap(page)
  await openWith(page, '?e2e=1&tileRows=100')
  const hook = <T>(name: string): Promise<T> => page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => T> }).__spatialExplorerE2E[n](), name)
  await expect.poll(async () => (await hook<{ mode: string }>('drawState')).mode).toBe('tiles')
  // Let the first tiles settle.
  await expect.poll(async () => (await hook<{ calls: number }>('tileStats')).calls).toBeGreaterThan(0)
  await page.waitForTimeout(1000)
  const draws = await hook<number>('drawCalls')
  const tiles = await hook<{ calls: number; cacheHits: number }>('tileStats')
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  for (const [name, layer] of [['Satellite', 'basemap-raster'], ['Topographic', 'basemap-raster'], ['Dark', 'stub-dark-bg'], ['Blank', 'basemap-blank']] as const) {
    await choose(page, name)
    await expect.poll(async () => (await basemapInStyle(page)).layers).toEqual([layer])
    await expect.poll(() => renderedFeatures(page)).toBeGreaterThan(0)
  }
  expect(await hook<number>('drawCalls')).toBe(draws)
  // MapLibre doesn't even ask again: no engine call, no cache hit.
  expect(await hook<{ calls: number; cacheHits: number }>('tileStats')).toEqual(tiles)
})
