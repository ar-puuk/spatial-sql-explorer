// T063 (spec 008 US5, FR-022, SC-005): the web theme control.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile } from './helpers'

const themeButton = (page: Page) => page.getByRole('button', { name: /^Theme: / })
const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
const basemapName = (page: Page) => page.getByRole('button', { name: 'Basemap' }).getAttribute('title')

test('System follows the OS live; Light and Dark override it and are remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await openFile(page, fixture('sample.geojson'))
  await expect(themeButton(page)).toHaveAccessibleName('Theme: System')
  const light = await bg(page)
  await expect.poll(() => basemapName(page)).toBe('Basemap: Positron')

  // System: the OS switch applies live.
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => bg(page)).not.toBe(light)
  const dark = await bg(page)
  await expect.poll(() => basemapName(page)).toBe('Basemap: Dark')

  // Light, picked from the menu (keyboard): applies at once, ignores the OS.
  await themeButton(page).focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.getByRole('menu', { name: 'Theme' })
  await expect(menu.getByRole('menuitemradio', { name: 'System' })).toBeFocused()
  const started = Date.now()
  await menu.getByRole('menuitemradio', { name: 'Light' }).click()
  await expect.poll(() => bg(page)).toBe(light)
  expect(Date.now() - started).toBeLessThan(1000) // SC-005
  await expect.poll(() => basemapName(page)).toBe('Basemap: Positron')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(300)
  expect(await bg(page)).toBe(light)

  // Remembered across a reload.
  await page.reload()
  await expect(themeButton(page)).toHaveAccessibleName('Theme: Light')
  await expect.poll(() => bg(page)).toBe(light)

  // Dark on a light OS.
  await page.emulateMedia({ colorScheme: 'light' })
  await themeButton(page).click()
  await page.getByRole('menuitemradio', { name: 'Dark' }).click()
  await expect.poll(() => bg(page)).toBe(dark)
  await expect(page.getByRole('menuitemradio')).toHaveCount(0)
  await expect(themeButton(page)).toBeFocused()
})
