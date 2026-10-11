// T079 (spec 008 US7, FR-030, SC-007): the map as a PNG.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { fixture, openFile } from './helpers'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Export map image' })
/** PNG width and height from the IHDR chunk. */
const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20), png: b.subarray(1, 4).toString('latin1') === 'PNG' })

type Shot = { width: number; height: number; notes: string[]; base64: string }
const capture = (page: Page, scale: 1 | 2, legend: boolean) =>
  page.evaluate(([s, l]) => (window as unknown as { __spatialExplorerE2E: { captureMap(s: 1 | 2, l: boolean): Promise<Shot> } }).__spatialExplorerE2E.captureMap(s, l), [scale, legend] as const)
/** One pixel of a PNG, decoded by the browser. */
const pixel = (page: Page, base64: string, x: number, y: number) =>
  page.evaluate(
    async ([b, px, py]) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return Array.from(ctx.getImageData(px, py, 1, 1).data)
    },
    [base64, x, y] as const
  )

test('Export map image: 1x and 2x PNGs of the map, through the dialog, in under 5 s', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const map = (await page.locator('.canvas-host').boundingBox())!
  const open = page.getByRole('button', { name: 'Export map image…' })
  await open.click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('radio', { name: '2×' })).toHaveAttribute('aria-checked', 'true')

  for (const scale of [1, 2] as const) {
    await dialog(page).getByRole('radio', { name: `${scale}×` }).click()
    const started = Date.now()
    const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Export' }).click()])
    expect(download.suggestedFilename()).toBe('world-boundaries-map.png')
    const size = pngSize(fs.readFileSync((await download.path())!))
    expect(Date.now() - started).toBeLessThan(5000) // SC-007
    expect(size.png).toBe(true)
    expect(size.width).toBe(Math.round(map.width) * scale)
    expect(size.height).toBe(Math.round(map.height) * scale)
    await expect(dialog(page).getByRole('status').filter({ hasText: 'Saved' })).toContainText(`${size.width} × ${size.height} px`)
  }
  // The map goes back to the screen's pixel ratio.
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(open).toBeFocused()
})

test('the legend is drawn into the image', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const without = await capture(page, 1, false)
  const withLegend = await capture(page, 1, true)
  expect(withLegend.width).toBe(without.width)
  // The test legend's swatch (#ff0000) sits in the bottom-left box.
  const [r, g, b] = await pixel(page, withLegend.base64, 24, withLegend.height - 45)
  expect(r).toBeGreaterThan(200)
  expect(g).toBeLessThan(60)
  expect(b).toBeLessThan(60)
  const plain = await pixel(page, without.base64, 24, without.height - 45)
  expect(plain[0] > 200 && plain[1] < 60).toBe(false)
})

test('the dialog offers the legend only when one is shown', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await page.getByRole('button', { name: 'Export map image…' }).click()
  await expect(dialog(page).getByRole('checkbox', { name: 'Include legend' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Layer style' }).click()
  await page.getByRole('radio', { name: 'Categorized' }).click()
  await page.getByRole('button', { name: 'Layer style' }).click()
  await page.getByRole('button', { name: 'Export map image…' }).click()
  await expect(dialog(page).getByRole('checkbox', { name: 'Include legend' })).toBeChecked()
})

test('a raster basemap whose tiles can not be read: the image is still made, and says the basemap is left out', async ({ page }) => {
  test.setTimeout(120000)
  // MapLibre fetches tiles with CORS: a server that doesn't allow it fails
  // the tiles (they can't taint the canvas); the basemap falls back to blank.
  await page.route(/arcgisonline\.com/, (route) => route.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await page.getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('dialog', { name: 'Basemap' }).getByRole('radio', { name: /^Satellite/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.map-notice')).toContainText(/Satellite basemap unavailable/, { timeout: 30000 })
  await page.getByRole('button', { name: 'Export map image…' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Export' }).click()])
  expect(pngSize(fs.readFileSync((await download.path())!)).png).toBe(true)
  await expect(dialog(page)).toContainText('basemap could not be loaded')
})
