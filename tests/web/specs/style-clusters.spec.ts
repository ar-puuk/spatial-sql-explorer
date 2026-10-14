// Clusters (bubbles, after mapgl's cluster_options): points grouped into
// bubbles colored and sized by count, drawn from memory (MapLibre's GeoJSON
// clustering) and from the engine's tiles (grouped in SQL). The map's pixels
// are read back for the bubbles' colors; a click on a bubble zooms in.
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { chooseStyleType, openFile, openStyle } from './helpers'

/** Three groups of points (1500, 400 and 60) and 30 scattered. */
function writePoints(): string {
  let seed = 7
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  const features: unknown[] = []
  for (const [cx, cy, n] of [
    [-112, 40.7, 1500],
    [-111.6, 40.3, 400],
    [-111.9, 41.1, 60],
  ]) {
    for (let i = 0; i < n; i++) {
      const r = 0.15 * Math.sqrt(rand())
      const a = rand() * 2 * Math.PI
      features.push({ type: 'Feature', properties: { name: `P${features.length}` }, geometry: { type: 'Point', coordinates: [cx + r * Math.cos(a), cy + r * Math.sin(a)] } })
    }
  }
  for (let i = 0; i < 30; i++) features.push({ type: 'Feature', properties: { name: `L${i}` }, geometry: { type: 'Point', coordinates: [-113 + rand() * 2.5, 39.8 + rand() * 2] } })
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-clusters-')), 'points.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  return file
}

// mapgl's three steps: from 2, 100 and 750 points.
const SMALL = '#51bbd6'
const MID = '#f1f075'
const BIG = '#f28cb1'

/** For each color: how many map pixels are near it, and their center (CSS px within the canvas). */
async function pixelsNear(page: Page, colors: string[]): Promise<Array<{ count: number; x: number; y: number }>> {
  const canvas = page.locator('.canvas-host canvas').first()
  const png = await canvas.screenshot()
  const box = (await canvas.boundingBox())!
  return page.evaluate(
    async ({ b64, colors, width }) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D
      ctx.drawImage(bmp, 0, 0)
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
      const scale = width / bmp.width
      return colors.map((h) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
        let count = 0
        let sx = 0
        let sy = 0
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) >= 24) continue
          const p = i / 4
          count++
          sx += p % bmp.width
          sy += Math.floor(p / bmp.width)
        }
        return { count, x: count ? (sx / count) * scale : 0, y: count ? (sy / count) * scale : 0 }
      })
    },
    { b64: png.toString('base64'), colors, width: box.width }
  )
}

const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
type Bounds = [number, number, number, number]
const mapBounds = (page: Page) => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapBounds(): Bounds } }).__spatialExplorerE2E.mapBounds())
const selectedId = (page: Page) => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { selectionState(): { ids: number[] | null } } }).__spatialExplorerE2E.selectionState().ids)

for (const mode of ['GeoJSON', 'engine tiles'] as const) {
  test(`clusters from ${mode}: bubbles by count, a legend of steps, a click zooms in`, async ({ page }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width: 1400, height: 900 })
    await openFile(page, writePoints(), mode === 'GeoJSON' ? '?e2e=1' : '?e2e=1&tileRows=1')
    await openStyle(page)
    await chooseStyleType(page, 'Clusters')

    await expect(legend(page)).toContainText('2–99 points')
    await expect(legend(page)).toContainText('100–749 points')
    await expect(legend(page)).toContainText('750+ points')
    await expect(legend(page)).toContainText('Single points')
    // Each group is one bubble of its step's color.
    await expect.poll(async () => (await pixelsNear(page, [BIG, MID, SMALL])).map((p) => p.count > 200), { timeout: 20000 }).toEqual([true, true, true])

    // A click on the biggest bubble zooms in (it breaks apart); it selects nothing.
    const before = await mapBounds(page)
    const [big] = await pixelsNear(page, [BIG])
    const box = (await page.locator('.canvas-host canvas').first().boundingBox())!
    await page.mouse.click(box.x + big.x, box.y + big.y)
    await expect.poll(async () => { const b = await mapBounds(page); return b[2] - b[0] < (before[2] - before[0]) * 0.9 }, { timeout: 10000 }).toBe(true)
    expect((await selectedId(page)) ?? []).toEqual([])

    // Back to a single color: no bubbles.
    await chooseStyleType(page, 'Single')
    await expect.poll(async () => (await pixelsNear(page, [BIG, MID]))[0].count + (await pixelsNear(page, [MID]))[0].count, { timeout: 15000 }).toBe(0)
  })
}

test('cluster settings: steps can be added and removed, and the legend follows', async ({ page }) => {
  await openFile(page, writePoints())
  await openStyle(page)
  await chooseStyleType(page, 'Clusters')
  const panel = page.getByRole('region', { name: 'Layer style' })
  await panel.getByRole('button', { name: 'Add a step' }).click()
  await expect(legend(page)).toContainText('750–3,749 points')
  await expect(legend(page)).toContainText('3,750+ points')
  await panel.getByRole('button', { name: 'Remove the step for 3,750+ points' }).click()
  await panel.getByRole('button', { name: 'Remove the step for 750+ points' }).click()
  await expect(legend(page)).toContainText('100+ points')
  await panel.getByRole('spinbutton', { name: 'Step 2 starts at' }).fill('50')
  await panel.getByRole('spinbutton', { name: 'Step 2 starts at' }).press('Enter')
  await expect(legend(page)).toContainText('2–49 points')
  await expect(legend(page)).toContainText('50+ points')
})
