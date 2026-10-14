// Spec 010 phase 10: one search box for layer values, coordinates and places.
// Places are covered by place-search.spec.ts (Nominatim mocked there).
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile } from './helpers'

type MapState = { center?: [number, number]; zoom?: number }
const mapState = (page: Page) => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState(): MapState } }).__spatialExplorerE2E.mapState())
const box = (page: Page) => page.getByRole('combobox', { name: 'Search' })
const group = (page: Page, name: string | RegExp) => page.getByRole('group', { name })

for (const mode of ['GeoJSON', 'tiles'] as const) {
  test(`a layer value is found, and choosing it selects the row, shows its attributes and zooms (${mode})`, async ({ page }) => {
    await page.route('https://nominatim.openstreetmap.org/**', (r) => r.abort())
    await openFile(page, fixture('world-boundaries.geojson'), mode === 'tiles' ? '?e2e=1&tileRows=10' : '?e2e=1')
    const before = (await mapState(page)).zoom ?? 0

    await box(page).pressSequentially('Nam', { delay: 30 })
    const values = group(page, 'In world-boundaries.geojson')
    // An exact match ranks first: the id NAM (Namibia's row), then names containing it.
    await expect(values.getByRole('option').first()).toContainText(/NAM\s*id/)
    await expect(values.getByRole('option').filter({ hasText: 'Namibia' })).toContainText('name')
    // The first option is active: Enter chooses it.
    await expect(box(page)).toHaveAttribute('aria-expanded', 'true')
    await box(page).press('Enter')

    await expect(box(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('region', { name: 'Feature attributes' })).toContainText('Namibia')
    await expect.poll(async () => (await mapState(page)).zoom ?? 0, { timeout: 10000 }).toBeGreaterThan(before + 1)
    const c = (await mapState(page)).center!
    expect(c[0]).toBeGreaterThan(11)
    expect(c[0]).toBeLessThan(26)
    expect(c[1]).toBeGreaterThan(-29)
    expect(c[1]).toBeLessThan(-16)
  })
}

test('one hit per value with its count; arrows move across groups; Escape clears and closes', async ({ page }) => {
  await openFile(page, fixture('roads-traffic.geojson'))
  await box(page).fill('arterial')
  const values = group(page, 'In roads-traffic.geojson')
  // One option per value, with how many features have it (counted in the fixture).
  await expect(values.getByRole('option')).toHaveCount(2)
  await expect(values.getByRole('option').nth(0)).toContainText(/Minor Arterial\s*functional_class\s·\s541/)
  await expect(values.getByRole('option').nth(1)).toContainText(/Principal Arterial\s*functional_class\s·\s569/)

  const options = page.getByRole('listbox', { name: 'Search results' }).getByRole('option')
  const n = await options.count()
  expect(n).toBeGreaterThan(1)
  await box(page).press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(box(page)).toHaveAttribute('aria-activedescendant', (await options.nth(1).getAttribute('id'))!)
  await box(page).press('ArrowUp')
  await box(page).press('ArrowUp')
  await expect(options.nth(n - 1)).toHaveAttribute('aria-selected', 'true')

  await box(page).press('Escape')
  await expect(box(page)).toHaveValue('')
  await expect(page.getByRole('listbox', { name: 'Search results' })).toBeHidden()
})

test('coordinates offer Go to, which moves the map there', async ({ page }) => {
  await page.route('https://nominatim.openstreetmap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await box(page).fill('-111.9, 40.7')
  const coords = group(page, 'Coordinates')
  await expect(coords.getByRole('option')).toHaveCount(1)
  await expect(coords.getByRole('option')).toContainText('Go to -111.9, 40.7')
  await coords.getByRole('option').click()
  await expect.poll(async () => (await mapState(page)).zoom ?? 0, { timeout: 10000 }).toBeGreaterThan(10)
  const c = (await mapState(page)).center!
  expect(Math.abs(c[0] - -111.9)).toBeLessThan(0.01)
  expect(Math.abs(c[1] - 40.7)).toBeLessThan(0.01)

  // A pasted lat, lon pair is read the only way it fits.
  await box(page).fill('40.7, -111.9')
  await expect(group(page, 'Coordinates').getByRole('option')).toContainText('Go to -111.9, 40.7')
})

test('no layer value matches: only the place search is offered, and typing sends nothing', async ({ page }) => {
  const requests: string[] = []
  await page.route('https://nominatim.openstreetmap.org/**', (r) => {
    requests.push(r.request().url())
    return r.abort()
  })
  await openFile(page, fixture('world-boundaries.geojson'))
  await box(page).pressSequentially('zzqx', { delay: 30 })
  // Places stay one option away (spec 008 FR-033).
  await expect(group(page, 'Places').getByRole('option')).toContainText('Search places for “zzqx”')
  await expect(group(page, /^In /)).toHaveCount(0)
  await page.waitForTimeout(400)
  expect(requests).toHaveLength(0)
})
