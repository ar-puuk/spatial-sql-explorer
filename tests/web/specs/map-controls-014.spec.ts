// Spec 014: the Map controls side panel. Which controls show, and the corner each one
// sits in (a row per control: switch, name, position), remembered for the user (not per file).
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
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
  for (const name of ['Search', 'Zoom in and out', 'Zoom to layer', 'Reset view', 'Globe view', 'Terrain', 'Draw shapes', 'Measure', 'Select by shape', 'Export map image', 'Legend', 'MapLibre logo', 'Scale bar']) {
    await expect(panel(page).getByRole('checkbox', { name: new RegExp(`^${name}`) })).toBeChecked()
  }
  await expect(panel(page).getByRole('button', { name: 'Reset to defaults' })).toBeDisabled()
})

test('unchecking a control removes it from the map, and the choice survives a reload', async ({ page }) => {
  await open(page)
  await expect(page.getByRole('button', { name: 'Globe view' })).toBeVisible()
  await openPanel(page)
  await panel(page).getByRole('checkbox', { name: /^Globe view/ }).uncheck()
  await expect(page.getByRole('button', { name: 'Globe view' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible()

  await page.reload()
  await open(page)
  await expect(page.getByRole('button', { name: 'Globe view' })).toHaveCount(0)
  await openPanel(page)
  await panel(page).getByRole('button', { name: 'Reset to defaults' }).click()
  await expect(page.getByRole('button', { name: 'Globe view' })).toBeVisible()
})

test('the scale bar can be turned off and on', async ({ page }) => {
  await open(page)
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(1)
  await openPanel(page)
  await panel(page).getByRole('checkbox', { name: /^Scale bar/ }).uncheck()
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(0)
  await panel(page).getByRole('checkbox', { name: /^Scale bar/ }).check()
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(1)
})

test('each control has its own corner: moving one leaves the rest', async ({ page }) => {
  await open(page)
  // By default the buttons are top right, the search top left, the scale bar and logo bottom left.
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Globe view' })).toBeVisible()
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Zoom in' })).toBeVisible()
  await expect(corner(page, 'top-left').getByRole('search')).toBeVisible()
  await expect(corner(page, 'bottom-left').locator('.maplibregl-ctrl-scale')).toHaveCount(1)
  await expect(corner(page, 'bottom-left').locator('.maplibregl-ctrl-logo')).toHaveCount(1)

  await openPanel(page)
  await panel(page).getByLabel('Globe view position').selectOption('bottom-right')
  await expect(corner(page, 'bottom-right').getByRole('button', { name: 'Globe view' })).toBeVisible()
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Globe view' })).toHaveCount(0)
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Zoom in' })).toBeVisible()
  // It sits at the bottom, above the attribution.
  const view = (await page.locator('.map-view').boundingBox())!
  const box = (await corner(page, 'bottom-right').getByRole('button', { name: 'Globe view' }).boundingBox())!
  expect(view.y + view.height - (box.y + box.height)).toBeLessThan(80)

  // Even zoom, which is one box of two buttons, can go: the search moves in with it.
  await panel(page).getByLabel('Search position').selectOption('top-right')
  await expect(corner(page, 'top-right').getByRole('search')).toBeVisible()
  await expect(corner(page, 'top-left')).toHaveCount(0)
  // The search stacks above the buttons in the same corner (registry order).
  const s = (await corner(page, 'top-right').getByRole('search').boundingBox())!
  const z = (await corner(page, 'top-right').getByRole('button', { name: 'Zoom in' }).boundingBox())!
  expect(s.y).toBeLessThan(z.y)

  // Reset puts everything back.
  await panel(page).getByRole('button', { name: 'Reset to defaults' }).click()
  await expect(corner(page, 'top-left').getByRole('search')).toBeVisible()
  await expect(corner(page, 'top-right').getByRole('button', { name: 'Globe view' })).toBeVisible()
})

test('the MapLibre logo is on by default; it can be turned off and moved', async ({ page }) => {
  await open(page)
  await expect(page.locator('.maplibregl-ctrl-logo')).toHaveCount(1)
  await openPanel(page)
  await panel(page).getByLabel('MapLibre logo position').selectOption('top-left')
  await expect(corner(page, 'top-left').locator('.maplibregl-ctrl-logo')).toHaveCount(1)
  await panel(page).getByRole('checkbox', { name: /^MapLibre logo/ }).uncheck()
  await expect(page.locator('.maplibregl-ctrl-logo')).toHaveCount(0)
  await panel(page).getByRole('checkbox', { name: /^MapLibre logo/ }).check()
  await expect(page.locator('.maplibregl-ctrl-logo')).toHaveCount(1)
})

test('a control that is switched off keeps its position for when it comes back', async ({ page }) => {
  await open(page)
  await openPanel(page)
  await panel(page).getByLabel('Scale bar position').selectOption('top-left')
  await panel(page).getByRole('checkbox', { name: /^Scale bar/ }).uncheck()
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(0)
  await panel(page).getByRole('checkbox', { name: /^Scale bar/ }).check()
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

  await panel(page).getByRole('checkbox', { name: /^Coordinates/ }).check()
  await expect(corner(page, 'bottom-center').locator('.coords')).toHaveCount(1)
  await panel(page).getByLabel('Coordinates position').selectOption('top-center')
  await expect(corner(page, 'top-center').locator('.coords')).toHaveCount(1)
  await expect(corner(page, 'bottom-center')).toHaveCount(0)
  // Centered along the top edge.
  const view = (await page.locator('.map-view').boundingBox())!
  const box = (await corner(page, 'top-center').locator('.coords').boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - (view.x + view.width / 2))).toBeLessThan(4)
  expect(box.y - view.y).toBeLessThan(20)
})

test('coordinates: off by default; on, they follow the cursor and a click copies them', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await open(page)
  await expect(page.locator('.map-view .coords')).toHaveCount(0)
  await openPanel(page)
  await panel(page).getByRole('checkbox', { name: /^Coordinates/ }).check()
  const readout = page.locator('.map-view .coords')
  await expect(readout).toBeDisabled()
  const box = (await page.locator('.canvas-host').boundingBox())!
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2)
  await page.mouse.move(box.x + box.width / 3 + 5, box.y + box.height / 2 + 5)
  await expect(readout).toBeEnabled()
  await expect(readout).toContainText(/-?\d+\.\d{5}, -?\d+\.\d{5}/)
  const shown = (await readout.innerText()).trim()
  // Moving onto the readout keeps the last position.
  await readout.click()
  expect((await readout.innerText()).trim()).toBe(shown)
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(shown)
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
  await panel(page).getByRole('checkbox', { name: /^Hover tooltip/ }).check()
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
  await panel(page).getByRole('checkbox', { name: /^Hover tooltip/ }).check()
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
