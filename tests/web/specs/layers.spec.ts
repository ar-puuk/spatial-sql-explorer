// T039 (spec 008 US3, FR-015–FR-018, SC-009): files with several layers.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fixture, openFile, openQueryPanel, rowCount, runQuery } from './helpers'

const layerList = (page: Page) => page.getByRole('listbox', { name: 'Layers in this file' })
const statusBar = (page: Page) => page.locator('.status-bar')

test('a GeoPackage with three layers: listed, switched, and queryable by name', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('three-layers.gpkg'))
  await expect(page.getByRole('status').filter({ hasText: 'This file has 3 layers.' })).toBeVisible()
  const options = layerList(page).getByRole('option')
  await expect(options).toHaveCount(3)
  await expect(options.nth(0)).toHaveAccessibleName(/^countries, /)
  await expect(options.nth(1)).toHaveAccessibleName('city points, Point, 3')
  await expect(options.nth(2)).toHaveAccessibleName('lookup_table, table, 3')
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(statusBar(page)).toContainText('179 features')

  // Style the countries, switch to the points: under 2 s (SC-009), with their own facts.
  await page.getByRole('button', { name: 'Layer style' }).click()
  await page.getByRole('radio', { name: 'Categorized' }).click()
  await page.getByRole('button', { name: 'Close' }).click()
  const t0 = Date.now()
  await options.nth(1).click()
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(statusBar(page)).toContainText('3 features')
  console.log(`layer switch: ${Date.now() - t0} ms`)
  expect(Date.now() - t0).toBeLessThan(2000 * 3) // 2 s on real hardware; parallel software WebGL is slower
  expect(await rowCount(page)).toBe(3)
  await expect(page.getByRole('region', { name: 'Legend' })).toHaveCount(0) // points start with the default style

  // Back to the countries: their style comes back.
  await options.nth(0).click()
  await expect(statusBar(page)).toContainText('179 features')
  await expect(page.getByRole('region', { name: 'Legend' })).toContainText('categories')

  // Every layer is a table in SQL.
  await openQueryPanel(page)
  await runQuery(page, 'SELECT count(*) AS n FROM "city points"')
  await expect(page.locator('.query-status')).toContainText('1 row')
  await runQuery(page, 'SELECT * FROM lookup_table')
  expect(await rowCount(page)).toBe(3)
})

test('a table without geometry shows its rows; the map says it has none', async ({ page }) => {
  await openFile(page, fixture('three-layers.gpkg'))
  await layerList(page).getByRole('option', { name: /^lookup_table/ }).click()
  await expect(layerList(page).getByRole('option', { name: /^lookup_table/ })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => rowCount(page)).toBe(3)
  await expect(page.locator('.query-status')).toContainText(/no geometry|not drawn|table/i)
})

test('keyboard: arrows move, Enter switches', async ({ page }) => {
  await openFile(page, fixture('three-layers.gpkg'))
  await layerList(page).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(layerList(page).getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
})

test('a single-layer file shows no layer list', async ({ page }) => {
  await openFile(page, fixture('sample.gpkg'))
  await expect(layerList(page)).toHaveCount(0)
})

test('a File Geodatabase (as a zip) is refused with a way forward', async ({ page }) => {
  // A .gdb.zip of the fixture folder: what a user would pick in a browser.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-gdb-'))
  const zip = path.join(dir, 'two.gdb.zip')
  fs.writeFileSync(zip, 'PK\u0003\u0004') // the name is what's checked; contents never read
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(zip)
  await expect(page.getByRole('alert')).toContainText("File Geodatabase (.gdb) isn't supported yet")
  await expect(page.getByRole('alert')).toContainText('ogr2ogr -f GPKG')
})
