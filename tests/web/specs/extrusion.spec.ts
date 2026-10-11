// T071 (spec 008 US6, FR-025–FR-027): 3D polygon extrusion.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { fixture, openFile } from './helpers'

type MapState = { projection: string; extrusion: boolean; pitch?: number; bearing?: number }
const mapState = (page: Page) => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState(): MapState } }).__spatialExplorerE2E.mapState())
const panel = (page: Page) => page.getByRole('dialog', { name: 'Layer style' })
const jumpTo = (page: Page, lon: number, lat: number, zoom: number) =>
  page.evaluate(([a, b, z]) => (window as unknown as { __spatialExplorerE2E: { jumpTo(a: number, b: number, z: number): void } }).__spatialExplorerE2E.jumpTo(a, b, z), [lon, lat, zoom] as const)

test('points and lines: the 3D section says why it is unavailable', async ({ page }) => {
  await openFile(page, fixture('points.csv'), '?e2e=1')
  await page.getByRole('button', { name: 'Layer style' }).click()
  await expect(panel(page).getByRole('switch', { name: 'Extrude polygons' })).toHaveCount(0)
  await expect(panel(page)).toContainText('3D extrusion applies to polygons.')
})

test('extrude by a column: tilts, counts flat polygons, scales, resets, and clicks still inspect', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFile(page, fixture('buildings-10k.parquet'), '?e2e=1')
  await page.getByRole('button', { name: 'Layer style' }).click()
  const toggle = panel(page).getByRole('switch', { name: 'Extrude polygons' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  // The height column is guessed from its name.
  await expect(panel(page).getByLabel('Height from')).toHaveValue('height_m')
  await expect.poll(async () => (await mapState(page)).extrusion).toBe(true)
  await expect.poll(async () => (await mapState(page)).pitch ?? 0).toBeGreaterThan(30)
  // Every 50th row is null, the next two 0 and negative: 600 of 10,000.
  await expect(panel(page)).toContainText('600 polygons drawn flat')

  await panel(page).getByLabel('Height scale').fill('2')
  await panel(page).getByLabel('Height scale').press('Enter')
  await expect(panel(page)).toContainText('height_m × 2')

  // A constant height instead of a column: nothing is flat then.
  await panel(page).getByLabel('Height from').selectOption({ label: 'Constant height' })
  await expect(panel(page).getByLabel('Constant height')).toHaveValue('10')
  await expect(panel(page)).not.toContainText('drawn flat')
  await panel(page).getByLabel('Height from').selectOption('height_m')

  // A click on a raised building still opens the inspector (the hidden fill answers).
  await page.getByRole('button', { name: 'Close' }).first().click()
  await jumpTo(page, -111.918, 40.74015, 18)
  await page.waitForTimeout(1500)
  const box = (await page.locator('.canvas-host').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const inspector = page.getByRole('region', { name: 'Feature attributes' })
  await expect(inspector).toContainText('#4')

  // Reset view: flat and north-up.
  const reset = page.getByRole('button', { name: 'Reset view' })
  await expect(reset).toBeVisible()
  await reset.click()
  await expect.poll(async () => (await mapState(page)).pitch ?? 1).toBeLessThan(0.5)
  await expect(reset).toHaveCount(0)

  // On the globe, a click still inspects.
  await page.getByRole('button', { name: 'Globe view' }).click()
  await expect.poll(async () => (await mapState(page)).projection).toBe('globe')
  await jumpTo(page, -111.918, 40.74015, 18)
  await page.waitForTimeout(1500)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(inspector).toContainText('#4')
})

test('extrusion is kept in the saved QML and Mapbox GL style, and loads back', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('buildings-10k.parquet'), '?e2e=1')
  await page.getByRole('button', { name: 'Layer style' }).click()
  await panel(page).getByRole('switch', { name: 'Extrude polygons' }).click()
  await panel(page).getByLabel('Height scale').fill('1.5')
  await panel(page).getByLabel('Height scale').press('Enter')

  const [qml] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download style (QML)' }).click()])
  const qmlText = fs.readFileSync((await qml.path())!, 'utf8')
  expect(qmlText).toContain('<renderer-3d layer="" type="vector">')
  expect(qmlText).toContain('&quot;height_m&quot; * 1.5')

  await page.getByRole('button', { name: 'More style formats' }).click()
  const [mapbox] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Mapbox GL/ }).click()])
  const doc = JSON.parse(fs.readFileSync((await mapbox.path())!, 'utf8')) as { layers: Array<{ type: string }> }
  expect(doc.layers.some((l) => l.type === 'fill-extrusion')).toBe(true)

  await page.getByRole('button', { name: 'More style formats' }).click()
  await expect(page.getByRole('menuitem', { name: /OGC SLD/ })).toContainText('SLD has no 3D')
  await page.keyboard.press('Escape')

  // Reset, then load the saved QML: extrusion comes back.
  await panel(page).getByRole('button', { name: 'Reset style' }).click()
  await expect(panel(page).getByRole('switch', { name: 'Extrude polygons' })).toHaveAttribute('aria-checked', 'false')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), panel(page).getByRole('button', { name: 'Load style…' }).click()])
  await chooser.setFiles((await qml.path())!)
  await expect(panel(page).getByRole('switch', { name: 'Extrude polygons' })).toHaveAttribute('aria-checked', 'true')
  await expect(panel(page).getByLabel('Height scale')).toHaveValue('1.5')
  await expect.poll(async () => (await mapState(page)).extrusion).toBe(true)
})

test('a column that is not a height gets a scale that shows it; Auto picks it again (user report)', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/?e2e=1')
  await page.getByRole('button', { name: /Try sample data/ }).click()
  await page.getByRole('button', { name: 'Layer style' }).click()
  await panel(page).getByRole('switch', { name: 'Extrude polygons' }).click()
  await panel(page).getByLabel('Height from').selectOption('density')
  // A density of ~40 per km² is 40 m raw: flat at a country's zoom. The 95th
  // percentile rises to ~6% of the extent instead, as a 1/2/5 step.
  const scale = panel(page).getByLabel('Height scale')
  await expect.poll(async () => Number(await scale.inputValue())).toBeGreaterThan(50)
  const auto = Number(await scale.inputValue())
  expect([1, 2, 5]).toContain(Number((auto / 10 ** Math.floor(Math.log10(auto))).toFixed(6)))
  await scale.fill('1')
  await scale.press('Enter')
  await panel(page).getByRole('button', { name: 'Auto' }).click()
  await expect(scale).toHaveValue(String(auto))
  await page.screenshot({ path: test.info().outputPath('density-extruded.png') })
})
