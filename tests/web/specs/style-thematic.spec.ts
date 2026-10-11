// Spec 003 (thematic styling), browser tests in the real web build.
// T016: Categorized (US1; quickstart Scenario 1).
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile, openQueryPanel, runQuery, writeParcels } from './helpers'

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
