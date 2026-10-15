// Spec 014: the Map controls side panel. Which map buttons show, and the corner
// each group sits in, remembered for the user (not per file).
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
// The toolbar holding the Navigation group (the Tools group stays where it is).
const toolbar = (page: Page) => page.locator('.map-view .controls').filter({ has: page.getByRole('button', { name: 'Zoom in' }) })

async function openPanel(page: Page): Promise<void> {
  // The layout is remembered: after a reload the panel may already be open (the rail button would close it).
  if (await panel(page).isVisible()) return
  await page.locator('.rail').getByRole('button', { name: 'Map controls' }).click()
  await expect(panel(page)).toBeVisible()
}

test('the rail has a Map controls button that opens the panel with every control listed', async ({ page }) => {
  await open(page)
  await openPanel(page)
  for (const name of ['Zoom in and out', 'Zoom to layer', 'Reset view', 'Globe view', 'Export map image', 'Scale bar']) {
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

test('a group can move to another corner', async ({ page }) => {
  await open(page)
  const view = (await page.locator('.map-view').boundingBox())!
  const top = (await toolbar(page).boundingBox())!
  expect(top.y - view.y).toBeLessThan(20)
  expect(view.x + view.width - (top.x + top.width)).toBeLessThan(20)

  await openPanel(page)
  await panel(page).getByRole('radiogroup', { name: 'Navigation position' }).getByLabel('Bottom right').check()
  await expect.poll(async () => { const b = (await toolbar(page).boundingBox())!; return view.y + view.height - (b.y + b.height) }).toBeLessThan(80)

  await panel(page).getByRole('radiogroup', { name: 'Navigation position' }).getByLabel('Top left').check()
  await expect.poll(async () => (await toolbar(page).boundingBox())!.x - view.x).toBeLessThan(20)
  // Under the search box, not over it.
  const search = (await page.locator('.search-slot').boundingBox())!
  const box = (await toolbar(page).boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(search.y + search.height)
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
