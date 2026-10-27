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
