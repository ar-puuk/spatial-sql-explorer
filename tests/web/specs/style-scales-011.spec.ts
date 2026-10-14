// Spec 011 US4: Continuous and As is on the properties that vary by attribute.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile, openStyle, varyBy } from './helpers'

const panel = (page: Page) => page.getByRole('region', { name: 'Layer style' })
const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')

test('opacity continuous: three samples in the legend, not toggles; outline color continuous: a bar from min to max', async ({ page }, info) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFile(page, fixture('crashes.geojson'))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await openStyle(page)

  await varyBy(page, 'Opacity')
  await panel(page).getByLabel('Opacity column').selectOption('age_days')
  await expect(panel(page).getByLabel('Opacity scale').locator('option')).toHaveText(['Categories', 'Classes', 'Continuous', 'As is'])
  await panel(page).getByLabel('Opacity scale').selectOption({ label: 'Continuous' })
  const opacity = legend(page).getByRole('group', { name: /^age_days · Continuous/ })
  await expect(opacity.locator('li')).toHaveCount(3)
  await expect(opacity.getByRole('button')).toHaveCount(0)
  await expect(panel(page).getByLabel('Opacity curve')).toHaveValue('linear')
  // The values the opacities run between: Auto, then set, then Auto again.
  const from = panel(page).getByLabel('Opacity from value')
  await expect(from).not.toHaveValue('')
  await from.fill('1000')
  await from.press('Enter')
  await expect(opacity.locator('li').first()).toContainText('1,000')
  await panel(page).getByRole('button', { name: 'Auto' }).click()
  await expect(opacity.locator('li').first()).not.toContainText('1,000')

  await varyBy(page, 'Outline color')
  await panel(page).getByLabel('Outline color column').selectOption('age_days')
  await panel(page).getByLabel('Outline color scale').selectOption({ label: 'Continuous' })
  await expect(legend(page).getByRole('img', { name: /^age_days · Continuous: colors from [\d,.]+ to [\d,.]+$/ })).toBeVisible()
  await expect.poll(async () => Number(await rendered(page))).toBe(3000)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: info.outputPath('continuous.png') })
})

test('as is: outline colors from hex_color, rotation from heading', async ({ page }, info) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFile(page, fixture('crashes.geojson'))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await openStyle(page)

  await varyBy(page, 'Outline color')
  await panel(page).getByLabel('Outline color column').selectOption('hex_color')
  // A text column: categories, or the colors as they are.
  await expect(panel(page).getByLabel('Outline color scale').locator('option')).toHaveText(['Categories', 'As is'])
  await panel(page).getByLabel('Outline color scale').selectOption({ label: 'As is' })
  await expect(panel(page).getByText('Each feature takes the color in the column (#rrggbb).')).toBeVisible()
  await expect(legend(page).getByText('Colors read from the column')).toBeVisible()

  await varyBy(page, 'Rotation')
  await panel(page).getByLabel('Rotation column').selectOption('heading')
  await panel(page).getByLabel('Rotation scale').selectOption({ label: 'As is' })
  await expect(legend(page).getByText('Read from the column (degrees)')).toBeVisible()
  await expect.poll(async () => Number(await rendered(page))).toBe(3000)
  await page.screenshot({ path: info.outputPath('as-is.png') })
})
