// T035 (spec 007 US3, FR-009–FR-012): the table, styles and export work on
// the whole result, not a displayed subset. parcels-10k.parquet with small
// test caps (materializeCap=4000, jenksSample=2000) exercises the paths that
// large files take: a result too big to copy stays a view, the table pages
// it, Jenks classifies a sample with exact counts, and export writes it all.
import { test, expect, type Page } from '@playwright/test'
import { editor, exportVia, grid, inspectParquet, openFixture, openQueryPanel, rowCount, runQuery } from './helpers'

/** Rows of `layer` with value > 1,000,000, also asserted by the VS Code parity test (T043). */
export const FILTERED_ROWS = 4958

const raw = (page: Page, sql: string): Promise<Array<Record<string, unknown>>> =>
  page.evaluate(
    (s) =>
      (window as unknown as { __spatialExplorerE2E: { runRaw: (sql: string) => Promise<Array<Record<string, unknown>>> } }).__spatialExplorerE2E
        .runRaw(s)
        .then((rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])))),
    sql
  )

const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const legendTotal = async (page: Page): Promise<number> =>
  (await legend(page).locator('li .count').allTextContents()).reduce((a, t) => a + Number(t.replace(/,/g, '')), 0)

test('a result over the materialize cap: exact count, every row in the table, whole-result sort, style and export', async ({ page }) => {
  test.setTimeout(180000)
  await openFixture(page, 'parcels-10k.parquet', '?e2e=1&materializeCap=4000&jenksSample=2000')
  await openQueryPanel(page)
  await expect(editor(page)).toHaveText('SELECT * FROM layer')

  const [{ n }] = await raw(page, 'SELECT count(*) AS n FROM layer WHERE value > 1000000')
  expect(n).toBe(FILTERED_ROWS)
  await runQuery(page, 'SELECT * FROM layer WHERE value > 1000000')
  await expect(page.getByRole('dialog', { name: 'Large result' })).toHaveCount(0)
  await expect(page.locator('.query-status')).toContainText(`${FILTERED_ROWS.toLocaleString('en-US')} rows`)
  expect(await rowCount(page)).toBe(FILTERED_ROWS)

  // Keyboard: End reaches the last row across pages; skeleton rows are busy until loaded.
  await grid(page).locator('tbody tr:not(.spacer):not(.skeleton)').first().click()
  await grid(page).focus()
  await page.keyboard.press('End')
  const last = grid(page).locator(`tbody tr[aria-rowindex="${FILTERED_ROWS + 1}"]`)
  await expect(last).toBeVisible()
  await expect(last).not.toHaveAttribute('aria-busy', 'true')
  await expect(last).toHaveClass(/selected/)
  await page.keyboard.press('PageUp')
  await expect(grid(page).locator('tbody tr[aria-busy="true"]')).toHaveCount(0)

  // Sorting is SQL over the whole result: the first row is the smallest value of all 4,958.
  const [{ lo }] = await raw(page, 'SELECT min(value) AS lo FROM layer WHERE value > 1000000')
  await grid(page).getByRole('columnheader', { name: 'value' }).getByRole('button').click()
  await expect(grid(page).getByRole('columnheader', { name: 'value' })).toHaveAttribute('aria-sort', 'ascending')
  await expect(grid(page).locator('tbody tr:not(.spacer):not(.skeleton)').first()).toContainText(String(lo))

  // Natural breaks over 4,958 values with a 2,000-value sample: the legend says so; counts are exact.
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await page.getByRole('radio', { name: 'Graduated' }).click()
  await page.getByLabel('Column', { exact: true }).selectOption('value')
  await page.getByLabel('Method', { exact: true }).selectOption('jenks')
  await expect(legend(page)).toContainText('Natural breaks, 5 classes (estimated from 2,000 values)')
  await expect.poll(() => legendTotal(page)).toBe(FILTERED_ROWS)
  await page.getByRole('button', { name: 'Style', exact: true }).click()

  // Export writes the whole result.
  const { bytes } = await exportVia(page, { format: 'GeoParquet' })
  expect((await inspectParquet(page, bytes)).rows).toBe(FILTERED_ROWS)
})
