// Spec 024: a GTFS feed opens in the web app as its routes (the open layer) with the stops and
// the feed's tables in a schema named after the file. The fixture (scripts/fixtures-024.mjs) has
// 3 routes: R1 with a shape, R2 and R3 without (drawn from GDAL's trip lines), 5 stops (one unserved).
import { test, expect, type Page } from '@playwright/test'
import { fixture, openFile, runQuery, showSql, openQueryPanel } from './helpers'

/** Runs a query that returns one text cell and reads that cell from the table. */
async function one(page: Page, sql: string): Promise<string> {
  await runQuery(page, sql)
  return (await page.locator('[role="grid"][aria-label="Attribute table"] tbody tr:not(.spacer):not(.skeleton) td[role="gridcell"]').nth(2).textContent())?.trim() ?? ''
}

test.describe('a GTFS feed', () => {
  test.setTimeout(180000)

  test('opens as routes, with stops and tables to query', async ({ page }) => {
    await openFile(page, fixture('gtfs-mini.zip'))
    await openQueryPanel(page)
    await showSql(page)
    // Each route is one geometry: R1 from its shape, R2 and R3 from GDAL's trip lines.
    expect(await one(page, `SELECT string_agg(route_id || ':' || ST_GeometryType(geom)::VARCHAR || ':' || trips, ', ' ORDER BY route_id) AS s FROM gtfs_mini.routes`)).toBe('R1:MULTILINESTRING:2, R2:LINESTRING:1, R3:LINESTRING:1')
    // The colors are the data's, as given.
    expect(await one(page, `SELECT string_agg(coalesce(route_color, '-'), ',' ORDER BY route_id) AS s FROM gtfs_mini.routes`)).toBe('E4572E,-,17BEBB')
    // `layer` is the same table.
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM layer`)).toBe('3')
    // Stops carry the routes that serve them; the orphan has none.
    expect(await one(page, `SELECT string_agg(stop_id || '=' || coalesce(routes, '-'), ' ' ORDER BY stop_id) AS s FROM gtfs_mini.stops`)).toBe('S1=1 S2=1, L S3=2, L S4=2 S5=-')
    expect(await one(page, `SELECT coalesce(route_color, '-') AS s FROM gtfs_mini.stops WHERE stop_id = 'S2'`)).toBe('17BEBB')
    // The feed's other tables are views, all text.
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM gtfs_mini.calendar`)).toBe('1')
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM gtfs_mini.stop_times`)).toBe('8')
  })
})

// A real agency feed, when the machine has one: SE_GTFS_SAMPLE=D:\GTFS.zip (Utah Transit Authority, with a second zip inside).
const sample = process.env.SE_GTFS_SAMPLE
test.describe('a real feed', () => {
  test.skip(!sample, 'set SE_GTFS_SAMPLE to a GTFS zip')
  test.setTimeout(300000)

  test('opens with every route that has trips, and the stops they serve', async ({ page }) => {
    await openFile(page, sample as string)
    await openQueryPanel(page)
    await showSql(page)
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM layer`)).toBe('85')
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM gtfs.stops`)).toBe('5425')
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM gtfs.stop_times`)).toBe('466857')
    // Every route keeps its own color.
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM layer WHERE route_color IS NULL OR route_color = ''`)).toBe('0')
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM gtfs.stops WHERE route_count IS NULL`)).not.toBe('5425')
  })
})
