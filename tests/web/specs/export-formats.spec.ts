// T049 (spec 008 US4, FR-019–FR-021, SC-010): the "Include geometry" switch,
// the grouped format list, and every new format written by the real build and
// read back by the real engine (GDAL's readers), with the same row count.
import { test, expect, type Page } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exportDialog, exportVia, fixture, openFile, writeParcels } from './helpers'

type Inspected = { rows: number; types: string[]; crs: string | null; columns: string[] }
const inspect = (page: Page, files: Array<{ name: string; bytes: Uint8Array | Buffer }>): Promise<Inspected> =>
  page.evaluate(
    (f) => (window as unknown as { __spatialExplorerE2E: { inspectExport(f: unknown): Promise<Inspected> } }).__spatialExplorerE2E.inspectExport(f),
    files.map((f) => ({ name: f.name, base64: Buffer.from(f.bytes).toString('base64') }))
  )
const formats = (page: Page) => exportDialog(page).getByLabel('Format', { exact: true }).locator('option').allTextContents()

test('the geometry switch picks the list; an invalid choice is replaced, and says so', async ({ page }) => {
  await openFile(page, fixture('wide-50.parquet'), '?e2e=1')
  await page.getByRole('button', { name: 'Export data…' }).click()
  const toggle = exportDialog(page).getByRole('switch', { name: 'Include geometry' })
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  expect(await formats(page)).toEqual(['GeoParquet', 'GeoPackage', 'GeoJSON', 'FlatGeobuf', 'Shapefile (zip)', 'KML', 'GeoJSON (newline-delimited)', 'CSV'])
  await exportDialog(page).getByLabel('Format', { exact: true }).selectOption({ label: 'Shapefile (zip)' })
  // Shapefile field names: every rename listed before export (FR-021).
  await expect(exportDialog(page)).toContainText('a very long column name 5 → a_very_lon')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(await formats(page)).toEqual(['CSV', 'Parquet', 'Excel workbook', 'JSON'])
  await expect(exportDialog(page).getByRole('status').filter({ hasText: "Shapefile (zip) isn't available without geometry: using CSV." })).toBeVisible()
})

for (const [label, ext] of [
  ['GeoPackage', '.gpkg'],
  ['FlatGeobuf', '.fgb'],
  ['KML', '.kml'],
  ['GeoJSON (newline-delimited)', '.geojsonl'],
] as const) {
  test(`${label}: written and read back with the same rows`, async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(500), '?e2e=1')
    const { name, bytes } = await exportVia(page, { format: label })
    expect(name).toBe(`parcels-500-export${ext}`)
    const back = await inspect(page, [{ name, bytes }])
    expect(back.rows).toBe(500)
    expect(back.types).toEqual(['POLYGON'])
    if (label !== 'KML') expect(back.columns).toEqual(expect.arrayContaining(['parcel_id', 'zone', 'value']))
    if (label === 'KML' || label === 'GeoJSON (newline-delimited)') return // not formats the app opens
    // Our own exports reopen in the app (GeoPackage needs GDAL's feature-count table for that).
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-reopen-')), name)
    fs.writeFileSync(file, bytes)
    await openFile(page, file, '?e2e=1')
    await expect(page.locator('.status-bar')).toContainText('500 features')
  })
}

test('Shapefile (zip): one set, the CRS kept, read back with the same rows', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('usa-utm12n.gpkg'), '?e2e=1')
  const { name, bytes } = await exportVia(page, { format: 'Shapefile (zip)', crs: 'result' })
  expect(name).toBe('usa-utm12n-export.shp.zip')
  const files = unzipSync(new Uint8Array(bytes))
  const names = Object.keys(files).sort()
  expect(names).toEqual(['usa-utm12n.cpg', 'usa-utm12n.dbf', 'usa-utm12n.prj', 'usa-utm12n.shp', 'usa-utm12n.shx'])
  expect(strFromU8(files['usa-utm12n.prj'])).toMatch(/UTM zone 12N/)
  const shp = names.find((n) => n.endsWith('.shp'))!
  const back = await inspect(page, [shp, ...names.filter((n) => n !== shp)].map((n) => ({ name: n, bytes: files[n] })))
  expect(back.rows).toBe(1)
  expect(back.crs).toBe('26912')
})

test('a mixed result as Shapefile: one set per geometry type', async ({ page }) => {
  await openFile(page, fixture('mixed-types.geojson'), '?e2e=1')
  await page.getByRole('button', { name: 'Export data…' }).click()
  await exportDialog(page).getByLabel('Format', { exact: true }).selectOption({ label: 'Shapefile (zip)' })
  await expect(exportDialog(page)).toContainText('points, lines and polygons are written as separate Shapefiles')
  const { bytes } = await exportVia(page, { format: 'Shapefile (zip)' })
  expect(Object.keys(unzipSync(new Uint8Array(bytes))).filter((n) => n.endsWith('.shp')).sort()).toEqual(['mixed-types_points.shp', 'mixed-types_polygons.shp'])
})

test('without geometry: Excel and JSON', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeParcels(300), '?e2e=1')
  await page.getByRole('button', { name: 'Export data…' }).click()
  await exportDialog(page).getByRole('switch', { name: 'Include geometry' }).click()
  const xlsx = await exportVia(page, { format: 'Excel workbook' })
  expect(xlsx.name).toBe('parcels-300-export.xlsx')
  const sheet = strFromU8(unzipSync(new Uint8Array(xlsx.bytes))['xl/worksheets/sheet1.xml'])
  expect(sheet.match(/<row /g)).toHaveLength(301)
  expect(sheet).not.toContain('POLYGON')

  await exportDialog(page).getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Export data…' }).click()
  const json = await exportVia(page, { format: 'JSON' })
  const rows = JSON.parse(json.bytes.toString('utf8')) as Array<Record<string, unknown>>
  expect(rows).toHaveLength(300)
  expect(Object.keys(rows[0])).not.toContain('geom')
})

// Spec 008 (user request): the CRS picker (every CRS the engine knows,
// grouped as QGIS/ArcGIS do, searchable) and the output file name.
test('CRS picker: pinned, suggested for the data, grouped and searchable; the CRS and the name are written', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('usa-utm12n.gpkg'), '?e2e=1')
  await page.getByRole('button', { name: 'Export data…' }).click()
  await exportDialog(page).getByLabel('Format', { exact: true }).selectOption({ label: 'GeoPackage' })
  const trigger = exportDialog(page).getByLabel('CRS', { exact: true })
  await expect(trigger).toContainText('EPSG:26912')
  await expect(trigger).toContainText('as the result')
  await trigger.click()
  const search = page.getByRole('combobox', { name: 'Search coordinate reference systems' })
  await expect(search).toBeFocused()
  const tree = page.getByRole('tree', { name: 'Coordinate reference systems' })
  const sections = tree.locator('.section-name')
  await expect(sections.first()).toHaveText('Pinned')
  const names = await sections.allTextContents()
  expect(names).toEqual(expect.arrayContaining(['Suggested for this data', 'Geographic', 'Universal Transverse Mercator (UTM)', 'US State Plane', 'Lambert Conformal Conic', 'World']))
  const pinned = await tree.locator('[aria-level="2"]').allTextContents()
  expect(pinned[0]).toMatch(/as the result/)
  expect(pinned[1]).toMatch(/WGS 84.*4326/)
  expect(pinned[2]).toMatch(/Pseudo-Mercator.*3857/)
  // Groups start collapsed; one opens on click.
  const utm = tree.locator('.section', { hasText: 'Universal Transverse Mercator (UTM)' })
  await expect(utm.locator('xpath=..')).toHaveAttribute('aria-expanded', 'false')
  await utm.click()
  await expect(utm.locator('xpath=..')).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.getByRole('treeitem', { name: /NAD83 \/ UTM zone 12N/ }).first()).toBeVisible()

  // Search by name, choose with the keyboard.
  await search.fill('conus albers')
  await expect(tree.locator('[aria-level="2"]').first()).toContainText('NAD83 / Conus Albers')
  await search.press('Enter')
  await expect(search).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveText(/EPSG:5070 · NAD83 \/ Conus Albers/)
  await expect(exportDialog(page)).toContainText('Coordinates are reprojected to EPSG:5070.')

  // The file name: the default, the format's extension, and a typed name.
  const name = exportDialog(page).getByLabel('File name')
  await expect(name).toHaveValue('usa-utm12n-export')
  await expect(exportDialog(page).locator('#export-name-ext')).toHaveText('.gpkg')
  const out = await exportVia(page, { format: 'GeoPackage', fileName: 'Conus test.gpkg' })
  expect(out.name).toBe('Conus test.gpkg')
  const back = await inspect(page, [{ name: out.name, bytes: out.bytes }])
  expect(back.rows).toBe(1)
  expect(back.crs).toBe('5070')

  // The next export starts with the default name again; the CRS is remembered.
  await exportDialog(page).getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Export data…' }).click()
  await expect(name).toHaveValue('usa-utm12n-export')
  await expect(trigger).toHaveText(/EPSG:5070/)
})

test('a code the engine does not know: a message, Export disabled in the dialog only', async ({ page }) => {
  await openFile(page, fixture('usa-utm12n.gpkg'), '?e2e=1')
  await page.getByRole('button', { name: 'Export data…' }).click()
  await exportDialog(page).getByLabel('Format', { exact: true }).selectOption({ label: 'GeoPackage' })
  await exportDialog(page).getByLabel('CRS', { exact: true }).click()
  const search = page.getByRole('combobox', { name: 'Search coordinate reference systems' })
  await search.fill('999999')
  await expect(page.getByRole('treeitem', { name: /Use EPSG:999999/ })).toBeVisible()
  await search.press('Enter')
  await expect(exportDialog(page)).toContainText('EPSG:999999 is not a known CRS.')
  await expect(exportDialog(page).getByRole('button', { name: 'Export…' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(exportDialog(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export data…' })).toBeEnabled()
})
