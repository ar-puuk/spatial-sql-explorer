// Marker shapes, line patterns and size classes (graduated by size): the
// style panel controls, the map (shaped markers are icons and must still be
// drawn and clickable), the legend, and the saved QML.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { openFile, writeParcels, writeSquares } from './helpers'

const panel = (page: Page) => page.getByRole('dialog', { name: 'Layer style' })
const legendRows = (page: Page) => page.getByRole('region', { name: 'Legend' }).locator('li')
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')
const savedQml = async (page: Page): Promise<string> => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download style (QML)' }).click()])
  return fs.readFileSync(await download.path(), 'utf8')
}

test('a marker shape draws every point as that shape, in the legend too, and is saved', async ({ page }) => {
  await openFile(page, writeSquares())
  await expect.poll(() => rendered(page), { timeout: 30000 }).toBe('100')
  await page.getByRole('button', { name: 'Layer style' }).click()
  const shapes = panel(page).getByRole('radiogroup', { name: 'Shape' })
  await expect(shapes.getByRole('radio', { name: 'Circle' })).toHaveAttribute('aria-checked', 'true')

  await shapes.getByRole('radio', { name: 'Star' }).click()
  await expect(shapes.getByRole('radio', { name: 'Star' })).toHaveAttribute('aria-checked', 'true')
  // The icons are drawn (and queryable, so clicks and hover still find the points).
  await expect.poll(() => rendered(page)).toBe('100')
  // The legend draws a ten-point star, not a circle.
  const d = await legendRows(page).first().locator('svg path').getAttribute('d')
  expect(d?.match(/L/g)).toHaveLength(9)

  // Arrow keys move through the shapes.
  await shapes.getByRole('radio', { name: 'Star' }).press('ArrowRight')
  await expect(shapes.getByRole('radio', { name: 'Cross' })).toHaveAttribute('aria-checked', 'true')
  await expect(shapes.getByRole('radio', { name: 'Cross' })).toBeFocused()
  expect(await savedQml(page)).toContain('name="name" type="QString" value="cross_fill"')

  // Back to circles: the circle layer draws them again.
  await shapes.getByRole('radio', { name: 'Circle' }).click()
  await expect.poll(() => rendered(page)).toBe('100')
})

test('a line pattern dashes polygon outlines and the legend, and is saved', async ({ page }) => {
  await openFile(page, writeParcels(50))
  await page.getByRole('button', { name: 'Layer style' }).click()
  // Polygons have no marker shape.
  await expect(panel(page).getByRole('radiogroup', { name: 'Shape' })).toHaveCount(0)
  await panel(page).getByLabel('Pattern').selectOption('dash-dot')
  await expect(legendRows(page).first().locator('svg rect')).toHaveAttribute('stroke-dasharray', /\d/)
  expect(await savedQml(page)).toContain('name="outline_style" type="QString" value="dash dot"')
})

test('graduated by size: classes grow from the smallest to the largest size', async ({ page }) => {
  await openFile(page, writeSquares())
  await page.getByRole('button', { name: 'Layer style' }).click()
  await page.getByRole('radio', { name: 'Graduated' }).click()
  await expect(legendRows(page)).toHaveCount(5)
  await panel(page).getByRole('radio', { name: 'Size', exact: true }).click()
  const headings = await panel(page).locator('section h3').allTextContents()
  expect(headings).toEqual(['Style', 'Size by', 'Classification', 'Sizes', 'Appearance', '3D'])
  // No ramp while classes vary by size; the single fill color is editable again.
  await expect(panel(page).getByRole('button', { name: /^Colors:/ })).toHaveCount(0)
  await expect(panel(page).getByLabel('Smallest class size')).toHaveValue('2')
  await expect(panel(page).getByLabel('Largest class size')).toHaveValue('10')

  // Legend markers grow class by class (shrunk together to fit, relative sizes kept).
  const widths = async () =>
    Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        legendRows(page)
          .nth(i)
          .locator('svg path')
          .evaluate((el) => (el as SVGPathElement).getBBox().width)
      )
    )
  await expect.poll(async () => (await widths()).every((w, i, a) => i === 0 || w > a[i - 1])).toBe(true)
  await expect.poll(() => rendered(page)).toBe('100')

  await panel(page).getByLabel('Largest class size').fill('16')
  await panel(page).getByLabel('Largest class size').press('Enter')
  await expect(panel(page).getByRole('list', { name: 'Class list' }).locator('li').last().getByRole('img')).toHaveAttribute('aria-label', /16 px$/)
  expect(await savedQml(page)).toContain('graduatedMethod="GraduatedSize"')

  // Back to color: the ramp returns.
  await panel(page).getByRole('radio', { name: 'Color', exact: true }).click()
  await expect(panel(page).getByRole('button', { name: /^Colors:/ })).toBeVisible()
})

test('polygons cannot vary by size', async ({ page }) => {
  await openFile(page, writeParcels(50))
  await page.getByRole('button', { name: 'Layer style' }).click()
  await page.getByRole('radio', { name: 'Graduated' }).click()
  const size = panel(page).getByRole('radio', { name: 'Size', exact: true })
  await expect(size).toHaveAttribute('aria-disabled', 'true')
  await expect(size).toHaveAttribute('title', /Polygons have no size/)
  await size.dispatchEvent('click')
  await expect(size).toHaveAttribute('aria-checked', 'false')
})
