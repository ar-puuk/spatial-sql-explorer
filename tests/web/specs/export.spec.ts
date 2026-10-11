// Spec 005 (export), browser tests in the real web build. Downloads are
// captured and their bytes checked: GeoJSON parsed in Node, Parquet read back
// by the real engine through the ?e2e=1 hook.
// T012: US1 (quickstart Scenarios 1-2).
import { test, expect, type Page } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { exportDialog as dialog, exportVia, fixture, inspectParquet, openFile, openQueryPanel, runQuery, writeParcels, writePoints } from './helpers'

const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
test.describe('export: GeoJSON, GeoParquet and CSV (US1)', () => {
  test('converting a whole file: all 22,000 rows, GeoParquet with WGS84 metadata', async ({ page }) => {
    test.setTimeout(180000)
    const source = writeParcels(22_000)
    const before = sha(source)
    await openFile(page, source, '?e2e=1')
    // Spec 007 FR-009: nothing is display-limited, so there is no rows choice.
    await page.getByRole('button', { name: 'Export data…' }).click()
    await expect(dialog(page).getByRole('radiogroup', { name: 'Rows' })).toHaveCount(0)
    const { name, bytes } = await exportVia(page, { format: 'GeoParquet' })
    expect(name).toBe('parcels-22000-export.parquet')
    await expect(dialog(page)).toContainText('22,000 rows')
    const p = await inspectParquet(page, bytes)
    expect(p.rows).toBe(22_000)
    expect(p.geoKeys).toBe(1)
    expect(p.geo).toMatchObject({ version: '1.1.0', primary_column: 'geom', columns: { geom: { encoding: 'WKB', geometry_types: ['Polygon'] } } })
    expect(p.geo.columns.geom.crs).toBeUndefined() // WGS84 lon/lat: GeoParquet's default
    expect(p.columns).toEqual(expect.arrayContaining(['parcel_id', 'zone', 'acres', 'value', 'owner', 'geom']))
    expect(sha(source)).toBe(before) // SC-007
  })

  test('a filtered result to GeoJSON, GeoParquet and CSV; X/Y for points', async ({ page }) => {
    test.setTimeout(180000)
    const source = writeParcels(22_000)
    const before = sha(source)
    await openFile(page, source, '?e2e=1')
    await openQueryPanel(page)
    await runQuery(page, "SELECT * FROM layer WHERE zone = 'R1'")

    const gj = await exportVia(page, { format: 'GeoJSON' })
    expect(gj.name).toBe('parcels-22000-export.geojson')
    const doc = JSON.parse(gj.bytes.toString('utf8'))
    expect(doc.type).toBe('FeatureCollection')
    expect(doc.crs).toBeUndefined()
    expect(doc.features).toHaveLength(4400)
    const [lon, lat] = doc.features[0].geometry.coordinates[0][0]
    expect(lon).toBeGreaterThan(-113)
    expect(lon).toBeLessThan(-111)
    expect(lat).toBeGreaterThan(40)
    expect(lat).toBeLessThan(42)
    expect(doc.features[0].properties).toMatchObject({ zone: 'R1' })
    expect(typeof doc.features[0].properties.acres).toBe('number')

    const gp = await exportVia(page, { format: 'GeoParquet' })
    expect((await inspectParquet(page, gp.bytes)).rows).toBe(4400)

    const csv = await exportVia(page, { format: 'CSV', geometry: 'WKT text' })
    const lines = csv.bytes.toString('utf8').trim().split('\n')
    expect(lines).toHaveLength(4401)
    expect(lines[0].split(',')).toContain('geom')
    expect(lines[1]).toMatch(/POLYGON/)
    expect(sha(source)).toBe(before)

    // Points: X / Y columns.
    await openFile(page, writePoints(50), '?e2e=1')
    const xy = await exportVia(page, { format: 'CSV', geometry: 'X / Y columns' })
    const rows = xy.bytes.toString('utf8').trim().split('\n')
    expect(rows[0]).toBe('id,x,y')
    expect(rows).toHaveLength(51)
    expect(Number(rows[1].split(',')[1])).toBeCloseTo(-114, 3)
  })

  test('invalid geometry is written as an empty geometry, and announced', async ({ page }) => {
    await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
    await page.getByRole('button', { name: 'Export data…' }).click()
    await expect(dialog(page)).toContainText('1 row has no valid geometry')
    const gj = await exportVia(page, { format: 'GeoJSON' })
    const doc = JSON.parse(gj.bytes.toString('utf8'))
    expect(doc.features).toHaveLength(180)
    expect(doc.features.filter((f: { geometry: unknown }) => f.geometry === null)).toHaveLength(1)
  })
})

// T017: US2, the CRS (quickstart Scenario 3).
test.describe('export keeps the CRS honestly (US2)', () => {
  test('a projected layer exports in its own CRS (full PROJJSON) or in WGS84; GeoJSON is WGS84 only', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('usa-utm12n.gpkg'), '?e2e=1')
    const own = await exportVia(page, { format: 'GeoParquet', crs: 'result' })
    const p = await inspectParquet(page, own.bytes)
    expect(p.rows).toBe(1)
    expect(p.geoKeys).toBe(1)
    const col = p.geo.columns.geom
    expect(col.crs.type).toBe('ProjectedCRS')
    expect(col.crs.id).toEqual({ authority: 'EPSG', code: 26912 })
    expect(Math.abs(col.bbox[0])).toBeGreaterThan(1000) // metres, not degrees

    const wgs = await exportVia(page, { format: 'GeoParquet', crs: 'wgs84' })
    const w = (await inspectParquet(page, wgs.bytes)).geo.columns.geom
    expect(w.crs).toBeUndefined()
    expect(w.bbox[0]).toBeGreaterThan(-180)
    expect(w.bbox[2]).toBeLessThan(180)

    await dialog(page).getByLabel('Format', { exact: true }).selectOption({ label: 'GeoJSON' })
    const crs = dialog(page).getByLabel('CRS')
    await expect(crs).toBeDisabled()
    await expect(crs).toContainText('required by GeoJSON')
    const gj = await exportVia(page, { format: 'GeoJSON' })
    const [lon, lat] = JSON.parse(gj.bytes.toString('utf8')).features[0].geometry.coordinates[0][0][0]
    expect(lon).toBeGreaterThan(-180)
    expect(lon).toBeLessThan(-60)
    expect(lat).toBeGreaterThan(10)
    expect(lat).toBeLessThan(80)
  })

  test('an overridden result CRS is the one written', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('usa-utm12n.gpkg'), '?e2e=1')
    await openQueryPanel(page)
    await runQuery(page, "SELECT name, ST_Transform(geom, 'EPSG:26912', 'EPSG:3857', always_xy := true) AS geom FROM layer")
    await page.locator('.result-crs .chip').click()
    await page.getByRole('dialog', { name: 'Result CRS' }).getByLabel('EPSG code').fill('3857')
    await page.getByRole('dialog', { name: 'Result CRS' }).getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('.result-crs')).toContainText('3857')
    const out = await exportVia(page, { format: 'GeoParquet', crs: 'result' })
    const geo = (await inspectParquet(page, out.bytes)).geo
    expect(geo.columns.geom.crs.id).toEqual({ authority: 'EPSG', code: 3857 })
  })
})

// T021: US3, only verified formats (quickstart Scenario 4).
test.describe('formats offered (US3)', () => {
  test('geometry results: the spatial formats (spec 008); table results: the attribute formats', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(500), '?e2e=1')
    await page.getByRole('button', { name: 'Export data…' }).click()
    const formats = dialog(page).getByLabel('Format', { exact: true }).locator('option')
    await expect(formats).toHaveText(['GeoParquet', 'GeoPackage', 'GeoJSON', 'FlatGeobuf', 'Shapefile (zip)', 'KML', 'GeoJSON (newline-delimited)', 'CSV'])
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    await openQueryPanel(page)
    await runQuery(page, 'SELECT zone, count(*)::INTEGER AS n FROM layer GROUP BY zone ORDER BY zone')
    await page.getByRole('button', { name: 'Export data…' }).click()
    await expect(formats).toHaveText(['CSV', 'Parquet', 'Excel workbook', 'JSON'])
    await expect(dialog(page).getByLabel('CRS')).toHaveCount(0)
    const out = await exportVia(page, { format: 'Parquet' })
    const p = await inspectParquet(page, out.bytes)
    expect(p.rows).toBe(5)
    expect(p.columns).toEqual(['zone', 'n'])
    expect(p.geoKeys).toBe(0)
  })
})

// T023: US4, large exports (quickstart Scenario 5).
test.describe('large exports stay responsive (US4)', () => {
  test('progress while writing; cancel stops it, saves nothing, leaves nothing behind', async ({ page }) => {
    test.setTimeout(300000)
    await openFile(page, writeParcels(100_000, 'parcels-100k.geojson'), '?e2e=1')

    // 100,000 polygons to GeoJSON: rows-written progress, then a download.
    await page.getByRole('button', { name: 'Export data…' }).click()
    await dialog(page).getByLabel('Format', { exact: true }).selectOption({ label: 'GeoJSON' })
    const done = page.waitForEvent('download', { timeout: 120000 })
    await dialog(page).getByRole('button', { name: 'Export…' }).click()
    await expect(dialog(page).getByRole('status').filter({ hasText: /rows written/ })).toBeVisible({ timeout: 30000 })
    await done
    await expect(dialog(page)).toContainText('Saved')
    await dialog(page).getByRole('button', { name: 'Done' }).click()

    // A slow export (1,000,000 rows), cancelled once it is running.
    await openQueryPanel(page)
    await runQuery(page, 'SELECT a.* FROM layer a, range(10) b')
    // Spec 007 FR-009: no prompt; the whole result is the export.
    await expect(page.locator('.query-status')).toContainText('1,000,000 rows', { timeout: 120000 })
    await page.getByRole('button', { name: 'Export data…' }).click()
    await dialog(page).getByLabel('Format', { exact: true }).selectOption({ label: 'GeoJSON' })
    let downloaded = false
    page.on('download', () => (downloaded = true))
    await dialog(page).getByRole('button', { name: 'Export…' }).click()
    await expect(dialog(page).getByRole('status').filter({ hasText: /rows written/ })).toBeVisible({ timeout: 30000 })
    const t0 = Date.now()
    await dialog(page).getByRole('button', { name: 'Cancel export' }).click()
    await expect(dialog(page)).toContainText('Export cancelled. Nothing was saved.', { timeout: 3000 })
    expect(Date.now() - t0).toBeLessThan(3000) // SC-004
    await page.waitForTimeout(1000)
    expect(downloaded).toBe(false)
    const left = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { exportFiles: () => Promise<unknown[]> } }).__spatialExplorerE2E.exportFiles())
    expect(left).toEqual([])

    // The engine still works.
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await runQuery(page, 'SELECT 42 AS answer')
    await expect(page.locator('.query-status')).toContainText('1 row')
  })
})
