// Spec 011 US3 (contracts/ui.md "Draw as and recipes"): the dropdown's two
// groups, a recipe in a few choices, Heatmap ↔ Markers keeping the markers'
// properties, and 3D showing the height.
import { test, expect, type Page } from '@playwright/test'
import { chooseDrawAs, fixture, openFile, openStyle } from './helpers'

const panel = (page: Page) => page.getByRole('region', { name: 'Layer style' })
const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')

async function open(page: Page, name: string): Promise<void> {
  await openFile(page, fixture(name))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
}

test('Flow / network on lines: color by a category and width by a number, in three choices (SC-001)', async ({ page }) => {
  await open(page, 'roads-los.geojson')
  // 1: the Style panel; 2: the dropdown; 3: the recipe.
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await page.getByRole('button', { name: 'Draw as: Lines' }).click()
  await page.getByRole('listbox', { name: 'Draw as and recipes' }).getByRole('option', { name: 'Flow / network', exact: true }).click()
  await expect(legend(page).getByRole('group', { name: /^los · / })).toBeVisible()
  await expect(legend(page).getByRole('group', { name: /^volume · / })).toBeVisible()
  // The recipe set the properties; the button still shows the drawing.
  await expect(page.getByRole('button', { name: 'Draw as: Lines' })).toBeVisible()
  await expect(panel(page).getByRole('radio', { name: 'Color: By column', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(panel(page).getByRole('radio', { name: 'Width: By column', exact: true })).toHaveAttribute('aria-checked', 'true')
})

test('unusable recipes say why, and the keyboard skips them', async ({ page }) => {
  await open(page, 'crashes.geojson')
  await openStyle(page)
  await page.getByRole('button', { name: 'Draw as: Markers' }).focus()
  await page.keyboard.press('ArrowDown')
  const list = page.getByRole('listbox', { name: 'Draw as and recipes' })
  const flow = list.getByRole('option', { name: 'Flow / network', exact: true })
  await expect(flow).toHaveAttribute('aria-disabled', 'true')
  await expect(flow).toContainText('Flow maps are for lines.')
  // End goes to the last usable option (the Heatmap recipe), not to Flow.
  await page.keyboard.press('End')
  const heat = list.getByRole('group', { name: 'Recipes' }).getByRole('option', { name: 'Heatmap', exact: true })
  await expect(list).toHaveAttribute('aria-activedescendant', (await heat.getAttribute('id'))!)
  await page.keyboard.press('Escape')
})

test('Heatmap and back to Markers: the markers keep their properties (FR-007)', async ({ page }) => {
  await open(page, 'crashes.geojson')
  await openStyle(page)
  await panel(page).getByRole('radio', { name: 'Shape: By column', exact: true }).click()
  await panel(page).getByLabel('Shape column').selectOption('crash_type')
  await expect(legend(page).getByRole('group', { name: /^crash_type · / })).toBeVisible()
  await chooseDrawAs(page, 'Heatmap')
  await expect(panel(page).getByRole('heading', { name: 'Heatmap' })).toBeVisible()
  await expect(panel(page).getByRole('radio', { name: 'Shape: By column', exact: true })).toHaveCount(0)
  await chooseDrawAs(page, 'Markers')
  await expect(panel(page).getByRole('radio', { name: 'Shape: By column', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(panel(page).getByLabel('Shape column')).toHaveValue('crash_type')
  await expect(legend(page).getByRole('group', { name: /^crash_type · / })).toBeVisible()
})

test('Fills to 3D shows the height; back to Fills hides it', async ({ page }) => {
  await open(page, 'counties-011.geojson')
  await openStyle(page)
  await expect(panel(page).getByLabel('Height from')).toHaveCount(0)
  await chooseDrawAs(page, '3D')
  await expect(panel(page).getByLabel('Height from')).toBeVisible()
  await chooseDrawAs(page, 'Fills')
  await expect(panel(page).getByLabel('Height from')).toHaveCount(0)
})
