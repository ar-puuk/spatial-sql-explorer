// Spec 003 (thematic styling), browser tests in the real web build.
// T016: Categorized (US1; quickstart Scenario 1). T024: Graduated (US2; Scenario 2).
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile, openQueryPanel, runQuery, writeParcels, writeSquares } from './helpers'

const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const legendRows = (page: Page) => legend(page).locator('li')

async function openStylePanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Layer style' }).click()
  await expect(page.getByRole('dialog', { name: 'Layer style' })).toBeVisible()
}

async function legendCounts(page: Page): Promise<number[]> {
  return (await legendRows(page).locator('.count').allTextContents()).map((t) => Number(t.replace(/,/g, '')))
}

test.describe('categorized (US1)', () => {
  test('colors by category with a legend that adds up to the result', async ({ page }) => {
    test.setTimeout(180000)
    await openFile(page, writeParcels(22_000))
    await openStylePanel(page)
    await page.getByRole('radio', { name: 'Categorized' }).click()
    // The suggested column is the text column with 2-12 values: zone.
    await expect(page.getByLabel('Column')).toHaveValue('zone')
    await expect(legend(page)).toContainText('zone · 5 categories')
    await expect(legendRows(page)).toHaveCount(5)
    expect((await legendCounts(page)).reduce((a, b) => a + b, 0)).toBe(1000)

    // The whole file, by owner (997 values): 12 classes + Other.
    await openQueryPanel(page)
    await runQuery(page, 'SELECT * FROM layer')
    await page.getByLabel('Column').selectOption('owner')
    await expect(legendRows(page)).toHaveCount(13)
    await expect(legendRows(page).last()).toContainText('Other (985 values)')
    expect((await legendCounts(page)).reduce((a, b) => a + b, 0)).toBe(22_000)

    // Back to the default single symbol: no legend.
    await page.getByRole('radio', { name: 'Single' }).click()
    await expect(legend(page)).toHaveCount(0)
  })

  test('the same classes as the VS Code build for world-boundaries (FR-020)', async ({ page }) => {
    await openFile(page, fixture('world-boundaries.geojson'))
    await openStylePanel(page)
    await page.getByRole('radio', { name: 'Categorized' }).click()
    await page.getByLabel('Column').selectOption('name')
    const labels = await legendRows(page).locator('.label').allTextContents()
    expect(labels).toEqual([
      'Afghanistan',
      'Albania',
      'Algeria',
      'Angola',
      'Antarctica',
      'Argentina',
      'Armenia',
      'Australia',
      'Austria',
      'Azerbaijan',
      'Bangladesh',
      'Belarus',
      'Other (168 values)',
    ])
    expect(await legendCounts(page)).toEqual([...Array(12).fill(1), 168])
  })

  test('a legend swatch hides its class on the map', async ({ page }) => {
    await openFile(page, fixture('world-boundaries.geojson'))
    await openStylePanel(page)
    await page.getByRole('radio', { name: 'Categorized' }).click()
    await page.getByLabel('Column').selectOption('name')
    const rendered = async () => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))
    await expect.poll(rendered, { timeout: 10000 }).toBeGreaterThan(0)
    const before = await rendered()
    await legend(page).getByRole('button', { name: 'Hide class Other (168 values)' }).click()
    await expect(legend(page).getByRole('button', { name: 'Show class Other (168 values)' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(rendered, { timeout: 10000 }).toBeLessThan(before)
  })
})

/** Expected for writeSquares() with Quantile, 5 classes; the VS Code suite asserts the same (FR-020). */
export const SQUARES_QUANTILE_LABELS = ['0 – 392', '392 – 1,568', '1,568 – 3,529', '3,529 – 6,273', '6,273 – 9,801']

test.describe('graduated (US2)', () => {
  test('quantile, then other methods and class counts: the legend follows each change', async ({ page }) => {
    test.setTimeout(180000)
    await openFile(page, writeParcels(22_000))
    await openStylePanel(page)
    await page.getByRole('radio', { name: 'Graduated' }).click()
    await page.getByLabel('Column').selectOption('value')
    await expect(legend(page)).toContainText('value · Quantile, 5 classes')
    const counts = await legendCounts(page)
    expect(counts).toHaveLength(5)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1000)
    for (const n of counts) expect(Math.abs(n - 200)).toBeLessThanOrEqual(2)

    await page.getByLabel('Method').selectOption('equal')
    await expect(legend(page)).toContainText('value · Equal interval, 5 classes')
    await page.getByLabel('Method').selectOption('jenks')
    await expect(legend(page)).toContainText('value · Natural breaks, 5 classes')
    await page.getByLabel('Classes').selectOption('3')
    await expect(legendRows(page)).toHaveCount(3)
    await page.getByLabel('Classes').selectOption('10')
    await expect(legendRows(page)).toHaveCount(10)
    expect((await legendCounts(page)).reduce((a, b) => a + b, 0)).toBe(1000)
  })

  test('the same classes as the VS Code build (FR-020)', async ({ page }) => {
    await openFile(page, writeSquares())
    await openStylePanel(page)
    await page.getByRole('radio', { name: 'Graduated' }).click()
    await expect(page.getByLabel('Column')).toHaveValue('value')
    expect(await legendRows(page).locator('.label').allTextContents()).toEqual(SQUARES_QUANTILE_LABELS)
    expect(await legendCounts(page)).toEqual([20, 20, 20, 20, 20])
  })

  test('is unavailable without a numeric column, and says why', async ({ page }) => {
    await openFile(page, fixture('world-boundaries.geojson'))
    await openStylePanel(page)
    const graduated = page.getByRole('radio', { name: 'Graduated' })
    await expect(graduated).toHaveAttribute('aria-disabled', 'true')
    await expect(graduated).toHaveAttribute('title', 'Graduated styling needs a numeric column.')
    await graduated.click({ force: true }) // aria-disabled: Playwright would wait for it to enable
    await expect(page.getByRole('radio', { name: 'Single' })).toHaveAttribute('aria-checked', 'true')
  })
})
