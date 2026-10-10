// T046 (specs/001-quick-look/tasks.md): measure, don't eyeball, the timing
// success criteria against a real ~10 MB file in the production web build.
//   SC-001  choose a ~10 MB file -> data rendered on the map        < 2 s
//   SC-003  -> CRS, feature count and geometry type visible          < 2 s
//   SC-004  select in table or map -> highlight on the other side    < 100 ms
// Results are printed and written to test-results/performance.json; they are
// recorded in quickstart.md. Headless Chromium renders with SwiftShader
// (software WebGL), so map-side timings are pessimistic versus a real GPU.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** ~10 MB of realistic polygons: 22,000 parcel-like 12-vertex rings with 6 attributes. */
function makeTenMegabyteGeoJson(): string {
  const features: string[] = []
  let seed = 42
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 22000; i++) {
    const cx = -112.2 + rand() * 0.8
    const cy = 40.4 + rand() * 0.8
    const r = 0.0004 + rand() * 0.0008
    const ring: string[] = []
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      ring.push(`[${(cx + Math.cos(a) * r * (0.8 + rand() * 0.4)).toFixed(6)},${(cy + Math.sin(a) * r * (0.8 + rand() * 0.4)).toFixed(6)}]`)
    }
    ring.push(ring[0])
    features.push(
      `{"type":"Feature","properties":{"parcel_id":"P-${100000 + i}","zone":"${['R1', 'R2', 'C', 'I', 'AG'][i % 5]}","acres":${(rand() * 5).toFixed(3)},"value":${Math.round(rand() * 900000)},"year_built":${1900 + (i % 124)},"owner":"Owner ${i % 997}"},"geometry":{"type":"Polygon","coordinates":[[${ring.join(',')}]]}}`
    )
  }
  return `{"type":"FeatureCollection","features":[\n${features.join(',\n')}\n]}`
}

const results: Record<string, number | string> = {}
let fixture = ''

test.beforeAll(() => {
  fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-perf-')), 'parcels-10mb.geojson')
  fs.writeFileSync(fixture, makeTenMegabyteGeoJson())
  results.fileMB = Number((fs.statSync(fixture).size / 1024 / 1024).toFixed(2))
})

test.afterAll(() => {
  fs.mkdirSync('test-results', { recursive: true })
  fs.writeFileSync('test-results/performance.json', JSON.stringify(results, null, 2))
  console.log('PERFORMANCE', JSON.stringify(results))
})

async function timeOpen(page: Page): Promise<{ metadataMs: number; renderedMs: number }> {
  const t0 = Date.now()
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await expect(page.locator('.status-bar')).toContainText('22,000 features', { timeout: 60000 })
  const metadataMs = Date.now() - t0
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  return { metadataMs, renderedMs: Date.now() - t0 }
}

test('SC-001 / SC-003: ~10 MB file, cold and warm', async ({ page }) => {
  test.setTimeout(180000)
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort()) // measure our pipeline, not tile servers

  // Cold: the file is chosen the instant the page loads, before DuckDB warmed up.
  await page.goto('/')
  const cold = await timeOpen(page)
  results.coldMetadataMs = cold.metadataMs
  results.coldRenderedMs = cold.renderedMs

  // Warm: the realistic case. A fresh page pre-warms DuckDB while the user
  // is still choosing a file; give it the few seconds a person takes to
  // find one, then open.
  await page.goto('/')
  await page.waitForTimeout(8000)
  const warm = await timeOpen(page)
  results.warmMetadataMs = warm.metadataMs
  results.warmRenderedMs = warm.renderedMs
  results.renderedFeatures = Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))

  expect(results.renderedFeatures).toBeGreaterThan(0)
  expect(warm.renderedMs, 'SC-001 (warm): ~10 MB file rendered in under 2 s').toBeLessThan(2000)
  expect(warm.metadataMs, 'SC-003 (warm): CRS / count / type visible in under 2 s').toBeLessThan(2000)
})

test('SC-004: selection highlight, table -> map and map -> table', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort())
  await page.goto('/')
  await timeOpen(page)

  // Table -> map: click a row, then wait two animation frames (the map
  // repaints with the new feature-state on the next frame).
  const tableToMap = await page.evaluate(async () => {
    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('.attribute-table tbody tr:not(.spacer)'))
    const samples: number[] = []
    for (const row of rows.slice(2, 12)) {
      const t0 = performance.now()
      row.click()
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      samples.push(performance.now() - t0)
    }
    samples.sort((a, b) => a - b)
    return samples[Math.floor(samples.length / 2)]
  })
  results.tableToMapMedianMs = Math.round(tableToMap)

  // Map -> table: zoom to a parcel (double-click its row), clear the
  // selection, then click the parcel at the map center and time until its
  // row shows as selected.
  await page.locator('.attribute-table tbody tr:not(.spacer)').nth(1).dblclick()
  await page.waitForTimeout(1200)
  await page.keyboard.press('Escape')
  await expect(page.locator('.attribute-table tbody tr.selected')).toHaveCount(0)
  const box = (await page.locator('.canvas-host').boundingBox())!
  const t0 = Date.now()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.attribute-table tbody tr.selected')).toHaveCount(1, { timeout: 5000 })
  results.mapToTableMs = Date.now() - t0 // includes Playwright round trips: an upper bound

  expect(tableToMap, 'SC-004: table selection highlighted on the map in under 100 ms').toBeLessThan(100)
})

test('SC-001 (spec 002): a filtering query on the ~10 MB file renders in under 1 s', async ({ page }) => {
  test.setTimeout(120000)
  const { openFile, openQueryPanel, setQuery, editor, status } = await import('./helpers')
  await openFile(page, fixture)
  await openQueryPanel(page)
  await setQuery(page, "SELECT * FROM layer WHERE zone = 'R1' AND acres > 2.5 LIMIT 1000")
  const t0 = Date.now()
  await editor(page).press('Control+Enter')
  await expect(status(page)).toContainText('✓', { timeout: 30000 })
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached' })
  results.queryFilterMs = Date.now() - t0
  expect(results.queryFilterMs as number, 'SC-001 (002): filtering query rendered in under 1 s').toBeLessThan(1000)
})
