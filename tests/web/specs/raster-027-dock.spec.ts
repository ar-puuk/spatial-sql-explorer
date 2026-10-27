// Spec 027: the profile and area statistics live in the bottom panel (a raster has none otherwise). It opens when a shape is
// finished, shows the latest answer of each kind as a tab, can be maximized and restored, and goes when its answers are closed.
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

async function openRaster(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('raster/dem-utm12.tif'))
  await page.locator('.canvas-host[data-raster-ready]').waitFor({ state: 'attached', timeout: 90000 })
}
const mapBox = async (page: Page) => (await page.locator('.canvas-host').boundingBox())!
const mapHeight = async (page: Page): Promise<number> => (await mapBox(page)).height

async function drawProfile(page: Page): Promise<void> {
  await page.locator('.map-view .corner').getByRole('button', { name: 'Profile', exact: true }).click()
  const m = await mapBox(page)
  for (const [x, y] of [[m.x + m.width / 2 - 80, m.y + m.height / 3], [m.x + m.width / 2, m.y + m.height / 3 + 15], [m.x + m.width / 2 + 80, m.y + m.height / 3 + 30]]) {
    await page.mouse.move(x, y)
    await page.mouse.click(x, y)
    await page.waitForTimeout(80)
  }
  await page.keyboard.press('Enter')
}
async function drawArea(page: Page): Promise<void> {
  await page.locator('.map-view .corner').getByRole('button', { name: 'Area statistics', exact: true }).click()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  const m = await mapBox(page)
  const [x0, y0, x1, y1] = [m.x + m.width / 2 - 60, m.y + m.height / 4, m.x + m.width / 2 + 40, m.y + m.height / 2]
  await page.mouse.move(x0, y0)
  await page.mouse.click(x0, y0)
  await page.waitForTimeout(80)
  await page.mouse.move(x1, y1, { steps: 6 })
  await page.waitForTimeout(80)
  await page.mouse.click(x1, y1)
}

test.describe('the bottom panel of a raster (spec 027)', () => {
  test('there is none until a shape is finished; it opens with the answer, and goes with it', async ({ page }) => {
    await openRaster(page)
    await expect(page.getByRole('tab', { name: 'Profile' })).toHaveCount(0)
    const before = await mapHeight(page)
    await drawProfile(page)
    await expect(page.getByRole('tab', { name: 'Profile' })).toBeVisible()
    await expect(page.getByRole('slider', { name: /Position along the profile/ })).toBeVisible()
    expect(await mapHeight(page)).toBeLessThan(before)
    await page.getByRole('button', { name: 'Close the profile' }).click()
    await expect(page.getByRole('tab', { name: 'Profile' })).toHaveCount(0)
    await expect.poll(() => mapHeight(page)).toBeGreaterThanOrEqual(before - 2)
  })

  test('both tools keep their latest answer as tabs, and the tab follows the tool last used', async ({ page }) => {
    await openRaster(page)
    await drawProfile(page)
    await expect(page.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
    await drawArea(page)
    await expect(page.getByRole('tab', { name: 'Statistics' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('table', { name: 'Statistics per band' })).toBeVisible()
    // The profile is still there, a click away.
    await page.getByRole('tab', { name: 'Profile' }).click()
    await expect(page.getByRole('slider', { name: /Position along the profile/ })).toBeVisible()
  })

  test('maximizing gives the panel the whole height, and Restore brings the map back', async ({ page }) => {
    await openRaster(page)
    const before = await mapHeight(page)
    await drawProfile(page)
    await page.getByRole('button', { name: 'Maximize panel' }).click()
    await expect.poll(() => mapHeight(page)).toBeLessThan(5)
    // The way back is in the panel's own tab bar, and visible.
    const restore = page.getByRole('button', { name: 'Restore panel size' })
    await expect(restore).toBeVisible()
    const box = await restore.boundingBox()
    expect(box && box.y >= 0 && box.y < 200, 'the restore button is on screen').toBe(true)
    await restore.click()
    await expect.poll(() => mapHeight(page)).toBeGreaterThan(before * 0.4)
  })

  test('closing the answers of a maximized panel brings the map back', async ({ page }) => {
    await openRaster(page)
    const before = await mapHeight(page)
    await drawProfile(page)
    await page.getByRole('button', { name: 'Maximize panel' }).click()
    await page.getByRole('button', { name: 'Close the profile' }).click()
    await expect.poll(() => mapHeight(page)).toBeGreaterThanOrEqual(before - 2)
  })

  test('the Chart and Table views show the same profile', async ({ page }) => {
    await openRaster(page)
    await drawProfile(page)
    await expect(page.getByRole('slider', { name: /Position along the profile/ })).toBeVisible()
    await page.getByRole('radio', { name: 'Table' }).click()
    await expect(page.getByRole('table', { name: 'Profile values' })).toBeVisible()
    await expect(page.getByRole('slider', { name: /Position along the profile/ })).toHaveCount(0)
    await page.getByRole('radio', { name: 'Chart' }).click()
    await expect(page.getByRole('slider', { name: /Position along the profile/ })).toBeVisible()
  })
})
