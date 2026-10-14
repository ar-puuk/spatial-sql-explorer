// Spec 011 US1 (contracts/ui.md "Vary by attribute"): under the style type,
// more properties each vary by their own column; one legend group per
// property; removing one and adding it again; the Add menu by geometry and by
// keyboard; axe on the panel.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { chooseStyleType, fixture, openFile, openStyle, varyBy } from './helpers'

const panel = (page: Page) => page.getByRole('region', { name: 'Layer style' })
const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')

async function open(page: Page, name: string): Promise<void> {
  await openFile(page, fixture(name))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await openStyle(page)
}

test('lines: categorized by level of service, width by traffic (the user story)', async ({ page }) => {
  await open(page, 'roads-los.geojson')
  const drawn = Number(await rendered(page))
  await chooseStyleType(page, 'Categorized')
  await panel(page).getByLabel('Column', { exact: true }).selectOption('los')
  await varyBy(page, 'Width')
  await panel(page).getByLabel('Size column').selectOption('volume')
  // Two groups, each from its own column; the color group keeps its six LOS classes plus No value.
  await expect(legend(page).getByRole('group', { name: /^volume · / })).toBeVisible()
  await expect(legend(page).getByRole('group', { name: /^los · / }).locator('li')).toHaveCount(7)
  // Every road is still drawn (lines crossing tile edges count once per tile).
  await expect.poll(async () => Number(await rendered(page))).toBe(drawn)
  // Removing Width: its group goes; the color group is untouched.
  await panel(page).getByRole('button', { name: 'Stop varying width' }).click()
  await expect(legend(page).getByRole('group', { name: /^volume · / })).toHaveCount(0)
  await expect(legend(page).getByRole('group', { name: /^los · / }).locator('li')).toHaveCount(7)
})

test('points: color, shape and size each by their own column', async ({ page }) => {
  test.setTimeout(120000)
  await open(page, 'crashes.geojson')
  await chooseStyleType(page, 'Categorized')
  await panel(page).getByLabel('Column', { exact: true }).selectOption('severity')
  await varyBy(page, 'Shape')
  await panel(page).getByLabel('Shape column').selectOption('crash_type')
  await varyBy(page, 'Size')
  await panel(page).getByLabel('Size column').selectOption('age_days')

  const shapeGroup = legend(page).getByRole('group', { name: /^crash_type · / })
  await expect(shapeGroup).toBeVisible()
  await expect(legend(page).getByRole('group', { name: /^severity · / })).toHaveCount(1)
  await expect(legend(page).getByRole('group', { name: /^age_days · / })).toBeVisible()
  // Nine crash types: six with their own shape, the three rarest share Other's (FR-013), with a note.
  await expect(shapeGroup.locator('li')).toHaveCount(7)
  await expect(panel(page)).toContainText('Only 6 values get their own shape')
  const classes = panel(page).getByRole('list', { name: 'Shape classes' })
  await expect(classes.getByLabel('Rear end shape')).toHaveValue('circle')
  await expect(classes.getByLabel('Angle shape')).toHaveValue('square')
  // Three properties by data: the readability note.
  await expect(panel(page)).toContainText('Maps with many variables are harder to read')

  // Hiding a shape class hides its features (Rear end: 900 crashes).
  await expect.poll(async () => Number(await rendered(page))).toBe(3000)
  await shapeGroup.getByRole('button', { name: 'Hide shape class Rear end' }).click()
  await expect.poll(async () => Number(await rendered(page))).toBe(2100)
  await shapeGroup.getByRole('button', { name: 'Show shape class Rear end' }).click()

  // A class's own shape.
  await classes.getByLabel('Angle shape').selectOption('star')
  await expect(classes.getByLabel('Angle shape')).toHaveValue('star')
})

test('removed, then added again: the same column comes back (FR-007)', async ({ page }) => {
  await open(page, 'crashes.geojson')
  await varyBy(page, 'Outline color')
  await panel(page).getByLabel('Outline color column').selectOption('crash_type')
  await expect(legend(page).getByRole('group', { name: /^crash_type · / })).toBeVisible()
  await panel(page).getByRole('button', { name: 'Stop varying outline color' }).click()
  await expect(legend(page).getByRole('group', { name: /^crash_type · / })).toHaveCount(0)
  await expect(panel(page).getByLabel('Outline color column')).toHaveCount(0)
  await varyBy(page, 'Outline color')
  await expect(panel(page).getByLabel('Outline color column')).toHaveValue('crash_type')
})

test('Add… offers what fits the geometry, and works by keyboard', async ({ page }) => {
  await open(page, 'crashes.geojson')
  const add = panel(page).getByRole('button', { name: 'Add…' })
  await add.click()
  const menu = page.getByRole('menu', { name: 'Vary by attribute' })
  await expect(menu.getByRole('menuitem')).toHaveText(['Outline color', 'Outline width', 'Size', 'Shape', 'Opacity', 'Rotation'])
  await expect(menu.getByRole('menuitem', { name: 'Outline color' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Outline width' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(add).toBeFocused()
  await add.press('Enter')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(panel(page).getByRole('group', { name: 'Rotation by' })).toBeVisible()
  await expect(panel(page).getByLabel('Rotation column')).toBeVisible()
  const results = await new AxeBuilder({ page }).include('[aria-label="Layer style"]').analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
})
