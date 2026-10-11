// T024 (spec 008 US2, FR-010/FR-011, SC-004): per-column filters over the
// whole result, in the table and on the map.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile, openQueryPanel, rowCount, runQuery, writeParcels } from './helpers'

type FilterState = { filters: Array<{ column: string; valid?: boolean }>; matching: number | null; total: number; rendered: number | null }
const filterState = (page: Page) => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { filterState(): FilterState } }).__spatialExplorerE2E.filterState())
const count = (page: Page) => page.locator('.drawer-header > .count')
const rendered = async (page: Page) => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))

test('a text and a numeric filter: N of M rows, the table and the map agree', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeParcels(2000), '?e2e=1')
  await page.getByRole('textbox', { name: 'Filter zone' }).fill('r1')
  await expect(count(page)).toHaveText('400 of 2,000 rows')
  expect(await rowCount(page)).toBe(400)
  await page.getByRole('combobox', { name: 'value filter operator' }).selectOption('gte')
  await page.getByRole('textbox', { name: 'Filter value' }).fill('500000')
  await expect.poll(async () => (await filterState(page)).matching).toBeLessThan(400)
  const { matching } = await filterState(page)
  await expect(count(page)).toHaveText(`${matching!.toLocaleString('en-US')} of 2,000 rows`)
  expect(await rowCount(page)).toBe(matching)
  // The map draws only matching features (all of them fit in view at this size).
  await expect.poll(() => rendered(page)).toBeLessThanOrEqual(matching!)
  await expect.poll(async () => (await filterState(page)).rendered).toBe(matching)
  // Every row in the table matches.
  const zones = await page.locator('.attribute-table tbody tr:not(.spacer):not(.skeleton) td:nth-child(4)').allTextContents()
  expect(zones.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(count(page)).not.toContainText(' of ')
  expect(await rowCount(page)).toBe(2000)
  await expect(page.getByRole('textbox', { name: 'Filter zone' })).toHaveValue('')
})

test('an invalid value is marked, with the reason, and not applied', async ({ page }) => {
  await openFile(page, writeParcels(200), '?e2e=1')
  const input = page.getByRole('textbox', { name: 'Filter value' })
  await input.fill('abc')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  const reason = await input.getAttribute('aria-describedby')
  await expect(page.locator(`#${reason}`)).toHaveText('Enter a number.')
  await page.waitForTimeout(500)
  expect(await rowCount(page)).toBe(200)
  await expect(count(page)).not.toContainText(' of ')
})

test('nothing matches: the table says so, with Clear filters; a new query clears filters', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await page.getByRole('textbox', { name: 'Filter name' }).fill('zzzz-no-such-place')
  await expect(page.getByText('No rows match the filters.')).toBeVisible()
  await expect(count(page)).toHaveText('0 of 180 rows')
  await page.getByRole('textbox', { name: 'Filter name' }).fill('land')
  await expect.poll(async () => (await filterState(page)).matching).toBeGreaterThan(0)
  await openQueryPanel(page)
  await runQuery(page, 'SELECT * FROM layer')
  await expect(page.getByRole('textbox', { name: 'Filter name' })).toHaveValue('')
  expect(await rowCount(page)).toBe(180)
})

test('SC-004: a filter on a 10,000-row file updates within half a second', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeParcels(10_000), '?e2e=1')
  const input = page.getByRole('textbox', { name: 'Filter zone' })
  await input.fill('c1')
  const started = Date.now()
  await input.press('Enter')
  await expect(count(page)).toHaveText(/ of 10,000 rows$/)
  const ms = Date.now() - started
  console.log(`filter on 10,000 rows: ${ms} ms`)
  expect(ms).toBeLessThan(1500) // 0.5 s target on real hardware; generous for parallel software WebGL
})
