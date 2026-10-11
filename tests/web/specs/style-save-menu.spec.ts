// T011 (spec 008 US1, FR-006): one split Save button. The main part
// downloads the QGIS sidecar (web); the arrow's menu offers every format, and
// works from the keyboard alone (WAI-ARIA menu button).
import { test, expect, type Page } from '@playwright/test'
import { openFile, writeSquares } from './helpers'

const panel = (page: Page) => page.getByRole('dialog', { name: 'Layer style' })

async function open(page: Page): Promise<void> {
  await openFile(page, writeSquares())
  await page.getByRole('button', { name: 'Layer style' }).click()
  await page.getByRole('radio', { name: 'Graduated' }).click()
}

test('the main action downloads the QML sidecar; there is no separate Export button', async ({ page }) => {
  await open(page)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download style (QML)' }).click()])
  expect(download.suggestedFilename()).toBe('squares.qml')
  await expect(panel(page).getByRole('button', { name: /^Export/ })).toHaveCount(0)
})

test('the menu saves SLD and Mapbox GL', async ({ page }) => {
  await open(page)
  const arrow = page.getByRole('button', { name: 'More style formats' })
  await expect(arrow).toHaveAttribute('aria-haspopup', 'menu')
  await arrow.click()
  await expect(arrow).toHaveAttribute('aria-expanded', 'true')
  const menu = page.getByRole('menu', { name: 'Style formats' })
  await expect(menu.getByRole('menuitem')).toHaveText([/QGIS style \(\.qml\)/, /OGC SLD \(\.sld\)/, /Mapbox GL style \(\.json\)/])

  const [sld] = await Promise.all([page.waitForEvent('download'), menu.getByRole('menuitem', { name: /OGC SLD/ }).click()])
  expect(sld.suggestedFilename()).toMatch(/\.sld$/)
  await expect(menu).toHaveCount(0)

  await arrow.click()
  const [mapbox] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Mapbox GL/ }).click()])
  expect(mapbox.suggestedFilename()).toMatch(/\.json$/)
})

test('keyboard: open, move, jump, and Escape back to the arrow', async ({ page }) => {
  await open(page)
  const arrow = page.getByRole('button', { name: 'More style formats' })
  await arrow.focus()
  await page.keyboard.press('ArrowDown')
  const items = page.getByRole('menuitem')
  await expect(items.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(items.nth(2)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(0)).toBeFocused()
  await page.keyboard.press('Home')
  await expect(items.nth(0)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(arrow).toBeFocused()
  // Escape closed only the menu, not the panel.
  await expect(panel(page)).toBeVisible()

  await page.keyboard.press('Enter')
  await expect(items.nth(0)).toBeFocused()
  const [sld] = await Promise.all([page.waitForEvent('download'), (async () => {
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
  })()])
  expect(sld.suggestedFilename()).toMatch(/\.sld$/)
})
