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
  await expect(page.getByRole('spinbutton', { name: 'Show from zoom' })).toBeVisible()
}

async function setNumber(page: Page, name: string, value: number): Promise<void> {
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

  test('an end before the start moves to one zoom after it', async ({ page }) => {
    await openFile(page, fixture('crashes.geojson'), '?e2e=1')
    await openStylePanel(page)
    await setNumber(page, 'Show from zoom', 12)
    await setNumber(page, 'Hide from zoom', 8)
    await expect(page.getByRole('spinbutton', { name: 'Hide from zoom' })).toHaveValue('13')
    await expect.poll(async () => (await layers(page)).every((l) => l.minzoom === 12 && l.maxzoom === 13)).toBe(true)
    // Moving the start past the end pushes the end along.
    await setNumber(page, 'Show from zoom', 20)
    await expect(page.getByRole('spinbutton', { name: 'Hide from zoom' })).toHaveValue('21')
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
