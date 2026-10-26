// Spec 026 T029 (SC-002, SC-003, SC-004; memory: profile at 6x CPU throttle, the user feels lag tests miss). In the performance
// project: it runs alone, so the timing measures the app, not the machine.
// Measures the main thread's long tasks while a raster is panned, restyled and hovered, and how long a style change takes to be drawn.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

const here = path.dirname(fileURLToPath(import.meta.url))
const BIG = path.resolve(here, '../../.large-data/raster-big.tif')
const STUB_STYLE = { version: 8, sources: {}, layers: [{ id: 'stub-bg', type: 'background', paint: { 'background-color': '#dddddd' } }] }

const e2e = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => unknown> }).__spatialExplorerE2E[n]() as T, name)

async function open(page: Page, file: string): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] }
    w.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(Math.round(e.duration))
    }).observe({ type: 'longtask', buffered: true })
  })
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ json: STUB_STYLE }))
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.locator('.canvas-host[data-raster-ready]').waitFor({ state: 'attached', timeout: 120000 })
  // Users have no test hooks.
  await page.evaluate(() => delete document.documentElement.dataset.seTestHooks)
}

const marker = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('.canvas-host')?.getAttribute('data-raster-ready') ?? null)
const longTasks = (page: Page): Promise<number[]> => page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks.slice())
const clearLongTasks = (page: Page): Promise<void> => page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks.length = 0))

/** Milliseconds from `action` until the map reports the tiles of a new picture drawn (the marker names the version). */
async function untilRedrawn(page: Page, action: () => Promise<void>): Promise<number> {
  const before = await marker(page)
  const t0 = Date.now()
  await action()
  await expect.poll(async () => ((await marker(page)) ?? '') !== before && (await marker(page)) !== null, { timeout: 60000, intervals: [25] }).toBe(true)
  return Date.now() - t0
}

for (const [name, file] of [
  ['a 40 MB DEM in UTM', fixture('raster/dem-utm12.tif')],
  ['a 4.9 GB COG (30,000 x 30,000 cells)', BIG],
] as const) {
  test(`${name}: opening, panning, a style change and hovering, at 6x CPU`, async ({ page }) => {
    test.skip(!fs.existsSync(file), `${file} is not there (npm run large-data -- --raster)`)
    test.setTimeout(240000)
    const t0 = Date.now()
    await open(page, file)
    const openMs = Date.now() - t0
    // The style panel, so a change is the real thing.
    await page.getByRole('button', { name: 'Style', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Range' })).toBeVisible()
    await page.waitForTimeout(1000)

    // SC-003 unthrottled: a style change is drawn in under 300 ms.
    const styleMs = await untilRedrawn(page, async () => {
      await page.getByRole('switch', { name: 'Reverse' }).click()
    })

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    await clearLongTasks(page)
    // SC-003 at 6x: the same change.
    const styleSlowMs = await untilRedrawn(page, async () => {
      await page.getByRole('switch', { name: 'Reverse' }).click()
    })
    const afterStyle = await longTasks(page)

    // SC-002: panning and zooming.
    await clearLongTasks(page)
    const box = (await page.locator('.canvas-host').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width / 2 + i * 15, box.y + box.height / 2 + i * 8, { steps: 2 })
    await page.mouse.up()
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.waitForTimeout(1500)
    const afterPan = await longTasks(page)

    // Hovering: one question to the file at a time, never a pile of them.
    await clearLongTasks(page)
    for (let i = 0; i < 40; i++) await page.mouse.move(box.x + 40 + i * 9, box.y + 60 + (i % 7) * 11)
    await page.waitForTimeout(600)
    const afterHover = await longTasks(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

    const worst = (a: number[]): number => Math.max(0, ...a)
    console.log(`raster-performance ${name}: open ${openMs} ms; style change ${styleMs} ms (6x: ${styleSlowMs} ms); longest task at 6x: style ${worst(afterStyle)} ms, pan and zoom ${worst(afterPan)} ms, hover ${worst(afterHover)} ms`)
    const tiles = await e2e<{ built: number; buildMs: number[] }>(page, 'raster').then((s) => (s as unknown as { tiles: { built: number; buildMs: number[] } }).tiles)
    console.log(`  tiles built ${tiles.built}, last build times ${tiles.buildMs.slice(-12).join(', ')} ms`)

    expect(styleMs, 'SC-003: a style change is drawn in under 300 ms').toBeLessThan(300)
    // 6x CPU: nothing holds the main thread for as long as a freeze (200 ms, SC-002).
    expect(worst(afterStyle), 'long task during a style change').toBeLessThan(200)
    expect(worst(afterPan), 'long task while panning and zooming').toBeLessThan(200)
    expect(worst(afterHover), 'long task while hovering').toBeLessThan(200)
  })
}
