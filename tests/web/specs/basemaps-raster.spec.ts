// T065 (spec 008 US5, FR-024): the keyless raster basemaps.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile } from './helpers'

const picker = (page: Page) => page.getByRole('region', { name: 'Basemap' })

test('Satellite, Topographic and OpenStreetMap are offered, draw, and show their attribution', async ({ page }) => {
  // Tiles from the network are stubbed with a tiny PNG (no third-party traffic in tests).
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  await page.route(/arcgisonline\.com|opentopomap\.org|tile\.openstreetmap\.org/, (route) => route.fulfill({ body: png, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' } }))
  await openFile(page, fixture('sample.geojson'))
  for (const [name, attribution] of [
    ['Satellite', /Esri/],
    ['Topographic', /OpenTopoMap/],
    ['OpenStreetMap', /OpenStreetMap contributors/],
  ] as const) {
    if (!(await picker(page).isVisible())) await page.getByRole('button', { name: 'Basemap', exact: true }).click()
    await picker(page).getByRole('radio', { name: new RegExp(`^${name}`) }).click()
    await expect(page.getByRole('button', { name: 'Basemap', exact: true })).toHaveAttribute('aria-description', `Basemap: ${name}`)
    await page.locator('.maplibregl-ctrl-attrib-button').click()
    await expect(page.locator('.maplibregl-ctrl-attrib-inner')).toContainText(attribution)
    await page.locator('.maplibregl-ctrl-attrib-button').click()
  }
})

test('a raster basemap that fails falls back to Blank with a message', async ({ page }) => {
  await page.route(/opentopomap\.org/, (route) => route.abort())
  await openFile(page, fixture('sample.geojson'))
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await picker(page).getByRole('radio', { name: /^Topographic/ }).click()
  // The picker is open: the message shows there (on the map once it closes).
  await expect(picker(page)).toContainText(/Topographic basemap unavailable/, { timeout: 20000 })
  await expect(page.getByRole('button', { name: 'Basemap', exact: true })).toHaveAttribute('aria-description', 'Basemap: Blank')
  await page.keyboard.press('Escape')
  await expect(page.locator('.map-notice')).toContainText(/Topographic basemap unavailable/)
})
