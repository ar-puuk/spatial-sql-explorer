// Spec 027: saving what a profile or an area says: CSV, and the chart as SVG or PNG (a download on the web).
import fs from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

async function openRaster(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('raster/dem-utm12.tif'))
  await page.locator('.canvas-host[data-raster-ready]').waitFor({ state: 'attached', timeout: 90000 })
}
const mapBox = async (page: Page) => (await page.locator('.canvas-host').boundingBox())!

async function drawProfile(page: Page): Promise<void> {
  await page.locator('.map-view .corner').getByRole('button', { name: 'Profile', exact: true }).click()
  const m = await mapBox(page)
  for (const [x, y] of [[m.x + m.width / 2 - 80, m.y + m.height / 3], [m.x + m.width / 2, m.y + m.height / 3 + 15], [m.x + m.width / 2 + 80, m.y + m.height / 3 + 30]]) {
    await page.mouse.move(x, y)
    await page.mouse.click(x, y)
    await page.waitForTimeout(80)
  }
  await page.keyboard.press('Enter')
  await page.getByRole('slider', { name: /Position along the profile/ }).waitFor()
}
async function drawArea(page: Page): Promise<void> {
  await page.locator('.map-view .corner').getByRole('button', { name: 'Area statistics', exact: true }).click()
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  const m = await mapBox(page)
  const [x0, y0, x1, y1] = [m.x + m.width / 2 - 60, m.y + m.height / 4, m.x + m.width / 2 + 40, m.y + m.height / 2]
  await page.mouse.move(x0, y0)
  await page.mouse.click(x0, y0)
  await page.waitForTimeout(80)
  await page.mouse.move(x1, y1, { steps: 6 })
  await page.waitForTimeout(80)
  await page.mouse.click(x1, y1)
  await page.getByRole('table', { name: 'Statistics per band' }).waitFor()
}

/** Chooses an item of the open panel's Save menu and returns what was downloaded. */
async function save(page: Page, item: string): Promise<{ name: string; bytes: Buffer }> {
  await page.getByRole('button', { name: 'Save as' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: item }).click()])
  const file = await download.path()
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(file) }
}

test.describe('saving a profile', () => {
  test('the values as CSV, with every place', async ({ page }) => {
    await openRaster(page)
    await drawProfile(page)
    const got = await save(page, 'Values (CSV)')
    expect(got.name).toBe('dem-utm12-profile.csv')
    const rows = got.bytes.toString('utf8').trim().split('\n')
    expect(rows[0]).toBe('distance_m,longitude,latitude,Band 1')
    expect(rows.length).toBeGreaterThan(20)
  })

  test('the chart as SVG: standalone, on white, with the figures in text', async ({ page }) => {
    await openRaster(page)
    await drawProfile(page)
    const got = await save(page, 'Chart (SVG)')
    expect(got.name).toBe('dem-utm12-profile.svg')
    const svg = got.bytes.toString('utf8')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('Profile: dem-utm12.tif')
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toMatch(/Rise [\d,.]+/)
    expect(svg).not.toContain('var(--')
  })

  test('the chart as PNG: a real picture at twice the size', async ({ page }) => {
    await openRaster(page)
    await drawProfile(page)
    const got = await save(page, 'Chart (PNG)')
    expect(got.name).toBe('dem-utm12-profile.png')
    expect(Array.from(got.bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(got.bytes.readUInt32BE(16)).toBe(1920)
    expect(got.bytes.readUInt32BE(20)).toBe(840)
    expect(got.bytes.length).toBeGreaterThan(5000)
  })

  test('the menu works from the keyboard', async ({ page }) => {
    await openRaster(page)
    await drawProfile(page)
    const trigger = page.getByRole('button', { name: 'Save as' })
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menu', { name: 'Save as' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Values (CSV)' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Chart (SVG)' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('the open menu has no accessibility violations', async ({ page }) => {
    await openRaster(page)
    await drawProfile(page)
    await page.getByRole('button', { name: 'Save as' }).click()
    const results = await new AxeBuilder({ page }).include('[aria-label="Profile along the line"]').analyze()
    expect(results.violations).toEqual([])
  })
})

test.describe('saving area statistics', () => {
  test('the statistics CSV says what it measured', async ({ page }) => {
    await openRaster(page)
    await drawArea(page)
    const got = await save(page, 'Statistics (CSV)')
    expect(got.name).toBe('dem-utm12-area-statistics.csv')
    const rows = got.bytes.toString('utf8').trim().split('\n')
    expect(rows[0]).toBe('file,band,cells,no_data_cells,min,max,mean,sum,std_dev,area_m2,cell_size_m,approximate')
    const cols = rows[1].split(',')
    expect(cols[0]).toBe('dem-utm12.tif')
    expect(cols[1]).toBe('Band 1')
    expect(Number(cols[2])).toBeGreaterThan(0)
    expect(Number(cols[9])).toBeGreaterThan(1e6)
    expect(cols[11]).toBe('no')
  })

  test('the histogram CSV has a row per bin, adding up to the cells', async ({ page }) => {
    await openRaster(page)
    await drawArea(page)
    const stats = (await save(page, 'Statistics (CSV)')).bytes.toString('utf8').trim().split('\n')[1].split(',')
    await page.getByRole('button', { name: 'Save as' }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Histogram (CSV)' }).click()])
    const rows = fs.readFileSync((await download.path())!, 'utf8').trim().split('\n')
    expect(rows[0]).toBe('band,bin_start,bin_end,cells')
    expect(rows).toHaveLength(65)
    expect(rows.slice(1).reduce((s, r) => s + Number(r.split(',')[3]), 0)).toBe(Number(stats[2]))
  })

  test('the histogram as SVG and PNG', async ({ page }) => {
    await openRaster(page)
    await drawArea(page)
    const svg = await save(page, 'Histogram (SVG)')
    expect(svg.name).toBe('dem-utm12-area-histogram.svg')
    expect(svg.bytes.toString('utf8')).toContain('mean ')
    const png = await save(page, 'Histogram (PNG)')
    expect(Array.from(png.bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png.bytes.readUInt32BE(16)).toBe(1920)
  })
})
