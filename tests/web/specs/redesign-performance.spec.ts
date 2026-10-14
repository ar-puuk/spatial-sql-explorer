// Spec 010 phase 12: open time and pan smoothness of the new map drawing, at
// 6x CPU throttle (VS Code webviews are slower than headless Chromium).
// GeoJSON mode (parcels-10k): no long task over 200 ms during 5 pans. Tiles
// mode (parcels-230k, from `npm run large-data`): the median tile time and the
// longest main-thread task, recorded. Numbers go to test-results/redesign-perf.json
// and specs/010-redesign/research.md.
import * as fs from 'fs'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { fixture, largeData } from './helpers'

const hook = <T>(page: Page, name: string, ...args: unknown[]): Promise<T> =>
  page.evaluate(([n, a]) => (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>).__spatialExplorerE2E[n as string](...(a as unknown[])), [name, args] as const) as Promise<T>

async function pan(page: Page, dx: number, dy: number): Promise<void> {
  const box = (await page.locator('.canvas-host').boundingBox())!
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 10 })
  await page.mouse.up()
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function record(entry: Record<string, unknown>): void {
  const file = path.resolve('test-results/redesign-perf.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const all = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[]) : []
  fs.writeFileSync(file, JSON.stringify([...all, { at: new Date().toISOString(), ...entry }], null, 2))
}

for (const c of [
  { label: 'GeoJSON mode, parcels-10k', file: () => fixture('parcels-10k.geojson'), mode: 'geojson', limitMs: 200 },
  { label: 'tiles mode, parcels-230k', file: () => largeData('parcels-230k.geojson'), mode: 'tiles', limitMs: null },
] as const) {
  test(c.label, async ({ page }) => {
    test.setTimeout(600000)
    const file = c.file()
    await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
    await page.addInitScript(() => {
      const w = window as unknown as { __longTasks: number[] }
      w.__longTasks = []
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__longTasks.push(Math.round(e.duration))
      }).observe({ type: 'longtask', buffered: true })
    })
    // A big GeoJSON is announced before it is read whole: skip the announcement (it isn't the open time).
    await page.goto('/?e2e=1&wholeThreshold=2000000000')
    await expect(page.getByText('SQL engine ready')).toBeVisible({ timeout: 60000 })
    const t0 = Date.now()
    await page.locator('input[type="file"]').setInputFiles(file)
    await expect(page.locator('.status-bar')).toContainText('features', { timeout: 300000 })
    const factsMs = Date.now() - t0
    await expect.poll(async () => Number((await page.locator('.canvas-host').getAttribute('data-paints')) ?? 0), { timeout: 300000 }).toBeGreaterThan(0)
    const drawnMs = Date.now() - t0
    expect((await hook<{ mode: string }>(page, 'drawState')).mode).toBe(c.mode)
    const openTiles = (await hook<{ buildMs: number[] }>(page, 'tileStats')).buildMs

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    // Users have no test hooks: no rendered-feature count on each idle.
    await page.evaluate(() => delete document.documentElement.dataset.seTestHooks)
    await page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks = []))
    const calls0 = await hook<number>(page, 'drawCalls')
    const tiles0 = await hook<{ calls: number; buildMs: number[] }>(page, 'tileStats')
    const p0 = Date.now()
    for (const [dx, dy] of [[200, 80], [-260, -40], [120, 160], [-180, -120], [90, -60]]) {
      await pan(page, dx, dy)
      await page.waitForTimeout(400)
    }
    const idle0 = Number((await page.locator('.canvas-host').getAttribute('data-idles')) ?? 0)
    await expect.poll(async () => Number((await page.locator('.canvas-host').getAttribute('data-idles')) ?? 0), { timeout: 120000 }).toBeGreaterThan(idle0 - 1)
    const panPhaseMs = Date.now() - p0
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    const long = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks)
    const tiles1 = await hook<{ calls: number; buildMs: number[] }>(page, 'tileStats')
    const panTiles = tiles1.buildMs.slice(tiles0.buildMs.length)
    const result = {
      label: c.label,
      mode: c.mode,
      factsMs,
      drawnMs,
      panPhaseMs,
      engineCallsWhilePanning: (await hook<number>(page, 'drawCalls')) - calls0,
      tilesBuiltWhilePanning: tiles1.calls - tiles0.calls,
      medianTileMsOpen: median(openTiles),
      medianTileMsPans6x: median(panTiles),
      longTasksDuringPans6x: long.length,
      longestTaskMs6x: Math.max(0, ...long),
    }
    console.log('MEASURE', JSON.stringify(result))
    record(result)
    if (c.limitMs !== null) expect(result.longestTaskMs6x).toBeLessThanOrEqual(c.limitMs)
  })
}
