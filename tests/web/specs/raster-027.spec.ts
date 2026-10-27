// Spec 027: display options of the open raster (picture adjustments, relief) and values read under a drawn shape.
// Fixtures: tests/vscode-ext/fixtures/raster/ (scripts/fixtures-026.mjs). Run with npm run test:web:chrome.
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

const raster = (name: string): string => fixture(`raster/${name}`)
const e2e = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => unknown> }).__spatialExplorerE2E[n]() as T, name)

type State = { style: { display?: Record<string, number | string> } | null; version: number; tiles: { built: number } }
const state = (page: Page): Promise<State> => e2e<State>(page, 'raster')
const readyMarker = (page: Page): Promise<string | null> => page.evaluate(() => document.querySelector('.canvas-host')?.getAttribute('data-raster-ready') ?? null)
const paint = (page: Page): Promise<Record<string, number | string> | null> =>
  page.evaluate(() => {
    const v = document.querySelector('.canvas-host')?.getAttribute('data-raster-paint')
    return v ? JSON.parse(v) : null
  })

async function openRaster(page: Page, file: string): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect.poll(async () => (await readyMarker(page)) !== null, { timeout: 90000 }).toBe(true)
}

async function openStylePanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
}

test.describe('picture adjustments (US1)', () => {
  test('each control changes the layer\'s paint, and no tile is read again', async ({ page }) => {
    await openRaster(page, raster('ortho-rgb.tif'))
    await openStylePanel(page)
    expect(await paint(page)).toMatchObject({ 'raster-brightness-min': 0, 'raster-brightness-max': 1, 'raster-contrast': 0, 'raster-saturation': 0, 'raster-hue-rotate': 0, 'raster-resampling': 'linear' })
    const before = await state(page)
    await page.getByRole('slider', { name: 'Contrast', exact: true }).fill('0.5')
    await page.getByRole('slider', { name: 'Saturation', exact: true }).fill('-0.4')
    await page.getByRole('slider', { name: 'Hue', exact: true }).fill('120')
    await page.getByRole('slider', { name: 'Black level', exact: true }).fill('0.2')
    await expect.poll(() => paint(page)).toMatchObject({ 'raster-contrast': 0.5, 'raster-saturation': -0.4, 'raster-hue-rotate': 120, 'raster-brightness-min': 0.2 })
    const after = await state(page)
    // Not a new picture: same version, no tile built.
    expect(after.version).toBe(before.version)
    expect(after.tiles.built).toBe(before.tiles.built)
    expect(after.style!.display).toMatchObject({ contrast: 0.5, saturation: -0.4, hue: 120, brightnessMin: 0.2 })
  })

  test('sharp pixels, and Reset appearance puts everything back', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openStylePanel(page)
    await page.getByRole('radio', { name: 'Sharp' }).click()
    await expect.poll(() => paint(page)).toMatchObject({ 'raster-resampling': 'nearest' })
    await page.getByRole('slider', { name: 'Hue', exact: true }).fill('45')
    await page.getByRole('button', { name: 'Reset appearance' }).click()
    await expect.poll(() => paint(page)).toMatchObject({ 'raster-hue-rotate': 0, 'raster-resampling': 'linear' })
    expect((await state(page)).style!.display).toBeUndefined()
    await expect(page.getByRole('button', { name: 'Reset appearance' })).toBeDisabled()
  })

  test('a color table raster is sharp by default and smooth when asked', async ({ page }) => {
    await openRaster(page, raster('classes.tif'))
    await openStylePanel(page)
    expect(await paint(page)).toMatchObject({ 'raster-resampling': 'nearest' })
    await page.getByRole('radio', { name: 'Smooth' }).click()
    await expect.poll(() => paint(page)).toMatchObject({ 'raster-resampling': 'linear' })
  })

  test('the adjustments are remembered for the file', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await openStylePanel(page)
    await page.getByRole('slider', { name: 'Contrast', exact: true }).fill('0.3')
    await expect.poll(() => paint(page)).toMatchObject({ 'raster-contrast': 0.3 })
    await page.waitForTimeout(700) // saved a moment after the last edit
    await page.goto('/?e2e=1')
    await page.locator('input[type="file"]').setInputFiles(raster('dem-utm12.tif'))
    await expect.poll(async () => (await paint(page))?.['raster-contrast'], { timeout: 60000 }).toBe(0.3)
    // Another file is not affected.
    await page.locator('input[type="file"]').setInputFiles(raster('ortho-rgb.tif'))
    await expect.poll(async () => (await paint(page))?.['raster-contrast'], { timeout: 60000 }).toBe(0)
  })

  test('the new controls have no accessibility violations', async ({ page }) => {
    await openRaster(page, raster('ortho-rgb.tif'))
    await openStylePanel(page)
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})

// --- US3: a profile along a line -----------------------------------------------------------------------------------

type Probe = {
  kind: string
  status: string
  message?: string
  profile?: { samples: { points: Array<[number, number]>; distances: number[]; totalMeters: number }; bands: Array<{ name: string; values: Array<number | null> }> }
}
const probe = (page: Page): Promise<Probe | null> => e2e<Probe | null>(page, 'rasterProbe')
const pointAt = (page: Page, lon: number, lat: number): Promise<{ values: number[]; outside?: boolean }> =>
  page.evaluate(([x, y]) => (window as unknown as { __spatialExplorerE2E: { rasterPointAt: (a: number, b: number) => Promise<{ values: number[]; outside?: boolean }> } }).__spatialExplorerE2E.rasterPointAt(x, y), [lon, lat])

const mapBox = async (page: Page) => (await page.locator('.canvas-host').boundingBox())!

async function pickRasterTool(page: Page, purposeButton: string): Promise<void> {
  await page.locator('.map-view .corner').getByRole('button', { name: purposeButton, exact: true }).click()
}
async function drawLine(page: Page, points: Array<[number, number]>): Promise<void> {
  for (const [x, y] of points) {
    await page.mouse.move(x, y)
    await page.mouse.click(x, y)
    await page.waitForTimeout(80)
  }
  await page.keyboard.press('Enter')
}

test.describe('a profile along a line (US3)', () => {
  test('the Profile tool is offered for a raster and a line gives a chart that agrees with the cursor readout', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await pickRasterTool(page, 'Profile')
    const m = await mapBox(page)
    const cx = m.x + m.width / 2
    const cy = m.y + m.height / 2
    await drawLine(page, [[cx - 90, cy - 60], [cx + 10, cy + 20], [cx + 90, cy - 10]])
    await expect(page.getByRole('region', { name: 'Profile along the line' })).toBeVisible()
    await expect.poll(async () => (await probe(page))?.status, { timeout: 30000 }).toBe('done')
    const p = (await probe(page))!.profile!
    expect(p.samples.points.length).toBeGreaterThan(10)
    expect(p.samples.distances[0]).toBe(0)
    expect(p.samples.distances.at(-1)).toBeCloseTo(p.samples.totalMeters, 3)
    // Five places along it: the value is the one the cursor readout reads there.
    const n = p.samples.points.length
    let checked = 0
    for (const i of [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1]) {
      const [lon, lat] = p.samples.points[i]
      const answer = await pointAt(page, lon, lat)
      const expected = answer.outside || answer.values.length === 0 ? null : answer.values[0]
      const got = p.bands[0].values[i]
      if (expected === null || expected === -9999) expect(got).toBeNull()
      else expect(got).toBe(expected)
      checked++
    }
    expect(checked).toBe(5)
    // The figures and the table are there as text.
    await expect(page.getByLabel('Figures')).toContainText('Length')
    await expect(page.getByLabel('Figures')).toContainText('Rise')
    await page.getByText('Table of values').click()
    await expect(page.getByRole('columnheader', { name: 'Distance' })).toBeVisible()
  })

  test('the keys move a marker along the chart, and a second line replaces the first', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await pickRasterTool(page, 'Profile')
    const m = await mapBox(page)
    const cx = m.x + m.width / 2
    const cy = m.y + m.height / 2
    await drawLine(page, [[cx - 80, cy], [cx, cy + 10], [cx + 80, cy]])
    await expect.poll(async () => (await probe(page))?.status, { timeout: 30000 }).toBe('done')
    const slider = page.getByRole('slider', { name: /Position along the profile/ })
    await slider.focus()
    await page.keyboard.press('ArrowRight')
    await expect(slider).toHaveAttribute('aria-valuenow', '0')
    await page.keyboard.press('ArrowRight')
    await expect(slider).toHaveAttribute('aria-valuenow', '1')
    await expect(page.locator('.probe-pin')).toHaveCount(1)
    await expect(page.getByRole('status').filter({ hasText: /: / })).toContainText('m')
    const first = (await probe(page))!.profile!.samples.totalMeters
    await drawLine(page, [[cx - 20, cy - 40], [cx, cy - 30], [cx + 20, cy - 40]])
    await expect.poll(async () => (await probe(page))?.profile?.samples.totalMeters, { timeout: 30000 }).not.toBe(first)
    await page.getByRole('button', { name: 'Close the profile' }).click()
    await expect(page.getByRole('region', { name: 'Profile along the line' })).toHaveCount(0)
    await expect(page.locator('.probe-pin')).toHaveCount(0)
  })

  test('a line off the raster is gaps, not zeros; the tool is not offered for a vector layer', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await pickRasterTool(page, 'Profile')
    const m = await mapBox(page)
    // From the far left of the map (outside the portrait raster) to its middle.
    const cy = m.y + m.height / 2
    await drawLine(page, [[m.x + 30, cy], [m.x + m.width / 4, cy + 5], [m.x + m.width / 2, cy]])
    await expect.poll(async () => (await probe(page))?.status, { timeout: 30000 }).toBe('done')
    const values = (await probe(page))!.profile!.bands[0].values
    expect(values[0]).toBeNull()
    expect(values.some((v) => v !== null)).toBe(true)
    await expect(page.getByLabel('Figures')).toContainText('have no data')
    // A vector layer never offers it.
    await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
    await expect(page.locator('.canvas-host[data-rendered-features]')).toBeAttached({ timeout: 60000 })
    await expect(page.locator('.map-view .corner').getByRole('button', { name: 'Profile', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Profile along the line' })).toHaveCount(0)
  })

  test('the profile panel has no accessibility violations', async ({ page }) => {
    await openRaster(page, raster('dem-utm12.tif'))
    await pickRasterTool(page, 'Profile')
    const m = await mapBox(page)
    await drawLine(page, [[m.x + m.width / 2 - 60, m.y + m.height / 2], [m.x + m.width / 2, m.y + m.height / 2 + 15], [m.x + m.width / 2 + 60, m.y + m.height / 2 + 30]])
    await expect.poll(async () => (await probe(page))?.status, { timeout: 30000 }).toBe('done')
    const results = await new AxeBuilder({ page }).include('[aria-label="Profile along the line"]').analyze()
    expect(results.violations).toEqual([])
  })
})
