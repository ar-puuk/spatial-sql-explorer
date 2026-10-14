// Spec 011 US5 (research §10): legend groups merge when properties read the
// same column with the same classes; otherwise each keeps its own group.
import { test, expect, type Page } from '@playwright/test'
import { chooseStyleType, fixture, openFile, openStyle, varyBy } from './helpers'

const panel = (page: Page) => page.getByRole('region', { name: 'Layer style' })
const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')

test('color and size by the same column and breaks: one group, each entry colored and sized; different breaks: two', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('crashes.geojson'))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await openStyle(page)
  await chooseStyleType(page, 'Graduated')
  await panel(page).getByLabel('Column', { exact: true }).selectOption('age_days')
  await varyBy(page, 'Size')
  await panel(page).getByLabel('Size column').selectOption('age_days')

  // One group (the color's, named by the legend's heading), drawing both properties.
  const groups = legend(page).getByRole('group')
  await expect(groups).toHaveCount(1)
  await expect(groups.first()).toHaveAttribute('data-channels', 'color size')
  await expect(legend(page).getByRole('heading', { name: /^age_days · / })).toHaveCount(0)
  // Swatches grow class by class (the size), each in its class color.
  const swatches = groups.first().locator('li svg path')
  const widths = async () => swatches.evaluateAll((els) => els.slice(0, 5).map((el) => (el as SVGPathElement).getBBox().width))
  await expect.poll(async () => (await widths()).every((w, i, a) => i === 0 || w > a[i - 1])).toBe(true)
  const fills = await swatches.evaluateAll((els) => els.slice(0, 5).map((el) => el.getAttribute('fill')))
  expect(new Set(fills).size).toBe(5)

  // Hiding a merged entry hides the class in both properties: the map draws fewer, and the group stays one.
  await expect.poll(async () => Number(await rendered(page))).toBe(3000)
  await groups.first().getByRole('button', { name: /^Hide class / }).first().click()
  await expect.poll(async () => Number(await rendered(page))).toBeLessThan(3000)
  await expect(groups).toHaveCount(1)
  await groups.first().getByRole('button', { name: /^Show class / }).first().click()

  // The size in equal intervals: other breaks, two groups.
  await panel(page).getByLabel('Size method').selectOption('equal')
  await expect(groups).toHaveCount(2)
  await expect(legend(page).getByRole('heading', { name: 'age_days · Equal interval, 5 classes' })).toBeVisible()
})
