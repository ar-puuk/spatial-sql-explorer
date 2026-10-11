// T049 (spec 008 US4, FR-019–FR-021, SC-010): the format list grouped by
// geometry, the output CRS (any EPSG code), and every new format written by
// the real build and read back by the real engine (GDAL's readers), with the
// same row count.
import { test, expect, type Page } from '@playwright/test'
import { unzipSync, strFromU8 } from 'fflate'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chooseFormat, exportDialog, exportVia, fixture, formatGroup, openFile, writeParcels } from './helpers'

type Inspected = { rows: number; types: string[]; crs: string | null; columns: string[] }
const inspect = (page: Page, files: Array<{ name: string; bytes: Uint8Array | Buffer }>): Promise<Inspected> =>
  page.evaluate(
    (f) => (window as unknown as { __spatialExplorerE2E: { inspectExport(f: unknown): Promise<Inspected> } }).__spatialExplorerE2E.inspectExport(f),
    files.map((f) => ({ name: f.name, base64: Buffer.from(f.bytes).toString('base64') }))
  )
const crsSelect = (page: Page) => exportDialog(page).getByLabel('Coordinate reference system')

test('formats are grouped by geometry; the group picked decides whether it is written', async ({ page }) => {
  await openFile(page, fixture('wide-50.parquet'), '?e2e=1')
  await page.getByRole('button', { name: 'Export data…' }).click()
  await expect(exportDialog(page).getByLabel('Format', { exact: true })).toBeFocused()
  expect(await formatGroup(page, 'With geometry')).toEqual(['GeoParquet', 'GeoPackage', 'GeoJSON', 'FlatGeobuf', 'Shapefile (zip)', 'KML', 'GeoJSON (newline-delimited)', 'CSV'])
  expect(await formatGroup(page, 'Attributes only')).toEqual(['CSV', 'Parquet', 'Excel workbook', 'JSON'])
  await chooseFormat(page, 'Shapefile (zip)')
  await expect(exportDialog(page)).toContainText('wide-50-export.shp.zip')
  // Shapefile field names: every rename listed before export (FR-021).
  await expect(exportDialog(page)).toContainText('a very long column name 5 → a_very_lon')
  await expect(crsSelect(page)).toBeVisible()
  await chooseFormat(page, 'CSV', 'Attributes only')
  await expect(crsSelect(page)).toHaveCount(0)
  await expect(exportDialog(page).getByLabel('Geometry as')).toHaveCount(0)
  await chooseFormat(page, 'CSV', 'With geometry')
  await expect(exportDialog(page).getByLabel('Geometry as')).toBeVisible()
})

test('any EPSG code: checked by the engine before export, and written', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('usa-utm12n.gpkg'), '?e2e=1')
  await page.getByRole('button', { name: 'Export data…' }).click()
  await chooseFormat(page, 'GeoPackage')
  await expect(crsSelect(page).locator('option')).toHaveText([/^EPSG:26912.* · as the result$/, 'EPSG:4326 · WGS 84', 'EPSG:3857 · Web Mercator', 'Other EPSG code…'])
  await crsSelect(page).selectOption('other')
  const code = exportDialog(page).getByLabel('EPSG code')
  await expect(code).toBeFocused()
  const status = exportDialog(page).locator('#export-epsg-status')
  const exportButton = exportDialog(page).getByRole('button', { name: 'Export…' })
  await expect(exportButton).toBeDisabled()
  await code.fill('999999')
  await expect(status).toContainText('EPSG:999999 is not a known CRS.')
  await expect(code).toHaveAttribute('aria-invalid', 'true')
  await expect(exportButton).toBeDisabled()
  // An unusable code blocks this dialog only, not the toolbar's Export button.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Export data…' })).toBeEnabled()
  await page.getByRole('button', { name: 'Export data…' }).click()
  await expect(code).toHaveValue('999999')
  await code.fill('EPSG:5070')
  await expect(status).toContainText('NAD83 / Conus Albers')
  await expect(exportButton).toBeEnabled()
  await expect(exportDialog(page)).toContainText('reprojected from')
  const { name, bytes } = await exportVia(page, { format: 'GeoPackage' })
  const back = await inspect(page, [{ name, bytes }])
  expect(back.rows).toBe(1)
  expect(back.crs).toBe('5070')

  // The choice is remembered, code included.
  await exportDialog(page).getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Export data…' }).click()
  await expect(crsSelect(page)).toHaveValue('other')
  await expect(exportDialog(page).getByLabel('EPSG code')).toHaveValue('5070')

  // Back to the result's CRS: the code box goes, and nothing is reprojected.
  await crsSelect(page).selectOption('result')
  await expect(exportDialog(page).getByLabel('EPSG code')).toHaveCount(0)
  await expect(exportDialog(page)).not.toContainText('reprojected')
  await expect(crsSelect(page)).toHaveValue('result')
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
  await chooseFormat(page, 'Shapefile (zip)')
  await expect(exportDialog(page)).toContainText('points, lines and polygons are written as separate Shapefiles')
  const { bytes } = await exportVia(page, { format: 'Shapefile (zip)' })
  expect(Object.keys(unzipSync(new Uint8Array(bytes))).filter((n) => n.endsWith('.shp')).sort()).toEqual(['mixed-types_points.shp', 'mixed-types_polygons.shp'])
})

test('without geometry: Excel and JSON', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeParcels(300), '?e2e=1')
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
