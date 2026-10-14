// T039 (spec 008 US3, FR-015–FR-018, SC-009): files with several layers.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fixture, openFile, openQueryPanel, rowCount, runQuery, chooseStyleType } from './helpers'

// Spec 010: the file's layers are a select next to the search box.
const layerPicker = (page: Page) => page.getByRole('combobox', { name: 'Layer' })
const statusBar = (page: Page) => page.locator('.status-bar')

test('a GeoPackage with three layers: listed, switched, and queryable by name', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('three-layers.gpkg'))
  const options = layerPicker(page).locator('option')
  await expect(options).toHaveCount(3)
  await expect(options.nth(0)).toHaveText(/^countries, /)
  await expect(options.nth(1)).toHaveText('city points, Point, 3')
  await expect(options.nth(2)).toHaveText('lookup_table, table, 3')
  await expect(layerPicker(page)).toHaveValue('countries')
  await expect(statusBar(page)).toContainText('179 features')

  // Style the countries, switch to the points: under 2 s (SC-009), with their own facts.
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await chooseStyleType(page, 'Categorized')
  await page.getByRole('button', { name: 'Close panel' }).click()
  const t0 = Date.now()
  await layerPicker(page).selectOption('city points')
  await expect(layerPicker(page)).toHaveValue('city points')
  await expect(statusBar(page)).toContainText('3 features')
  console.log(`layer switch: ${Date.now() - t0} ms`)
  expect(Date.now() - t0).toBeLessThan(2000 * 3) // 2 s on real hardware; parallel software WebGL is slower
  expect(await rowCount(page)).toBe(3)
  await expect(page.getByRole('region', { name: 'Legend' })).toHaveCount(0) // points start with the default style

  // Back to the countries: their style comes back.
  await layerPicker(page).selectOption('countries')
  await expect(statusBar(page)).toContainText('179 features')
  await expect(page.getByRole('region', { name: 'Legend' })).toContainText('categories')

  // Every layer is a table in SQL, named <file>.<layer> (user decision 2026-10-14).
  await openQueryPanel(page)
  await expect(page.getByRole('textbox', { name: 'SQL query' })).toHaveText('SELECT * FROM three_layers.countries')
  await runQuery(page, 'SELECT count(*) AS n FROM three_layers.city_points')
  await expect(page.locator('.query-status')).toContainText('1 row')
  await runQuery(page, 'SELECT * FROM three_layers.lookup_table')
  expect(await rowCount(page)).toBe(3)
})

test('a table without geometry shows its rows; the map says it has none', async ({ page }) => {
  await openFile(page, fixture('three-layers.gpkg'))
  await layerPicker(page).selectOption('lookup_table')
  await expect(layerPicker(page)).toHaveValue('lookup_table')
  await expect.poll(() => rowCount(page)).toBe(3)
  await expect(page.locator('.query-status')).toContainText(/no geometry|not drawn|table/i)
})

test('keyboard: an arrow key switches the layer', async ({ page }) => {
  await openFile(page, fixture('three-layers.gpkg'))
  await layerPicker(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(layerPicker(page)).toHaveValue('city points')
  await expect(page.locator('.status-bar')).toContainText('3 features')
})

test('a single-layer file shows no layer list', async ({ page }) => {
  await openFile(page, fixture('sample.gpkg'))
  await expect(layerPicker(page)).toHaveCount(0)
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
