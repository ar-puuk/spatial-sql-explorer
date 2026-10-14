// T040 (spec 002, US4, FR-015; quickstart Scenario 4): suggestions come from
// the live catalog: the file's columns (with types), spatial functions
// (with signature and description), and temp tables created by queries.
import { test, expect, type Page } from '@playwright/test'
import { editor, fixture, openFile, openQueryPanel, runQuery, setQuery } from './helpers'

const list = (page: Page) => page.locator('.cm-tooltip-autocomplete')
const option = (page: Page, label: string) => list(page).locator('li', { hasText: label })

async function complete(page: Page, prefix: string, typed: string): Promise<void> {
  await setQuery(page, prefix)
  await editor(page).press('End')
  await page.keyboard.type(typed, { delay: 30 })
  await expect(list(page)).toBeVisible()
}

test('columns with types, spatial functions with docs, and temp tables are suggested', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  await openQueryPanel(page)

  await complete(page, 'SELECT ', 'na')
  await expect(option(page, 'name').first()).toBeVisible()
  await expect(option(page, 'name').first()).toContainText('VARCHAR')
  await page.keyboard.press('Escape')

  await complete(page, 'SELECT ', 'ST_Ar')
  await expect(list(page).locator('li').first()).toContainText('ST_Area')
  await expect(page.locator('.cm-completionInfo')).toContainText('area')
  await expect(list(page).locator('li').first()).toContainText('→ DOUBLE')
  await page.keyboard.press('Escape')

  await runQuery(page, 'CREATE TEMP TABLE big AS SELECT * FROM layer WHERE ST_Area(geom) > 50')
  await complete(page, 'SELECT * FROM ', 'bi')
  await expect(list(page).locator('.cm-completionLabel', { hasText: /^big$/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // Internal objects are never suggested.
  await setQuery(page, 'SELECT * FROM ')
  await editor(page).press('End')
  await page.keyboard.type('__', { delay: 30 })
  await page.keyboard.press('Control+Space')
  await expect(list(page).locator('li', { hasText: '__se_' })).toHaveCount(0)
})

test("the file's own name is suggested; a multi-layer file's layers after its name and a dot", async ({ page }) => {
  await openFile(page, fixture('three-layers.gpkg'))
  await openQueryPanel(page)
  await complete(page, 'SELECT * FROM ', 'three')
  await expect(list(page).locator('.cm-completionLabel', { hasText: /^three_layers$/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await complete(page, 'SELECT * FROM ', 'three_layers.')
  for (const name of ['countries', 'city_points', 'lookup_table']) await expect(list(page).locator('.cm-completionLabel', { hasText: new RegExp(`^${name}$`) })).toBeVisible()
  await page.keyboard.press('Escape')
  // Columns of a layer in the schema.
  await complete(page, 'SELECT * FROM three_layers.city_points p WHERE p.', '')
  await expect(list(page).locator('li').first()).toBeVisible()
})
