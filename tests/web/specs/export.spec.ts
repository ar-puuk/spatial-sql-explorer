// Spec 005 (export), browser tests in the real web build. Downloads are
// captured and their bytes checked: GeoJSON parsed in Node, Parquet read back
// by the real engine through the ?e2e=1 hook.
// T012: US1 (quickstart Scenarios 1-2).
import { test, expect, type Page } from '@playwright/test'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { fixture, openFile, openQueryPanel, runQuery, writeParcels, writePoints } from './helpers'

const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export data' })

/** Opens the dialog, sets choices, exports, and returns the downloaded bytes. */
export async function exportVia(page: Page, choices: { format: string; rows?: string; crs?: 'result' | 'wgs84'; geometry?: string }): Promise<{ name: string; bytes: Buffer }> {
  if (!(await dialog(page).isVisible())) await page.getByRole('button', { name: 'Export data…' }).click()
  await expect(dialog(page)).toBeVisible()
  if (choices.rows) await dialog(page).getByRole('radio', { name: choices.rows }).click()
  await dialog(page).getByRole('radio', { name: choices.format, exact: true }).click()
  if (choices.crs) await dialog(page).getByLabel('CRS').selectOption(choices.crs)
  if (choices.geometry) await dialog(page).getByRole('radio', { name: choices.geometry }).click()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), dialog(page).getByRole('button', { name: 'Export…' }).click()])
  const file = await download.path()
  await expect(dialog(page).getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(file) }
}

export async function inspectParquet(page: Page, bytes: Buffer) {
  return page.evaluate(
    (b64) =>
      (
        window as unknown as {
          __spatialExplorerE2E: { inspectParquet: (b: string) => Promise<{ rows: number; columns: string[]; geo: any; geoKeys: number }> }
        }
      ).__spatialExplorerE2E.inspectParquet(b64),
    bytes.toString('base64')
  )
}

test.describe('export: GeoJSON, GeoParquet and CSV (US1)', () => {
  test('converting a whole file: "All 22,000 rows" by default, GeoParquet with WGS84 metadata', async ({ page }) => {
    test.setTimeout(180000)
    const source = writeParcels(22_000)
    const before = sha(source)
    await openFile(page, source, '?e2e=1')
    await page.getByRole('button', { name: 'Export data…' }).click()
    await expect(dialog(page).getByRole('radio', { name: 'All 22,000 rows' })).toHaveAttribute('aria-checked', 'true')
    await expect(dialog(page).getByRole('radio', { name: 'Only the 1,000 shown' })).toBeVisible()
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
