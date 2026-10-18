// Spec 017 T044 (the project's responsiveness rule): binning a big point layer does not freeze the interface. With the CPU
// throttled 6x: (1) the dialog itself answers within 150 ms: opening it (mounting its widgets, about 100 ms at 6x, measured 97 to 107) and each
// key on the resolution slider leave no longer task in the moments after; (2) the redraw that follows (the new cells reaching the map, legend and table) never
// blocks the page for half a second. The points are binned in the engine's worker; the page only draws the cells, and a
// redraw of a map layer is the project's heavier work (its precedent, SC-007, allows a second unthrottled).
// In the performance project: run alone, so the timing measures the app, not the machine.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 300,000 by default: a 1,000,000-point GeoJSON takes over five minutes just to open in the web app (the whole-file read, unrelated to the bin).
const POINTS = Number(process.env.SE_GRID_PERF_POINTS ?? 300_000)
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Bin into cells' })

/** Random-looking points over a 3 x 2 degree area, written in chunks (a million rows is too big for one string). */
function writePoints(count: number): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-gp-')), `points-${count}.geojson`)
  const fd = fs.openSync(file, 'w')
  fs.writeSync(fd, '{"type":"FeatureCollection","features":[\n')
  let seed = 7
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let start = 0; start < count; start += 50_000) {
    const rows: string[] = []
    for (let i = start; i < Math.min(count, start + 50_000); i++) {
      rows.push(`{"type":"Feature","properties":{"id":${i},"v":${(rand() * 100).toFixed(1)}},"geometry":{"type":"Point","coordinates":[${(-113 + rand() * 3).toFixed(5)},${(39 + rand() * 2).toFixed(5)}]}}`)
    }
    fs.writeSync(fd, (start > 0 ? ',\n' : '') + rows.join(',\n'))
  }
  fs.writeSync(fd, '\n]}')
  fs.closeSync(fd)
  return file
}

test(`binning ${POINTS.toLocaleString('en-US')} points at 6x CPU: the dialog answers, no redraw blocks the page`, async ({ page }) => {
  test.setTimeout(600_000)
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[]; __long: Array<[number, number]>; __marks: Array<[string, number]> }
    w.__longTasks = []
    w.__long = []
    w.__marks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        w.__longTasks.push(Math.round(e.duration))
        w.__long.push([Math.round(e.startTime), Math.round(e.duration)])
      }
    }).observe({ type: 'longtask', buffered: true })
  })
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort())
  const file = writePoints(POINTS)
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.locator('.canvas-host[data-rendered-features], .canvas-host[data-paints]').first().waitFor({ state: 'attached', timeout: 300_000 })
  await expect(page.locator('.status-bar')).toContainText(POINTS.toLocaleString('en-US'), { timeout: 300_000 })
  await page.waitForTimeout(3000)
  // Users have no test hooks: no rendered-feature count on each idle.
  await page.evaluate(() => delete document.documentElement.dataset.seTestHooks)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.evaluate(() => {
    const w = window as unknown as { __longTasks: number[]; __long: Array<[number, number]> }
    w.__longTasks = []
    w.__long = []
  })

  const mark = (name: string) => page.evaluate((n) => (window as unknown as { __marks: Array<[string, number]> }).__marks.push([n, Math.round(performance.now())]), name)
  await mark('open')
  await page.getByRole('button', { name: 'Bin into cells…' }).click()
  await expect(dialog(page)).toBeVisible()
  const status = dialog(page).getByRole('status').filter({ hasText: /^About / })
  await expect(status).toBeVisible()
  // The suggested size previews at once; then each step of the slider redraws.
  await expect(dialog(page).getByText('drawing…')).toBeHidden({ timeout: 120_000 })
  const slider = dialog(page).getByRole('slider', { name: 'Resolution' })
  await slider.focus()
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft']) {
    await mark(key)
    await slider.press(key)
    await page.waitForTimeout(700)
    await expect(dialog(page).getByText('drawing…')).toBeHidden({ timeout: 120_000 })
  }
  await mark('keep')
  await dialog(page).getByRole('button', { name: /^(Keep|Show)$/ }).click()
  await expect(dialog(page)).toBeHidden({ timeout: 120_000 })
  await expect(page.getByRole('region', { name: 'Legend' }).getByRole('button', { name: /^Number of features/ })).toBeVisible({ timeout: 120_000 })
  await page.waitForTimeout(1500)

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const { long, marks } = await page.evaluate(() => {
    const w = window as unknown as { __long: Array<[number, number]>; __marks: Array<[string, number]> }
    return { long: w.__long, marks: w.__marks }
  })
  const interaction = long.filter(([start]) => marks.some(([name, at]) => name !== 'keep' && start >= at && start < at + 600))
  console.log(`grid bin of ${POINTS} points at 6x: marks`, JSON.stringify(marks), 'long tasks [start, ms]', JSON.stringify(long))
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
  expect(Math.max(0, ...interaction.map(([, ms]) => ms)), 'the dialog answers within 150 ms (open and each slider key)').toBeLessThanOrEqual(150)
  expect(Math.max(0, ...long.map(([, ms]) => ms)), 'no redraw blocks the page for half a second').toBeLessThan(500)
})
