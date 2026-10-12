// Spec 009 US1/US2 (contracts/ui.md): a size channel next to the color
// channel. Lines keep their class colors and step through width classes; the
// legend shows one group per channel.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile, writeParcels } from './helpers'

const panel = (page: Page) => page.getByRole('dialog', { name: 'Layer style' })
const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const sizeGroup = (page: Page) => legend(page).getByRole('group', { name: /^aadt · / })
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')

async function openRoads(page: Page): Promise<void> {
  await openFile(page, fixture('roads-traffic.geojson'))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await page.getByRole('button', { name: 'Layer style' }).click()
}

test('color by class, width by traffic: two legend groups, live edits, and off again (US1)', async ({ page }) => {
  await openRoads(page)
  await page.getByRole('radio', { name: 'Categorized' }).click()
  await panel(page).getByLabel('Column', { exact: true }).selectOption('functional_class')
  // The fixture's five classes (no nulls in functional_class).
  const colorRows = 5
  await expect(legend(page).getByRole('group', { name: /^functional_class · / }).locator('li')).toHaveCount(colorRows)
  // A new style column reloads the view (spec 007): wait for the count of the drawn view.
  await expect.poll(() => rendered(page)).not.toBeNull()
  const drawn = (await rendered(page)) as string
  expect(Number(drawn)).toBeGreaterThan(0)

  const toggle = panel(page).getByRole('switch', { name: 'Size by column' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  // SC-001: one click sizes by the first measure (the id column goes last).
  await expect(panel(page).getByLabel('Size column')).toHaveValue('aadt')
  await panel(page).getByLabel('Size column').selectOption('aadt')
  // Five width classes plus No value (the fixture has null traffic), next to the unchanged color group.
  await expect(sizeGroup(page)).toHaveAccessibleName('aadt · Quantile, 5 classes')
  await expect(sizeGroup(page).locator('li')).toHaveCount(6)
  await expect(legend(page).getByRole('group', { name: /^functional_class · / }).locator('li')).toHaveCount(colorRows)
  await expect.poll(() => rendered(page)).toBe(drawn)

  // Live edits.
  await panel(page).getByLabel('Size class count').selectOption('3')
  await expect(sizeGroup(page)).toHaveAccessibleName('aadt · Quantile, 3 classes')
  await panel(page).getByLabel('Size method').selectOption('equal')
  await expect(sizeGroup(page)).toHaveAccessibleName('aadt · Equal interval, 3 classes')
  await panel(page).getByLabel('Largest size').fill('12')
  await panel(page).getByLabel('Largest size').press('Enter')
  await expect(panel(page).getByRole('list', { name: 'Size classes' }).locator('li').nth(2).getByRole('img')).toHaveAttribute('aria-label', /12 px$/)

  // A size class hides from the legend, and the map draws fewer features.
  await sizeGroup(page).locator('li').first().getByRole('button').click()
  await expect.poll(async () => Number(await rendered(page))).toBeLessThan(Number(drawn))

  await toggle.click()
  await expect(sizeGroup(page)).toHaveCount(0)
  await expect.poll(() => rendered(page)).toBe(drawn)
})

test('polygons have no size channel, and the old Graduated "Vary" switch is gone', async ({ page }) => {
  await openFile(page, writeParcels(50))
  await page.getByRole('button', { name: 'Layer style' }).click()
  await expect(panel(page).getByRole('switch', { name: 'Size by column' })).toHaveCount(0)
  await expect(panel(page)).toContainText('Polygons have no size')
  await page.getByRole('radio', { name: 'Graduated' }).click()
  await expect(panel(page).getByRole('radiogroup', { name: 'Vary' })).toHaveCount(0)
})

test('proportional sizes: smooth widths with reference sizes in the legend, and back to classes (US2)', async ({ page }) => {
  await openRoads(page)
  await panel(page).getByRole('switch', { name: 'Size by column' }).click()
  await panel(page).getByLabel('Size column').selectOption('aadt')
  const mode = panel(page).getByRole('radiogroup', { name: 'Size scale' })
  await expect(mode.getByRole('radio', { name: 'Classed' })).toHaveAttribute('aria-checked', 'true')
  await mode.getByRole('radio', { name: 'Proportional' }).click()
  await expect(sizeGroup(page)).toHaveAccessibleName('aadt · Proportional')
  // Reference sizes (not toggles), then No value (a toggle).
  const rows = sizeGroup(page).locator('li')
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(4)
  await expect(rows.first().getByRole('button')).toHaveCount(0)
  await expect(rows.last().getByRole('button')).toHaveCount(1)
  await expect(panel(page).getByLabel('Size method')).toHaveCount(0)
  await expect(panel(page)).toContainText('scale smoothly')

  await mode.getByRole('radio', { name: 'Classed' }).click()
  await expect(sizeGroup(page)).toHaveAccessibleName('aadt · Quantile, 5 classes')
})
