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

// The local copy (Cache Storage): offline after the first start.
const ENGINE_CACHE = 'spatial-explorer-engine'
const cachedNames = (page: import('@playwright/test').Page) =>
  page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname.split('/').pop()!).sort(), ENGINE_CACHE)

test('after the first start, the engine starts with the download servers unreachable', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await expect.poll(() => cachedNames(page)).toEqual(['duckdb-browser-eh.worker.js', 'duckdb-eh.wasm', 'json.duckdb_extension.wasm', 'parquet.duckdb_extension.wasm', 'spatial.duckdb_extension.wasm'])

  // No way to reach the engine's servers any more.
  let attempts = 0
  await page.route('**/engine-mirror/**', (route) => {
    attempts++
    return route.abort('internetdisconnected')
  })
  await page.reload()
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await expect(page.locator('.status-bar')).toContainText('features')
  expect(attempts).toBe(0)
})

test('a damaged local copy is noticed and downloaded again', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  // Damage the cached wasm in place.
  await page.evaluate(async (name) => {
    const cache = await caches.open(name)
    const key = (await cache.keys()).find((r) => r.url.endsWith('/duckdb-eh.wasm'))!
    await cache.put(key, new Response(new TextEncoder().encode('damaged')))
  }, ENGINE_CACHE)
  const downloads: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/engine-mirror/')) downloads.push(r.url().split('/').pop()!)
  })
  await page.reload()
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  // Only the damaged file came from the network again.
  expect(downloads).toEqual(['duckdb-eh.wasm'])
})
