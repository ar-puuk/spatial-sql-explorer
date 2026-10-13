// T087 (spec 008 US8, FR-033): place search with Nominatim (stubbed): the
// notice before the first search, searches only on Enter, results that move
// the map, and nothing but the typed text sent.
import { test, expect, type Page, type Request } from '@playwright/test'
import { fixture, openFile } from './helpers'

type MapState = { center?: [number, number]; zoom?: number }
const mapState = (page: Page) => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState(): MapState } }).__spatialExplorerE2E.mapState())
const SALT_LAKE = [
  { display_name: 'Salt Lake City, Salt Lake County, Utah, United States', boundingbox: ['40.6999', '40.8530', '-112.1013', '-111.7398'], lat: '40.76', lon: '-111.89' },
  { display_name: 'Salt Lake County, Utah, United States', boundingbox: ['40.4', '40.9', '-112.3', '-111.5'], lat: '40.6', lon: '-111.9' },
]

async function setup(page: Page, reply: (q: string) => unknown[] | 'offline'): Promise<Request[]> {
  const requests: Request[] = []
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    requests.push(route.request())
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    const r = reply(q)
    if (r === 'offline') return route.abort('internetdisconnected')
    return route.fulfill({ json: r, headers: { 'access-control-allow-origin': '*' } })
  })
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  return requests
}
const box = (page: Page) => page.getByRole('combobox', { name: 'Search' })

test('the notice comes first and only once; Enter searches; a result moves the map; only the text is sent', async ({ page }) => {
  test.setTimeout(120000)
  const requests = await setup(page, (q) => (/salt lake/i.test(q) ? SALT_LAKE : []))
  // Spec 010: the search box is always on the map (no button to open it).
  await expect(page.getByRole('search')).toBeVisible()
  await box(page).click()
  // Typing sends nothing.
  await box(page).pressSequentially('Salt Lake City', { delay: 20 })
  await page.waitForTimeout(500)
  expect(requests).toHaveLength(0)

  // First search: the privacy notice, then the search.
  await box(page).press('Enter')
  const notice = page.getByRole('dialog', { name: 'Place search' })
  await expect(notice).toContainText('sends only the text you type')
  expect(requests).toHaveLength(0)
  await notice.getByRole('button', { name: 'Search' }).click()
  const places = page.getByRole('group', { name: 'Places' })
  await expect(places.getByRole('option')).toHaveCount(2)
  expect(requests).toHaveLength(1)

  // Exactly the typed text, a format and a limit; no cookies, no view, no file.
  const url = new URL(requests[0].url())
  expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search')
  expect([...url.searchParams.keys()].sort()).toEqual(['format', 'limit', 'q'])
  expect(url.searchParams.get('q')).toBe('Salt Lake City')
  expect(requests[0].headers()['cookie']).toBeUndefined()

  // Arrows + Enter pick; the map fits the place.
  await box(page).press('ArrowDown')
  await box(page).press('ArrowUp')
  await box(page).press('Enter')
  await expect.poll(async () => (await mapState(page)).zoom ?? 0, { timeout: 10000 }).toBeGreaterThan(8)
  const c = (await mapState(page)).center!
  expect(Math.abs(c[0] - -111.92)).toBeLessThan(0.3)
  expect(Math.abs(c[1] - 40.78)).toBeLessThan(0.3)
  await expect(page.locator('.search-box')).toContainText('Search © OpenStreetMap contributors (Nominatim)')

  // The notice is remembered: after a reload, a new search shows no notice.
  await page.reload()
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await box(page).fill('Salt Lake')
  await box(page).press('Enter')
  await expect(page.getByRole('group', { name: 'Places' }).getByRole('option')).toHaveCount(2)
  await expect(page.getByRole('dialog', { name: 'Place search' })).toHaveCount(0)
})

test('no places found, and the service unreachable', async ({ page }) => {
  let offline = false
  await setup(page, () => (offline ? 'offline' : []))
  await box(page).fill('Nowhere at all')
  await box(page).press('Enter')
  await page.getByRole('dialog', { name: 'Place search' }).getByRole('button', { name: 'Search' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'No places found for “Nowhere at all”.' })).toBeVisible()
  offline = true
  await box(page).fill('Anywhere')
  await box(page).press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: "Can't reach the place search service" })).toBeVisible()
  // Escape clears the message; the search box stays on the map.
  await box(page).press('Escape')
  await expect(page.getByRole('alert').filter({ hasText: "Can't reach the place search service" })).toHaveCount(0)
  await expect(page.getByRole('search')).toBeVisible()
})
