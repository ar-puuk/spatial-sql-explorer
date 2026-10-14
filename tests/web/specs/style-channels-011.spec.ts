// Spec 011 US1 (contracts/ui.md "Property rows"): each property Fixed or By
// column, independently; one legend group per property; back to Fixed and
// back again; polygon properties; keyboard and axe on the panel.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture, openFile, openStyle } from './helpers'

const panel = (page: Page) => page.getByRole('region', { name: 'Layer style' })
const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')
const byColumn = (page: Page, property: string) => panel(page).getByRole('radio', { name: `${property}: By column`, exact: true })
const fixed = (page: Page, property: string) => panel(page).getByRole('radio', { name: `${property}: Fixed`, exact: true })

async function open(page: Page, name: string): Promise<void> {
  await openFile(page, fixture(name))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await openStyle(page)
}

test('lines: color by level of service, width by traffic (the user story)', async ({ page }) => {
  await open(page, 'roads-los.geojson')
  const drawn = Number(await rendered(page))
  await byColumn(page, 'Color').click()
  await panel(page).getByLabel('Column', { exact: true }).selectOption('los')
  await expect(legend(page).getByRole('group', { name: /^los · / })).toBeVisible()
  await byColumn(page, 'Width').click()
  await panel(page).getByLabel('Size column').selectOption('volume')
  // Two groups, each from its own column; the color group keeps its six LOS classes plus No value.
  await expect(legend(page).getByRole('group', { name: /^volume · / })).toBeVisible()
  await expect(legend(page).getByRole('group', { name: /^los · / }).locator('li')).toHaveCount(7)
  // Every road is still drawn (lines crossing tile edges count once per tile).
  await expect.poll(async () => Number(await rendered(page))).toBe(drawn)
  // Width back to Fixed: its group goes; the color group is untouched.
  await fixed(page, 'Width').click()
  await expect(legend(page).getByRole('group', { name: /^volume · / })).toHaveCount(0)
  await expect(legend(page).getByRole('group', { name: /^los · / }).locator('li')).toHaveCount(7)
})

test('points: color, shape and size each by their own column', async ({ page }) => {
  test.setTimeout(120000)
  await open(page, 'crashes.geojson')
  await byColumn(page, 'Color').click()
  await panel(page).getByLabel('Column', { exact: true }).selectOption('severity')
  await byColumn(page, 'Shape').click()
  await panel(page).getByLabel('Shape column').selectOption('crash_type')
  await byColumn(page, 'Size').click()
  await panel(page).getByLabel('Size column').selectOption('age_days')

  const shapeGroup = legend(page).getByRole('group', { name: /^crash_type · / })
  // The shape group starts on the first text column (severity) until crash_type is chosen.
  await expect(shapeGroup).toBeVisible()
  await expect(legend(page).getByRole('group', { name: /^severity · / })).toHaveCount(1)
  await expect(legend(page).getByRole('group', { name: /^age_days · / })).toBeVisible()
  // Nine crash types: six with their own shape, the three rarest share Other's (FR-013), with a note.
  await expect(shapeGroup.locator('li')).toHaveCount(7)
  await expect(panel(page)).toContainText('Only 6 values get their own shape')
  const classes = panel(page).getByRole('list', { name: 'Shape classes' })
  await expect(classes.getByLabel('Rear end shape')).toHaveValue('circle')
  await expect(classes.getByLabel('Angle shape')).toHaveValue('square')

  // Hiding a shape class hides its features (Rear end: 900 crashes).
  await expect.poll(async () => Number(await rendered(page))).toBe(3000)
  await shapeGroup.getByRole('button', { name: 'Hide shape class Rear end' }).click()
  await expect.poll(async () => Number(await rendered(page))).toBe(2100)
  await shapeGroup.getByRole('button', { name: 'Show shape class Rear end' }).click()

  // A class's own shape.
  await classes.getByLabel('Angle shape').selectOption('star')
  await expect(classes.getByLabel('Angle shape')).toHaveValue('star')
})

test('back to Fixed, and By column again restores the same settings (FR-007)', async ({ page }) => {
  await open(page, 'crashes.geojson')
  await byColumn(page, 'Outline color').click()
  await panel(page).getByLabel('Outline color column').selectOption('crash_type')
  await expect(legend(page).getByRole('group', { name: /^crash_type · / })).toBeVisible()
  await fixed(page, 'Outline color').click()
  await expect(legend(page).getByRole('group', { name: /^crash_type · / })).toHaveCount(0)
  await expect(panel(page).getByLabel('Outline color column')).toHaveCount(0)
  await byColumn(page, 'Outline color').click()
  await expect(panel(page).getByLabel('Outline color column')).toHaveValue('crash_type')
})

test('polygons list color, outline color, outline width and opacity (no size)', async ({ page }) => {
  await open(page, 'counties-011.geojson')
  await expect(panel(page).locator('.channel h4')).toHaveText(['Color', 'Outline color', 'Outline width', 'Opacity'])
})

test('keyboard and accessible names: arrows switch Fixed and By column; axe finds nothing', async ({ page }) => {
  await open(page, 'crashes.geojson')
  const group = panel(page).getByRole('radiogroup', { name: 'Opacity: Fixed or By column' })
  await fixed(page, 'Opacity').focus()
  await page.keyboard.press('ArrowRight')
  await expect(byColumn(page, 'Opacity')).toHaveAttribute('aria-checked', 'true')
  await expect(byColumn(page, 'Opacity')).toBeFocused()
  await expect(group).toBeVisible()
  await expect(panel(page).getByLabel('Opacity column')).toBeVisible()
  const results = await new AxeBuilder({ page }).include('[aria-label="Layer style"]').analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
})
