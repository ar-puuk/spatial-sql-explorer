// Spec 017: fts, h3 and a5 load with the engine (signature check on) and are callable from SQL.
import { test, expect } from '@playwright/test'
import { fixture } from './helpers'

test('h3, a5 and fts are loaded and answer in SQL', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  const outside: string[] = []
  page.on('request', (r) => {
    if (/query-farm/.test(r.url())) outside.push(r.url())
  })
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  const run = (sql: string) =>
    page.evaluate((q) => (window as unknown as { __spatialExplorerE2E: { runRaw: (s: string) => Promise<Array<Record<string, unknown>>> } }).__spatialExplorerE2E.runRaw(q), sql)
  const loaded = await run(`SELECT extension_name FROM duckdb_extensions() WHERE loaded AND extension_name IN ('h3','a5','fts') ORDER BY 1`)
  expect(loaded.map((r) => r.extension_name)).toEqual(['a5', 'fts', 'h3'])
  const h3 = await run(`SELECT h3_latlng_to_cell_string(47.0, 8.0, 7) AS c, h3_cell_to_boundary_wkt(h3_latlng_to_cell(47.0, 8.0, 7)) AS w`)
  expect(h3[0].c).toBe('871f830dbffffff')
  expect(String(h3[0].w)).toMatch(/^POLYGON/)
  const a5 = await run(`SELECT ST_AsText(a5_cell_to_geometry(a5_lonlat_to_cell(8.0, 47.0, 10))) AS w`)
  expect(String(a5[0].w)).toMatch(/^POLYGON/)
  // The a5 extension's start-up report to Query.Farm never leaves the engine (constitution IV).
  expect(outside).toEqual([])
})
