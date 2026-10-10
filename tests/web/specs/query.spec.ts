// T014 (spec 002, US1): run a query and see the result on the map and in the
// table (quickstart Scenarios 1 and 6), in the production web build.
import { test, expect } from '@playwright/test'
import { editor, fixture, grid, openFile, openQueryPanel, queryPanel, rowCount, runQuery, setQuery, status } from './helpers'

test('the default query reproduces the initial view, and a filter replaces it', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))

  // Collapsed by default: spec 001's view is unchanged until opened.
  await expect(editor(page)).toBeHidden()
  await openQueryPanel(page)
  await expect(editor(page)).toHaveText('SELECT * FROM layer LIMIT 1000')
  const header = queryPanel(page).locator('.query-table')
  await expect(header).toContainText('layer')
  await expect(header).toContainText('EPSG:4326')
  await expect(header).toContainText('180 rows')
  expect(await rowCount(page)).toBe(180)

  await runQuery(page, "SELECT * FROM layer WHERE name LIKE 'U%'")
  await expect(status(page)).toContainText('✓ 8 rows · 8 mapped')
  expect(await rowCount(page)).toBe(8)
  await expect(page.locator('.drawer-header .count')).toHaveText('8 features')
  await expect(page.locator('.status-bar')).toContainText('Polygon')
  await expect.poll(async () => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))).toBeGreaterThan(0)

  // Spec 001 interactions still work on results: selection and the inspector.
  await grid(page).locator('tbody tr:not(.spacer)').first().click()
  await expect(grid(page).locator('tbody tr.selected')).toHaveCount(1)
})

test('a result without geometry shows in the table only (FR-006)', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  await openQueryPanel(page)
  await runQuery(page, 'SELECT left(name, 1) AS letter, count(*) AS n FROM layer GROUP BY 1 ORDER BY 1')
  await expect(status(page)).toContainText('✓ 25 rows · no geometry to map')
  expect(await rowCount(page)).toBe(25)
  await expect(page.locator('.map-notice')).toContainText('no geometry to map')
})

test('measurements use the source CRS; results are drawn from the resolved CRS (FR-014)', async ({ page }) => {
  await openFile(page, fixture('usa-utm12n.gpkg'))
  await openQueryPanel(page)
  await expect(queryPanel(page).locator('.query-table')).toContainText('EPSG:26912')

  // Area in real units (m² from UTM): measured 10,179,527,591,736 m² in Phase 0.
  await runQuery(page, 'SELECT name, round(ST_Area(geom) / 1e6) AS km2, geom FROM layer')
  await expect(grid(page).locator('tbody tr:not(.spacer)').first()).toContainText('10179528')
  await expect(page.locator('.result-crs')).toContainText('EPSG:26912')
  await expect(page.locator('.result-crs')).toContainText('layer')

  await runQuery(page, "SELECT ST_Transform(geom, 'EPSG:26912', 'EPSG:4326', always_xy := true) AS geom FROM layer")
  await expect(page.locator('.result-crs')).toContainText('EPSG:4326')
  await expect(page.locator('.result-crs')).toContainText('detected')
  await expect.poll(async () => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))).toBeGreaterThan(0)
})

test('Reset restores the original view: query, rows, extent and style (US3, FR-011)', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  const initialScale = await page.locator('.maplibregl-ctrl-scale').textContent()
  await openQueryPanel(page)

  // Change the view: a filter and a different fill color.
  await runQuery(page, "SELECT * FROM layer WHERE name LIKE 'U%'")
  expect(await rowCount(page)).toBe(8)
  await page.getByRole('button', { name: 'Layer style' }).click()
  await page.getByRole('dialog', { name: 'Layer style' }).locator('input[type="color"]').first().fill('#ff0000')
  await page.getByRole('button', { name: 'Layer style' }).click()

  // Unedited since the last run: Reset needs no confirmation.
  await page.getByRole('button', { name: 'Reset to the original view' }).click()
  await expect(editor(page)).toHaveText('SELECT * FROM layer LIMIT 1000')
  expect(await rowCount(page)).toBe(180)
  await expect(page.locator('.drawer-header .count')).toHaveText('180 rows · 179 mapped')
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveText(initialScale ?? '')
  await page.getByRole('button', { name: 'Layer style' }).click()
  await expect(page.getByRole('dialog', { name: 'Layer style' }).locator('input[type="color"]').first()).toHaveValue('#3b82f6')
  await page.getByRole('button', { name: 'Layer style' }).click()

  // Edited text: Reset asks first, and "Keep" keeps it.
  await setQuery(page, 'SELECT name FROM layer -- my work')
  await page.getByRole('button', { name: 'Reset to the original view' }).click()
  await expect(queryPanel(page).getByText('Discard your query changes?')).toBeVisible()
  await queryPanel(page).getByRole('button', { name: 'Keep' }).click()
  await expect(editor(page)).toHaveText('SELECT name FROM layer -- my work')
  await page.getByRole('button', { name: 'Reset to the original view' }).click()
  await queryPanel(page).getByRole('button', { name: 'Discard' }).click()
  await expect(editor(page)).toHaveText('SELECT * FROM layer LIMIT 1000')
})
