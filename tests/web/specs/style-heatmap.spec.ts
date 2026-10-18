// Heatmap: the style type dropdown (each type with its one-line description),
// then a point heatmap drawn in GeoJSON mode and in tiles mode. The map's
// pixels are read back: the densest cluster takes the ramp's last color, and
// switching back to Single removes it. Points stay clickable (their circles
// are drawn invisibly under the heatmap).
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { chooseStyleType, fixture, openFile, openStyle } from './helpers'

/** 300 points in two clusters, with a population. */
function writePoints(): string {
  const features = Array.from({ length: 300 }, (_, i) => {
    const dense = i < 220
    const a = i * 2.399963
    const r = dense ? 0.6 * Math.sqrt((i + 1) / 220) : 3 * Math.sqrt((i - 219) / 80)
    const [cx, cy] = dense ? [10, 10] : [-30, -15]
    return { type: 'Feature', properties: { name: `P${i}`, pop: ((i * 37) % 100) + 1 }, geometry: { type: 'Point', coordinates: [cx + r * Math.cos(a), cy + r * Math.sin(a)] } }
  })
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-heat-')), 'points.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  return file
}

// Yellow–orange–red at 7 stops (core rampColors): the lightest and the densest.
const LIGHTEST = '#ffffb2'
const DENSEST = '#b10026'

/** How many map pixels are close to each color (the canvas, read back from a screenshot). */
async function pixelsNear(page: Page, colors: string[]): Promise<number[]> {
  const png = await page.locator('.canvas-host canvas').first().screenshot()
  return page.evaluate(
    async ({ b64, colors }) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
      const canvas = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
      ctx.drawImage(bmp, 0, 0)
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
      const want = colors.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)))
      const counts = want.map(() => 0)
      for (let i = 0; i < d.length; i += 4) want.forEach((c, k) => (counts[k] += Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]) < 30 ? 1 : 0))
      return counts
    },
    { b64: png.toString('base64'), colors }
  )
}

const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const drawnCount = (page: Page) => page.locator('.canvas-host').evaluate((el) => (el as HTMLElement & { seRendered?: () => unknown[] }).seRendered?.().length ?? 0)

test('the style type dropdown: each type with what it does; Heatmap only for points', async ({ page }) => {
  await openFile(page, writePoints())
  await openStyle(page)
  const button = page.getByRole('button', { name: 'Color: Single color' })
  await expect(button).toContainText('One color for every feature')
  await button.click()
  const options = page.getByRole('listbox', { name: 'Color styles' }).getByRole('option')
  await expect(options).toHaveText([
    /^\s*Single color\s*One color for every feature/,
    /^\s*Categorized\s*A color for each value of a column/,
    // One numeric column: no bivariate, and the option says why.
    /^\s*Graduated\s*Colors by ranges of a number or an expression/,
    // Spec 011 US4.
    /^\s*Continuous\s*Colors along a ramp, in proportion to a number/,
    /^\s*Bivariate\s*Bivariate maps need two numeric columns\./,
    /^\s*Rules\s*SQL conditions: the first one a feature meets colors it/,
    /^\s*As is\s*Colors read from a column \(#rrggbb\)/,
    /^\s*Heatmap\s*Where points cluster, as a smooth density surface/,
    /^\s*Clusters\s*Nearby points grouped into bubbles, sized and colored by how many/,
  ])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox', { name: 'Color styles' })).toBeHidden()
  await expect(button).toBeFocused()

  // Polygons: no heatmap, with the reason.
  await openFile(page, fixture('world-boundaries.geojson'))
  await openStyle(page)
  await page.getByRole('button', { name: /^Color: / }).click()
  const heat = page.getByRole('option', { name: 'Heatmap', exact: true })
  await expect(heat).toHaveAttribute('aria-disabled', 'true')
  await expect(heat).toContainText('Heatmaps need points; this layer has none.')
})

for (const mode of ['GeoJSON', 'tiles'] as const) {
  test(`a heatmap is drawn from the points, weighted on request, and Single brings the points back (${mode})`, async ({ page }) => {
    test.setTimeout(90000)
    await openFile(page, writePoints(), mode === 'tiles' ? '?e2e=1&tileRows=10' : '?e2e=1')
    await openStyle(page)
    expect((await pixelsNear(page, [DENSEST]))[0]).toBe(0)

    await chooseStyleType(page, 'Heatmap')
    await expect(legend(page)).toContainText('Density')
    await expect(legend(page)).toContainText('300 points')
    await expect(legend(page).getByRole('img', { name: 'Colors from sparse to dense' })).toBeVisible()
    // The dense cluster saturates to the ramp's last color; the edges fade through its first.
    await expect.poll(async () => (await pixelsNear(page, [DENSEST, LIGHTEST])).every((n) => n > 20), { timeout: 20000, intervals: [100] }).toBe(true)
    // The points are still there to click (their circles, invisible).
    expect(await drawnCount(page)).toBe(300)

    // Weighted by a column; a bigger radius spreads further.
    await page.getByRole('combobox', { name: 'Weight' }).selectOption('pop')
    await expect(legend(page)).toContainText('Density · weighted by pop')
    const before = (await pixelsNear(page, [LIGHTEST]))[0]
    await page.getByRole('slider', { name: 'Radius' }).fill('50')
    await expect.poll(async () => (await pixelsNear(page, [LIGHTEST]))[0], { timeout: 20000, intervals: [100] }).toBeGreaterThan(before)

    // Meters on the map: starts at the size now on screen, so the map barely changes.
    await expect(page.getByText('Fixed on screen: zooming out piles points together')).toBeVisible()
    await page.waitForTimeout(300)
    const px = (await pixelsNear(page, [LIGHTEST]))[0]
    await page.getByRole('radio', { name: 'Meters' }).click()
    await expect(page.getByRole('radio', { name: 'Meters' })).toHaveAttribute('aria-checked', 'true')
    expect(Number(await page.getByRole('spinbutton', { name: 'Radius in meters' }).inputValue())).toBeGreaterThan(1000)
    await expect(page.getByText('Fixed on the map: a place keeps its color at every zoom.')).toBeVisible()
    await page.waitForTimeout(300)
    const m = (await pixelsNear(page, [LIGHTEST]))[0]
    expect(Math.abs(m - px) / px).toBeLessThan(0.25)

    // Size and the point symbol don't apply to a point heatmap.
    const headings = await page.getByRole('region', { name: 'Layer style' }).locator('section h3').allTextContents()
    expect(headings).toEqual(['Color', 'Heatmap', '3D'])

    await chooseStyleType(page, 'Single')
    await expect.poll(async () => (await pixelsNear(page, [DENSEST]))[0], { timeout: 20000, intervals: [100] }).toBe(0)
  })
}

/** MapLibre's kernel summed exactly at every point of writePoints' data (Web Mercator meters; radius: Mercator meters): the density the densest 2% of the points reach. */
function exactPeak(file: string, radius: number): number {
  const R = 6378137
  const xy = (JSON.parse(fs.readFileSync(file, 'utf8')) as { features: Array<{ geometry: { coordinates: [number, number] } }> }).features.map(({ geometry: { coordinates: [lon, lat] } }) => [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))])
  const dens = xy.map(([x0, y0]) => {
    let d = 0
    for (const [x, y] of xy) d += Math.exp((-4.5 * ((x - x0) ** 2 + (y - y0) ** 2)) / radius ** 2)
    return d
  }).sort((a, b) => a - b)
  return dens[Math.ceil(dens.length * 0.98) - 1] * 0.3989422804014327
}

for (const mode of ['GeoJSON', 'tiles'] as const) {
  test(`automatic intensity: from the engine, the densest 2% reach the last color (${mode})`, async ({ page }) => {
    test.setTimeout(90000)
    const file = writePoints()
    await openFile(page, file, mode === 'tiles' ? '?e2e=1&tileRows=10' : '?e2e=1')
    await openStyle(page)
    await chooseStyleType(page, 'Heatmap')
    // Intensity 1 floods the dense cluster with the last color.
    await expect.poll(async () => (await pixelsNear(page, [DENSEST]))[0], { timeout: 20000, intervals: [100] }).toBeGreaterThan(200)
    const flooded = (await pixelsNear(page, [DENSEST]))[0]

    // Automatic, from pixels: the radius switches to meters.
    await page.getByRole('checkbox', { name: /^Automatic/ }).check()
    await expect(page.getByRole('radio', { name: 'Meters' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('slider', { name: 'Intensity' })).toBeDisabled()
    // The radius is then fitted to the point spacing (it changes from the pixel radius carried over).
    const radiusBox = page.getByRole('spinbutton', { name: 'Radius in meters' })
    const carried = await radiusBox.inputValue()
    await expect.poll(async () => await radiusBox.inputValue(), { timeout: 20000, intervals: [100] }).not.toBe(carried)
    const meters = Number(await radiusBox.inputValue())
    const lat = (await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState(): { center: [number, number] } } }).__spatialExplorerE2E.mapState().center))[1]
    const want = 1 / exactPeak(file, meters / Math.cos((lat * Math.PI) / 180))
    const shown = page.locator('.row', { has: page.getByRole('slider', { name: 'Intensity' }) }).locator('.value')
    await expect.poll(async () => Math.abs(parseFloat((await shown.textContent()) ?? '') / want - 1), { timeout: 20000, intervals: [100] }).toBeLessThan(0.15)

    // The peak is still the top of the ramp (the last two stops), but no longer a flood.
    await expect
      .poll(async () => {
        const [top, next] = await pixelsNear(page, [DENSEST, '#e31a1c'])
        return top + next > 0 && top < flooded / 3
      }, { timeout: 20000, intervals: [100] })
      .toBe(true)
  })
}
