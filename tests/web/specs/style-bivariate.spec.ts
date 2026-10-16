// Spec 009 US4 (contracts/ui.md): bivariate maps in the style panel and the
// legend: a 3x3 keyboard grid whose cell counts add up, hideable cells,
// swapping axes, palettes, and accessibility.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture, openFile, writeSquares, openStyle, chooseStyleType } from './helpers'

const panel = (page: Page) => page.getByRole('region', { name: 'Layer style' })
const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const grid = (page: Page) => legend(page).getByRole('grid', { name: 'Bivariate cells' })
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')

async function openCounties(page: Page): Promise<void> {
  await openFile(page, fixture('counties-bivariate.geojson'))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await openStyle(page)
  await chooseStyleType(page, 'Bivariate')
  // SC-002: the defaults are already the two measures (the id column goes last).
  await expect(panel(page).getByLabel('Axis 1', { exact: true })).toHaveValue('poverty_rate')
  await expect(panel(page).getByLabel('Axis 2', { exact: true })).toHaveValue('obesity_rate')
  await panel(page).getByLabel('Axis 1', { exact: true }).selectOption('poverty_rate')
  await panel(page).getByLabel('Axis 2', { exact: true }).selectOption('obesity_rate')
}

test('a 3x3 bivariate map: the cells add up, and a cell hides by keyboard (US4)', async ({ page }) => {
  await openCounties(page)
  // The legend is headed by the layer and names its axes itself, with the ends of each marked; the method is in the style panel.
  await expect(legend(page)).toContainText('counties-bivariate.geojson')
  await expect(legend(page)).not.toContainText('Quantile')
  await expect(legend(page)).toContainText('poverty_rate')
  await expect(legend(page)).toContainText('obesity_rate')
  const cells = grid(page).getByRole('gridcell').getByRole('button')
  await expect(cells).toHaveCount(9)
  // Each cell names both ranges and its count; with No value, they add up to the 600 counties.
  const names = await cells.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  for (const n of names) expect(n).toMatch(/^poverty_rate .+, obesity_rate .+: [\d,]+ features?$/)
  const counts = names.map((n) => Number(n.match(/: ([\d,]+) features?$/)?.[1].replace(/,/g, '')))
  const noValue = Number((await legend(page).getByRole('button', { name: /No value/ }).getAttribute('aria-label'))?.match(/([\d,]+) features?/)?.[1].replace(/,/g, ''))
  expect(counts.reduce((a, b) => a + b, 0) + noValue).toBe(600)

  // Roving focus: arrow keys move one cell; Enter hides it on the map.
  await cells.first().focus()
  await page.keyboard.press('ArrowRight')
  const focused = grid(page).locator('button:focus')
  await expect(focused).toHaveCount(1)
  // The bivariate columns reload the view (spec 007): read the settled count.
  await expect.poll(() => rendered(page)).not.toBeNull()
  const before = Number(await rendered(page))
  expect(before).toBeGreaterThan(0)
  await page.keyboard.press('Enter')
  await expect(focused).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => Number(await rendered(page))).toBeLessThan(before)
  await page.keyboard.press('Enter')
  await expect(focused).toHaveAttribute('aria-pressed', 'false')
})

test('swap axes and change the palette; no size channel; no axe violations', async ({ page }) => {
  await openCounties(page)
  const topRight = async () => grid(page).getByRole('gridcell').first().getByRole('button').evaluate((e) => getComputedStyle(e).backgroundColor)
  const before = await topRight()
  await panel(page).getByRole('button', { name: 'Swap axes' }).click()
  await expect(panel(page).getByLabel('Axis 1', { exact: true })).toHaveValue('obesity_rate')
  // The axes swapped on the legend too: the first one runs along the bottom.
  await expect(legend(page).locator('.x-axis')).toContainText('obesity_rate')
  await expect(legend(page).locator('.y-axis')).toContainText('poverty_rate')
  await panel(page).getByRole('radiogroup', { name: 'Bivariate palette' }).getByRole('radio', { name: 'Green – Purple' }).click()
  await expect.poll(topRight).not.toBe(before)
  // Counties are polygons: no size channel either way (FR-006/FR-007; core tests cover points and lines).
  await expect(panel(page).getByRole('switch', { name: 'Size by column' })).toHaveCount(0)
  await panel(page).getByLabel('Axis 1 method').selectOption('equal')
  await expect(panel(page).getByLabel('Axis 1 method')).toHaveValue('equal')
  const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
})

test('Bivariate needs two numeric columns, and says why', async ({ page }) => {
  await openFile(page, writeSquares())
  await openStyle(page)
  await page.getByRole('button', { name: /^Color: / }).click()
  const option = page.getByRole('option', { name: 'Bivariate', exact: true })
  await expect(option).toHaveAttribute('aria-disabled', 'true')
  await expect(option).toContainText('Bivariate maps need two numeric columns.')
})

test('the map legend can be tilted into a diamond, and keeps working; square is the default', async ({ page }) => {
  await openCounties(page)
  const cells = grid(page).getByRole('gridcell').getByRole('button')
  await expect(legend(page).locator('.bivariate.tilted')).toHaveCount(0)
  await legend(page).getByRole('button', { name: 'Tilt', exact: true }).click()
  await expect(legend(page).locator('.bivariate.tilted')).toHaveCount(1)
  await expect(cells).toHaveCount(9)
  // A cell still hides its features, and the axes are named along the edges.
  await cells.first().click()
  await expect(cells.first()).toHaveAttribute('aria-pressed', 'true')
  await expect(legend(page)).toContainText('← obesity_rate')
  await expect(legend(page)).toContainText('poverty_rate →')
  // The choice is remembered: back to the square by the same button.
  await legend(page).getByRole('button', { name: 'Square', exact: true }).click()
  await expect(legend(page).locator('.bivariate.tilted')).toHaveCount(0)
})
