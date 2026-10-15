// Spec 014: drawing, measuring and selecting by shape, the `drawn` table, and the shapes' actions. Shapes are
// scratch geometry for queries and filters (never edits to the data).
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { fixture, grid, openFile, rowCount, runQuery, choose } from './helpers'

type E2E = { __spatialExplorerE2E: { jumpTo(a: number, b: number, z: number): void } }

/** Opens the world and looks at `center` (default North America) at a size where a few hundred pixels cover a few dozen degrees. */
async function open(page: Page, center: [number, number, number] = [-100, 40, 3]): Promise<{ x: number; y: number; w: number; h: number }> {
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await page.evaluate((c) => (window as unknown as E2E).__spatialExplorerE2E.jumpTo(c[0], c[1], c[2]), center)
  await page.waitForTimeout(1200)
  const b = (await page.locator('.canvas-host').boundingBox())!
  return { x: b.x, y: b.y, w: b.width, h: b.height }
}

const palette = (page: Page, name: string) => page.getByRole('group', { name: `${name} tools` })
const bar = (page: Page) => page.getByRole('group', { name: 'Drawn shapes' })
const selection = (page: Page) => page.getByRole('group', { name: 'Selection' })
const labels = (page: Page) => page.locator('.map-view .shape-label')

async function pickTool(page: Page, purposeButton: string, tool: string): Promise<void> {
  await page.locator('.map-view .corner').getByRole('button', { name: purposeButton, exact: true }).click()
  await palette(page, purposeButton).getByRole('button', { name: tool, exact: true }).click()
}

/** Click the corners, then Enter. */
async function drawPolygon(page: Page, points: Array<[number, number]>): Promise<void> {
  // A moment between the clicks: under load (parallel workers) Terra Draw can still be taking one when the next arrives.
  for (const [x, y] of points) {
    await page.mouse.move(x, y)
    await page.mouse.click(x, y)
    await page.waitForTimeout(80)
  }
  await page.keyboard.press('Enter')
}

/** Corner, move, corner: a rectangle (the second click finishes it). */
async function drawRectangle(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1])
  await page.mouse.click(from[0], from[1])
  await page.waitForTimeout(80)
  await page.mouse.move(to[0], to[1], { steps: 6 })
  await page.waitForTimeout(80)
  await page.mouse.click(to[0], to[1])
}

const around = (m: { x: number; y: number; w: number; h: number }, dx: number, dy: number): Array<[number, number]> => {
  const cx = m.x + m.w / 2
  const cy = m.y + m.h / 2
  return [
    [cx - dx, cy - dy],
    [cx + dx, cy - dy],
    [cx + dx, cy + dy],
    [cx - dx, cy + dy],
  ]
}

test('the Draw button opens a palette; a polygon is drawn, measured on the map, and the bar offers its actions', async ({ page }) => {
  const m = await open(page)
  await expect(page.locator('.map-view .corner').getByRole('button', { name: 'Draw', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await pickTool(page, 'Draw', 'Polygon')
  await expect(palette(page, 'Draw').getByRole('button', { name: 'Polygon', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await drawPolygon(page, around(m, 120, 80))
  await expect(bar(page)).toBeVisible()
  await expect(bar(page)).toContainText(/(m²|ha|km²)/)
  // The measurement sits on the map, at the shape.
  await expect(labels(page)).toHaveCount(1)
  await expect(labels(page).first()).toHaveText(/(km²|ha|m²) · [\d.,]+ (km|m)/)
  // Close the tools: the shape stays.
  await palette(page, 'Draw').getByRole('button', { name: 'Close drawing tools' }).click()
  await expect(palette(page, 'Draw')).toHaveCount(0)
  await expect(bar(page)).toBeVisible()
})

test('Measure: a line shows its length; the units switch', async ({ page }) => {
  const m = await open(page)
  await pickTool(page, 'Measure', 'Line')
  const cx = m.x + m.w / 2
  const cy = m.y + m.h / 2
  await page.mouse.click(cx - 100, cy)
  await page.mouse.move(cx + 100, cy, { steps: 4 })
  // Under load the first moves can arrive before Terra Draw has the first corner: move again.
  await page.waitForTimeout(150)
  await page.mouse.move(cx + 101, cy + 1, { steps: 2 })
  // Live, while drawing.
  await expect(page.locator('.map-view .live-label')).toHaveText(/\d.* km/)
  await page.mouse.click(cx + 100, cy)
  await page.keyboard.press('Enter')
  await expect(labels(page)).toHaveCount(1)
  await expect(labels(page).first()).toHaveText(/^[\d.,]+ km$/)
  await palette(page, 'Measure').getByRole('button', { name: /^Units/ }).click()
  await expect(labels(page).first()).toHaveText(/^[\d.,]+ mi$/)
})

test('Select by shape: a rectangle selects the rows it covers; the predicate matters', async ({ page }) => {
  // Central Europe: small countries lie wholly inside the rectangle, larger ones only partly.
  const m = await open(page, [10, 47, 4])
  await pickTool(page, 'Select by shape', 'Rectangle')
  const cx = m.x + m.w / 2
  const cy = m.y + m.h / 2
  await drawRectangle(page, [cx - 200, cy - 120], [cx + 200, cy + 120])
  await expect(selection(page)).toContainText('selected')
  const count = async (): Promise<number> => Number(/([\d,]+) selected/.exec(await selection(page).innerText())?.[1].replace(/,/g, ''))
  await expect.poll(count).toBeGreaterThan(3)
  const intersecting = await count()
  expect(intersecting).toBeLessThan(60)

  // Rows entirely inside the rectangle are fewer than rows that touch it.
  await choose(page, bar(page).getByRole('button', { name: 'Rows that' }), 'Within')
  await bar(page).getByRole('button', { name: 'Select rows' }).click()
  await expect.poll(count).toBeLessThan(intersecting)
  expect(await count()).toBeGreaterThan(0)
})

test('Filter keeps only the rows meeting the condition, and lifts when turned off', async ({ page }) => {
  const m = await open(page, [10, 47, 4])
  await pickTool(page, 'Draw', 'Rectangle')
  const cx = m.x + m.w / 2
  const cy = m.y + m.h / 2
  await drawRectangle(page, [cx - 200, cy - 120], [cx + 200, cy + 120])
  const filter = bar(page).getByRole('button', { name: 'Filter' })
  const count = page.locator('.drawer-header > .count')
  await filter.click()
  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(count).toHaveText(/^\d+ of 180 rows$/)
  const matching = Number(/^(\d+) of/.exec(await count.innerText())?.[1])
  expect(matching).toBeGreaterThan(3)
  expect(matching).toBeLessThan(60)
  await filter.click()
  await expect(count).not.toContainText('of 180')
})

test('SQL: the shapes are the drawn table; the SQL button writes a query; As layer shows them', async ({ page }) => {
  const m = await open(page)
  await pickTool(page, 'Draw', 'Polygon')
  await drawPolygon(page, around(m, 100, 70))
  await expect(bar(page)).toBeVisible()
  await page.waitForTimeout(600)

  await runQuery(page, 'SELECT kind, purpose, area_m2 > 0 AS has_area FROM drawn')
  await expect(grid(page)).toContainText('polygon')
  await expect(grid(page)).toContainText('true')

  // A query for the shapes: geometry inlined, in the layer's CRS.
  await bar(page).getByRole('button', { name: 'SQL', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'SQL query' })
  await expect(editor).toContainText('ST_Intersects')
  await expect(editor).toContainText('ST_GeomFromGeoJSON')
  await editor.press('Control+Enter')
  await expect(page.locator('.query-status')).not.toContainText(/Running|Fetching/, { timeout: 60000 })
  expect(await rowCount(page)).toBeGreaterThan(0)

  // The shapes as a layer: every export format then applies.
  await bar(page).getByRole('button', { name: 'As layer' }).click()
  await expect.poll(() => rowCount(page)).toBe(1)
})

test('GeoJSON export of the shapes', async ({ page }) => {
  const m = await open(page)
  await pickTool(page, 'Draw', 'Polygon')
  await drawPolygon(page, around(m, 90, 60))
  await expect(bar(page)).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), bar(page).getByRole('button', { name: 'GeoJSON' }).click()])
  expect(download.suggestedFilename()).toBe('drawn-shapes.geojson')
  const text = await (await import('node:fs')).promises.readFile((await download.path())!, 'utf8')
  const fc = JSON.parse(text)
  expect(fc.type).toBe('FeatureCollection')
  expect(fc.features).toHaveLength(1)
  expect(fc.features[0].geometry.type).toBe('Polygon')
  expect(fc.features[0].properties.area_m2).toBeGreaterThan(1e9)
})

test('Esc cancels a shape in progress; Clear removes the shapes and their labels', async ({ page }) => {
  const m = await open(page)
  await pickTool(page, 'Draw', 'Polygon')
  const pts = around(m, 100, 60)
  await page.mouse.click(pts[0][0], pts[0][1])
  await page.mouse.click(pts[1][0], pts[1][1])
  await page.keyboard.press('Escape')
  await expect(bar(page)).toHaveCount(0)

  await drawPolygon(page, pts)
  await expect(bar(page)).toBeVisible()
  await bar(page).getByRole('button', { name: 'Clear' }).click()
  await expect(bar(page)).toHaveCount(0)
  await expect(labels(page)).toHaveCount(0)
})

test('with a tool open, a map click does not select a feature; with it closed, it does', async ({ page }) => {
  const m = await open(page)
  const cx = m.x + m.w / 2
  const cy = m.y + m.h / 2
  await pickTool(page, 'Draw', 'Point')
  await page.mouse.click(cx, cy)
  await expect(page.getByRole('region', { name: 'Feature attributes' })).toHaveCount(0)
  await palette(page, 'Draw').getByRole('button', { name: 'Close drawing tools' }).click()
  await page.mouse.click(cx, cy)
  await expect(page.getByRole('region', { name: 'Feature attributes' })).toBeVisible()
})

test('select by shape on a projected layer (UTM 12N) agrees with an independent WGS84 query', async ({ page }) => {
  await openFile(page, fixture('usa-utm12n.gpkg'), '?e2e=1')
  await page.waitForTimeout(1500)
  const b = (await page.locator('.canvas-host').boundingBox())!
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  await pickTool(page, 'Select by shape', 'Rectangle')
  await drawRectangle(page, [cx - 120, cy - 70], [cx + 120, cy + 70])
  await expect(selection(page)).toContainText('selected')
  const picked = Number(/([\d,]+) selected/.exec(await selection(page).innerText())?.[1].replace(/,/g, ''))
  expect(picked).toBeGreaterThan(0)

  // The same rows, found with the shape and the layer both in WGS84.
  await page.waitForTimeout(600)
  await runQuery(
    page,
    `SELECT count(*) AS n FROM layer l, (SELECT geom AS g FROM drawn LIMIT 1) d WHERE ST_Intersects(ST_Transform(l.geom, 'EPSG:32612', 'EPSG:4326', always_xy := true), d.g)`
  )
  await expect(grid(page)).toContainText(String(picked))
})

test('Edit: a shape is selected by clicking it, and deleted', async ({ page }) => {
  const m = await open(page)
  await pickTool(page, 'Draw', 'Polygon')
  await drawPolygon(page, around(m, 100, 60))
  await expect(bar(page)).toBeVisible()
  await palette(page, 'Draw').getByRole('button', { name: 'Edit shapes', exact: true }).click()
  const del = palette(page, 'Draw').getByRole('button', { name: 'Delete selected shape' })
  await expect(del).toBeDisabled()
  // Click inside the shape.
  await page.mouse.click(m.x + m.w / 2, m.y + m.h / 2)
  await expect(del).toBeEnabled()
  await del.click()
  await expect(bar(page)).toHaveCount(0)
  await expect(labels(page)).toHaveCount(0)
})

test('the palette and the shapes bar have no axe violations', async ({ page }) => {
  const m = await open(page)
  await pickTool(page, 'Draw', 'Polygon')
  await drawPolygon(page, around(m, 100, 60))
  await expect(bar(page)).toBeVisible()
  const results = await new AxeBuilder({ page }).include('.map-view .corner').include('[aria-label="Drawn shapes"]').analyze()
  expect(results.violations).toEqual([])
})

test('Undo and Redo work while a shape is being drawn, and the shape still finishes', async ({ page }) => {
  const m = await open(page)
  await pickTool(page, 'Draw', 'Polygon')
  const [a, b, c, d] = around(m, 100, 70)
  for (const [x, y] of [a, b, c]) {
    await page.mouse.move(x, y)
    await page.mouse.click(x, y)
    await page.waitForTimeout(80)
  }
  await palette(page, 'Draw').getByRole('button', { name: 'Undo', exact: true }).click()
  await palette(page, 'Draw').getByRole('button', { name: 'Redo', exact: true }).click()
  // Back on the map (the buttons took the focus): one more corner, then Enter.
  await page.mouse.move(d[0], d[1])
  await page.mouse.click(d[0], d[1])
  await page.waitForTimeout(80)
  await page.keyboard.press('Enter')
  await expect(bar(page)).toBeVisible()
  await expect(labels(page)).toHaveCount(1)
})
