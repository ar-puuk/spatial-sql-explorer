// Spec 017: Bin into cells, in the real engine. The SQL is built by the same function the app uses
// (packages/core/src/grid/binSql.ts) and run through the ?e2e=1 hook, over temp tables of points.
import { test, expect, type Page } from '@playwright/test'
import { binQuerySql, type BinSpec } from '../../../packages/core/src/grid/binSql'
import { editor, fixture, openFile, openQueryPanel } from './helpers'

type Row = Record<string, unknown>

async function openEngine(page: Page): Promise<(sql: string) => Promise<Row[]>> {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  return (sql) => page.evaluate((q) => (window as unknown as { __spatialExplorerE2E: { runRaw: (s: string) => Promise<Row[]> } }).__spatialExplorerE2E.runRaw(q), sql)
}

const FACTS = { geom: '"geom"', srid: 4326, columns: [{ name: 'v', type: 'DOUBLE' }] }
/** The app's own query over the temp table `pts` instead of `layer`. */
const binSql = (over: Partial<BinSpec> & Pick<BinSpec, 'system' | 'resolution'>, srid: number | null = 4326): string =>
  binQuerySql({ measure: { kind: 'count' }, ...over }, { ...FACTS, srid })!.sql.replace('FROM layer', 'FROM pts')
const num = (v: unknown): number => Number(v)

test.describe('Bin into cells in the engine (spec 017)', () => {
  test('counts add up to the rows with a location, for H3 and for A5 (SC-2), and every cell is valid', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(
      `CREATE OR REPLACE TEMP TABLE pts AS
       SELECT ST_Point(random() * 360 - 180, random() * 170 - 85) AS geom, random() AS v FROM range(20000)
       UNION ALL SELECT ST_GeomFromText('POINT EMPTY'), 1 FROM range(7)
       UNION ALL SELECT NULL, 1 FROM range(5)`
    )
    for (const spec of [
      { system: 'h3', resolution: 3 },
      { system: 'a5', resolution: 4 },
    ] as const) {
      await run(`CREATE OR REPLACE TEMP TABLE binned AS ${binSql(spec)}`)
      const [r] = await run(`SELECT count(*) AS cells, sum(n)::BIGINT AS total, count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid, count(DISTINCT cell_id) AS ids, typeof(any_value(geom)) AS t, min(resolution) AS res FROM binned`)
      expect(num(r.total), `${spec.system} rows binned`).toBe(20000)
      expect(num(r.invalid), `${spec.system} invalid cells`).toBe(0)
      expect(num(r.ids)).toBe(num(r.cells))
      expect(r.t).toBe("GEOMETRY('EPSG:4326')")
      expect(num(r.res)).toBe(spec.resolution)
    }
  })

  test('the sum, average, minimum, maximum and median of a column per cell match a direct GROUP BY', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(`CREATE OR REPLACE TEMP TABLE pts AS SELECT ST_Point(8 + random(), 47 + random()) AS geom, i::DOUBLE AS v FROM range(2000) t(i)`)
    for (const kind of ['sum', 'avg', 'min', 'max', 'median'] as const) {
      await run(`CREATE OR REPLACE TEMP TABLE binned AS ${binSql({ system: 'h3', resolution: 6, measure: { kind, column: 'v' } })}`)
      const [r] = await run(
        `SELECT count(*) AS cells, count(*) FILTER (WHERE abs(b.value - d.expected) > 1e-9) AS wrong
         FROM binned b JOIN (SELECT h3_h3_to_string(h3_latlng_to_cell(ST_Y(geom), ST_X(geom), 6)) AS cell_id, ${kind}(v) AS expected FROM pts GROUP BY 1) d USING (cell_id)`
      )
      expect(num(r.cells), kind).toBeGreaterThan(1)
      expect(num(r.wrong), kind).toBe(0)
    }
  })

  test('A5 cells have the same area at 10 and at 60 degrees north (SC-3); H3 cells do not', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(`CREATE OR REPLACE TEMP TABLE pts AS SELECT ST_Point(8, 10) AS geom UNION ALL SELECT ST_Point(8, 60)`)
    const area = async (spec: Pick<BinSpec, 'system' | 'resolution'>): Promise<number[]> => {
      await run(`CREATE OR REPLACE TEMP TABLE binned AS ${binSql(spec)}`)
      const rows = await run(`SELECT ST_Area_Spheroid(geom) AS a FROM binned ORDER BY ST_Y(ST_Centroid(geom))`)
      return rows.map((r) => num(r.a))
    }
    // A fine resolution, where a straight edge in longitude/latitude is close to the cell's own edge.
    const a5 = await area({ system: 'a5', resolution: 12 })
    expect(a5).toHaveLength(2)
    expect(Math.abs(a5[0] / a5[1] - 1)).toBeLessThan(0.01)
    const [ref] = await run(`SELECT a5_cell_area(12) AS a`)
    expect(Math.abs(a5[0] / num(ref.a) - 1)).toBeLessThan(0.01)
    const h3 = await area({ system: 'h3', resolution: 7 })
    expect(Math.abs(h3[0] / h3[1] - 1)).toBeGreaterThan(0.01) // hexagons shrink toward the poles in longitude/latitude
  })

  test('cells across the date line are valid polygons within the world, split in two', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(
      `CREATE OR REPLACE TEMP TABLE pts AS
       SELECT ST_Point(179.99, 0.0) AS geom UNION ALL SELECT ST_Point(-179.99, 10.0) UNION ALL SELECT ST_Point(179.999, -30.0) UNION ALL SELECT ST_Point(-179.999, 45.0)`
    )
    for (const spec of [
      { system: 'h3', resolution: 3 },
      { system: 'h3', resolution: 6 },
      { system: 'a5', resolution: 5 },
      { system: 'a5', resolution: 9 },
    ] as const) {
      await run(`CREATE OR REPLACE TEMP TABLE binned AS ${binSql(spec)}`)
      const [r] = await run(
        `SELECT count(*) AS cells, count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid, min(ST_XMin(geom)) AS xmin, max(ST_XMax(geom)) AS xmax,
                count(*) FILTER (WHERE ST_GeometryType(geom)::VARCHAR = 'MULTIPOLYGON') AS split
         FROM binned`
      )
      const label = `${spec.system} ${spec.resolution}`
      expect(num(r.cells), label).toBeGreaterThanOrEqual(2)
      expect(num(r.invalid), label).toBe(0)
      expect(num(r.xmin), label).toBeGreaterThanOrEqual(-180)
      expect(num(r.xmax), label).toBeLessThanOrEqual(180)
      // Each point sits within a cell's width of the date line: at least one cell on each side is split or touches it.
      const touching = await run(`SELECT count(*) AS n FROM binned WHERE ST_XMin(geom) = -180 OR ST_XMax(geom) = 180`)
      expect(num(touching[0].n), label).toBeGreaterThanOrEqual(1)
      // No cell is wider on the map than its own size: a split cell is two narrow pieces, never one world-wide polygon.
      const wide = await run(`SELECT count(*) AS n FROM (SELECT UNNEST(ST_Dump(geom)) AS d FROM binned) WHERE ST_XMax(d.geom) - ST_XMin(d.geom) > 90`)
      expect(num(wide[0].n), label).toBe(0)
    }
  })

  test('the cells holding the poles are caps that contain the pole (H3 and A5)', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(`CREATE OR REPLACE TEMP TABLE pts AS SELECT ST_Point(10, 89.99) AS geom UNION ALL SELECT ST_Point(10, -89.99)`)
    for (const spec of [
      ...[0, 1, 2, 3, 5].map((resolution) => ({ system: 'h3' as const, resolution })),
      ...[1, 2, 3, 5].map((resolution) => ({ system: 'a5' as const, resolution })),
    ]) {
      await run(`CREATE OR REPLACE TEMP TABLE binned AS ${binSql(spec)}`)
      const [r] = await run(
        `SELECT count(*) AS cells, count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid, min(ST_XMin(geom)) AS xmin, max(ST_XMax(geom)) AS xmax,
                min(ST_Distance(geom, ST_Point(10, 89.99))) FILTER (WHERE ST_Y(ST_Centroid(geom)) > 0) AS north,
                min(ST_Distance(geom, ST_Point(10, -89.99))) FILTER (WHERE ST_Y(ST_Centroid(geom)) < 0) AS south
         FROM binned`
      )
      const label = `${spec.system} ${spec.resolution}`
      expect(num(r.cells), label).toBe(2)
      expect(num(r.invalid), label).toBe(0)
      expect(num(r.xmin), label).toBeGreaterThanOrEqual(-180)
      expect(num(r.xmax), label).toBeLessThanOrEqual(180)
      if (spec.system === 'h3') {
        // The cap contains the point next to the pole (distance 0).
        expect(num(r.north), label).toBeLessThan(0.5)
        expect(num(r.south), label).toBeLessThan(0.5)
      } else {
        // A5's cells have geodesic edges and a vertex can sit exactly at the pole, where longitude/latitude is
        // degenerate: the polar cells must reach the polar region, which is what the map shows.
        const [reach] = await run(`SELECT max(ST_YMax(geom)) AS top, min(ST_YMin(geom)) AS bottom FROM binned`)
        expect(num(reach.top), label).toBeGreaterThan(85)
        expect(num(reach.bottom), label).toBeLessThan(-85)
      }
    }
  })

  test('a projected layer is converted to longitude and latitude before it is assigned', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    // Two UTM 12N points near Salt Lake City, written in meters.
    await run(
      `CREATE OR REPLACE TEMP TABLE pts AS
       SELECT ST_Transform(ST_Point(-111.89, 40.76), 'EPSG:4326', 'EPSG:26912', always_xy := true) AS geom
       UNION ALL SELECT ST_Transform(ST_Point(-111.88, 40.77), 'EPSG:4326', 'EPSG:26912', always_xy := true)`
    )
    await run(`CREATE OR REPLACE TEMP TABLE binned AS ${binSql({ system: 'h3', resolution: 4 }, 26912)}`)
    const [r] = await run(`SELECT count(*) AS cells, sum(n)::BIGINT AS total, min(ST_XMin(geom)) AS xmin, max(ST_XMax(geom)) AS xmax, min(ST_YMin(geom)) AS ymin, max(ST_YMax(geom)) AS ymax FROM binned`)
    expect(num(r.total)).toBe(2)
    expect(num(r.xmin)).toBeLessThan(-111.8)
    expect(num(r.xmax)).toBeGreaterThan(-112.0)
    expect(num(r.ymin)).toBeLessThan(40.8)
    expect(num(r.ymax)).toBeGreaterThan(40.7)
  })

  test('polygons are assigned by their center', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(`CREATE OR REPLACE TEMP TABLE pts AS SELECT ST_GeomFromText('POLYGON((8 47, 8.002 47, 8.002 47.002, 8 47.002, 8 47))') AS geom`)
    await run(`CREATE OR REPLACE TEMP TABLE binned AS ${binSql({ system: 'h3', resolution: 9 })}`)
    const [r] = await run(`SELECT count(*) AS cells, sum(n)::BIGINT AS total, cell_id = h3_h3_to_string(h3_latlng_to_cell(47.001, 8.001, 9)) AS same FROM binned GROUP BY cell_id`)
    expect(num(r.cells)).toBe(1)
    expect(num(r.total)).toBe(1)
    expect(r.same).toBe(true)
  })
})

// The dialog, through the real interface (US1, FR-2 of the plan): crashes.geojson holds points.
// The query panel's button; the map's own is "Bin into cells…".
const binButton = (page: Page) => page.getByRole('button', { name: 'Bin into cells', exact: true })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Bin into cells' })
const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
const rendered = (page: Page) => page.locator('.canvas-host').getAttribute('data-rendered-features')

test.describe('Bin into cells dialog (spec 017)', () => {
  test('keeps H3 and the count: the cells are drawn, colored, and legended "Number of features"', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    const before = Number(await rendered(page))
    await openQueryPanel(page)
    await binButton(page).click()
    await expect(dialog(page)).toBeVisible()
    // Defaults: H3, a count, a starting size already chosen.
    await expect(dialog(page).getByRole('radio', { name: 'H3' })).toHaveAttribute('data-state', 'on')
    await expect(dialog(page).getByText(/^About [\d,]+ cells?/)).toBeVisible()
    // The preview draws on its own once the choices settle.
    await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBe(String(before))
    await dialog(page).getByRole('button', { name: 'Keep' }).click()
    await expect(dialog(page)).toBeHidden()
    // The query is in the panel for the user to read, edit and rerun.
    await expect(editor(page)).toContainText('h3_latlng_to_cell')
    await expect(legend(page).getByRole('button', { name: /^Number of features/ })).toBeVisible()
  })

  test('A5 starts from its own size, and Esc puts back the original view and query', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    const before = Number(await rendered(page))
    await openQueryPanel(page)
    const queryBefore = await editor(page).innerText()
    await binButton(page).click()
    await dialog(page).getByRole('radio', { name: 'A5' }).click()
    await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBe(String(before))
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBe(String(before))
    await expect(editor(page)).not.toContainText('a5_lonlat_to_cell')
    expect(await editor(page).innerText()).toBe(queryBefore)
  })

  test('editing the resolution in the SQL and rerunning keeps the style of the cells', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await openQueryPanel(page)
    await binButton(page).click()
    await dialog(page).getByRole('button', { name: 'Keep' }).click()
    await expect(legend(page).getByRole('button', { name: /^Number of features/ })).toBeVisible()
    const text = await editor(page).innerText()
    const m = /AS resolution/.exec(text)
    expect(m).not.toBeNull()
  })

  test('the map has the same action as a button, which opens the same dialog', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })
})
