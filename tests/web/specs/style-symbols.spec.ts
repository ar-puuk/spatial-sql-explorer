// Marker shapes, line patterns and size classes (graduated by size): the
// style panel controls, the map (shaped markers are icons and must still be
// drawn and clickable), the legend, and the saved QML.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { openFile, writeParcels, writeSquares, openStyle } from './helpers'

const panel = (page: Page) => page.getByRole('region', { name: 'Layer style' })
const legendRows = (page: Page) => page.getByRole('region', { name: 'Legend' }).locator('li')
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')
const savedQml = async (page: Page): Promise<string> => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download style (QML)' }).click()])
  return fs.readFileSync(await download.path(), 'utf8')
}

test('a marker shape draws every point as that shape, in the legend too, and is saved', async ({ page }) => {
  await openFile(page, writeSquares())
  await expect.poll(() => rendered(page), { timeout: 30000 }).toBe('100')
  await openStyle(page)
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
  await openStyle(page)
  // Polygons have no marker shape.
  await expect(panel(page).getByRole('radiogroup', { name: 'Shape' })).toHaveCount(0)
  await panel(page).getByLabel('Pattern').selectOption('dash-dot')
  await expect(legendRows(page).first().locator('svg rect')).toHaveAttribute('stroke-dasharray', /\d/)
  expect(await savedQml(page)).toContain('name="outline_style" type="QString" value="dash dot"')
})

// Spec 009: size classes are the size channel (style-channels.spec.ts covers its controls and files).
test('size classes on points: markers grow class by class, in the legend to scale', async ({ page }) => {
  await openFile(page, writeSquares())
  await openStyle(page)
  await panel(page).getByRole('radio', { name: 'Size: By column' }).click()
  await expect(panel(page).getByLabel('Size column')).toHaveValue('value')
  await expect(panel(page).getByLabel('Smallest size')).toHaveValue('2')
  await expect(panel(page).getByLabel('Largest size')).toHaveValue('10')
  const sizeRows = page.getByRole('region', { name: 'Legend' }).getByRole('group', { name: /^value · / }).locator('li')
  await expect(sizeRows).toHaveCount(5)

  // Legend markers grow class by class (shrunk together to fit, relative sizes kept).
  const widths = async () =>
    Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        sizeRows
          .nth(i)
          .locator('svg path')
          .evaluate((el) => (el as SVGPathElement).getBBox().width)
      )
    )
  await expect.poll(async () => (await widths()).every((w, i, a) => i === 0 || w > a[i - 1])).toBe(true)
  await expect.poll(() => rendered(page)).toBe('100')

  // Shaped markers are sized too (icons scaled per feature), and still drawn.
  await panel(page).getByRole('radiogroup', { name: 'Shape' }).getByRole('radio', { name: 'Triangle' }).click()
  await expect.poll(() => rendered(page)).toBe('100')

  await panel(page).getByLabel('Largest size').fill('16')
  await panel(page).getByLabel('Largest size').press('Enter')
  await expect(panel(page).getByRole('list', { name: 'Size classes' }).locator('li').last().getByRole('img')).toHaveAttribute('aria-label', /16 px$/)
})
