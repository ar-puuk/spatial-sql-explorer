// Spec 027: choosing a place of a profile: from the table (a row), or with "Go to highest" and "Go to lowest". The place is
// marked on the chart, the table and the map.
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

const e2e = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => unknown> }).__spatialExplorerE2E[n]() as T, name)

async function openWithProfile(page: Page): Promise<Array<number | null>> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('raster/dem-utm12.tif'))
  await page.locator('.canvas-host[data-raster-ready]').waitFor({ state: 'attached', timeout: 90000 })
  await page.locator('.map-view .corner').getByRole('button', { name: 'Profile', exact: true }).click()
  const m = (await page.locator('.canvas-host').boundingBox())!
  for (const [x, y] of [[m.x + m.width / 2 - 120, m.y + m.height * 0.75], [m.x + m.width / 2, m.y + m.height * 0.5], [m.x + m.width / 2 + 120, m.y + m.height * 0.25]]) {
    await page.mouse.move(x, y)
    await page.mouse.click(x, y)
    await page.waitForTimeout(80)
  }
  await page.keyboard.press('Enter')
  await page.getByRole('slider', { name: /Position along the profile/ }).waitFor()
  await expect.poll(async () => (await e2e<{ status: string } | null>(page, 'rasterProbe'))?.status).toBe('done')
  return (await e2e<{ profile: { bands: Array<{ values: Array<number | null> }> } }>(page, 'rasterProbe')).profile.bands[0].values
}

const argMax = (v: Array<number | null>): number => v.reduce<number>((best, x, i) => (x !== null && (best < 0 || x > (v[best] as number)) ? i : best), -1)
const argMin = (v: Array<number | null>): number => v.reduce<number>((best, x, i) => (x !== null && (best < 0 || x < (v[best] as number)) ? i : best), -1)

test.describe('choosing a place of a profile', () => {
  test('a row of the table marks its place on the chart and the map', async ({ page }) => {
    await openWithProfile(page)
    await page.getByRole('radio', { name: 'Table' }).click()
    await page.getByRole('button', { name: 'Mark place 6 on the map' }).click()
    await expect(page.locator('tr.selected')).toHaveCount(1)
    await expect(page.locator('tr.selected')).toHaveAttribute('data-row', '5')
    await expect(page.locator('.probe-pin')).toHaveCount(1)
    // The same place is the chart's.
    await page.getByRole('radio', { name: 'Chart' }).click()
    await expect(page.getByRole('slider', { name: /Position along the profile/ })).toHaveAttribute('aria-valuenow', '5')
  })

  test('clicking the row itself works too', async ({ page }) => {
    await openWithProfile(page)
    await page.getByRole('radio', { name: 'Table' }).click()
    await page.locator('tr[data-row="3"] td.num').first().click()
    await expect(page.locator('tr.selected')).toHaveAttribute('data-row', '3')
  })

  test('Go to highest and Go to lowest choose those places, and the table says which they are', async ({ page }) => {
    const values = await openWithProfile(page)
    await page.getByRole('button', { name: 'Go to highest' }).click()
    const slider = page.getByRole('slider', { name: /Position along the profile/ })
    await expect(slider).toHaveAttribute('aria-valuenow', String(argMax(values)))
    await page.getByRole('button', { name: 'Go to lowest' }).click()
    await expect(slider).toHaveAttribute('aria-valuenow', String(argMin(values)))
    await expect(page.locator('.probe-pin')).toHaveCount(1)
    await page.getByRole('radio', { name: 'Table' }).click()
    await expect(page.locator('tr.selected')).toHaveAttribute('data-row', String(argMin(values)))
    await expect(page.locator('tr[data-row="' + argMax(values) + '"] .tag')).toHaveText('highest')
    await expect(page.locator('tr[data-row="' + argMin(values) + '"] .tag')).toHaveText('lowest')
  })

  test('the place stays when the pointer leaves the chart', async ({ page }) => {
    const values = await openWithProfile(page)
    await page.getByRole('button', { name: 'Go to highest' }).click()
    await page.mouse.move(5, 5)
    await expect(page.getByRole('slider', { name: /Position along the profile/ })).toHaveAttribute('aria-valuenow', String(argMax(values)))
    await expect(page.getByRole('status').filter({ hasText: /: / })).toBeVisible()
  })

  test('the table with a selected row has no accessibility violations', async ({ page }) => {
    await openWithProfile(page)
    await page.getByRole('radio', { name: 'Table' }).click()
    await page.getByRole('button', { name: 'Mark place 4 on the map' }).click()
    const results = await new AxeBuilder({ page }).include('[aria-label="Profile along the line"]').analyze()
    expect(results.violations).toEqual([])
  })
})
