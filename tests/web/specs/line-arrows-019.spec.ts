// Spec 019: direction arrows along lines. A long west-to-east line; the Arrows control in the style panel turns the
// arrow layer on, and the arrowheads are drawn (taller than the line itself), in the line's color.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { openFile, openStyle } from './helpers'

type Hooked = { seMap: { getLayer(id: string): unknown; getLayoutProperty(id: string, p: string): unknown; hasImage(id: string): boolean; queryRenderedFeatures(o?: unknown, f?: unknown): unknown[] } }

function oneLine(): string {
  const feature = { type: 'Feature', properties: { name: 'A' }, geometry: { type: 'LineString', coordinates: [[-111.95, 40.6], [-111.75, 40.6]] } }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-arrows-')), 'line.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: [feature] }))
  return file
}

const map = <T>(page: Page, fn: (m: Hooked['seMap']) => T, ...args: never[]): Promise<T> =>
  page.evaluate(`(${fn.toString()})((document.querySelector('.canvas-host')).seMap)`, ...args) as Promise<T>

async function setup(page: Page, search = '?e2e=1'): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, oneLine(), search)
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await page.getByRole('radio', { name: /^Blank/ }).click()
  await openStyle(page)
}

test('the Arrows control draws arrowheads along the line, and None takes them away', async ({ page }) => {
  test.setTimeout(120000)
  await setup(page)
  const panel = page.getByRole('region', { name: 'Layer style' })
  const visibility = () => map(page, (m) => m.getLayoutProperty('se-line-arrow', 'visibility'))
  expect(await visibility()).toBe('none')

  await panel.getByLabel('Arrows', { exact: true }).selectOption('along')
  await expect.poll(visibility).toBe('visible')
  expect(await map(page, (m) => m.getLayoutProperty('se-line-arrow', 'symbol-placement'))).toBe('line')
  await expect.poll(() => map(page, (m) => m.hasImage('se-arrow'))).toBe(true)
  await expect(panel.getByRole('slider', { name: 'Spacing' })).toBeVisible()

  // Middle of the line: one arrow, no spacing.
  await panel.getByLabel('Arrows', { exact: true }).selectOption('center')
  await expect.poll(() => map(page, (m) => m.getLayoutProperty('se-line-arrow', 'symbol-placement'))).toBe('line-center')
  await expect(panel.getByRole('slider', { name: 'Spacing' })).toHaveCount(0)

  await panel.getByLabel('Arrows', { exact: true }).selectOption('none')
  await expect.poll(visibility).toBe('none')
})

test('the arrowheads are painted: pixels above and below the thin line, in its color', async ({ page }, info) => {
  test.setTimeout(120000)
  await setup(page)
  const panel = page.getByRole('region', { name: 'Layer style' })
  await panel.getByLabel('Arrows', { exact: true }).selectOption('along')
  await page.waitForTimeout(2500)
  const png = await page.locator('.canvas-host canvas').first().screenshot()
  fs.writeFileSync(info.outputPath('arrows.png'), png)
  const counts = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const cv = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = cv.getContext('2d') as OffscreenCanvasRenderingContext2D
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    const isLine = (x: number, y: number) => {
      const i = (y * bmp.width + x) * 4
      return Math.abs(d[i] - 27) < 45 && Math.abs(d[i + 1] - 84) < 45 && Math.abs(d[i + 2] - 112) < 45
    }
    const rows: number[] = []
    for (let y = 0; y < bmp.height; y++) {
      let n = 0
      for (let x = 0; x < bmp.width; x++) if (isLine(x, y)) n++
      rows.push(n)
    }
    const lineRow = rows.indexOf(Math.max(...rows))
    // Painted rows: the line itself, plus whatever sticks out of it.
    const painted = rows.filter((n) => n > 0).length
    return { lineRow, painted, inRows: rows.slice(lineRow - 12, lineRow + 12).filter((n) => n > 0).length }
  }, png.toString('base64'))
  // A 1.5 px line paints about 2-3 rows; arrowheads (about 16 px tall at this size) paint many more.
  expect(counts.painted).toBeGreaterThan(8)
})

test('the arrows draw from engine tiles too (big files)', async ({ page }) => {
  test.setTimeout(120000)
  await setup(page, '?e2e=1&tileRows=1')
  const mode = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { drawState(): { mode: string } } }).__spatialExplorerE2E.drawState().mode)
  expect(mode).toBe('tiles')
  const panel = page.getByRole('region', { name: 'Layer style' })
  await panel.getByLabel('Arrows', { exact: true }).selectOption('along')
  await expect.poll(() => map(page, (m) => m.queryRenderedFeatures({ layers: ['se-line-arrow'] }).length), { timeout: 20000 }).toBeGreaterThan(0)
})
