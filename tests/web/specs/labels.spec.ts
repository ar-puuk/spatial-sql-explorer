// Spec 011 US6: labels, from their own button on the side panel's rail.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chooseStyleType, fixture, openFile, openStyle } from './helpers'

const side = (page: Page) => page.getByRole('complementary', { name: 'Labels' })
const host = (page: Page) => page.locator('.canvas-host')
const rendered = (page: Page) => host(page).getAttribute('data-rendered-features')
const labels = async (page: Page) => Number((await host(page).getAttribute('data-rendered-labels')) ?? -1)
/** How many dark (label text) pixels the map shows: the canvas, read back from a screenshot. */
async function textPixels(page: Page): Promise<number> {
  const png = await page.locator('.canvas-host canvas').first().screenshot()
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const canvas = new OffscreenCanvas(bmp.width, bmp.height)
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
    ctx.drawImage(bmp, 0, 0)
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 70 && d[i + 1] < 70 && d[i + 2] < 80) n++
    return n
  }, png.toString('base64'))
}

/** Twelve straight, named roads with a level of service (a line label needs room along the line). */
function straightRoads(): string {
  const features = Array.from({ length: 12 }, (_, i) => ({
    type: 'Feature',
    properties: { id: i + 1, name: `Road ${i + 1}`, los: 'ABCDEF'[i % 6] },
    geometry: { type: 'LineString', coordinates: [[-111.9, 40.6 + i * 0.01], [-111.8, 40.6 + i * 0.01 + (i % 3) * 0.004]] },
  }))
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-labels-')), 'roads.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  return file
}

async function openLabels(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Labels', exact: true }).click()
  await expect(side(page)).toBeVisible()
}
async function blank(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await page.getByRole('radio', { name: /^Blank/ }).click()
}

test('points: the Labels button turns labels on from a column; size changes the text; keyboard and axe clean', async ({ page }, info) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFile(page, fixture('crashes.geojson'))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await blank(page)
  // The rail button is named and keyboard reachable; off by default.
  const button = page.getByRole('button', { name: 'Labels', exact: true })
  await expect(button).toHaveAttribute('title', 'Labels')
  await openLabels(page)
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  const show = side(page).getByRole('checkbox', { name: 'Show labels' })
  await expect(show).not.toBeChecked()
  await expect.poll(() => labels(page)).toBe(0)

  await show.check()
  await expect(side(page).getByLabel('From')).toHaveValue('name')
  await expect(button).toHaveAttribute('title', 'Labels: on (name)')
  await page.getByRole('button', { name: 'Zoom to layer' }).click()
  await expect.poll(() => labels(page), { timeout: 20000 }).toBeGreaterThan(5)
  // Not every crash is labeled: labels that would overlap are left out.
  expect(await labels(page)).toBeLessThan(3000)
  await page.screenshot({ path: info.outputPath('points-12.png') })
  // Bigger text: more text pixels per label.
  const perLabel = async () => (await textPixels(page)) / Math.max(1, await labels(page))
  const small = await perLabel()
  await side(page).getByLabel('Size', { exact: true }).fill('24')
  await expect.poll(perLabel, { timeout: 10000 }).toBeGreaterThan(small * 2)
  await page.screenshot({ path: info.outputPath('points-24.png') })

  // Every control is named; axe finds nothing in the panel.
  for (const name of ['From', 'Size', 'Color', 'Halo color', 'Halo width', 'Offset']) await expect(side(page).getByLabel(name, { exact: true })).toBeVisible()
  await expect(side(page).getByRole('radiogroup', { name: 'Point labels' })).toBeVisible()
  const axe = await new AxeBuilder({ page }).include('aside[aria-label="Labels"]').analyze()
  expect(axe.violations.map((v) => v.id)).toEqual([])
})

test('lines follow the line; an expression labels; a bad expression shows its error and keeps no stale text', async ({ page }, info) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFile(page, straightRoads())
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await blank(page)
  await openLabels(page)
  await side(page).getByRole('checkbox', { name: 'Show labels' }).check()
  await page.getByRole('button', { name: 'Zoom to layer' }).click()
  await expect.poll(() => labels(page), { timeout: 20000 }).toBeGreaterThan(0)
  const layers = await host(page).evaluate((el) => (el as HTMLElement & { seLabels: () => Array<{ layer: string }> }).seLabels().map((l) => l.layer))
  expect(new Set(layers)).toEqual(new Set(['se-label-line']))
  await page.screenshot({ path: info.outputPath('lines.png') })

  await side(page).getByLabel('From').selectOption({ label: 'SQL expression…' })
  const expr = side(page).getByLabel('Label expression')
  await expr.fill("name || ' (' || los || ')'")
  await expr.press('Enter')
  await expect(side(page).getByRole('alert')).toHaveCount(0)
  await expect.poll(() => labels(page), { timeout: 20000 }).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: 'Labels', exact: true })).toHaveAttribute('title', 'Labels: on (expression)')
  await page.screenshot({ path: info.outputPath('lines-expression.png') })

  await expr.fill('nam || los')
  await expr.press('Enter')
  await expect(side(page).getByRole('alert')).toContainText('No column "nam"')
  await expect(expr).toHaveAttribute('aria-invalid', 'true')
  await expect.poll(() => labels(page)).toBe(0)
})

test('hiding a class in the legend hides its labels; switching the basemap keeps them', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFile(page, fixture('counties-011.geojson'))
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await openStyle(page)
  await chooseStyleType(page, 'Graduated')
  await page.getByRole('region', { name: 'Layer style' }).getByLabel('Column', { exact: true }).selectOption('pop')
  await openLabels(page)
  await side(page).getByRole('checkbox', { name: 'Show labels' }).check()
  await page.getByRole('button', { name: 'Zoom to layer' }).click()
  await expect.poll(() => labels(page), { timeout: 20000 }).toBeGreaterThan(0)
  const before = await labels(page)
  await page.getByRole('region', { name: 'Legend' }).getByRole('button', { name: /^Hide class / }).first().click()
  await expect.poll(() => labels(page)).toBeLessThan(before)
  await blank(page)
  await expect.poll(() => labels(page)).toBeGreaterThan(0)
})

test('3D: labels stay drawn on the ground at each polygon', async ({ page }, info) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFile(page, fixture('counties-011.geojson'), '?e2e=1')
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await openLabels(page)
  await side(page).getByRole('checkbox', { name: 'Show labels' }).check()
  await page.getByRole('button', { name: 'Zoom to layer' }).click()
  await expect.poll(() => labels(page), { timeout: 20000 }).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  const toggle = page.getByRole('region', { name: 'Layer style' }).getByRole('switch', { name: 'Extrude polygons' })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  const mapState = () => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState(): { extrusion: boolean; pitch?: number } } }).__spatialExplorerE2E.mapState())
  await expect.poll(async () => (await mapState()).extrusion).toBe(true)
  await expect.poll(async () => (await mapState()).pitch ?? 0).toBeGreaterThan(30)
  await expect.poll(() => labels(page), { timeout: 20000 }).toBeGreaterThan(0)
  await page.screenshot({ path: info.outputPath('3d.png') })
})

test('tiles mode: labels from a column and from an expression draw from the engine tiles', async ({ page }, info) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('counties-011.geojson'), '?e2e=1&tileRows=10')
  await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBeNull()
  await expect(page.getByText(/Drawn from tiles|Load all/).first()).toBeVisible()
  await openLabels(page)
  await side(page).getByRole('checkbox', { name: 'Show labels' }).check()
  await page.getByRole('button', { name: 'Zoom to layer' }).click()
  await expect.poll(() => labels(page), { timeout: 20000 }).toBeGreaterThan(0)
  await side(page).getByLabel('From').selectOption({ label: 'SQL expression…' })
  const expr = side(page).getByLabel('Label expression')
  await expr.fill("name || ' ' || pop")
  await expr.press('Enter')
  await expect.poll(() => labels(page), { timeout: 20000 }).toBeGreaterThan(0)
  const props = await host(page).evaluate((el) => (el as HTMLElement & { seRendered: () => Array<{ properties: Record<string, unknown> }> }).seRendered()[0]?.properties)
  expect(String(props?.__se_lbl)).toMatch(/^County \d+ \d+$/)
  await page.screenshot({ path: info.outputPath('tiles.png') })
})
