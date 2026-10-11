// Spec 008 research §15: the engine is downloaded and checked against the
// SHA-256 recorded at build time. A file that doesn't match is refused, never
// run, and the user is told why. (Test builds serve the engine from
// /engine-mirror with the same paths and hashes as the CDNs.)
import { test, expect } from '@playwright/test'
import { fixture } from './helpers'

test('a tampered engine download is refused with a clear message', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('**/engine-mirror/npm/@duckdb/duckdb-wasm@*/dist/duckdb-eh.wasm', (route) =>
    route.fulfill({ body: Buffer.from('not the engine'), contentType: 'application/wasm' })
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await expect(page.getByText(/refused to run its SQL engine: DuckDB wasm .* does not match the expected file/)).toBeVisible({ timeout: 60000 })
})

test('a tampered extension is refused too', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('**/engine-mirror/extensions/*/wasm_eh/spatial.duckdb_extension.wasm', (route) =>
    route.fulfill({ body: Buffer.from('not spatial'), contentType: 'application/wasm' })
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await expect(page.getByText(/refused to run its SQL engine: spatial extension .* does not match the expected file/)).toBeVisible({ timeout: 60000 })
})

test('no engine downloads beyond the pinned files', async ({ page }) => {
  test.setTimeout(120000)
  const engine: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    if (/duckdb|extension|sql-wasm|engine-mirror/.test(u)) engine.push(new URL(u).pathname)
  })
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  const files = [...new Set(engine.map((p) => p.split('/').pop()))].sort()
  expect(files).toEqual(['duckdb-browser-eh.worker.js', 'duckdb-eh.wasm', 'json.duckdb_extension.wasm', 'parquet.duckdb_extension.wasm', 'spatial.duckdb_extension.wasm'])
  expect(engine.every((p) => p.startsWith('/engine-mirror/'))).toBe(true)
})
