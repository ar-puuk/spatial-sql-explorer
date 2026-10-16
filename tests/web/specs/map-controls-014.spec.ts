// Spec 014: the Map controls side panel. Which controls show, and the corner each one
// sits in (a row per control: switch, name, position), remembered for the user (not per file).
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fixture } from './helpers'

async function open(page: Page): Promise<void> {
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
}
const panel = (page: Page) => page.getByRole('region', { name: 'Map controls', exact: true })
const rail = (page: Page) => page.getByRole('button', { name: 'Map controls', exact: true }).first()
const corner = (page: Page, name: string) => page.locator(`.map-view .corner.${name}`)

async function openPanel(page: Page): Promise<void> {
  // The layout is remembered: after a reload the panel may already be open (the rail button would close it).
  if (await panel(page).isVisible()) return
  await page.locator('.rail').getByRole('button', { name: 'Map controls' }).click()
  await expect(panel(page)).toBeVisible()
}

test('the rail has a Map controls button that opens the panel with every control listed', async ({ page }) => {
  await open(page)
  await openPanel(page)
  for (const name of ['Search', 'Zoom in and out', 'Zoom to layer', 'Reset view', 'Globe view', 'Terrain', 'Draw shapes', 'Measure', 'Select by shape', 'Print map', 'Legend', 'MapLibre logo', 'Scale bar']) {
    await expect(panel(page).getByRole('switch', { name: new RegExp(`^${name}`) })).toBeChecked()
  }
  await expect(panel(page).getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
})

test('unchecking a control removes it from the map, and the choice survives a reload', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: 'Globe view', exact: true })).toBeVisible()
  await openPanel(page)
  await panel(page).getByRole('switch', { name: /^Globe view/ }).uncheck()
  await expect(page.getByRole('button', { name: 'Globe view', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible()

  await page.reload()
  await open(page)
  await expect(page.getByRole('button', { name: 'Globe view', exact: true })).toHaveCount(0)
  await openPanel(page)
  await panel(page).getByRole('button', { name: 'Reset to defaults' }).click()
  await expect(page.getByRole('button', { name: 'Globe view', exact: true })).toBeVisible()
})

test('the scale bar can be turned off and on', async ({ page }) => {
  await open(page)
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(1)
  await openPanel(page)
  await panel(page).getByRole('switch', { name: /^Scale bar/ }).uncheck()
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(0)
  await panel(page).getByRole('switch', { name: /^Scale bar/ }).check()
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(1)
})

test('each control has its own corner: moving one leaves the rest', async ({ page }) => {
  await open(page)
  // By default the buttons are top right, the search top left, the scale bar and logo bottom left.
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Globe view', exact: true })).toBeVisible()
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible()
  await expect(corner(page, 'top-left').getByRole('search')).toBeVisible()
  await expect(corner(page, 'bottom-left').locator('.maplibregl-ctrl-scale')).toHaveCount(1)
  await expect(corner(page, 'bottom-left').locator('.maplibregl-ctrl-logo')).toHaveCount(1)

  await openPanel(page)
  await panel(page).getByLabel('Globe view position').selectOption({ label: 'Bottom right' })
  await expect(corner(page, 'bottom-right').getByRole('button', { name: 'Globe view', exact: true })).toBeVisible()
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Globe view', exact: true })).toHaveCount(0)
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible()
  // It sits at the bottom, above the attribution.
  const view = (await page.locator('.map-view').boundingBox())!
  const box = (await corner(page, 'bottom-right').getByRole('button', { name: 'Globe view', exact: true }).boundingBox())!
  expect(view.y + view.height - (box.y + box.height)).toBeLessThan(80)

  // Even zoom, which is one box of two buttons, can go: the search moves in with it.
  await panel(page).getByLabel('Search position').selectOption({ label: 'Top right' })
  await expect(corner(page, 'top-right').getByRole('search')).toBeVisible()
  await expect(corner(page, 'top-left').getByRole('search')).toHaveCount(0)
  // The search stacks above the buttons in the same corner (registry order).
  const s = (await corner(page, 'top-right').getByRole('search').boundingBox())!
  const z = (await corner(page, 'top-right').getByRole('button', { name: 'Zoom in', exact: true }).boundingBox())!
  expect(s.y).toBeLessThan(z.y)

  // Reset puts everything back.
  await panel(page).getByRole('button', { name: 'Reset to defaults' }).click()
  await expect(corner(page, 'top-left').getByRole('search')).toBeVisible()
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Globe view', exact: true })).toBeVisible()
})

test('the MapLibre logo is on by default; it can be turned off and moved', async ({ page }) => {
  await open(page)
  await expect(page.locator('.maplibregl-ctrl-logo')).toHaveCount(1)
  await openPanel(page)
  await panel(page).getByLabel('MapLibre logo position').selectOption({ label: 'Top left' })
  await expect(corner(page, 'top-left').locator('.maplibregl-ctrl-logo')).toHaveCount(1)
  await panel(page).getByRole('switch', { name: /^MapLibre logo/ }).uncheck()
  await expect(page.locator('.maplibregl-ctrl-logo')).toHaveCount(0)
  await panel(page).getByRole('switch', { name: /^MapLibre logo/ }).check()
  await expect(page.locator('.maplibregl-ctrl-logo')).toHaveCount(1)
})

test('a control that is switched off keeps its position for when it comes back', async ({ page }) => {
  await open(page)
  await openPanel(page)
  await panel(page).getByLabel('Scale bar position').selectOption({ label: 'Top left' })
  await panel(page).getByRole('switch', { name: /^Scale bar/ }).uncheck()
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(0)
  await panel(page).getByRole('switch', { name: /^Scale bar/ }).check()
  await expect(corner(page, 'top-left').locator('.maplibregl-ctrl-scale')).toHaveCount(1)
})

test('each control offers only the positions that suit it: the readout, the top or bottom edge', async ({ page }) => {
  await open(page)
  await openPanel(page)
  const options = (name: string) => panel(page).getByLabel(`${name} position`).locator('option').allTextContents()
  expect(await options('Zoom in and out')).toEqual(['Top left', 'Top right', 'Bottom left', 'Bottom right'])
  expect(await options('Coordinates')).toEqual(['Top center', 'Bottom center'])
  // The hover tooltip has no place on the map, so no position.
  await expect(panel(page).getByLabel('Hover tooltip position')).toHaveCount(0)

  await panel(page).getByRole('switch', { name: /^Coordinates/ }).check()
  await expect(corner(page, 'bottom-center').locator('.coords')).toHaveCount(1)
  await panel(page).getByLabel('Coordinates position').selectOption({ label: 'Top center' })
  await expect(corner(page, 'top-center').locator('.coords')).toHaveCount(1)
  await expect(corner(page, 'bottom-center')).toHaveCount(0)
  // Centered along the top edge.
  const view = (await page.locator('.map-view').boundingBox())!
  const box = (await corner(page, 'top-center').locator('.coords').boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - (view.x + view.width / 2))).toBeLessThan(4)
  expect(box.y - view.y).toBeLessThan(20)
})

test('coordinates: off by default; on, they follow the cursor; a right-click keeps a position to copy', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page)
  await expect(page.locator('.map-view .coords')).toHaveCount(0)
  await openPanel(page)
  await panel(page).getByRole('switch', { name: /^Coordinates/ }).check()
  const readout = page.locator('.map-view .coords')
  const box = (await page.locator('.canvas-host').boundingBox())!
  const at = { x: box.x + box.width / 3, y: box.y + box.height / 2 }
  await page.mouse.move(at.x, at.y)
  await page.mouse.move(at.x + 5, at.y + 5)
  await expect(readout).toContainText(/-?\d+\.\d{5}, -?\d+\.\d{5}/)

  // The readout is live. The position you pointed at stays in the right-click menu while the cursor moves away.
  await page.mouse.click(at.x + 5, at.y + 5, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Position' })
  await expect(menu).toBeVisible()
  const pointed = (await menu.locator('.point-coords').innerText()).trim()
  expect(pointed).toMatch(/^-?\d+\.\d{5}, -?\d+\.\d{5}$/)
  await page.mouse.move(at.x + 120, at.y + 90)
  await expect(menu.locator('.point-coords')).toHaveText(pointed)
  await menu.getByRole('menuitem', { name: 'Copy lat, lon' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(pointed)
  await expect(menu).toHaveCount(0)

  // The other forms: lon, lat and a WKT point.
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Copy as WKT' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^POINT\(-?\d+\.\d{6} -?\d+\.\d{6}\)$/)

  // Esc closes it without copying.
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('the panel has no axe violations', async ({ page }) => {
  await open(page)
  await openPanel(page)
  const results = await new AxeBuilder({ page }).include('[aria-label="Map controls"][role="region"]').analyze()
  expect(results.violations).toEqual([])
})

// Spec 014: the hover tooltip.
type E2E = { __spatialExplorerE2E: { jumpTo(a: number, b: number, z: number): void } }
const tooltip = (page: Page) => page.getByRole('tooltip')

test('hover tooltip: off by default; on, it shows chosen columns, hides while dragging, and follows the column choice', async ({ page }) => {
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('world-boundaries.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await page.evaluate(() => (window as unknown as E2E).__spatialExplorerE2E.jumpTo(-100, 40, 3))
  await page.waitForTimeout(1500)
  const box = (await page.locator('.canvas-host').boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.move(cx + 3, cy + 3)
  await expect(tooltip(page)).toHaveCount(0)

  await openPanel(page)
  await panel(page).getByRole('switch', { name: /^Hover tooltip/ }).check()
  const columns = panel(page).getByRole('group', { name: /Tooltip columns/ }).getByRole('checkbox')
  await expect(columns.first()).toBeVisible()
  const chosen = await columns.evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length)
  expect(chosen).toBeGreaterThan(0)

  await page.mouse.move(cx, cy)
  await page.mouse.move(cx + 4, cy + 4)
  await expect(tooltip(page)).toBeVisible()
  await expect(tooltip(page).locator('.tip-row')).toHaveCount(chosen)

  // Dragging the map shows no tooltip.
  await page.mouse.down()
  await page.mouse.move(cx + 40, cy + 20, { steps: 4 })
  await expect(tooltip(page)).toHaveCount(0)
  await page.mouse.up()

  // Unchecking every column leaves nothing to show.
  const n = await columns.count()
  for (let i = 0; i < n; i++) if (await columns.nth(i).isChecked()) await columns.nth(i).uncheck()
  await page.mouse.move(cx, cy)
  await page.mouse.move(cx + 4, cy + 4)
  await page.waitForTimeout(300)
  await expect(tooltip(page)).toHaveCount(0)
})

test('hover tooltip in engine tiles mode: the chosen columns come by id', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/?e2e=1&tileRows=1000')
  await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.parquet'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await expect.poll(async () => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))).toBeGreaterThan(0)
  await openPanel(page)
  await panel(page).getByRole('switch', { name: /^Hover tooltip/ }).check()
  // A drawn feature's screen position, from the map itself (test hooks).
  const at = await page.evaluate(() => {
    const m = (document.querySelector('.canvas-host') as unknown as { seMap: import('maplibre-gl').Map }).seMap
    const f = m.queryRenderedFeatures().find((x) => x.source.startsWith('se-') && x.geometry.type !== 'GeometryCollection')
    if (!f) return null
    const g = f.geometry as GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.LineString
    const first = (c: unknown): number[] => (Array.isArray(c) && typeof c[0] === 'number' ? (c as number[]) : first((c as unknown[])[0]))
    const p = m.project(first((g as { coordinates: unknown }).coordinates) as [number, number])
    return { x: p.x, y: p.y }
  })
  expect(at).not.toBeNull()
  const box = (await page.locator('.canvas-host').boundingBox())!
  await page.mouse.move(box.x + at!.x + 6, box.y + at!.y + 6)
  await page.mouse.move(box.x + at!.x, box.y + at!.y)
  await expect(tooltip(page)).toBeVisible({ timeout: 15000 })
  await expect(tooltip(page).locator('.tip-row').first()).toBeVisible()
})

test('on a short map the left stacks never spill out of it or over each other', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 })
  await page.goto('/?e2e=1')
  // Many attributes: the feature card is as tall as it can be, so the stacks compete for the room.
  const props = Object.fromEntries(Array.from({ length: 46 }, (_, i) => [`attribute_${i}`, i]))
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-w-')), 'wide.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [-111.9, 40.7] } }] }))
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await page.getByRole('grid', { name: 'Attribute table' }).getByRole('row').nth(1).dblclick()
  await expect(page.locator('.inspector')).toBeVisible()
  // Too little room: the card keeps its header only, and the legend its title.
  await expect(page.locator('.inspector.collapsed')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Filter attributes' })).toHaveCount(0)
  const view = (await page.locator('.map-view').boundingBox())!
  const top = (await corner(page, 'top-left').boundingBox())!
  const bottom = (await corner(page, 'bottom-left').boundingBox())!
  expect(bottom.y + bottom.height).toBeLessThanOrEqual(view.y + view.height + 1)
  expect(top.y + top.height).toBeLessThanOrEqual(bottom.y + 1)
  // Every child of the bottom stack (legend, logo, scale bar) stays inside the stack.
  for (const child of await corner(page, 'bottom-left').locator('> *').all()) {
    const b = await child.boundingBox()
    if (!b) continue
    expect(b.y + b.height).toBeLessThanOrEqual(bottom.y + bottom.height + 1)
  }
})

test('the feature card opens up when the map is tall enough', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/?e2e=1')
  const props = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`attribute_${i}`, i]))
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-w-')), 'wide.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [-111.9, 40.7] } }] }))
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await page.getByRole('grid', { name: 'Attribute table' }).getByRole('row').nth(1).dblclick()
  await expect(page.locator('.inspector')).toBeVisible()
  await expect(page.locator('.inspector.collapsed')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Filter attributes' })).toBeVisible()
})
