// Spec 010 phase 9 (T063): the web app's workspace is the open file plus the
// files the user adds; a query names them by file name.
import { test, expect } from '@playwright/test'
import { editor, fixture, openFile, openQueryPanel, runQuery, setQuery, status } from './helpers'

test('an added GeoPackage is read by name, and joined with the open layer', async ({ page }) => {
  await openFile(page, fixture('sample.geojson'))
  await openQueryPanel(page)
  const files = page.getByRole('region', { name: 'Files' })
  await expect(files).toContainText('sample.geojson')
  await expect(files).toContainText('(layer)')

  // Unknown files: a clear message naming the file, never the engine path.
  await runQuery(page, "SELECT count(*) AS n FROM ST_Read('sample.gpkg')")
  await expect(status(page)).toContainText('sample.gpkg')
  await expect(status(page)).not.toContainText('se-source')

  const chooser = page.waitForEvent('filechooser')
  await files.getByRole('button', { name: 'Add files…' }).click()
  await (await chooser).setFiles([fixture('sample.gpkg'), fixture('sample.shp'), fixture('sample.dbf'), fixture('sample.shx'), fixture('sample.prj')])
  await expect(files.getByRole('button', { name: /sample\.gpkg/ })).toBeVisible()
  await expect(files.getByRole('button', { name: /sample\.shp/ })).toBeVisible()

  await runQuery(page, "SELECT count(*) AS n FROM ST_Read('sample.gpkg')")
  await expect(status(page)).toContainText('✓ 1 row')

  await runQuery(page, "SELECT a.* FROM layer a JOIN ST_Read('sample.shp') b ON ST_Intersects(a.geom, b.geom)")
  await expect(status(page)).toContainText('mapped')
})

test('inside a string literal, the added files are suggested', async ({ page }) => {
  await openFile(page, fixture('sample.geojson'))
  await openQueryPanel(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('region', { name: 'Files' }).getByRole('button', { name: 'Add files…' }).click()
  await (await chooser).setFiles([fixture('sample.gpkg'), fixture('points.csv')])
  await setQuery(page, 'SELECT * FROM ST_Read(')
  await editor(page).press('End')
  await page.keyboard.type("'sam", { delay: 30 })
  const list = page.locator('.cm-tooltip-autocomplete')
  await expect(list.locator('.cm-completionLabel', { hasText: 'sample.gpkg' })).toBeVisible()
  await expect(list).not.toContainText('points.csv')
  await expect(list).not.toContainText('sample.geojson') // the open file is `layer`
})
