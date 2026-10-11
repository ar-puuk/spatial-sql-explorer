// T044 (spec 002, US5, FR-016/SC-007; quickstart Scenario 5): per-file query
// history that survives reopening the file, newest first with outcomes, and
// loads an entry into the editor without running it.
import { test, expect, type Page } from '@playwright/test'
import { editor, fixture, openFile, openQueryPanel, rowCount, runQuery, status } from './helpers'

const historyButton = (page: Page) => page.getByRole('button', { name: 'Query history' })
const historyList = (page: Page) => page.getByRole('listbox', { name: 'Query history' })

test('history survives reopening, lists outcomes newest first, and loads without running', async ({ page }) => {
  const file = fixture('world-boundaries.geojson')
  await openFile(page, file)
  await openQueryPanel(page)
  await runQuery(page, "SELECT * FROM layer WHERE name LIKE 'U%'")
  await runQuery(page, 'SELECT nope FROM layer')
  await runQuery(page, 'SELECT name FROM layer LIMIT 3')

  // Reload the page and open the same file again.
  await openFile(page, file)
  await openQueryPanel(page)
  const before = await rowCount(page)
  await historyButton(page).click()
  await expect(historyList(page)).toBeFocused()
  const options = historyList(page).getByRole('option')
  await expect(options).toHaveCount(3)
  await expect(options.nth(0)).toContainText('SELECT name FROM layer LIMIT 3')
  await expect(options.nth(0)).toContainText('✓ 3 rows')
  await expect(options.nth(1)).toContainText('SELECT nope FROM layer')
  await expect(options.nth(1)).toContainText('✗')
  await expect(options.nth(1)).toContainText('"nope"')
  await expect(options.nth(2)).toContainText('✓ 8 rows')
  await expect(options.nth(0)).toContainText('just now')

  // Arrow down to the second entry, Enter loads it; nothing runs.
  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(historyList(page)).toHaveCount(0)
  await expect(editor(page)).toHaveText('SELECT nope FROM layer')
  await expect(editor(page)).toBeFocused()
  await expect(status(page)).toContainText('not run')
  expect(await rowCount(page)).toBe(before)

  // Esc closes the popover and returns focus to the button.
  await historyButton(page).click()
  await expect(historyList(page)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(historyList(page)).toHaveCount(0)
  await expect(historyButton(page)).toBeFocused()
})

test('history is per file', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  await openQueryPanel(page)
  await runQuery(page, 'SELECT name FROM layer LIMIT 2')

  await openFile(page, fixture('points.csv'))
  await openQueryPanel(page)
  await historyButton(page).click()
  await expect(page.getByText('No queries yet for this file.')).toBeVisible()
})
