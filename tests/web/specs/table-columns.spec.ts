// T023 (spec 008 US2, FR-008/FR-009, SC-003): the column chooser.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile, openQueryPanel, runQuery } from './helpers'

const chooser = (page: Page) => page.getByRole('dialog', { name: 'Choose columns' })
const headers = (page: Page) => page.locator('.attribute-table thead th[aria-sort] .sort .label').allTextContents()
const columnsButton = (page: Page) => page.getByRole('button', { name: /^Columns/ })

test('hide all but five columns: the table fits, and the choice is kept for this file', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openFile(page, fixture('wide-50.parquet'))
  expect((await headers(page)).length).toBe(49) // 50 columns, the geometry drawn on the map
  await columnsButton(page).click()
  await expect(chooser(page)).toBeVisible()
  await expect(chooser(page).getByRole('searchbox', { name: 'Find column' })).toBeFocused()

  // Hide all keeps one column and says so.
  await chooser(page).getByRole('button', { name: 'Hide all' }).click()
  await expect(chooser(page)).toContainText('at least one column stays visible')
  expect(await headers(page)).toEqual(['id'])
  // The last visible column can't be hidden.
  await chooser(page).getByRole('checkbox', { name: 'id' }).click()
  await expect(chooser(page).getByRole('checkbox', { name: 'id' })).toBeChecked()

  // Search, then tick four more.
  const find = chooser(page).getByRole('searchbox', { name: 'Find column' })
  await find.fill('text_')
  await expect(chooser(page).getByRole('checkbox')).toHaveCount(8)
  for (const name of ['text_6', 'text_12']) await chooser(page).getByRole('checkbox', { name, exact: true }).check()
  await find.fill('dbl_2')
  await chooser(page).getByRole('checkbox', { name: 'dbl_2', exact: true }).check()
  await find.fill('flag_3')
  await chooser(page).getByRole('checkbox', { name: 'flag_3', exact: true }).check()
  expect(await headers(page)).toEqual(['id', 'dbl_2', 'flag_3', 'text_6', 'text_12'])
  await expect(columnsButton(page)).toHaveText('Columns (44 hidden)')

  await page.keyboard.press('Escape')
  await expect(chooser(page)).toHaveCount(0)
  // SC-003: no sideways scrolling.
  const overflow = await page.locator('.attribute-table').evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)

  // Reopening the same file keeps the choice (the web shell keeps it in local storage).
  await openFile(page, fixture('wide-50.parquet'))
  await expect.poll(() => headers(page)).toEqual(['id', 'dbl_2', 'flag_3', 'text_6', 'text_12'])

  // Show all brings everything back.
  await columnsButton(page).click()
  await chooser(page).getByRole('button', { name: 'Show all' }).click()
  expect((await headers(page)).length).toBe(49)
})

test('another file starts with every column; a query with other columns shows all of them', async ({ page }) => {
  await openFile(page, fixture('wide-50.parquet'))
  await columnsButton(page).click()
  await chooser(page).getByRole('button', { name: 'Hide all' }).click()
  await page.keyboard.press('Escape')
  expect(await headers(page)).toEqual(['id'])

  // A result with different columns is shown in full; the file's choice comes back with the file's columns.
  await openQueryPanel(page)
  await runQuery(page, 'SELECT id, text_6, geom FROM layer')
  expect(await headers(page)).toEqual(['id', 'text_6'])
  await runQuery(page, 'SELECT * FROM layer')
  await expect.poll(() => headers(page)).toEqual(['id'])

  await openFile(page, fixture('world-boundaries.geojson'))
  await expect.poll(() => headers(page)).toEqual(['id', 'name'])
})
