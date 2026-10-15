// Spec 012: the Basemap side panel. Real previews (bundled thumbnails for
// vector styles, one live tile of the same place for raster rows), "Follow the
// theme", a search with results in the panel, the featured grid by keyboard,
// and the gallery centered over the map's column. Network-independent.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture } from './helpers'

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const STUB_STYLE = { version: 8, sources: {}, layers: [{ id: 'stub-bg', type: 'background', paint: { 'background-color': '#dddddd' } }] }

/** Styles answer with a stub, tiles with a pixel; the tile URLs asked for are kept. */
async function open(page: Page): Promise<string[]> {
  const tiles: string[] = []
  await page.route(/^https:\/\/(?!localhost)/, (route) => {
    const url = route.request().url()
    if (/style|\.json(\?|$)/.test(url)) return route.fulfill({ json: STUB_STYLE })
    tiles.push(url)
    return route.fulfill({ body: PNG_1PX, contentType: 'image/png' })
  })
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await expect(panel(page)).toBeVisible()
  return tiles
}

const panel = (page: Page) => page.getByRole('region', { name: 'Basemap', exact: true })
const card = (page: Page, name: string) => panel(page).getByRole('radio', { name: new RegExp(`^${name}`) })
const search = (page: Page) => panel(page).getByRole('searchbox', { name: 'Find a basemap' })

test('featured cards show real previews: bundled thumbnails, and live tiles of the same place', async ({ page }) => {
  const tiles = await open(page)
  // A vector style: its bundled thumbnail (a data URI), no request.
  await expect(card(page, 'Liberty').locator('img')).toHaveAttribute('src', /^data:image\/webp;base64,/)
  await expect.poll(() => card(page, 'Liberty').locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(100)
  // Raster rows: one tile of the preview place (Zurich, z12).
  await expect(card(page, 'OpenStreetMap').locator('img')).toHaveAttribute('src', 'https://tile.openstreetmap.org/12/2145/1434.png')
  await expect.poll(() => tiles.some((t) => t.includes('/World_Imagery/MapServer/tile/12/1434/2145'))).toBe(true)
  // Blank: its color, no image.
  await expect(card(page, 'Blank').locator('img')).toHaveCount(0)
  // The current basemap, by name and provider.
  await expect(panel(page).locator('.current')).toContainText('Positron')
  await expect(panel(page).locator('.current')).toContainText('OpenFreeMap · Vector')
})

test('Follow the theme: picking a basemap turns it off, checking it goes back to the theme default', async ({ page }) => {
  await open(page)
  const follow = panel(page).getByRole('checkbox', { name: /Follow the theme/ })
  await expect(follow).toBeChecked()
  await card(page, 'Bright').click()
  await expect(follow).not.toBeChecked()
  await expect(card(page, 'Bright')).toHaveAttribute('aria-checked', 'true')
  await follow.check()
  await expect(card(page, 'Positron')).toHaveAttribute('aria-checked', 'true')
  await expect(card(page, 'Positron')).toContainText('Theme default')
  // Unchecking keeps the basemap shown, no longer following.
  await follow.uncheck()
  await expect(card(page, 'Positron')).toHaveAttribute('aria-checked', 'true')
  await expect(card(page, 'Positron')).not.toContainText('Theme default')
})

test('the featured grid by keyboard: arrows move across and down, choosing as they go', async ({ page }) => {
  await open(page)
  await card(page, 'Positron').focus()
  await page.keyboard.press('ArrowRight')
  await expect(card(page, 'Liberty')).toBeFocused()
  await expect(card(page, 'Liberty')).toHaveAttribute('aria-checked', 'true')
  // Three columns (Blank, Positron, Liberty / Bright, Dark, Fiord): down from Liberty is Fiord.
  await page.keyboard.press('ArrowDown')
  await expect(card(page, 'Fiord')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(card(page, 'Blank')).toHaveAttribute('aria-checked', 'true')
})

test('search: results in the panel with previews; Enter takes the first; a keyed one asks for its key in the gallery', async ({ page }) => {
  await open(page)
  await search(page).fill('voyager')
  const results = panel(page).getByRole('group', { name: 'Search results' }).getByRole('button')
  await expect(results.first()).toContainText('Voyager')
  await expect(results.filter({ hasText: 'CARTO (vector)' }).first().locator('img')).toHaveAttribute('src', /^data:image\/webp/)
  await search(page).press('Enter')
  await expect(panel(page).locator('.current')).toContainText('Voyager')

  // Escape clears the search (and the grid is back); the panel stays.
  await search(page).fill('dark')
  await expect(results.first()).toBeVisible()
  await search(page).press('Escape')
  await expect(search(page)).toHaveValue('')
  await expect(card(page, 'Dark')).toBeVisible()

  // A basemap that needs a key: its result says so, and choosing it opens the gallery's key form.
  await search(page).fill('maptiler toner')
  const keyed = results.filter({ hasText: 'Toner' }).first()
  await expect(keyed).toContainText('Needs key')
  await keyed.click()
  const gallery = page.getByRole('dialog', { name: 'Basemaps' })
  await expect(gallery).toBeVisible()
  await expect(gallery.getByLabel('MapTiler API key')).toBeVisible()
  await expect(gallery.getByRole('searchbox', { name: 'Search basemaps' })).toHaveValue('maptiler toner')
})

test('the gallery centers over the map, not the whole window; a narrow window centers it on the window', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 860 })
  await open(page)
  await panel(page).getByRole('button', { name: 'More basemaps…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Basemaps' })
  await expect(dialog).toBeVisible()
  const center = async () => {
    const d = (await dialog.boundingBox())!
    return d.x + d.width / 2
  }
  const column = (await page.locator('.main').boundingBox())!
  await expect.poll(async () => Math.abs((await center()) - (column.x + column.width / 2))).toBeLessThan(2)
  // The side panel stays clear of it.
  const side = (await panel(page).boundingBox())!
  expect((await dialog.boundingBox())!.x + (await dialog.boundingBox())!.width).toBeLessThanOrEqual(side.x)

  await page.setViewportSize({ width: 820, height: 700 })
  await expect.poll(async () => Math.abs((await center()) - 410)).toBeLessThan(2)
})

test('the panel has no axe violations, with results shown too', async ({ page }) => {
  await open(page)
  const scan = () => new AxeBuilder({ page }).include('[aria-label="Basemap"]').analyze()
  expect((await scan()).violations).toEqual([])
  await search(page).fill('carto')
  await expect(panel(page).getByRole('group', { name: 'Search results' })).toBeVisible()
  expect((await scan()).violations).toEqual([])
})

test('opening the panel (the thumbnails load) and typing a search stay responsive at 6x CPU', async ({ page }) => {
  test.setTimeout(120000)
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] }
    w.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(Math.round(e.duration))
    }).observe({ type: 'longtask', buffered: true })
  })
  await page.route(/^https:\/\/(?!localhost)/, (route) =>
    /style|\.json(\?|$)/.test(route.request().url()) ? route.fulfill({ json: STUB_STYLE }) : route.fulfill({ body: PNG_1PX, contentType: 'image/png' })
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await page.evaluate(() => delete document.documentElement.dataset.seTestHooks)
  await page.waitForTimeout(1000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks = []))
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await expect(card(page, 'Liberty').locator('img')).toHaveAttribute('src', /^data:image\/webp/, { timeout: 20000 })
  await search(page).pressSequentially('carto dark', { delay: 80 })
  await expect(panel(page).getByRole('group', { name: 'Search results' }).getByRole('button').first()).toBeVisible()
  await page.waitForTimeout(1000)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const long = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks)
  console.log('basemap panel long tasks at 6x:', JSON.stringify(long))
  expect(Math.max(0, ...long)).toBeLessThanOrEqual(100)
})
