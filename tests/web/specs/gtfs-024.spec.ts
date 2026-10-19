// Spec 024: a GTFS feed opens in the web app as its routes (the open layer) with the stops and
// the feed's tables in a schema named after the file. The fixture (scripts/fixtures-024.mjs) has
// 3 routes: R1 with a shape, R2 and R3 without (drawn from GDAL's trip lines), 5 stops (one unserved).
import { test, expect, type Page } from '@playwright/test'
import { exportVia, fixture, openFile, runQuery, showSql, openQueryPanel } from './helpers'

/** Runs a query that returns one text cell and reads that cell from the table. */
async function one(page: Page, sql: string): Promise<string> {
  await runQuery(page, sql)
  return (await page.locator('[role="grid"][aria-label="Attribute table"] tbody tr:not(.spacer):not(.skeleton) td[role="gridcell"]').nth(2).textContent())?.trim() ?? ''
}

/** The stops (or routes) the map holds in its companion source, by their ids, once it has drawn them. */
const companionIds = (page: Page, key: string): Promise<string[]> =>
  page.locator('.canvas-host').evaluate((el, k) => {
    const map = (el as unknown as { seMap: { querySourceFeatures(source: string): Array<{ properties: Record<string, unknown> }> } }).seMap
    return [...new Set(map.querySourceFeatures('se-companion').map((f) => String(f.properties[k])))].sort()
  }, key)

test.describe('a GTFS feed', () => {
  test.setTimeout(180000)

  test('opens as two layers: routes (the open layer) and stops, each its own table, both on the map', async ({ page }) => {
    await openFile(page, fixture('gtfs-mini.zip'), '?e2e=1')
    await openQueryPanel(page)
    await showSql(page)
    // The open layer is the routes; the stops are their own table in the feed's schema.
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM layer`)).toBe('3')
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM gtfs_mini.stops`)).toBe('5')
    // Colors are #RRGGBB: the data's, GTFS-X's grey where there is none (route R2; the stops no colored route serves: S4, S5).
    expect(await one(page, `SELECT string_agg(color, ' ' ORDER BY route_id) AS s FROM layer`)).toBe('#E4572E #888888 #17BEBB')
    expect(await one(page, `SELECT string_agg(stop_id || color, ' ' ORDER BY stop_id) AS s FROM gtfs_mini.stops`)).toBe('S1#E4572E S2#17BEBB S3#17BEBB S4#8b7e74 S5#8b7e74')
    // The stops are on the map too, in a source of their own (not part of the table), all five.
    await expect.poll(() => companionIds(page, 'stop_id'), { timeout: 20000 }).toEqual(['S1', 'S2', 'S3', 'S4', 'S5'])
    // The style the feed opens with: colors as given, three pixel lines (no arrows until asked for), labels from zoom 13.
    const style = await page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { styleState(): Record<string, unknown> } }).__spatialExplorerE2E.styleState())
    expect(style.channels).toMatchObject({ color: { source: { kind: 'column', column: 'color' }, scale: { kind: 'identity' } } })
    expect(style.arrows).toBeUndefined()
    expect(style).toMatchObject({ lineWidth: 3, strokeColor: '#ffffff', labels: { enabled: true, source: { column: 'name' }, minZoom: 13 } })
  })

  test('the layer picker lists routes and stops; choosing stops makes them the table and draws the routes beside them', async ({ page }) => {
    await openFile(page, fixture('gtfs-mini.zip'), '?e2e=1')
    const picker = page.getByRole('combobox', { name: 'Layer' })
    await expect(picker.locator('option').first()).toHaveText('routes, LineString, 3')
    await expect(picker.locator('option').nth(1)).toHaveText('stops, Point, 5')
    // One style for both layers: what is changed on one is there on the other.
    const lineWidth = (): Promise<unknown> => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { styleState(): { lineWidth?: number } } }).__spatialExplorerE2E.styleState().lineWidth)
    expect(await lineWidth()).toBe(3)
    await picker.selectOption('stops')
    // The file is opened again for the other layer: wait until the table holds the stops (their first id), then work.
    const cell = (): Promise<string> => page.locator('[role="grid"][aria-label="Attribute table"] tbody tr:not(.spacer):not(.skeleton) td[role="gridcell"]').nth(2).textContent().then((t) => t?.trim() ?? '')
    await expect.poll(cell, { timeout: 60000 }).toBe('S1')
    await openQueryPanel(page)
    await showSql(page)
    await runQuery(page, `SELECT count(*)::VARCHAR AS s FROM layer`)
    await expect.poll(cell).toBe('5')
    await runQuery(page, `SELECT count(*)::VARCHAR AS s FROM gtfs_mini.routes`)
    await expect.poll(cell).toBe('3')
    await expect.poll(() => companionIds(page, 'route_id'), { timeout: 30000 }).toEqual(['R1', 'R2', 'R3'])
    expect(await lineWidth()).toBe(3)
    await expect(page.locator('.se-range2')).toHaveCount(0)
  })

  test('routes, stops, the raw shape points and the other tables are all in the feed schema', async ({ page }) => {
    await openFile(page, fixture('gtfs-mini.zip'))
    await openQueryPanel(page)
    await showSql(page)
    // Each route is one geometry: R1 from its shape, R2 and R3 from GDAL's trip lines.
    expect(await one(page, `SELECT string_agg(route_id || ':' || ST_GeometryType(geom)::VARCHAR || ':' || trips, ', ' ORDER BY route_id) AS s FROM gtfs_mini.routes`)).toBe('R1:MULTILINESTRING:2, R2:LINESTRING:1, R3:LINESTRING:1')
    // The data's own color column, untouched; the name the labels read.
    expect(await one(page, `SELECT string_agg(coalesce(route_color, '-'), ',' ORDER BY route_id) AS s FROM gtfs_mini.routes`)).toBe('E4572E,-,17BEBB')
    expect(await one(page, `SELECT string_agg(name, ',' ORDER BY route_id) AS s FROM gtfs_mini.routes`)).toBe('1,2,L')
    // Stops carry the routes that serve them; the orphan has none.
    expect(await one(page, `SELECT string_agg(stop_id || '=' || coalesce(routes, '-'), ' ' ORDER BY stop_id) AS s FROM gtfs_mini.stops`)).toBe('S1=1 S2=1, L S3=2, L S4=2 S5=-')
    // The feed's other tables are views, all text, the shape points among them.
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM gtfs_mini.shapes`)).toBe('3')
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
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM layer WHERE color = '#888888'`)).toBe('0')
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM gtfs.stops WHERE route_count IS NULL`)).not.toBe('5425')
  })
})

// A feed as a folder: the "GTFS folder…" menu item (the folder picker) or dropped / multi-picked text files.
test.describe('a GTFS feed as a folder of text files', () => {
  test.setTimeout(180000)
  const rendered = (page: Page) => page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 90000 })
  const start = async (page: Page): Promise<void> => {
    await page.addInitScript(() => delete (window as unknown as Record<string, unknown>).showDirectoryPicker)
    await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }))
    await page.goto('/')
  }

  test('picked with the folder button, it opens like the zip, named after the folder', async ({ page }) => {
    await start(page)
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'More ways to open' }).click()
    await page.getByRole('menuitem', { name: /GTFS folder/ }).click()
    await (await chooser).setFiles(fixture('gtfs-mini'))
    await rendered(page)
    await expect(page.locator('.file')).toContainText('gtfs-mini.zip')
    await openQueryPanel(page)
    await showSql(page)
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM gtfs_mini.routes`)).toBe('3')
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM layer`)).toBe('3')
  })

  test('its loose text files, chosen together, are the same feed', async ({ page }) => {
    await start(page)
    const names = ['agency', 'calendar', 'routes', 'shapes', 'stop_times', 'stops', 'trips'].map((n) => fixture(`gtfs-mini/${n}.txt`))
    await page.locator('input[type="file"]').setInputFiles(names)
    await rendered(page)
    await openQueryPanel(page)
    await showSql(page)
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM layer`)).toBe('3')
  })

  test('a folder of something else is not taken for a feed', async ({ page }) => {
    await start(page)
    await page.locator('input[type="file"]').setInputFiles([fixture('points.csv')])
    await rendered(page)
    await expect(page.locator('.file')).toContainText('points.csv')
  })
})

// Without GDAL (no reader, a blocked download): the geometry is made in SQL from the same tables.
test.describe('a GTFS feed read without GDAL (the SQL fallback)', () => {
  test.setTimeout(180000)

  test('draws the same two layers, and says how', async ({ page }) => {
    await openFile(page, fixture('gtfs-mini.zip'), '?e2e=1&noGdal=1')
    await expect(page.locator('body')).toContainText('The GDAL reader could not be used')
    await openQueryPanel(page)
    await showSql(page)
    expect(await one(page, `SELECT count(*)::VARCHAR AS s FROM layer`)).toBe('3')
    expect(await one(page, `SELECT string_agg(route_id || ':' || ST_GeometryType(geom)::VARCHAR || ':' || ST_NPoints(geom), ', ' ORDER BY route_id) AS s FROM gtfs_mini.routes`)).toBe('R1:MULTILINESTRING:3, R2:LINESTRING:2, R3:LINESTRING:2')
    expect(await one(page, `SELECT string_agg(stop_id || color, ' ' ORDER BY stop_id) AS s FROM gtfs_mini.stops`)).toBe('S1#E4572E S2#17BEBB S3#17BEBB S4#8b7e74 S5#8b7e74')
  })

  test('a feed with no shapes at all is drawn through its trips\' stops, in both modes', async ({ page, browser }) => {
    for (const search of ['?e2e=1', '?e2e=1&noGdal=1']) {
      const p = await browser.newPage()
      await openFile(p, fixture('gtfs-noshapes.zip'), search)
      await expect(p.locator('body')).toContainText('have no shape are drawn through the stops of one trip')
      await openQueryPanel(p)
      await showSql(p)
      expect(await one(p, `SELECT string_agg(route_id || ':' || ST_NPoints(geom), ', ' ORDER BY route_id) AS s FROM gtfs_noshapes.routes`)).toBe('R1:2, R2:2, R3:2')
      await p.close()
    }
    void page
  })

  test('says what is left out: routes with no trips, stops with no coordinates; a bad color falls back', async ({ page }) => {
    await openFile(page, fixture('gtfs-gaps.zip'), '?e2e=1')
    await expect(page.locator('body')).toContainText('1 route has no trips and is not drawn')
    await expect(page.locator('body')).toContainText('1 stop has no usable coordinates and is not on the map')
    await openQueryPanel(page)
    await showSql(page)
    expect(await one(page, `SELECT string_agg(route_id || color, ' ' ORDER BY route_id) AS s FROM layer`)).toBe('R1#E4572E R2#888888 R3#888888')
  })
})

// The two ways of making geometry agree on a real feed.
test.describe('GDAL and SQL geometry agree', () => {
  test.skip(!sample, 'set SE_GTFS_SAMPLE to a GTFS zip')
  test.setTimeout(300000)

  test('the UTA feed: the same routes, points and stops either way', async ({ browser }) => {
    const answers: string[] = []
    for (const search of ['?e2e=1', '?e2e=1&noGdal=1']) {
      const p = await browser.newPage()
      const started = Date.now()
      await openFile(p, sample as string, search)
      await openQueryPanel(p)
      await showSql(p)
      answers.push(await one(p, `SELECT (SELECT count(*) FROM gtfs.routes) || ' routes, ' || (SELECT sum(ST_NPoints(geom)) FROM gtfs.routes) || ' points, ' || (SELECT count(*) FROM gtfs.stops WHERE geom IS NOT NULL) || ' stops' AS s`))
      console.log(`${search}: ${answers.at(-1)} (${Math.round((Date.now() - started) / 100) / 10} s with the first query)`)
      await p.close()
    }
    expect(answers[1]).toBe(answers[0])
  })
})

test.describe('what goes wrong with a feed is said', () => {
  test.setTimeout(120000)

  test('a feed missing files names them', async ({ page }) => {
    const { zipSync } = await import('fflate')
    const enc = new TextEncoder()
    const buffer = Buffer.from(
      zipSync({
        'stops.txt': enc.encode('stop_id,stop_name,stop_lat,stop_lon\nS1,A,39.7,-104.9\n'),
        'routes.txt': enc.encode('route_id,route_type\nR1,3\n'),
        'trips.txt': enc.encode('route_id,service_id,trip_id\nR1,WK,T1\n'),
      })
    )
    await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }))
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles({ name: 'data.zip', mimeType: 'application/zip', buffer })
    await expect(page.locator('body')).toContainText('looks like a GTFS transit feed but is missing stop_times.txt')
  })
})

test.describe('a feed can be exported', () => {
  test.setTimeout(180000)

  const inspect = (page: Page, name: string, bytes: Buffer): Promise<{ rows: number; types: string[]; crs: string | null; columns: string[] }> =>
    page.evaluate(
      (f) => (window as unknown as { __spatialExplorerE2E: { inspectExport(f: unknown): Promise<{ rows: number; types: string[]; crs: string | null; columns: string[] }> } }).__spatialExplorerE2E.inspectExport(f),
      [{ name, base64: bytes.toString('base64') }]
    )

  for (const format of ['GeoJSON', 'GeoPackage', 'FlatGeobuf']) {
    test(`the routes as ${format}, and the stops as a result, read back`, async ({ page }) => {
      await openFile(page, fixture('gtfs-mini.zip'), '?e2e=1')
      const routes = await exportVia(page, { format })
      expect(routes.name).toContain('gtfs-mini')
      const back = await inspect(page, routes.name, routes.bytes)
      expect(back.rows).toBe(3)
      expect(back.types.every((t) => t.includes('LINESTRING'))).toBe(true)
      expect(back.columns).toEqual(expect.arrayContaining(['route_id', 'route_short_name', 'color', 'name']))
      // The stops are a table of their own: a query for them exports like any result.
      await page.getByRole('button', { name: 'Close' }).first().click().catch(() => {})
      await openQueryPanel(page)
      await showSql(page)
      await runQuery(page, 'SELECT * FROM gtfs_mini.stops')
      const stops = await exportVia(page, { format })
      const backStops = await inspect(page, stops.name, stops.bytes)
      expect(backStops.rows).toBe(5)
      expect(backStops.types).toEqual(['POINT'])
      expect(backStops.columns).toEqual(expect.arrayContaining(['stop_id', 'stop_name', 'routes', 'color']))
    })
  }
})
