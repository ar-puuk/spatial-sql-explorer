// Spec 027 (SC-002, SC-005; memory: profile at 6x CPU throttle, the user feels lag tests miss). In the performance project: it
// runs alone, so the timing measures the app, not the machine. The big file is made by `npm run large-data -- --raster`.
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
  await page.evaluate(() => delete document.documentElement.dataset.seTestHooks)
}

const longTasks = (page: Page): Promise<number[]> => page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks.slice())
const clearLongTasks = (page: Page): Promise<void> => page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks.length = 0))
const worst = (a: number[]): number => Math.max(0, ...a)
const paint = (page: Page): Promise<Record<string, number | string> | null> =>
  page.evaluate(() => {
    const v = document.querySelector('.canvas-host')?.getAttribute('data-relief-paint')
    return v ? JSON.parse(v) : null
  })

async function draw(page: Page, points: Array<[number, number]>, finish: 'enter' | 'second'): Promise<void> {
  for (const [x, y] of points) {
    await page.mouse.move(x, y, { steps: 3 })
    await page.mouse.click(x, y)
    await page.waitForTimeout(100)
  }
  if (finish === 'enter') await page.keyboard.press('Enter')
}

for (const [name, file] of [
  ['a 40 MB DEM in UTM', fixture('raster/dem-utm12.tif')],
  ['a 4.9 GB COG (30,000 x 30,000 cells)', BIG],
] as const) {
  test(`${name}: relief, a profile and an area, at 6x CPU`, async ({ page }) => {
    test.skip(!fs.existsSync(file), `${file} is not there (npm run large-data -- --raster)`)
    test.setTimeout(300000)
    await open(page, file)
    await page.getByRole('button', { name: 'Style', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Relief' })).toBeVisible()

    // Relief on, unthrottled (building the first tiles is the engine's work).
    await page.getByRole('switch', { name: 'Shaded relief' }).click()
    await page.locator('.canvas-host[data-relief-ready]').waitFor({ state: 'attached', timeout: 120000 })
    await page.waitForTimeout(1000)

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    await clearLongTasks(page)
    // SC-002: changing the light is paint only.
    const t0 = Date.now()
    await page.getByRole('slider', { name: 'Light direction', exact: true }).fill('120')
    await expect.poll(() => paint(page), { intervals: [25] }).toMatchObject({ 'hillshade-illumination-direction': 120 })
    const lightMs = Date.now() - t0
    await page.getByRole('slider', { name: 'Light height', exact: true }).fill('25')
    await page.getByRole('slider', { name: 'Relief strength', exact: true }).fill('0.8')
    await page.waitForTimeout(800)
    const afterLight = await longTasks(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

    // SC-005: a profile across the raster and the statistics of an area over it, each in under 5 seconds.
    await page.getByRole('button', { name: 'Style', exact: true }).click().catch(() => {})
    const box = (await page.locator('.canvas-host').boundingBox())!
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await page.locator('.map-view .corner').getByRole('button', { name: 'Profile', exact: true }).click()
    const p0 = Date.now()
    await draw(page, [[cx - 120, cy - 60], [cx, cy + 20], [cx + 120, cy - 30]], 'enter')
    await expect.poll(async () => (await e2e<{ status: string } | null>(page, 'rasterProbe'))?.status, { timeout: 30000, intervals: [50] }).toBe('done')
    const profileMs = Date.now() - p0 - 3 * 100 - 3 * 3 * 16
    await page.locator('.map-view .corner').getByRole('button', { name: 'Area statistics', exact: true }).click()
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
    await clearLongTasks(page)
    const a0 = Date.now()
    await draw(page, [[cx - 150, cy - 200], [cx + 150, cy - 70]], 'second')
    await expect.poll(async () => (await e2e<{ status: string; kind: string } | null>(page, 'rasterProbe'))?.kind, { timeout: 30000, intervals: [50] }).toBe('area')
    await expect.poll(async () => (await e2e<{ status: string } | null>(page, 'rasterProbe'))?.status, { timeout: 30000, intervals: [50] }).toBe('done')
    const areaMs = Date.now() - a0 - 2 * 100 - 2 * 3 * 16
    const afterArea = await longTasks(page)
    const area = (await e2e<{ area: { approximate: boolean; bands: Array<{ count: number }> } }>(page, 'rasterProbe')).area

    console.log(`raster-027-performance ${name}: light change ${lightMs} ms (6x); longest task at 6x during light changes ${worst(afterLight)} ms; profile about ${profileMs} ms; area about ${areaMs} ms (approximate: ${area.approximate}, cells ${area.bands[0].count}); longest task during the area ${worst(afterArea)} ms`)
    expect(lightMs, 'SC-002: a change of light is drawn quickly even at 6x CPU').toBeLessThan(300)
    expect(worst(afterLight), 'long task while changing the light at 6x').toBeLessThan(200)
    expect(profileMs, 'SC-005: a profile in under 5 seconds').toBeLessThan(5000)
    expect(areaMs, 'SC-005: area statistics in under 5 seconds').toBeLessThan(5000)
    expect(worst(afterArea), 'long task while the area statistics are read').toBeLessThan(200)
  })
}
