// Spec 010 T053: layout Option A: the activity rail and side panel, the bottom
// panel's tabs, maximize, the remembered layout, the narrow overlay, and axe.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture, openFile } from './helpers'

const side = (page: Page) => page.locator('aside.side-panel')
const rail = (page: Page, name: 'Style' | 'Details' | 'Basemap') => page.getByRole('toolbar', { name: 'Panels' }).getByRole('button', { name, exact: true })
const mapWidth = async (page: Page): Promise<number> => (await page.locator('.canvas-host').boundingBox())!.width

test('the rail opens the side panel, the active button closes it, and Escape returns to the rail', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  await expect(side(page)).toHaveCount(0)
  const full = await mapWidth(page)

  await rail(page, 'Style').click()
  await expect(side(page)).toHaveAttribute('aria-label', 'Style')
  await expect(rail(page, 'Style')).toHaveAttribute('aria-pressed', 'true')
  // The panel takes its width from the map (not an overlay at this size).
  await expect.poll(() => mapWidth(page)).toBeLessThan(full - 200)

  await rail(page, 'Basemap').click()
  await expect(side(page)).toHaveAttribute('aria-label', 'Basemap')
  await rail(page, 'Basemap').click()
  await expect(side(page)).toHaveCount(0)

  await rail(page, 'Details').click()
  await expect(side(page)).toContainText('Click a feature on the map or a row in the table to see its attributes.')
  await side(page).getByRole('button', { name: 'Close panel' }).focus()
  await page.keyboard.press('Escape')
  await expect(side(page)).toHaveCount(0)
  await expect(rail(page, 'Details')).toBeFocused()
})

test('a selection opens Details, but while styling it marks Details with a dot instead', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  const rows = page.getByRole('grid', { name: 'Attribute table' }).locator('tbody tr')

  await rows.nth(2).click()
  await expect(side(page)).toHaveAttribute('aria-label', 'Feature details')
  await expect(page.getByRole('region', { name: 'Feature attributes' })).toContainText('Albania')

  await rail(page, 'Style').click()
  await rows.nth(3).click()
  await expect(side(page)).toHaveAttribute('aria-label', 'Style')
  await expect(rail(page, 'Details').locator('.badge')).toHaveCount(1)
  await rail(page, 'Details').click()
  await expect(page.getByRole('region', { name: 'Feature attributes' })).toContainText('United Arab Emirates')
  await expect(rail(page, 'Details').locator('.badge')).toHaveCount(0)
})

test('bottom panel: arrow keys switch tabs, maximize and restore, hide and show', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  const table = page.getByRole('tab', { name: 'Table' })
  const sql = page.getByRole('tab', { name: 'SQL' })
  await expect(table).toHaveAttribute('aria-selected', 'true')
  await table.focus()
  await page.keyboard.press('ArrowRight')
  await expect(sql).toHaveAttribute('aria-selected', 'true')
  await expect(sql).toBeFocused()
  await expect(page.getByRole('textbox', { name: 'SQL query' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Files' })).toContainText('world-boundaries.geojson')
  await page.keyboard.press('ArrowLeft')
  await expect(table).toHaveAttribute('aria-selected', 'true')

  const mapBox = page.locator('.map-pane')
  await page.getByRole('button', { name: 'Maximize panel' }).click()
  await expect.poll(async () => (await mapBox.boundingBox())?.height ?? 0).toBeLessThan(2)
  await page.getByRole('button', { name: 'Restore panel size' }).click()
  await expect.poll(async () => (await mapBox.boundingBox())?.height ?? 0).toBeGreaterThan(200)

  await page.getByRole('button', { name: 'Hide panel' }).click()
  await expect(page.getByRole('grid', { name: 'Attribute table' })).toBeHidden()
  await page.getByRole('button', { name: 'Show panel' }).click()
  await expect(page.getByRole('grid', { name: 'Attribute table' })).toBeVisible()
})

test('the layout is remembered across a reload', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  await rail(page, 'Basemap').click()
  await page.getByRole('tab', { name: 'SQL' }).click()
  // Saved once the layout settles (300 ms).
  await page.waitForTimeout(600)
  await page.reload()
  await page.locator('input[type="file"]').setInputFiles(fixture('world-boundaries.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  await expect(side(page)).toHaveAttribute('aria-label', 'Basemap')
  await expect(page.getByRole('tab', { name: 'SQL' })).toHaveAttribute('aria-selected', 'true')
})

test('under 720 px wide, the side panel overlays the map instead of narrowing it', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 760 })
  await openFile(page, fixture('world-boundaries.geojson'))
  const before = await mapWidth(page)
  await rail(page, 'Style').click()
  await expect(side(page)).toHaveClass(/overlay/)
  await page.waitForTimeout(300)
  expect(await mapWidth(page)).toBe(before)
})

test('no axe violations with the side panel and each bottom tab', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  const audit = async (state: string): Promise<void> => {
    const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), state).toEqual([])
  }
  await rail(page, 'Details').click()
  await audit('details, empty')
  await page.getByRole('grid', { name: 'Attribute table' }).locator('tbody tr').nth(1).click()
  await audit('details, a feature')
  await rail(page, 'Basemap').click()
  await page.getByRole('tab', { name: 'SQL' }).click()
  await audit('basemap and SQL')
})

// User decision 2026-10-13: the map always tilts and rotates (basemap 3D buildings show); Reset view flattens it.
test('a right-drag tilts the map without extrusion, and Reset view flattens it again', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const state = () => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState(): { pitch?: number; bearing?: number } } }).__spatialExplorerE2E.mapState())
  const box = (await page.locator('.canvas-host').boundingBox())!
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2]
  await page.mouse.move(x, y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(x + 40, y - 120, { steps: 12 })
  await page.mouse.up({ button: 'right' })
  await expect.poll(async () => (await state()).pitch ?? 0).toBeGreaterThan(10)
  const reset = page.getByRole('button', { name: 'Reset view' })
  await expect(reset).toBeVisible()
  await reset.click()
  await expect.poll(async () => (await state()).pitch ?? 1).toBeLessThan(0.5)
  await expect(reset).toHaveCount(0)
})
