// Research §16 (bug fix, 2026-10-11): GeoPackage layers whose feature ids
// don't run 1..N, SQLite / SpatiaLite databases (Bentley Cube 7 networks),
// and the integer primary key GDAL hides as the feature id. Real engine.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile } from './helpers'

const layerList = (page: Page) => page.getByRole('listbox', { name: 'Layers in this file' })
const statusBar = (page: Page) => page.locator('.status-bar')

async function sql(page: Page, statement: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (s) => {
    const hook = (window as unknown as { __spatialExplorerE2E: { runRaw: (sql: string) => Promise<Array<Record<string, unknown>>> } }).__spatialExplorerE2E
    const rows = await hook.runRaw(s)
    return JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)))
  }, statement)
}

test('a GeoPackage layer with ids that do not start at 1 opens, with its fid', async ({ page }) => {
  await openFile(page, fixture('gapped-ids.gpkg'), '?e2e=1')
  await expect(layerList(page).getByRole('option')).toHaveCount(3)
  // `zones` (ids 101..123) is the first layer with geometry: it used to fail with "thread constructor failed".
  await expect(layerList(page).getByRole('option').nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect(statusBar(page)).toContainText('12 features')
  await expect(page.locator('.canvas-host')).toHaveAttribute('data-rendered-features', /^[1-9]/)
  await expect(page.getByRole('alert')).toHaveCount(0)

  const zones = await sql(page, 'SELECT min(fid) AS lo, max(fid) AS hi, count(*) AS n, count(geom) AS g, min(ST_XMin(geom)) AS x0 FROM layer')
  expect(zones[0]).toEqual({ lo: 101, hi: 123, n: 12, g: 12, x0: -112 })
  // Each id stays with its own row.
  expect(await sql(page, "SELECT fid FROM layer WHERE zone = 'Z4'")).toEqual([{ fid: 107 }])
  // Same column types as GDAL's GeoPackage reader gives.
  const types = Object.fromEntries((await sql(page, 'DESCRIBE layer')).map((r) => [r.column_name, r.column_type]))
  expect(types).toMatchObject({ fid: 'BIGINT', zone: 'VARCHAR', households: 'INTEGER', opened: 'DATE', active: 'BOOLEAN' })
  // The CRS comes from the GeoPackage catalog.
  await expect(statusBar(page)).toContainText('EPSG:4326')

  // The other layers: ids 1..5 (GDAL's fast path) and 7, 9, 11 (no geometry, SQLite driver).
  expect(await sql(page, 'SELECT list(fid ORDER BY fid) AS ids, count(geom) AS g FROM stops')).toEqual([{ ids: [1, 2, 3, 4, 5], g: 5 }])
  expect(await sql(page, 'SELECT list(fid ORDER BY fid) AS ids, list(note ORDER BY fid) AS notes FROM notes')).toEqual([{ ids: [7, 9, 11], notes: ['note 7', 'note 9', 'note 11'] }])
})

test('a GeoPackage with ids 1..N keeps the fast reader and gains its fid', async ({ page }) => {
  await openFile(page, fixture('sample.gpkg'), '?e2e=1')
  const rows = await sql(page, 'SELECT min(fid) AS lo, max(fid) AS hi, count(*) AS n FROM layer')
  expect(rows[0].lo).toBe(1)
  expect(rows[0].hi).toBe(rows[0].n)
})

test('a SQLite network (Cube 7 shape): nodes keep n, links and attribute tables are layers', async ({ page }) => {
  await openFile(page, fixture('cube-network.sqlite'), '?e2e=1')
  const options = layerList(page).getByRole('option')
  await expect(options).toHaveCount(3)
  await expect(options.nth(0)).toHaveAccessibleName('cubedb__BY__node, Point, 8')
  await expect(options.nth(1)).toHaveAccessibleName('cubedb__BY__link, LineString, 8')
  await expect(options.nth(2)).toHaveAccessibleName('cubedb__BY__transit_mode, table, 3')
  await expect(statusBar(page)).toContainText('8 features')
  await expect(statusBar(page)).toContainText('EPSG:26912')

  // `n` is the INTEGER PRIMARY KEY: restored, gaps and all, on the right rows.
  expect(await sql(page, 'SELECT list(n ORDER BY n) AS ids FROM layer')).toEqual([{ ids: [1, 2, 3, 10, 11, 12, 105, 106] }])
  expect(await sql(page, "SELECT n FROM layer WHERE nodename = 'node 105'")).toEqual([{ n: 105 }])
  // Links join to nodes by a/b (OGC_FID, GDAL's own id, is not added).
  const joined = await sql(page, `SELECT count(*) AS n FROM cubedb__BY__link l JOIN layer f ON f.n = l.a JOIN layer t ON t.n = l.b
    WHERE ST_Distance(ST_StartPoint(l.geom), f.geom) < 0.001 AND ST_Distance(ST_EndPoint(l.geom), t.geom) < 0.001`)
  expect(joined).toEqual([{ n: 8 }])
  expect((await sql(page, 'DESCRIBE cubedb__BY__link')).map((r) => r.column_name)).not.toContain('OGC_FID')
  expect(await sql(page, 'SELECT list(mode ORDER BY mode) AS ids, list(name ORDER BY mode) AS names FROM cubedb__BY__transit_mode')).toEqual([
    { ids: [4, 5, 6], names: ['Local bus', 'Core bus', 'Light rail'] },
  ])

  // Switching to the links draws them.
  await options.nth(1).click()
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(statusBar(page)).toContainText('8 features')
})

test('a .db file opens like .sqlite', async ({ page }) => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-db-')), 'network.db')
  fs.copyFileSync(fixture('cube-network.sqlite'), file)
  await openFile(page, file)
  await expect(layerList(page).getByRole('option')).toHaveCount(3)
  await expect(statusBar(page)).toContainText('8 features')
})
