// Spec 010 T043: the "More basemaps…" modal stays responsive (ground rule 8).
// In the performance project: run alone, so the timing measures the app, not the machine.
import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.resolve(__dirname, '../../vscode-ext/fixtures/world-boundaries.geojson')
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const STUB_STYLE = { version: 8, sources: {}, layers: [{ id: 'stub-bg', type: 'background', paint: { 'background-color': '#dddddd' } }] }

/** Styles answer with a stub, everything else with a pixel; nothing reaches a real server. */
async function offline(page: Page): Promise<void> {
  await page.route(/^https:\/\/(?!localhost)/, (route) => {
    if (/style|\.json(\?|$)/.test(route.request().url())) return route.fulfill({ json: STUB_STYLE })
    return route.fulfill({ body: PNG_1PX, contentType: 'image/png' })
  })
}

const gallery = (page: Page) => page.getByRole('dialog', { name: 'Basemaps' })
const rows = (page: Page) => gallery(page).locator('[role="option"]')

test('opening the modal and typing in search: no long task over 100 ms at 6x CPU', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: number[] }
    w.__longTasks = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push(Math.round(e.duration))
    }).observe({ type: 'longtask', buffered: true })
  })
  await offline(page)
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  // Users have no test hooks: no rendered-feature count on each idle.
  await page.evaluate(() => delete document.documentElement.dataset.seTestHooks)
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await page.waitForTimeout(1000)
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks = []))
  await page.getByRole('button', { name: 'More basemaps…' }).click()
  await expect(gallery(page)).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search basemaps' }).pressSequentially('carto dark', { delay: 80 })
  await expect.poll(() => rows(page).count()).toBeGreaterThan(0)
  await page.waitForTimeout(1000)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const long = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks)
  console.log('gallery long tasks at 6x:', JSON.stringify(long))
  expect(Math.max(0, ...long)).toBeLessThanOrEqual(100)
})
