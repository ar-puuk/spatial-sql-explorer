// T010 (spec 008 US1, FR-001–FR-005, SC-001): the sectioned style panel, the
// value distribution, the live ramp preview, and live appearance edits.
import { test, expect, type Page } from '@playwright/test'
import { openFile, writeParcels, writeSquares, chooseStyleType } from './helpers'

const panel = (page: Page) => page.getByRole('region', { name: 'Layer style' })
const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const legendRows = (page: Page) => legend(page).locator('li')
const swatchFillOpacity = (page: Page) => legendRows(page).first().locator('.swatch svg > *').evaluate((el) => Number(el.getAttribute('fill-opacity')))
const swatch = (page: Page, i: number) => legendRows(page).nth(i).locator('.swatch').evaluate((el) => getComputedStyle(el).getPropertyValue('--swatch').trim())

test('sections in a fixed order, and only those that apply', async ({ page }) => {
  await openFile(page, writeSquares())
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  const headings = () => panel(page).locator('section h3').allTextContents()
  // Spec 011: Vary by attribute takes the old Size section's place, under Appearance.
  expect(await headings()).toEqual(['Color', 'Appearance', 'Vary by attribute', '3D'])
  await chooseStyleType(page, 'Categorized')
  expect(await headings()).toEqual(['Color', 'Color by', 'Colors', 'Appearance', 'Vary by attribute', '3D'])
  await chooseStyleType(page, 'Graduated')
  expect(await headings()).toEqual(['Color', 'Color by', 'Classification', 'Colors', 'Appearance', 'Vary by attribute', '3D'])
  await expect(page.getByRole('button', { name: 'Color: Graduated' })).toContainText('Colors by ranges of a number or an expression')
  // No Apply step anywhere (FR-002).
  await expect(panel(page).getByRole('button', { name: /^Apply/ })).toHaveCount(0)
})

test('a graduated style in three interactions or fewer (SC-001)', async ({ page }) => {
  await openFile(page, writeSquares())
  // 1: open the panel; 2: Graduated (the numeric column is picked by default). Classes are on the map.
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await chooseStyleType(page, 'Graduated')
  await expect(legend(page)).toContainText('value · Quantile, 5 classes')
  await expect(legendRows(page)).toHaveCount(5)
})

test('the value distribution shows the breaks and follows the method and class count', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeParcels(2000))
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await chooseStyleType(page, 'Graduated')
  await page.getByLabel('Column', { exact: true }).selectOption('value')
  const chart = panel(page).getByRole('img', { name: 'Value distribution' })
  await expect(chart).toBeVisible({ timeout: 30000 })
  const description = async () => (await chart.getAttribute('aria-describedby')) ?? ''
  const text = async () => page.locator(`#${await description()}`).textContent()
  await expect.poll(text).toMatch(/^2,000 values from .* Class breaks at .*\.$/)
  expect(((await text()) ?? '').match(/Class breaks at (.*)\./)![1].split(', ')).toHaveLength(4)
  await expect.poll(async () => panel(page).locator('svg line.break').count()).toBe(4)
  await page.getByLabel('Classes', { exact: true }).selectOption('3')
  await expect.poll(async () => panel(page).locator('svg line.break').count()).toBe(2)
  const before = await text()
  await page.getByLabel('Method', { exact: true }).selectOption('equal')
  await expect.poll(text).not.toBe(before)
  await expect(panel(page).locator('svg rect.bar')).toHaveCount(40)
})

test('ramps preview on the map while browsing; Escape restores; Enter commits', async ({ page }) => {
  await openFile(page, writeSquares())
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await chooseStyleType(page, 'Graduated')
  await expect(legendRows(page)).toHaveCount(5)
  const original = await swatch(page, 0)
  // Save first, so "modified" shows only for real edits: a preview never marks the style modified.
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save style' }).click()])
  await expect(panel(page).locator('.source')).not.toContainText('modified')

  await page.getByRole('button', { name: /^Colors:/ }).click()
  const list = page.getByRole('listbox', { name: 'Color ramps' })
  await expect(list).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => swatch(page, 0)).not.toBe(original)
  await expect(panel(page).locator('.source')).not.toContainText('modified')
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await expect.poll(() => swatch(page, 0)).toBe(original)
  await expect(panel(page).locator('.source')).not.toContainText('modified')

  await page.getByRole('button', { name: /^Colors:/ }).click()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => swatch(page, 0)).not.toBe(original)
  const firstPreview = await swatch(page, 0)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => swatch(page, 0)).not.toBe(firstPreview)
  const previewed = await swatch(page, 0)
  await page.keyboard.press('Enter')
  await expect(list).toHaveCount(0)
  await expect.poll(() => swatch(page, 0)).toBe(previewed)
  await expect(panel(page).locator('.source')).toContainText('modified')

  // Reverse in one action.
  const first = await swatch(page, 0)
  const last = await swatch(page, 4)
  await page.getByRole('button', { name: 'Reverse colors' }).click()
  await expect.poll(() => swatch(page, 0)).toBe(last)
  expect(await swatch(page, 4)).toBe(first)
})

test('opacity applies live to the map and the legend', async ({ page }) => {
  await openFile(page, writeParcels(200))
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  const slider = page.getByRole('slider', { name: 'Fill opacity' })
  await slider.fill('0.25')
  await expect(slider).toHaveAttribute('aria-valuetext', '25%')
  await expect(legend(page)).toBeVisible()
  // The swatch is drawn like the map: its fill carries the opacity.
  await expect.poll(() => swatchFillOpacity(page)).toBeCloseTo(0.25, 2)
})

test('layer opacity fades the whole layer, live, and is saved in the QML (user request)', async ({ page }) => {
  await openFile(page, writeParcels(200))
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  const slider = page.getByRole('slider', { name: 'Layer opacity' })
  await expect(slider).toHaveAttribute('aria-valuetext', '100%')
  await slider.fill('0.5')
  await expect(slider).toHaveAttribute('aria-valuetext', '50%')
  // Default fill opacity 45%, times 50%: the legend swatch is about 22% opaque.
  await expect.poll(() => swatchFillOpacity(page)).toBeCloseTo(0.225, 2)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save style' }).click()])
  const fs = await import('node:fs')
  expect(fs.readFileSync(await download.path(), 'utf8')).toContain('<layerOpacity>0.5</layerOpacity>')
})
