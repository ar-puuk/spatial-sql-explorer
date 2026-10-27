// Issue 1: a GeoPackage in EPSG:27700 (British National Grid) failed to open with "Transformation cannot be formatted as WKT1
// TOWGS84 parameters": in this engine ST_Read_Meta cannot describe a CRS whose transformation to WGS84 is not a plain 7-parameter
// shift (EPSG:27700 and 31467 are the ones found), while ST_Read and ST_Transform work. specs/issue-1-towgs84.md has the findings.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile } from './helpers'

async function expectOverBritain(page: Page): Promise<void> {
  await expect(page.getByText('Transformation cannot be formatted')).toHaveCount(0)
  await expect(page.locator('.canvas-host')).toHaveAttribute('data-rendered-features', /^[1-9]/)
  const state = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState: () => { lng?: number; lat?: number; center?: [number, number] } } }).__spatialExplorerE2E.mapState())
  const lng = state.lng ?? state.center?.[0]
  const lat = state.lat ?? state.center?.[1]
  expect(lng, 'longitude near Britain').toBeGreaterThan(-9)
  expect(lng).toBeLessThan(3)
  expect(lat).toBeGreaterThan(49)
  expect(lat).toBeLessThan(61)
}

test('a GeoPackage in EPSG:27700 opens, lists its layers and draws them in Britain', async ({ page }) => {
  await openFile(page, fixture('osgb-27700.gpkg'), '?e2e=1')
  await expectOverBritain(page)
  await expect(page.getByRole('option', { name: 'points, Point, 4' })).toHaveCount(1)
  await expect(page.getByRole('option', { name: 'polygons, Polygon, 3' })).toHaveCount(1)
})

test('a GML file in EPSG:27700 opens as its first layer (no catalog to list from)', async ({ page }) => {
  await openFile(page, [fixture('osgb-27700.gml'), fixture('osgb-27700.xsd')] as unknown as string, '?e2e=1')
  await expectOverBritain(page)
})
