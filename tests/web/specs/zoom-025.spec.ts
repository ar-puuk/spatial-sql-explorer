// Spec 025: the zoom range a layer shows in (beside the opacity at the top of the style panel), and sizes that
// follow the zoom. The map's own layers carry MapLibre's minzoom and maxzoom.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile } from './helpers'

type MapLayer = { id: string; minzoom?: number; maxzoom?: number }
const layers = (page: Page): Promise<MapLayer[]> =>
  page.locator('.canvas-host').evaluate((el) => {
    const map = (el as unknown as { seMap: { getStyle(): { layers: Array<{ id: string }> }; getLayer(id: string): { minzoom?: number; maxzoom?: number } } }).seMap
    return map
      .getStyle()
      .layers.filter((l) => l.id.startsWith('se-') && !l.id.includes('selection-halo'))
      .map((l) => ({ id: l.id, minzoom: map.getLayer(l.id).minzoom, maxzoom: map.getLayer(l.id).maxzoom }))
  })
const paintOf = (page: Page, id: string, prop: string): Promise<unknown> =>
  page.locator('.canvas-host').evaluate((el, [layer, p]) => (el as unknown as { seMap: { getPaintProperty(l: string, p: string): unknown } }).seMap.getPaintProperty(layer, p), [id, prop])

async function openStylePanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Style/ }).first().click()
  await expect(page.getByRole('heading', { name: 'Zoom' })).toHaveCount(0)
  await expect(page.getByRole('slider', { name: 'Show from zoom' })).toBeVisible()
}

async function setNumber(page: Page, name: string, value: number): Promise<void> {
  // The zoom range has two slider handles; the other fields are number boxes.
  if (/^(Show|Hide) from zoom$/.test(name)) return page.getByRole('slider', { name }).fill(String(value))
  const field = page.getByRole('spinbutton', { name })
  await field.fill(String(value))
  await field.press('Enter')
}

test.describe('zoom range and sizes', () => {
  test.setTimeout(120000)

  test('the range is at the top with the opacity, and sets the map layers\' minzoom and maxzoom', async ({ page }) => {
    await openFile(page, fixture('crashes.geojson'), '?e2e=1')
    await openStylePanel(page)
    // Opacity first, then the zoom range, then the rest (the Color section).
    const top = async (selector: string): Promise<number> => (await page.locator(selector).first().boundingBox())?.y ?? -1
    const opacity = await top('#layer-opacity-label')
    const range = await top('#zoom-range-label')
    const color = await top('#style-sec-type')
    expect(opacity).toBeGreaterThan(0)
    expect(range).toBeGreaterThan(opacity)
    expect(color).toBeGreaterThan(range)
    expect((await layers(page)).every((l) => l.minzoom === 0 && l.maxzoom === 24)).toBe(true)

    await setNumber(page, 'Show from zoom', 9)
    await setNumber(page, 'Hide from zoom', 15)
    await expect.poll(async () => (await layers(page)).every((l) => l.minzoom === 9 && l.maxzoom === 15)).toBe(true)

    // Back to no limit: 0 and 24.
    await setNumber(page, 'Show from zoom', 0)
    await setNumber(page, 'Hide from zoom', 24)
    await expect.poll(async () => (await layers(page)).every((l) => l.minzoom === 0 && l.maxzoom === 24)).toBe(true)
  })

  test('the handles never cross: the one you move pushes the other', async ({ page }) => {
    await openFile(page, fixture('crashes.geojson'), '?e2e=1')
    await openStylePanel(page)
    const from = page.getByRole('slider', { name: 'Show from zoom' })
    const to = page.getByRole('slider', { name: 'Hide from zoom' })
    await setNumber(page, 'Show from zoom', 12)
    await setNumber(page, 'Hide from zoom', 8)
    // 8 is before 12: the start is pushed to 7.
    await expect(to).toHaveValue('8')
    await expect(from).toHaveValue('7')
    await expect.poll(async () => (await layers(page)).every((l) => l.minzoom === 7 && l.maxzoom === 8)).toBe(true)
    await setNumber(page, 'Show from zoom', 20)
    await expect(from).toHaveValue('20')
    await expect(to).toHaveValue('21')
    // The two numbers beside the slider say the same.
    await expect(page.locator('.zoom-range-value')).toHaveText('20 – 21')
  })

  test('two small triangles on the slider show where the map is, grey when the layer is hidden there', async ({ page }) => {
    await openFile(page, fixture('crashes.geojson'), '?e2e=1')
    await openStylePanel(page)
    const jump = (zoom: number): Promise<void> => page.evaluate((z) => (window as unknown as { __spatialExplorerE2E: { jumpTo(a: number, b: number, c: number): void } }).__spatialExplorerE2E.jumpTo(-112, 40.7, z), zoom)
    const dot = page.locator('.se-range2 .mark.top')
    await jump(12)
    await expect(dot).toHaveAttribute('title', 'The map is at zoom 12.0')
    // One above the track and one below, at the same place; no sentence, no scale.
    await expect(page.locator('.se-range2 .mark')).toHaveCount(2)
    await expect(page.locator('.zoom-now, #zoom-range-hint, .se-range2 .tick, .se-range2 .flag, .se-range2 .line, .se-range2 .dot')).toHaveCount(0)
    await setNumber(page, 'Show from zoom', 5)
    await setNumber(page, 'Hide from zoom', 10)
    await expect(dot).toHaveAttribute('title', 'The map is at zoom 12.0: the layer is hidden here')
    await expect(page.locator('.se-range2 .mark.outside')).toHaveCount(2)
    await jump(8)
    await expect(dot).toHaveAttribute('title', 'The map is at zoom 8.0')
    await expect(page.locator('.se-range2 .mark.outside')).toHaveCount(0)
    // They stand where the zoom is on the scale of 0 to 24.
    const left = await dot.evaluate((el) => (el as HTMLElement).style.left)
    expect(parseFloat(left)).toBeCloseTo((8 / 24) * 100, 0)
  })

  test('the triangles follow the zoom while the map is still moving', async ({ page }) => {
    await openFile(page, fixture('crashes.geojson'), '?e2e=1')
    await openStylePanel(page)
    const top = page.locator('.se-range2 .mark.top')
    await page.locator('.canvas-host').evaluate((el) => (el as unknown as { seMap: { jumpTo(o: unknown): void } }).seMap.jumpTo({ zoom: 6 }))
    await expect(top).toHaveAttribute('title', 'The map is at zoom 6.0')
    // A slow zoom, watched from inside the page a frame at a time (a loaded machine delays round trips, not frames): the marker
    // shows rising values between 6 and 14 while the map has not stopped.
    const samples = await page.evaluate(async () => {
      const map = (document.querySelector('.canvas-host') as unknown as { seMap: { easeTo(o: unknown): void; getZoom(): number; isMoving(): boolean } }).seMap
      const shown = (): number => Number(/zoom ([\d.]+)/.exec(document.querySelector('.se-range2 .mark.top')?.getAttribute('title') ?? '')?.[1])
      map.easeTo({ zoom: 14, duration: 8000, essential: true })
      const out: Array<{ map: number; shown: number; moving: boolean }> = []
      const until = performance.now() + 4000
      while (performance.now() < until) {
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        out.push({ map: map.getZoom(), shown: shown(), moving: map.isMoving() })
      }
      return out
    })
    const moving = samples.filter((x) => x.moving)
    expect(moving.length).toBeGreaterThan(10)
    // Many different values while moving, rising, and never far behind the map (it is one frame, not the end of the move).
    expect(new Set(moving.map((x) => x.shown)).size).toBeGreaterThan(5)
    expect(moving.every((x, i) => i === 0 || x.shown >= moving[i - 1].shown)).toBe(true)
    expect(moving.at(-1)?.shown).toBeGreaterThan(7)
    expect(moving.at(-1)?.shown).toBeLessThan(14)
    expect(moving.every((x) => x.map - x.shown < 0.5)).toBe(true)
  })

  test('sizes follow the zoom from a switch, and the map paints a zoom curve', async ({ page }) => {
    await openFile(page, fixture('crashes.geojson'), '?e2e=1')
    await openStylePanel(page)
    expect(JSON.stringify(await paintOf(page, 'se-circle', 'circle-radius'))).not.toContain('"zoom"')
    await page.getByRole('switch', { name: 'Sizes follow zoom' }).click()
    await expect.poll(async () => JSON.stringify(await paintOf(page, 'se-circle', 'circle-radius'))).toContain('"zoom"')
    await expect(page.getByRole('spinbutton', { name: 'Smallest at zoom' })).toHaveValue('10')
    await setNumber(page, 'Full size at zoom', 16)
    await expect.poll(async () => JSON.stringify(await paintOf(page, 'se-circle', 'circle-radius'))).toContain('16')
    await page.getByRole('switch', { name: 'Sizes follow zoom' }).click()
    await expect.poll(async () => JSON.stringify(await paintOf(page, 'se-circle', 'circle-radius'))).not.toContain('"zoom"')
  })

  test('a GTFS feed starts with sizes that follow the zoom, lines a little less than stops', async ({ page }) => {
    await openFile(page, fixture('gtfs-mini.zip'), '?e2e=1')
    const radius = JSON.stringify(await paintOf(page, 'se-circle', 'circle-radius'))
    expect(radius).toContain('"zoom"')
    // 5 px at full size, 35% of it at zoom 10 and below.
    expect(radius).toContain('1.75')
    const width = JSON.stringify(await paintOf(page, 'se-line', 'line-width'))
    expect(width).toContain('"zoom"')
    // 3 px at full size (a curve over the line's own selected/hover widths), 60% at zoom 10 and below.
    expect(width).toContain(',0.6]')
  })
})
