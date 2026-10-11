// T015 (spec 002, FR-012, quickstart Scenario 7): results above 50,000 rows
// ask before anything is rendered.
import { test, expect } from '@playwright/test'
import { openFile, openQueryPanel, rowCount, runQuery, setQuery, editor, status, writePoints } from './helpers'

test('a large result asks first: show the first 50,000, or cancel and keep the previous result', async ({ page }) => {
  test.setTimeout(180000)
  await openFile(page, writePoints(60_000))
  await openQueryPanel(page)

  await setQuery(page, 'SELECT * FROM layer')
  await editor(page).press('Control+Enter')
  const dialog = page.getByRole('dialog', { name: 'Large result' })
  await expect(dialog).toBeVisible({ timeout: 60000 })
  await expect(dialog).toContainText('60,000 rows')
  await expect(dialog.getByRole('button', { name: 'Show first 50,000' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Show first 50,000' }).click()
  await expect(status(page)).toContainText('Showing first 50,000 of 60,000', { timeout: 60000 })
  expect(await rowCount(page)).toBe(50_000)

  // Asked again; Cancel keeps what's shown.
  await setQuery(page, 'SELECT * FROM layer ORDER BY id DESC')
  await editor(page).press('Control+Enter')
  await expect(dialog).toBeVisible({ timeout: 60000 })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(status(page)).toContainText('Cancelled')
  expect(await rowCount(page)).toBe(50_000)

  // Below the threshold: no dialog.
  await runQuery(page, 'SELECT * FROM layer LIMIT 40000')
  await expect(dialog).toBeHidden()
  expect(await rowCount(page)).toBe(40_000)
})

test('a truncated result reports its own total, not the file\'s', async ({ page }) => {
  test.setTimeout(180000)
  await openFile(page, writePoints(1_000))
  await openQueryPanel(page)
  await setQuery(page, 'SELECT a.* FROM layer a, range(60) b')
  await editor(page).press('Control+Enter')
  await page.getByRole('dialog', { name: 'Large result' }).getByRole('button', { name: 'Show first 50,000' }).click({ timeout: 60000 })
  await expect(status(page)).toContainText('Showing first 50,000 of 60,000', { timeout: 60000 })
  await expect(page.locator('.count.truncated')).toHaveText('Showing 50,000 of 60,000 rows')
  await expect(page.locator('.item.truncated')).toHaveText('Showing 50,000 of 60,000')
})
