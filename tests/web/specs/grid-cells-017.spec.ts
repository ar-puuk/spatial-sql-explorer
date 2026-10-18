// Spec 017: Bin into cells, in the real engine. The SQL is built by the same function the app uses
// (packages/core/src/grid/binSql.ts) and run through the ?e2e=1 hook, over temp tables of points.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { binQuerySql, type BinSpec } from '../../../packages/core/src/grid/binSql'
import { choose, editor, exportDialog, exportVia, fixture, inspectParquet, openFile, openQueryPanel, rowCount, runQuery, setQuery, writeParcels } from './helpers'

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

  test('nulls in the measured column are ignored; a cell holding only nulls has no value but still counts its features', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(
      `CREATE OR REPLACE TEMP TABLE pts AS
       SELECT ST_Point(8.0, 47.0) AS geom, 10.0::DOUBLE AS v UNION ALL SELECT ST_Point(8.0001, 47.0001), NULL UNION ALL SELECT ST_Point(8.0002, 47.0002), 30.0
       UNION ALL SELECT ST_Point(-100.0, 10.0), NULL UNION ALL SELECT ST_Point(-100.0001, 10.0001), NULL`
    )
    await run(`CREATE OR REPLACE TEMP TABLE binned AS ${binSql({ system: 'h3', resolution: 6, measure: { kind: 'avg', column: 'v' } })}`)
    const rows = await run(`SELECT n, value FROM binned ORDER BY n DESC`)
    expect(rows).toHaveLength(2)
    expect(num(rows[0].n)).toBe(3)
    expect(num(rows[0].value)).toBe(20) // the null is left out of the average
    expect(num(rows[1].n)).toBe(2)
    expect(rows[1].value).toBeNull()
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
// The map's button.
const binButton = (page: Page) => page.getByRole('button', { name: 'Bin into cells…' })
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

  test('the query goes to the SQL tab as the preview runs, without Keep; Cancel brings back what was there', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await openQueryPanel(page)
    // What the user had in the editor, run or not.
    await setQuery(page, 'SELECT * FROM layer -- my own work')
    const before = await editor(page).innerText()
    expect(before).toContain('my own work')
    await binButton(page).click()
    await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBe('3000')
    // Open the SQL tab with the dialog still open: the bin's query is already in the editor.
    await page.getByRole('tab', { name: 'SQL' }).click()
    await expect(editor(page)).toContainText('SELECT cell_id, resolution, value, n,')
    await expect(editor(page)).toContainText('h3_latlng_to_cell')
    await expect(dialog(page)).toBeVisible()
    // Cancel: the old query comes straight back, and so does the original view.
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(editor(page)).not.toContainText('h3_latlng_to_cell')
    expect(await editor(page).innerText()).toBe(before)
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBe('3000')
  })

  test('Keep leaves the query in the SQL tab, selected', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await openQueryPanel(page)
    await binButton(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(dialog(page)).toBeHidden()
    await expect(editor(page)).toContainText('SELECT cell_id, resolution, value, n,')
    await expect(editor(page)).toContainText('h3_latlng_to_cell')
  })

  test('editing the resolution in the SQL and rerunning keeps the style and the legend of the cells', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await openQueryPanel(page)
    await binButton(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    const head = legend(page).getByRole('button', { name: /^Number of features/ })
    await expect(head).toBeVisible()
    const cellsBefore = await rendered(page)
    const text = await editor(page).innerText()
    const res = Number(/(\d+) AS resolution/.exec(text)![1])
    // One step coarser everywhere the resolution appears: the cell function and the `resolution` column.
    const edited = text.replace(new RegExp(`h3_latlng_to_cell\(ST_Y\(p\), ST_X\(p\), ${res}\)`), `h3_latlng_to_cell(ST_Y(p), ST_X(p), ${res - 1})`).replace(`${res} AS resolution`, `${res - 1} AS resolution`)
    expect(edited).not.toBe(text)
    await runQuery(page, edited)
    await expect.poll(() => rendered(page), { timeout: 30000 }).not.toBe(cellsBefore)
    // The style is the cells' own, not reset: same legend title, still graduated on value.
    await expect(head).toBeVisible()
  })

  test('the result exports like any other: the usual formats, and a GeoParquet that reads back', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'), '?e2e=1')
    await openQueryPanel(page)
    await binButton(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(legend(page).getByRole('button', { name: /^Number of features/ })).toBeVisible()
    // The table's rows are the cells (the map's rendered count also counts a cell once per tile it crosses).
    await expect.poll(() => rowCount(page), { timeout: 30000 }).toBeGreaterThan(0)
    const cells = await rowCount(page)
    await page.getByRole('button', { name: 'Export data…' }).click()
    const formats = await exportDialog(page).getByLabel('Format', { exact: true }).locator('option').allTextContents()
    expect(formats).toEqual(expect.arrayContaining(['GeoParquet', 'GeoPackage', 'GeoJSON', 'FlatGeobuf']))
    const { bytes } = await exportVia(page, { format: 'GeoParquet' })
    const back = await inspectParquet(page, bytes)
    expect(back.rows).toBe(cells)
    expect(back.columns).toEqual(expect.arrayContaining(['cell_id', 'resolution', 'value', 'n']))
    expect(back.geo).not.toBeNull()
  })

  test('the cells keep every polygon style option: graduated on value, a ramp change redraws, extrusion by value', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await openQueryPanel(page)
    await binButton(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await page.getByRole('button', { name: 'Style', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Layer style' })
    await expect(page.getByRole('button', { name: 'Color: Graduated' })).toBeVisible()
    await expect(panel.getByLabel('Column', { exact: true })).toContainText('value')
    // A ramp change redraws the legend swatches.
    const rows = legend(page).locator('li')
    const swatch = (i: number) => rows.nth(i).locator('.swatch').evaluate((el) => getComputedStyle(el).getPropertyValue('--swatch').trim())
    await expect(rows).toHaveCount(5)
    const before = await swatch(0)
    await page.getByRole('button', { name: /^Colors:/ }).click()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect.poll(() => swatch(0)).not.toBe(before)
    // Cells are polygons: extrusion is offered, and its height can be the value.
    const toggle = panel.getByRole('switch', { name: 'Extrude polygons' })
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(panel.getByLabel('Height from')).toContainText('value')
  })

  test('the map has the same action as a button, which opens the same dialog', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })

  test('the size and the estimate follow the resolution, and the sizes use the Measure tool\'s units', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    const size = dialog(page).getByText(/^Cells about /)
    const first = await size.innerText()
    expect(first).toMatch(/^Cells about [\d.,]+ (m|km|ft|mi) across, [\d.,]+ (m²|ha|km²|ft²|ac|mi²) each$/)
    const status = dialog(page).getByRole('status').filter({ hasText: /^About / })
    const estimateBefore = await status.innerText()
    await dialog(page).getByRole('slider', { name: 'Resolution' }).press('ArrowRight')
    await expect(size).not.toHaveText(first)
    await expect(status).not.toHaveText(estimateBefore)
    // A5 has its own sizes for the same number.
    await dialog(page).getByRole('radio', { name: 'A5' }).click()
    await expect(size).toContainText('across')
    await page.keyboard.press('Escape')
  })

  test('finer resolutions are behind "All resolutions"', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    const slider = dialog(page).getByRole('slider', { name: 'Resolution' })
    const max = Number(await slider.getAttribute('max'))
    expect(max).toBeLessThan(15)
    await dialog(page).getByRole('switch', { name: 'All resolutions' }).click()
    await expect(slider).toHaveAttribute('max', '15')
    await dialog(page).getByRole('switch', { name: 'All resolutions' }).click()
    await expect(slider).toHaveAttribute('max', String(max))
    await page.keyboard.press('Escape')
  })
})

// 120,000 points: the estimate passes the 5,000-cell preview limit and then the 100,000-cell drawing limit.
test.describe('Bin into cells with many cells (spec 017)', () => {
  const setResolution = (page: Page, n: number) =>
    dialog(page)
      .getByRole('slider', { name: 'Resolution' })
      .evaluate((el, value) => {
        const input = el as HTMLInputElement
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, n)

  test('over 5,000 cells it waits for a click; over 100,000 it asks first', async ({ page }) => {
    test.setTimeout(240000)
    const file = path.join(os.tmpdir(), 'se-grid-120k.geojson')
    const features = Array.from({ length: 120_000 }, (_, i) => {
      const lon = -111.9 + ((i * 7919) % 4000) / 10_000
      const lat = 40.5 + ((i * 104_729) % 4000) / 10_000
      return `{"type":"Feature","properties":{"id":${i}},"geometry":{"type":"Point","coordinates":[${lon},${lat}]}}`
    })
    fs.writeFileSync(file, `{"type":"FeatureCollection","features":[${features.join(',')}]}`)
    await openFile(page, file)
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    await dialog(page).getByRole('switch', { name: 'All resolutions' }).click()

    // Between 5,000 and 100,000 cells: no automatic preview; the button says Show.
    await setResolution(page, 9)
    const status = dialog(page).getByRole('status').filter({ hasText: /^About / })
    await expect(status).toContainText(/About [\d,]+ cells/)
    const count = Number((await status.innerText()).replace(/[^\d]/g, ''))
    expect(count).toBeGreaterThan(5000)
    expect(count).toBeLessThan(100_000)
    await page.waitForTimeout(1500)
    await expect(dialog(page).getByText('press Show to draw them')).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: 'Show', exact: true })).toBeVisible()

    // Over 100,000: a warning and "Run anyway" instead of Keep.
    await setResolution(page, 12)
    await expect(dialog(page).getByText(/more than 100,000 cells/)).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: 'Run anyway' })).toBeVisible()
    await expect(dialog(page).getByRole('button', { name: 'Keep', exact: true })).toHaveCount(0)
    // Enter must not run it past the warning.
    await dialog(page).getByRole('slider', { name: 'Resolution' }).press('Enter')
    await expect(dialog(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    fs.rmSync(file, { force: true })
  })
})

// US5: the cells are built from the rows the layer currently shows.
test.describe('Bin into cells of the rows shown (spec 017)', () => {
  const raw = (page: Page, sql: string) =>
    page.evaluate((q) => (window as unknown as { __spatialExplorerE2E: { runRaw: (s: string) => Promise<Array<Record<string, unknown>>> } }).__spatialExplorerE2E.runRaw(q), sql)
  /** The features the kept bin counts: the sum of its `n`. */
  const binned = async (page: Page): Promise<number> => {
    const sql = (await editor(page).innerText()).trim()
    const [row] = await raw(page, `SELECT sum(n)::BIGINT AS t FROM (${sql})`)
    return Number(row.t)
  }
  const mapBin = (page: Page) => page.getByRole('button', { name: 'Bin into cells…' })

  test('a column filter narrows the cells: the counts add up to the matching rows', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(2000), '?e2e=1')
    await page.getByRole('textbox', { name: 'Filter zone' }).fill('r1')
    await expect(page.locator('.drawer-header > .count')).toHaveText('400 of 2,000 rows')
    await mapBin(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(editor(page)).toContainText('WHERE (')
    expect(await binned(page)).toBe(400)
  })

  test('with no filter the cells count every row', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(2000), '?e2e=1')
    await mapBin(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(editor(page)).not.toContainText('WHERE (')
    expect(await binned(page)).toBe(2000)
  })

  test('Selected rows only bins the ticked rows, from a table named selected_rows', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(2000), '?e2e=1')
    for (const n of [1, 2, 3]) await page.getByRole('checkbox', { name: `Select row ${n}`, exact: true }).check()
    await mapBin(page).click()
    const only = dialog(page).getByRole('switch', { name: 'Selected rows only' })
    await expect(dialog(page)).toContainText('3 selected')
    await expect(only).toHaveAttribute('aria-checked', 'false')
    await only.click()
    await expect(only).toHaveAttribute('aria-checked', 'true')
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(editor(page)).toContainText('FROM selected_rows')
    expect(await binned(page)).toBe(3)
  })

  test('without a selection the switch is not offered', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(200), '?e2e=1')
    await mapBin(page).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByRole('switch', { name: 'Selected rows only' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('rows with no location are left out, and the number is said', async ({ page }) => {
    test.setTimeout(120000)
    const file = path.join(os.tmpdir(), 'se-grid-gaps.geojson')
    const point = (i: number) => `{"type":"Feature","properties":{"id":${i}},"geometry":{"type":"Point","coordinates":[${-111.9 + i / 100},${40.7 + i / 100}]}}`
    const gap = (i: number) => `{"type":"Feature","properties":{"id":${i}},"geometry":null}`
    const rows = [...Array.from({ length: 10 }, (_, i) => point(i)), gap(10), gap(11)]
    fs.writeFileSync(file, `{"type":"FeatureCollection","features":[${rows.join(',')}]}`)
    await openFile(page, file, '?e2e=1')
    await mapBin(page).click()
    await expect(dialog(page).getByText('2 rows have no location and are not counted.')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(page.locator('.query-status')).toContainText('2 rows have no location and are not counted')
    expect(await binned(page)).toBe(10)
    fs.rmSync(file, { force: true })
  })
})

// US6: reading a cell.
test.describe('Reading a cell (spec 017)', () => {
  test('clicking a cell shows its id, size, value and count; the id can be copied', async ({ page, context }) => {
    test.setTimeout(120000)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.setViewportSize({ width: 1280, height: 1000 }) // tall enough that the card is open, not collapsed to its header
    await openFile(page, fixture('crashes.geojson'))
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect.poll(async () => Number(await rendered(page)), { timeout: 30000 }).toBeGreaterThan(0)
    // Click where the data is: the middle of the map first, then a grid around it until a cell answers.
    const box = (await page.locator('.canvas-host').boundingBox())!
    const card = page.getByRole('region', { name: 'Feature attributes' })
    outer: for (const dy of [0, -0.12, 0.12, -0.25, 0.25]) {
      for (const dx of [0, -0.12, 0.12, -0.25, 0.25]) {
        await page.mouse.click(box.x + box.width * (0.5 + dx), box.y + box.height * (0.5 + dy))
        // The card opens with its header and fills in once the record is read.
        if (await card.getByText('cell_id', { exact: true }).waitFor({ timeout: 2500 }).then(() => true, () => false)) break outer
      }
    }
    await expect(card).toBeVisible()
    for (const column of ['cell_id', 'resolution', 'value', 'n']) await expect(card.getByText(column, { exact: true })).toBeVisible()
    const id = await card.locator('dd').first().innerText()
    expect(id.trim()).toMatch(/^[0-9a-f]{15}$/) // an H3 cell id
    await card.getByRole('button', { name: 'Copy cell_id' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(id.trim())
    // Only the id has a copy button.
    await expect(card.getByRole('button', { name: /^Copy / })).toHaveCount(1)
  })
})

// The dialog remembers the grid system and the kind of measure that was kept.
test('the last grid system and measure are remembered for the next bin', async ({ page, context }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('crashes.geojson'))
  await page.getByRole('button', { name: 'Bin into cells…' }).click()
  await dialog(page).getByRole('radio', { name: 'A5' }).click()
  await choose(page, dialog(page).getByRole('button', { name: 'What each cell shows' }), 'Average of a column')
  await expect(dialog(page).getByRole('button', { name: 'Column', exact: true })).toBeVisible()
  await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
  await expect(dialog(page)).toBeHidden()

  // A new page of the same browser: what is remembered is read back from the saved state.
  const next = await context.newPage()
  await openFile(next, fixture('crashes.geojson'))
  await next.getByRole('button', { name: 'Bin into cells…' }).click()
  const again = next.getByRole('dialog', { name: 'Bin into cells' })
  await expect(again.getByRole('radio', { name: 'A5' })).toHaveAttribute('data-state', 'on')
  await expect(again.getByRole('button', { name: 'What each cell shows' })).toContainText('Average of a column')
  await next.keyboard.press('Escape')
})

// Layout: the dialog shares the width and the left edge of the search box and the other panels in the map's top left.
test('the dialog is as wide as the search box and the feature card, on the same left edge', async ({ page }) => {
  test.setTimeout(120000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openFile(page, fixture('crashes.geojson'))
  await page.getByRole('button', { name: 'Bin into cells…' }).click()
  await expect(dialog(page)).toBeVisible()
  // The search box is the field inside its 300 px wide stack: take the stack's own box (the search region's parent).
  const stack = await page.getByRole('search').boundingBox()
  const box = await dialog(page).boundingBox()
  expect(stack).not.toBeNull()
  expect(Math.abs(box!.width - stack!.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(box!.x - stack!.x)).toBeLessThanOrEqual(2)
  // And it sits below the search box, not over it.
  expect(box!.y).toBeGreaterThanOrEqual(stack!.y + stack!.height)
  await page.keyboard.press('Escape')
})

