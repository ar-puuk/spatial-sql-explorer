// Issue 1: a GeoPackage in EPSG:27700 (British National Grid) failed to open with "Transformation cannot be formatted as WKT1
// TOWGS84 parameters": ST_Read_Meta builds the CRS as WKT1 in this engine and cannot for a CRS with several datum
// transformations, while ST_Read and ST_Transform work. The layers are now listed from the GeoPackage's own catalog.
import { test, expect } from '@playwright/test'
import { fixture, openFile } from './helpers'

test('a GeoPackage in EPSG:27700 opens, lists its layers and draws them in Britain', async ({ page }) => {
  await openFile(page, fixture('osgb-27700.gpkg'), '?e2e=1')
  await expect(page.getByText('Transformation cannot be formatted')).toHaveCount(0)
  await expect(page.locator('.canvas-host')).toHaveAttribute('data-rendered-features', /^[1-9]/)
  const state = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState: () => { lng?: number; lat?: number; center?: [number, number] } } }).__spatialExplorerE2E.mapState())
  const lng = state.lng ?? state.center?.[0]
  const lat = state.lat ?? state.center?.[1]
  expect(lng, 'longitude near Britain').toBeGreaterThan(-9)
  expect(lng).toBeLessThan(3)
  expect(lat).toBeGreaterThan(49)
  expect(lat).toBeLessThan(61)
  // The file's two layers are both there; the other opens too.
  await expect(page.getByRole('option', { name: 'points, Point, 4' })).toHaveCount(1)
  await expect(page.getByRole('option', { name: 'polygons, Polygon, 3' })).toHaveCount(1)
})
