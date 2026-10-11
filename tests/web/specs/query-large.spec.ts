// T015 (spec 002, FR-012, quickstart Scenario 7), reworked by spec 007 T042
// (FR-009): a large result no longer asks first. It reports its exact count,
// the table holds every row, and the map draws what is in view.
import { test, expect } from '@playwright/test'
import { openFile, openQueryPanel, rowCount, runQuery, status, writePoints } from './helpers'

test('a 60,000-row result shows its exact count, no prompt, and the map in view', async ({ page }) => {
  test.setTimeout(180000)
  await openFile(page, writePoints(60_000))
  await openQueryPanel(page)

  await runQuery(page, 'SELECT * FROM layer ORDER BY id DESC')
  await expect(page.getByRole('dialog', { name: 'Large result' })).toHaveCount(0)
  await expect(status(page)).toContainText('60,000 rows', { timeout: 60000 })
  expect(await rowCount(page)).toBe(60_000)
  await expect(page.locator('.count.truncated')).toHaveCount(0)
  await expect.poll(async () => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))).toBeGreaterThan(0)
})

test("a multiplied result reports its own total, not the file's", async ({ page }) => {
  test.setTimeout(180000)
  await openFile(page, writePoints(1_000))
  await openQueryPanel(page)
  await runQuery(page, 'SELECT a.* FROM layer a, range(60) b')
  await expect(status(page)).toContainText('60,000 rows', { timeout: 60000 })
  expect(await rowCount(page)).toBe(60_000)
  await expect(page.locator('.drawer-header .count')).toContainText('60,000')
})
