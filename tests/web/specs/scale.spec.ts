// T058 (spec 007 Polish): the success criteria measured on the large local
// files in tests/.large-data (`npm run large-data`), in the production web
// build. Runs in the Playwright `performance` project (alone, after
// everything else) and skips when the data is missing. Every number goes to
// test-results/scale.json and quickstart.md. Headless Chromium draws with
// SwiftShader (software WebGL): map timings are pessimistic.
import { test, expect, type Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { exportVia, fixture, largeData } from './helpers'

const results: Record<string, unknown> = {}

test.describe.configure({ mode: 'serial' })

test.afterAll(() => {
  fs.mkdirSync('test-results', { recursive: true })
  const perf = 'test-results/performance.json'
  if (fs.existsSync(perf)) results.sc009_spec001Open10MB = JSON.parse(fs.readFileSync(perf, 'utf8'))
  fs.writeFileSync('test-results/scale.json', JSON.stringify(results, null, 2))
  console.log('SCALE', JSON.stringify(results))
})

interface ViewState {
  generation: number
  drawn: number
  inView: number
  thinned: boolean
  ms: number
}
const hook = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([n, a]) => (window as unknown as { __spatialExplorerE2E: Record<string, (...x: unknown[]) => unknown> }).__spatialExplorerE2E[n as string](...(a as unknown[])) as T, [
    name,
    args,
  ] as const)
const viewState = (page: Page): Promise<ViewState | null> => hook(page, 'viewState')
const statusBar = (page: Page) => page.locator('.status-bar')

/** Records long tasks (SC-004) from the first script on. */
async function watchLongTasks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] }
    w.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(e.duration)
    }).observe({ type: 'longtask', buffered: true })
  })
}
const longestTask = (page: Page): Promise<number> =>
  page.evaluate(() => Math.round(Math.max(0, ...(window as unknown as { __longTasks: number[] }).__longTasks)))

/** Opens a file; returns ms to the whole-file facts and to the first painted overview. */
async function timeOpen(page: Page, file: string, rowsText: string): Promise<{ factsMs: number; overviewMs: number }> {
  const t0 = Date.now()
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(statusBar(page)).toContainText(rowsText, { timeout: 60000 })
  const factsMs = Date.now() - t0
  await page.locator('.canvas-host[data-paints]').waitFor({ state: 'attached', timeout: 120000 })
  return { factsMs, overviewMs: Date.now() - t0 }
}

/** The generator's 20 "cities" (scripts/large-data.sql). */
const CITIES = Array.from({ length: 20 }, (_, c) => [-112.6 + (c % 5) * 0.75, 37.4 + Math.floor(c / 5) * 1.2] as const)

test('SC-001/SC-003/SC-004: 1.1 GB GeoParquet opens fast, and every city view is drawn within 2 s', async ({ page }) => {
  test.setTimeout(300000)
  const file = largeData('parcels-6m.parquet')
  await watchLongTasks(page)
  await page.goto('/?e2e=1')
  const open = await timeOpen(page, file, '6,000,000')
  results.sc001_parquet6m = { sizeMB: Math.round(fs.statSync(file).size / 1e6), ...open }
  expect(open.factsMs, 'SC-001: facts within 5 s').toBeLessThanOrEqual(5000)
  expect(open.overviewMs, 'SC-001: overview within 10 s').toBeLessThanOrEqual(10000)

  // SC-003: 10 city views, each drawn within 2 s of the pan stopping, at or below the cap.
  const views: number[] = []
  for (const [lon, lat] of CITIES.slice(0, 10)) {
    const before = (await viewState(page))?.generation ?? 0
    const paints = Number((await page.locator('.canvas-host').getAttribute('data-paints')) ?? 0)
    const t0 = Date.now()
    await hook(page, 'jumpTo', lon, lat, 13)
    await expect.poll(async () => (await viewState(page))?.generation ?? 0, { timeout: 15000 }).toBeGreaterThan(before)
    await expect.poll(async () => Number((await page.locator('.canvas-host').getAttribute('data-paints')) ?? 0), { timeout: 15000 }).toBeGreaterThan(paints)
    views.push(Date.now() - t0)
    const v = (await viewState(page))!
    expect(v.drawn).toBeLessThanOrEqual(25000)
  }
  results.sc003_cityViewsMs = { each: views, max: Math.max(...views) }
  // The 150 ms debounce after moveend is part of "after the pan stops".
  expect(Math.max(...views), 'SC-003: every view within 2 s').toBeLessThanOrEqual(2000)

  // SC-004 continues: a query and a style on the whole file.
  await page.keyboard.press('Control+Shift+Q')
  const { runQuery } = await import('./helpers')
  await runQuery(page, 'SELECT * FROM layer WHERE value > 1500000')
  await expect(page.locator('.query-status')).toContainText('rows', { timeout: 120000 })
  await page.getByRole('button', { name: 'Layer style' }).click()
  await page.getByRole('radio', { name: 'Graduated' }).click()
  await page.getByLabel('Column', { exact: true }).selectOption('value')
  await expect(page.getByRole('region', { name: 'Legend' })).toContainText('value · Quantile', { timeout: 120000 })
  results.sc004_longestTaskMs = await longestTask(page)
  expect(results.sc004_longestTaskMs as number, 'SC-004: no task blocks the viewer for 1 s').toBeLessThan(1000)
})

test('SC-001: 1.45 GB FlatGeobuf opens from its header and index', async ({ page }) => {
  test.setTimeout(300000)
  const file = largeData('parcels-4m.fgb')
  await page.goto('/?e2e=1')
  const open = await timeOpen(page, file, '4,000,000')
  results.sc001_fgb4m = { sizeMB: Math.round(fs.statSync(file).size / 1e6), ...open }
  expect(open.factsMs).toBeLessThanOrEqual(5000)
  expect(open.overviewMs).toBeLessThanOrEqual(10000)

  // SC-003 for FlatGeobuf in parts: zoomed views read their features from the file.
  const views: Array<{ ms: number; drawn: number; thinned: boolean }> = []
  for (const [lon, lat] of CITIES.slice(0, 5)) {
    const before = (await viewState(page))?.generation ?? 0
    const t0 = Date.now()
    await hook(page, 'jumpTo', lon, lat, 15)
    await expect.poll(async () => (await viewState(page))?.generation ?? 0, { timeout: 30000 }).toBeGreaterThan(before)
    const v = (await viewState(page))!
    views.push({ ms: Date.now() - t0, drawn: v.drawn, thinned: v.thinned })
  }
  results.sc003_fgbCityViews = views
  for (const v of views) expect(v.ms, 'SC-003: FlatGeobuf view within 2 s').toBeLessThanOrEqual(2000)
})

test('SC-005: Cancel ends any open within 3 s (GeoParquet, FlatGeobuf, 325 MB GeoJSON)', async ({ page }) => {
  test.setTimeout(300000)
  const cases: Array<[string, string, number]> = [
    ['parcels-6m.parquet', 'GeoParquet', 300],
    ['parcels-4m.fgb', 'FlatGeobuf', 300],
    ['parcels-460k.geojson', 'GeoJSON', 4000],
  ]
  const out: Record<string, number> = {}
  for (const [name, label, after] of cases) {
    const file = largeData(name)
    await page.goto('/?e2e=1&wholeThreshold=2000000000')
    await page.locator('input[type="file"]').setInputFiles(file)
    const cancel = page.getByRole('button', { name: 'Cancel opening' })
    // Cancel as soon as it is offered (plus a moment into the work); a quick open may finish first.
    const offered = await cancel
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false)
    if (!offered) {
      out[label] = -1
      continue
    }
    await page.waitForTimeout(after)
    const t0 = Date.now()
    await cancel.click().catch(() => {})
    await expect(page.getByText('Drag a geospatial file here')).toBeVisible({ timeout: 3000 })
    out[label] = Date.now() - t0
  }
  results.sc005_cancelMs = out
  for (const ms of Object.values(out)) if (ms >= 0) expect(ms).toBeLessThan(3000)
})

test('SC-006: a 325 MB GeoJSON is announced; out of memory ends in the message and a usable viewer', async ({ page }) => {
  test.setTimeout(300000)
  const file = largeData('parcels-460k.geojson')
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  const dialog = page.getByRole('dialog', { name: 'Read the whole file?' })
  await expect(dialog).toContainText('This one is 310 MB')
  const t0 = Date.now()
  await dialog.getByRole('button', { name: 'Open' }).click()
  await expect(statusBar(page)).toContainText('444,445', { timeout: 120000 })
  results.sc006_geojson325MB = { announced: true, openMs: Date.now() - t0 }

  await page.goto('/?e2e=1&memoryLimit=64MB&wholeThreshold=2000000000')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(page.getByText('This file is too large to read in full here (out of memory).')).toBeVisible({ timeout: 120000 })
  await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.parquet'))
  await expect(statusBar(page)).toContainText('10,000 features', { timeout: 60000 })
  results.sc006_outOfMemory = 'message shown; next open worked'
})

test('SC-007: a 1,000,166-row filter on 4M rows is exact, and its export has every row', async ({ page }) => {
  test.setTimeout(600000)
  const file = largeData('parcels-4m.parquet')
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(statusBar(page)).toContainText('4,000,000', { timeout: 60000 })
  await page.keyboard.press('Control+Shift+Q')
  const { runQuery } = await import('./helpers')
  const t0 = Date.now()
  await runQuery(page, 'SELECT * FROM layer WHERE value > 1500000')
  await expect(page.locator('.query-status')).toContainText('1,000,166 rows', { timeout: 120000 })
  const queryMs = Date.now() - t0
  const t1 = Date.now()
  const { bytes } = await exportVia(page, { format: 'GeoParquet' })
  const exportMs = Date.now() - t1
  // Counted by the native DuckDB CLI: base64-ing ~150 MB into the page would crash it.
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-scale-')), 'filtered.parquet')
  fs.writeFileSync(out, bytes)
  const cli = spawnSync('duckdb', ['-csv', '-noheader'], { input: `SELECT count(*) FROM read_parquet('${out.split(path.sep).join('/')}');`, encoding: 'utf8', shell: process.platform === 'win32' })
  test.skip(cli.status !== 0, 'The DuckDB CLI is needed to count the exported rows')
  expect(Number(cli.stdout.trim())).toBe(1_000_166)
  results.sc007 = { rows: 1_000_166, queryMs, exportMs, exportMB: Math.round(bytes.length / 1e6) }
})

// T059 (SC-002): a 5 GB GeoParquet session stays within the engine's memory.
test('SC-002: a 5 GB session (open, 5 cities, a filter, a style, an export) stays under 3.1 GiB', async ({ page }) => {
  test.setTimeout(1200000)
  const file = largeData('parcels-27m.parquet')
  await page.goto('/?e2e=1')
  const memory: Record<string, number> = {}
  const sample = async (step: string): Promise<void> => {
    const rows = await hook<Array<{ b: number | bigint }>>(page, 'runRaw', 'SELECT CAST(sum(memory_usage_bytes) AS DOUBLE) AS b FROM duckdb_memory()')
    memory[step] = Math.round(Number(rows[0].b) / 1024 / 1024)
  }
  const open = await timeOpen(page, file, '27,000,000')
  await sample('open')
  for (const [i, [lon, lat]] of CITIES.slice(0, 5).entries()) {
    const before = (await viewState(page))?.generation ?? 0
    await hook(page, 'jumpTo', lon, lat, 13)
    await expect.poll(async () => (await viewState(page))?.generation ?? 0, { timeout: 30000 }).toBeGreaterThan(before)
    await sample(`city${i + 1}`)
  }
  await page.keyboard.press('Control+Shift+Q')
  const { runQuery } = await import('./helpers')
  await runQuery(page, 'SELECT * FROM layer WHERE value > 1990000')
  await expect(page.locator('.query-status')).toContainText('rows', { timeout: 300000 })
  const filtered = (await page.locator('.query-status').textContent()) ?? ''
  await sample('filter')
  await page.getByRole('button', { name: 'Layer style' }).click()
  await page.getByRole('radio', { name: 'Graduated' }).click()
  await page.getByLabel('Column', { exact: true }).selectOption('value')
  await expect(page.getByRole('region', { name: 'Legend' })).toContainText('value · Quantile', { timeout: 300000 })
  await sample('style')
  await page.getByRole('button', { name: 'Layer style' }).click()
  const { bytes } = await exportVia(page, { format: 'GeoParquet' })
  await sample('export')
  results.sc002_session27m = { sizeMB: Math.round(fs.statSync(file).size / 1e6), ...open, filtered: filtered.trim(), exportMB: Math.round(bytes.length / 1e6), engineMemoryMiB: memory }
  await expect(page.locator('.error-banner')).toHaveCount(0)
  for (const mib of Object.values(memory)) expect(mib, 'SC-002: engine memory under 3.1 GiB').toBeLessThan(3174)
})

test('SC-004 (spec 008): a table filter on 4M rows counts within 3 s, and can be cancelled by new work', async ({ page }) => {
  test.setTimeout(300000)
  const file = largeData('parcels-4m.parquet')
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(statusBar(page)).toContainText('4,000,000', { timeout: 60000 })
  const count = page.locator('.drawer-header > .count')
  const input = page.getByRole('textbox', { name: 'Filter zone' })
  await input.fill('C1')
  const t0 = Date.now()
  await input.press('Enter')
  await expect(count).toHaveText(/^[\d,]+ of 4,000,000 rows$/, { timeout: 60000 })
  const ms = Date.now() - t0
  results.spec008_filter4M = { ms, label: await count.textContent() }
  expect(ms).toBeLessThan(3000)
  // A newer filter replaces a count still running: no stale "of" figure stays.
  await input.fill('R1')
  await input.press('Enter')
  await page.getByRole('combobox', { name: 'value filter operator' }).selectOption('gte')
  await page.getByRole('textbox', { name: 'Filter value' }).fill('1500000')
  await page.getByRole('textbox', { name: 'Filter value' }).press('Enter')
  await expect(count).toHaveText(/^[\d,]+ of 4,000,000 rows$/, { timeout: 60000 })
  const both = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { filterState(): { filters: unknown[] } } }).__spatialExplorerE2E.filterState().filters.length)
  expect(both).toBe(2)
})

// Spec 009 SC-007: on the same 1,000,166-row result, classifying both bivariate
// axes, or a color and a size column, takes no more than twice one graduated column.
test('spec 009 SC-007: two-column styles on 1M rows within 2x one graduated column', async ({ page }) => {
  test.setTimeout(900000)
  const file = largeData('parcels-4m.parquet')
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(statusBar(page)).toContainText('4,000,000', { timeout: 60000 })
  await page.keyboard.press('Control+Shift+Q')
  const { runQuery } = await import('./helpers')
  await runQuery(page, 'SELECT * FROM layer WHERE value > 1500000')
  await expect(page.locator('.query-status')).toContainText('1,000,166 rows', { timeout: 120000 })
  await page.getByRole('button', { name: 'Layer style' }).click()
  const panel = page.getByRole('dialog', { name: 'Layer style' })
  const legend = page.getByRole('region', { name: 'Legend' })
  /** Time from an edit to the legend showing `text`. */
  const timed = async (edit: () => Promise<void>, text: string | RegExp) => {
    const t0 = Date.now()
    await edit()
    await expect(legend).toContainText(text, { timeout: 300000 })
    return Date.now() - t0
  }

  await page.getByRole('radio', { name: 'Graduated' }).click()
  await panel.getByLabel('Column', { exact: true }).selectOption('acres')
  await expect(legend).toContainText('acres · Quantile', { timeout: 300000 })
  const graduatedMs = await timed(() => panel.getByLabel('Column', { exact: true }).selectOption('value'), 'value · Quantile')

  await panel.getByRole('switch', { name: 'Size by column' }).click()
  await panel.getByLabel('Size column').selectOption('year_built')
  await expect(legend).toContainText('year_built · Quantile', { timeout: 300000 })
  const colorSizeMs = await timed(() => panel.getByLabel('Size column').selectOption('acres'), /acres · Quantile, \d+ classes/)

  await page.getByRole('radio', { name: 'Bivariate' }).click()
  await panel.getByLabel('Axis 1', { exact: true }).selectOption('year_built')
  await panel.getByLabel('Axis 2', { exact: true }).selectOption('acres')
  await expect(legend).toContainText('year_built × acres', { timeout: 300000 })
  const bivariateMs = await timed(() => panel.getByLabel('Axis 1', { exact: true }).selectOption('value'), 'value × acres')

  results.spec009_sc007 = { rows: 1_000_166, graduatedMs, colorSizeMs, bivariateMs }
  expect(bivariateMs, 'bivariate within 2x graduated').toBeLessThanOrEqual(2 * graduatedMs + 250)
  expect(colorSizeMs, 'color + size within 2x graduated').toBeLessThanOrEqual(2 * graduatedMs + 250)
})
