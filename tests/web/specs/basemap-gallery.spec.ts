// Spec 010 T043: "More basemaps…", the searchable gallery modal, with API keys.
// Network-independent: every request outside the app is stubbed or refused.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.resolve(__dirname, '../../vscode-ext/fixtures/world-boundaries.geojson')
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const STUB_STYLE = { version: 8, sources: {}, layers: [{ id: 'stub-bg', type: 'background', paint: { 'background-color': '#dddddd' } }] }

/** Styles answer with a stub, everything else with a pixel; nothing reaches a real server. */
async function offline(page: Page): Promise<void> {
  await page.route(/^https:\/\/(?!localhost)/, (route) => {
    // Tile URLs often have no extension (Esri: .../tile/{z}/{y}/{x}): everything but a style is a tile.
    if (/style|\.json(\?|$)/.test(route.request().url())) return route.fulfill({ json: STUB_STYLE })
    return route.fulfill({ body: PNG_1PX, contentType: 'image/png' })
  })
}

async function openGallery(page: Page): Promise<void> {
  await offline(page)
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await page.getByRole('button', { name: 'More basemaps…' }).click()
  await expect(gallery(page)).toBeVisible()
}

const gallery = (page: Page) => page.getByRole('dialog', { name: 'Basemaps' })
// Rows are options in one listbox per provider section.
const rows = (page: Page) => gallery(page).locator('[role="option"]')

/** Types a search and waits for the debounced list to match it. */
async function searchFor(page: Page, text: string, expected: RegExp): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search basemaps' }).fill(text)
  await expect.poll(async () => {
    const texts = await rows(page).allInnerTexts()
    return texts.length > 0 && texts.every((t) => expected.test(t))
  }).toBe(true)
}

/** The basemap sources in the map's style (everything not `se-`). */
function basemapSources(page: Page): Promise<Array<{ type: string; url?: string; tiles?: string[] }>> {
  return page.locator('.canvas-host').evaluate((el) => {
    const style = (el as unknown as { seMap: { getStyle(): { sources: Record<string, { type: string; url?: string; tiles?: string[] }> } } }).seMap.getStyle()
    return Object.entries(style.sources)
      .filter(([id]) => !id.startsWith('se-'))
      .map(([, s]) => ({ type: s.type, url: s.url, tiles: s.tiles }))
  })
}

test('search, category and the keyless filter narrow the list', async ({ page }) => {
  await openGallery(page)
  await expect(gallery(page)).toContainText(/\d+ basemaps/)
  await searchFor(page, 'imagery', /imagery/i)
  expect(await rows(page).count()).toBeGreaterThan(3)

  await searchFor(page, 'maptiler', /MapTiler/)
  await expect(rows(page).first()).toContainText('Needs key')
  await page.getByRole('checkbox', { name: 'No API key needed' }).check()
  await expect(rows(page)).toHaveCount(0)
  await expect(gallery(page)).toContainText('No basemap matches.')
})

test('a click applies a basemap and keeps the modal open; exactly one basemap is in the style', async ({ page }) => {
  await openGallery(page)
  await searchFor(page, 'esri topographic', /World Topographic/)
  await rows(page).filter({ hasText: 'World Topographic' }).click()
  await expect.poll(async () => (await basemapSources(page)).map((s) => s.tiles?.[0] ?? '')).toEqual([expect.stringContaining('World_Topo_Map')])
  await expect(gallery(page)).toBeVisible()
  await expect(rows(page).filter({ hasText: 'World Topographic' })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(async () => Number((await page.locator('.canvas-host').getAttribute('data-rendered-features')) ?? 0)).toBeGreaterThan(0)

  // Enter applies and closes; focus returns to "More basemaps…".
  // Two rows (sorted: NatGeo World Map, World Street Map): the arrow keys move to the second.
  await searchFor(page, 'esri street', /NatGeo World Map|World Street Map/)
  await expect(rows(page)).toHaveText([/NatGeo World Map/, /World Street Map/])
  await rows(page).first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(rows(page).nth(1)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(gallery(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'More basemaps…' })).toBeFocused()
  await expect.poll(async () => (await basemapSources(page)).map((s) => s.tiles?.[0] ?? '')).toEqual([expect.stringContaining('World_Street_Map')])
  // The picker shows the gallery choice as the checked entry.
  await expect(page.getByRole('radio', { checked: true })).toContainText('World Street Map')
})

test('a keyed basemap asks for a key, then uses it in its URL', async ({ page }) => {
  await openGallery(page)
  const keys: string[] = []
  await page.route('https://api.maptiler.com/**', (route) => {
    keys.push(new URL(route.request().url()).searchParams.get('key') ?? '')
    return route.fulfill({ json: STUB_STYLE })
  })
  await searchFor(page, 'maptiler streets', /MapTiler Streets/)
  await rows(page).first().click()
  const keyBox = page.getByLabel('MapTiler API key')
  await expect(keyBox).toBeFocused()
  await expect(gallery(page)).toContainText('MapTiler needs an API key. Keys stay in this browser.')
  await expect(gallery(page).getByRole('link', { name: 'Get a key' })).toHaveAttribute('href', 'https://cloud.maptiler.com/account/keys/')
  await keyBox.fill('fake-key-123')
  await gallery(page).getByRole('button', { name: 'Save and use' }).click()
  await expect.poll(() => keys).toContain('fake-key-123')
  await expect.poll(async () => (await basemapSources(page)).length).toBe(0) // the stub style has no sources
  await expect(page.getByLabel('MapTiler API key')).toHaveCount(0)

  // The key is listed and can be removed.
  await gallery(page).getByRole('button', { name: 'API keys…' }).click()
  await expect(gallery(page).getByRole('region', { name: 'Stored API keys' })).toContainText('MapTiler')
  await gallery(page).getByRole('button', { name: 'Remove the MapTiler API key' }).click()
  await expect(gallery(page).getByRole('region', { name: 'Stored API keys' })).toContainText('No API keys stored.')
})

test('Escape closes and focus returns to More basemaps…; no axe violations', async ({ page }) => {
  await openGallery(page)
  const results = await new AxeBuilder({ page }).include('[role="dialog"][aria-modal="true"]').analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(gallery(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'More basemaps…' })).toBeFocused()
})

test('sections by provider, collapsible; a type filter; featured basemaps are listed too', async ({ page }) => {
  await openGallery(page)
  const section = (name: string) => gallery(page).getByRole('region', { name, exact: true })
  await expect(section('OpenFreeMap').getByRole('option')).toHaveCount(5)
  await expect(section('OpenFreeMap').getByRole('option').first()).toContainText('Featured')
  await expect(section('CARTO (vector)').getByRole('option')).toHaveCount(6)
  const head = section('CARTO (vector)').getByRole('button', { name: /CARTO \(vector\)/ })
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'false')
  await expect(section('CARTO (vector)').getByRole('option')).toHaveCount(0)
  await head.click()
  await gallery(page).getByRole('combobox', { name: 'Type' }).selectOption('raster')
  await expect(section('CARTO (vector)')).toHaveCount(0)
  for (const text of await rows(page).allInnerTexts()) expect(text).toContain('Raster')
})

test('choosing a featured basemap in the gallery chooses its featured row', async ({ page }) => {
  await openGallery(page)
  await gallery(page).getByRole('region', { name: 'OpenFreeMap', exact: true }).getByRole('option', { name: /Fiord/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('radio', { checked: true })).toContainText('Fiord')
})

test('Amazon asks for a key and an AWS region, and puts both in the style URL', async ({ page }) => {
  await openGallery(page)
  const urls: string[] = []
  await page.route('https://*.amazonaws.com/**', (route) => {
    urls.push(route.request().url())
    return route.fulfill({ json: STUB_STYLE })
  })
  await searchFor(page, 'amazon standard', /Amazon Standard/)
  await rows(page).first().click()
  await page.getByLabel('Amazon Location API key').fill('ak-1')
  await page.getByLabel('AWS region').fill('eu-west-1')
  await gallery(page).getByRole('button', { name: 'Save and use' }).click()
  await expect.poll(() => urls).toContainEqual('https://maps.geo.eu-west-1.amazonaws.com/v2/styles/Standard/descriptor?key=ak-1')
})
