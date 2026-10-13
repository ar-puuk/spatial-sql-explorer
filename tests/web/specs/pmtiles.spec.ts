// T053 (spec 007 US5): a PMTiles archive is drawn from its tiles at every
// zoom, reading only parts of the file; the inspector shows a clicked
// feature and its archive layer; SQL, the table, styling and export say why
// they aren't available (FR-009a).
import fs from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

const REASON = "PMTiles holds map tiles, not a table: SQL, table, styling and export aren't available."

const e2e = <T>(page: Page, name: string): Promise<T> =>
  page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => unknown> }).__spatialExplorerE2E[n]() as T, name)

const rendered = async (page: Page): Promise<number> => Number((await page.locator('.canvas-host').getAttribute('data-rendered-features')) ?? 0)

test('a PMTiles archive: tiles at two zooms, partial reads, the inspector, and the other pillars disabled', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } })
  )
  const file = fixture('sample.pmtiles')
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect.poll(() => rendered(page), { timeout: 60000 }).toBeGreaterThan(0)

  // Facts from the archive header and metadata.
  const state = await e2e<{ phase: string; facts: { readMode: string; tiles: { minZoom: number; maxZoom: number; layers: string[] }; extent: number[] } }>(page, 'openState')
  expect(state.phase).toBe('ready')
  expect(state.facts.readMode).toBe('tiles')
  expect(state.facts.tiles).toEqual({ minZoom: 4, maxZoom: 10, layers: ['parcels-10k-nobbox'] })
  const status = page.locator('.status-bar')
  await expect(status).toContainText('Zoom 4–10')
  await expect(status).toContainText('-114.00, 37.00, -109.01, 42.00')

  // A second zoom, deeper: still drawn.
  const first = await e2e<{ count: number }>(page, 'rangeReads')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect.poll(async () => (await e2e<{ count: number }>(page, 'rangeReads')).count, { timeout: 30000 }).toBeGreaterThan(first.count)
  await expect.poll(() => rendered(page), { timeout: 30000 }).toBeGreaterThan(0)

  // Only parts of the file were read.
  const reads = await e2e<{ count: number; bytes: number; largest: number }>(page, 'rangeReads')
  const size = fs.statSync(file).size
  expect(reads.largest).toBeLessThan(size)
  expect(reads.bytes).toBeLessThan(size)

  // The inspector: the clicked feature's attributes and its layer.
  // Parcels are sparse at this zoom: click across a grid until one is hit.
  const box = (await page.locator('.canvas-host').boundingBox())!
  const inspector = page.getByRole('region', { name: 'Feature attributes' })
  search: for (let gy = 1; gy < 12; gy++) {
    for (let gx = 1; gx < 12; gx++) {
      await page.mouse.click(box.x + (box.width * gx) / 12, box.y + (box.height * gy) / 12)
      const hit = await inspector
        .waitFor({ state: 'visible', timeout: 300 })
        .then(() => true)
        .catch(() => false)
      if (hit) break search
    }
  }
  await expect(inspector).toBeVisible({ timeout: 10000 })
  await expect(inspector).toContainText('parcels-10k-nobbox')
  await expect(inspector).toContainText('zone')

  // FR-009a: SQL, the table, styling and export say why they're unavailable.
  await expect(page.getByRole('status').filter({ hasText: REASON }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export data…' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Style', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Style', exact: true })).toHaveAttribute('title', REASON)
  await page.keyboard.press('Control+Shift+Q')
  await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled()
  await expect(page.getByRole('region', { name: 'Query' }).getByRole('status').filter({ hasText: REASON })).toBeVisible()

  // Another file afterwards opens normally (the map goes back to view features).
  await page.locator('input[type="file"]').setInputFiles(fixture('parcels-10k.parquet'))
  await expect(status).toContainText('10,000 features', { timeout: 60000 })
  await expect.poll(() => rendered(page), { timeout: 60000 }).toBeGreaterThan(0)
})
