// Spec 011 T072 (research §1, tracked check): a line pattern that varies per
// feature draws from the engine's vector tiles as it does from GeoJSON. Two
// long horizontal lines, the pattern by their class: along the solid one the
// line color runs unbroken; along the dashed one it breaks again and again.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { openFile, openStyle, varyBy } from './helpers'

function twoLines(): string {
  const features = [
    { type: 'Feature', properties: { kind: 'A' }, geometry: { type: 'LineString', coordinates: [[-111.95, 40.6], [-111.75, 40.6]] } },
    { type: 'Feature', properties: { kind: 'B' }, geometry: { type: 'LineString', coordinates: [[-111.95, 40.68], [-111.75, 40.68]] } },
  ]
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-dash-')), 'lines.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  return file
}

test('patterns by category draw from engine tiles: one line solid, the other dashed', async ({ page }, info) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, twoLines(), '?e2e=1&tileRows=1')
  const mode = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { drawState(): { mode: string } } }).__spatialExplorerE2E.drawState().mode)
  expect(mode).toBe('tiles')
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await page.getByRole('radio', { name: /^Blank/ }).click()
  await openStyle(page)
  const panel = page.getByRole('region', { name: 'Layer style' })
  await panel.getByLabel('Width', { exact: true }).fill('4')
  await varyBy(page, 'Pattern')
  await panel.getByLabel('Pattern column').selectOption('kind')
  const outputs = await panel.getByRole('list', { name: 'Pattern classes' }).locator('select').evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value))
  expect(outputs.slice(0, 2)).toEqual(['solid', 'dash'])
  await page.getByRole('button', { name: 'Zoom to layer' }).click()
  await page.waitForTimeout(2500)

  const png = await page.locator('.canvas-host canvas').first().screenshot()
  fs.writeFileSync(info.outputPath('dash-tiles.png'), png)
  // Rows where the line color (#1d4ed8-ish) is drawn, and along each band, how often it breaks.
  const bands = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const cv = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = cv.getContext('2d') as OffscreenCanvasRenderingContext2D
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    const isLine = (x: number, y: number) => {
      const i = (y * bmp.width + x) * 4
      return d[i + 2] > 150 && d[i] < 100 && d[i + 1] < 140
    }
    const rows: Array<{ y: number; on: number; runs: number }> = []
    for (let y = 0; y < bmp.height; y++) {
      let on = 0
      let runs = 0
      let prev = false
      for (let x = 0; x < bmp.width; x++) {
        const v = isLine(x, y)
        if (v) on++
        if (v && !prev) runs++
        prev = v
      }
      if (on > 100) rows.push({ y, on, runs })
    }
    // Group neighboring rows into bands; each band's middle row.
    const out: Array<{ y: number; on: number; runs: number }> = []
    for (const r of rows) {
      const last = out[out.length - 1]
      if (last && r.y - last.y <= 2) {
        if (r.on > last.on) Object.assign(last, r)
        else last.y = r.y
      } else out.push({ ...r })
    }
    return out
  }, png.toString('base64'))
  expect(bands).toHaveLength(2)
  const [top, bottom] = bands
  // The upper line is B (dashed), the lower A (solid).
  expect(bottom.runs).toBeLessThanOrEqual(2)
  expect(top.runs).toBeGreaterThan(10)
})
