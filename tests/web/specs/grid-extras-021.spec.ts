// Spec 021: Bin into cells, covering (every cell a line or polygon touches) and smoothing (each cell takes in its
// neighbors), in the real engine. The SQL is the app's own (grid/binSql.ts) over temp tables instead of `layer`.
import { test, expect, type Page } from '@playwright/test'
import { binQuerySql, binSkippedSql, type BinSpec } from '../../../packages/core/src/grid/binSql'
import { choose, editor, fixture, openFile, openQueryPanel, writeParcels } from './helpers'

type Row = Record<string, unknown>
const num = (v: unknown): number => Number(v)

async function openEngine(page: Page): Promise<(sql: string) => Promise<Row[]>> {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  return (sql) => page.evaluate((q) => (window as unknown as { __spatialExplorerE2E: { runRaw: (s: string) => Promise<Row[]> } }).__spatialExplorerE2E.runRaw(q), sql)
}

const FACTS = { geom: '"geom"', srid: 4326, columns: [{ name: 'v', type: 'DOUBLE' }] }
const binSql = (over: Partial<BinSpec> & Pick<BinSpec, 'system' | 'resolution'>, srid: number | null = 4326): string => {
  const q = binQuerySql({ measure: { kind: 'count' }, ...over }, { ...FACTS, srid })
  expect(q, JSON.stringify(over)).not.toBeNull()
  return q!.sql.replace('FROM layer', 'FROM shapes')
}
const BOX = 'POLYGON((8.0 47.0, 8.4 47.0, 8.4 47.3, 8.0 47.3, 8.0 47.0))'
const LINE = 'LINESTRING(8.0 47.0, 8.4 47.3)'
/** SQL for the text id of the cell at longitude `x`, latitude `y`. */
const idAt = (system: 'h3' | 'a5', x: string, y: string, res: number): string =>
  system === 'h3' ? `h3_h3_to_string(h3_latlng_to_cell(${y}, ${x}, ${res}))` : `a5_u64_to_hex(a5_lonlat_to_cell(${x}, ${y}, ${res}))`

test.describe('covering (spec 021)', () => {
  test('a polygon is in every cell it touches, for H3 and A5, and the cells together cover it', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(`CREATE OR REPLACE TEMP TABLE shapes AS SELECT ST_GeomFromText('${BOX}') AS geom, 1.0 AS v`)
    for (const spec of [
      { system: 'h3', resolution: 7 },
      { system: 'a5', resolution: 11 },
    ] as const) {
      await run(`CREATE OR REPLACE TEMP TABLE centre AS ${binSql(spec)}`)
      await run(`CREATE OR REPLACE TEMP TABLE covered AS ${binSql({ ...spec, assign: 'cover' })}`)
      const [c] = await run(`SELECT count(*) AS cells FROM centre`)
      expect(num(c.cells), `${spec.system} centre`).toBe(1)
      const [r] = await run(
        `SELECT count(*) AS cells, count(*) FILTER (WHERE NOT ST_Intersects(geom, ST_GeomFromText('${BOX}'))) AS outside, min(n) AS lo, max(n) AS hi FROM covered`
      )
      expect(num(r.cells), `${spec.system} cover cells`).toBeGreaterThan(8)
      expect(num(r.outside), `${spec.system} cells that miss the polygon`).toBe(0)
      expect(num(r.lo)).toBe(1)
      expect(num(r.hi)).toBe(1)
      // Every point of a fine grid inside the polygon lies in one of the cells (the drawn cells are approximations, so this
      // asks the system itself which cell a point is in).
      const [m] = await run(
        `SELECT count(*) AS pts, count(*) FILTER (WHERE cell_id NOT IN (SELECT cell_id FROM covered)) AS missed
         FROM (SELECT ${idAt(spec.system, 'x', 'y', spec.resolution)} AS cell_id FROM (SELECT 8.0 + i * 0.4 / 60 AS x, 47.0 + j * 0.3 / 45 AS y FROM range(61) a(i), range(46) b(j)))`
      )
      expect(num(m.pts)).toBe(61 * 46)
      expect(num(m.missed), `${spec.system} points of the polygon in no cell`).toBe(0)
    }
  })

  test('a polygon smaller than a cell still gets one, and a cell two polygons touch counts both', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(
      `CREATE OR REPLACE TEMP TABLE shapes AS
       SELECT ST_GeomFromText('POLYGON((8.0 47.0, 8.001 47.0, 8.001 47.001, 8.0 47.001, 8.0 47.0))') AS geom, 1.0 AS v
       UNION ALL SELECT ST_GeomFromText('POLYGON((8.0005 47.0005, 8.0015 47.0005, 8.0015 47.0015, 8.0005 47.0015, 8.0005 47.0005))'), 2.0`
    )
    for (const spec of [
      { system: 'h3', resolution: 6 },
      { system: 'a5', resolution: 8 },
    ] as const) {
      await run(`CREATE OR REPLACE TEMP TABLE covered AS ${binSql({ ...spec, assign: 'cover', measure: { kind: 'sum', column: 'v' } })}`)
      const rows = await run(`SELECT n, value FROM covered ORDER BY n DESC`)
      expect(rows.length, spec.system).toBeGreaterThanOrEqual(1)
      expect(num(rows[0].n), `${spec.system} both polygons are in the first cell`).toBe(2)
      expect(num(rows[0].value), `${spec.system} their values add`).toBe(3)
    }
  })

  test('a line is in the cells along it, with no gap, and multi-part shapes are covered part by part', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(
      `CREATE OR REPLACE TEMP TABLE shapes AS
       SELECT ST_GeomFromText('${LINE}') AS geom, 1.0 AS v
       UNION ALL SELECT ST_GeomFromText('MULTIPOLYGON(((9.0 47.0, 9.1 47.0, 9.1 47.1, 9.0 47.1, 9.0 47.0)),((10.0 47.0, 10.1 47.0, 10.1 47.1, 10.0 47.1, 10.0 47.0)))'), 1.0`
    )
    for (const spec of [
      { system: 'h3', resolution: 7 },
      { system: 'a5', resolution: 9 },
    ] as const) {
      await run(`CREATE OR REPLACE TEMP TABLE covered AS ${binSql({ ...spec, assign: 'cover' })}`)
      const [line] = await run(`SELECT count(*) AS cells FROM covered WHERE ST_Intersects(geom, ST_GeomFromText('${LINE}'))`)
      expect(num(line.cells), `${spec.system} line cells`).toBeGreaterThan(5)
      // Points taken along the line, far closer together than the cells' own sampling: none is in a cell the cover left out.
      const [m] = await run(
        `SELECT count(*) AS pts, count(*) FILTER (WHERE cell_id NOT IN (SELECT cell_id FROM covered)) AS missed
         FROM (SELECT ${idAt(spec.system, 'x', 'y', spec.resolution)} AS cell_id FROM (SELECT 8.0 + i * 0.4 / 800 AS x, 47.0 + i * 0.3 / 800 AS y FROM range(801) t(i)))`
      )
      expect(num(m.pts)).toBe(801)
      expect(num(m.missed), `${spec.system} points of the line in no cell`).toBe(0)
      for (const [x0, x1] of [
        [9.0, 9.1],
        [10.0, 10.1],
      ]) {
        const [part] = await run(`SELECT count(*) AS cells FROM covered WHERE ST_Intersects(geom, ST_MakeEnvelope(${x0}, 47.0, ${x1}, 47.1))`)
        expect(num(part.cells), `${spec.system} part at ${x0}`).toBeGreaterThan(0)
      }
    }
  })

  test('the skipped-rows count follows covering: a shape outside the world is skipped', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(
      `CREATE OR REPLACE TEMP TABLE shapes AS SELECT ST_GeomFromText('${BOX}') AS geom UNION ALL SELECT NULL UNION ALL SELECT ST_GeomFromText('POLYGON EMPTY') UNION ALL SELECT ST_GeomFromText('POLYGON((179 0, 181 0, 181 1, 179 1, 179 0))')`
    )
    const sql = binSkippedSql({ system: 'h3', resolution: 5, measure: { kind: 'count' }, assign: 'cover' }, FACTS)!.replace('FROM layer', 'FROM shapes')
    const [r] = await run(sql)
    expect(num(r.skipped)).toBe(3)
  })
})

test.describe('smoothing (spec 021)', () => {
  /** Two neighboring cells A (3 points, values 10) and B (2 points, values 20), as points at their centers. */
  async function twoCells(run: (sql: string) => Promise<Row[]>, system: 'h3' | 'a5'): Promise<void> {
    const centre = (cell: string) => (system === 'h3' ? `ST_Point(h3_cell_to_lng(${cell}), h3_cell_to_lat(${cell}))` : `ST_Centroid(a5_cell_to_geometry(${cell}))`)
    const A = system === 'h3' ? 'h3_latlng_to_cell(47.0, 8.0, 6)' : 'a5_lonlat_to_cell(8.0, 47.0, 8)'
    const B = system === 'h3' ? `h3_grid_ring(${A}, 1)[1]` : `list_filter(a5_grid_disk(${A}, 1), c -> c != ${A})[1]`
    await run(
      `CREATE OR REPLACE TEMP TABLE shapes AS
       SELECT ${centre(A)} AS geom, 10.0 AS v FROM range(3) UNION ALL SELECT ${centre(B)}, 20.0 FROM range(2)`
    )
  }

  test('A5 is not smoothed: its neighbor function is incomplete, so the query is refused', async () => {
    expect(binQuerySql({ system: 'a5', resolution: 8, measure: { kind: 'count' }, smooth: 1 }, FACTS)).toBeNull()
    expect(binQuerySql({ system: 'a5', resolution: 8, measure: { kind: 'count' } }, FACTS)).not.toBeNull()
  })

  for (const spec of [{ system: 'h3', resolution: 6 }] as const) {
    test(`${spec.system}: every cell takes in its neighbors, and the cells spread past the data`, async ({ page }) => {
      test.setTimeout(120000)
      const run = await openEngine(page)
      await twoCells(run, spec.system)
      await run(`CREATE OR REPLACE TEMP TABLE plain AS ${binSql({ ...spec, measure: { kind: 'avg', column: 'v' } })}`)
      expect(num((await run(`SELECT count(*) AS c FROM plain`))[0].c)).toBe(2)
      for (const [kind, expected] of [
        ['count', 5],
        ['sum', 70],
        ['avg', 14],
        ['min', 10],
        ['max', 20],
      ] as const) {
        const measure = kind === 'count' ? ({ kind } as const) : ({ kind, column: 'v' } as const)
        await run(`CREATE OR REPLACE TEMP TABLE smoothed AS ${binSql({ ...spec, measure, smooth: 1 })}`)
        // The two data cells see each other: both read the same neighborhood of all five points.
        const both = await run(`SELECT value FROM smoothed WHERE n = 5 ORDER BY cell_id`)
        expect(both.length, `${spec.system} ${kind}: cells whose neighborhood holds all five`).toBeGreaterThanOrEqual(2)
        for (const r of both) expect(num(r.value), `${spec.system} ${kind}`).toBeCloseTo(expected, 9)
        const [all] = await run(`SELECT count(*) AS cells, count(DISTINCT cell_id) AS ids, count(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid FROM smoothed`)
        expect(num(all.cells), `${spec.system} ${kind}: spread past the two cells`).toBeGreaterThan(2)
        expect(num(all.ids)).toBe(num(all.cells))
        expect(num(all.invalid)).toBe(0)
      }
    })
  }

  test('more rings reach further: the cell count grows with the disk', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(`CREATE OR REPLACE TEMP TABLE shapes AS SELECT ST_Point(8.0, 47.0) AS geom FROM range(4)`)
    const cells: number[] = []
    for (const smooth of [0, 1, 2, 3]) {
      await run(`CREATE OR REPLACE TEMP TABLE b AS ${binSql({ system: 'h3', resolution: 7, smooth })}`)
      const [r] = await run(`SELECT count(*) AS c, max(value) AS top, min(value) AS low FROM b`)
      cells.push(num(r.c))
      expect(num(r.top)).toBe(4) // one data cell: every cell of its neighborhood sees all four
      expect(num(r.low)).toBe(4)
    }
    expect(cells).toEqual([1, 7, 19, 37])
  })

  test('covering and smoothing are not combined, and a median is not smoothed', async () => {
    const spec = { system: 'h3', resolution: 7, measure: { kind: 'count' } } as const
    expect(binQuerySql({ ...spec, assign: 'cover', smooth: 1 }, FACTS)).toBeNull()
    expect(binQuerySql({ ...spec, measure: { kind: 'median', column: 'v' }, smooth: 1 }, FACTS)).toBeNull()
    expect(binQuerySql({ ...spec, assign: 'cover' }, FACTS)).not.toBeNull()
    expect(binQuerySql({ ...spec, smooth: 2 }, FACTS)).not.toBeNull()
  })
})

// The dialog: the choices write the query, and the preview draws it.
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Bin into cells' })
const rendered = async (page: Page): Promise<number> => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))
/** The query text: a result shows the Table tab, so the SQL tab is opened first. */
const sqlText = async (page: Page): Promise<string> => {
  await page.getByRole('tab', { name: 'SQL' }).click()
  return editor(page).innerText()
}

test.describe('the dialog (spec 021)', () => {
  test('a point layer is offered no choice of how features are placed; a polygon layer is', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByRole('radio', { name: 'Every cell touched' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await openFile(page, writeParcels(300, 'parcels-cover.geojson'))
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    await expect(dialog(page).getByRole('radio', { name: 'Center' })).toHaveAttribute('data-state', 'on')
    await expect(dialog(page).getByRole('radio', { name: 'Every cell touched' })).toBeVisible()
  })

  test('"Every cell touched" writes the cover query and draws more cells than the centers give', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(300, 'parcels-cover.geojson'))
    await openQueryPanel(page)
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    // A fine size, where a parcel is bigger than a cell: the centers and the covers differ.
    await dialog(page).getByRole('switch', { name: 'All resolutions' }).click()
    await dialog(page).getByRole('slider', { name: 'Resolution', exact: true }).fill('10')
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBeGreaterThan(0)
    const centres = await rendered(page)
    await dialog(page).getByRole('radio', { name: 'Every cell touched' }).click()
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBeGreaterThan(centres)
    await expect.poll(() => sqlText(page), { timeout: 30000 }).toContain('h3_polygon_wkt_to_cells_experimental')
    await expect(dialog(page).getByText('counts once in every cell it touches')).toBeVisible()
    // A5 takes it too.
    await dialog(page).getByRole('radio', { name: 'A5' }).click()
    await expect.poll(() => sqlText(page), { timeout: 30000 }).toContain('ST_Boundary')
  })

  test('smoothing is a switch and a number of rings: any whole number up to 10, with arrows; H3 only, and not for a median', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await openQueryPanel(page)
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    const smooth = dialog(page).getByRole('switch', { name: 'Smooth with neighbors' })
    const rings = dialog(page).getByRole('spinbutton', { name: 'Rings of neighbors' })
    await expect(smooth).toBeVisible()
    await expect(rings).toHaveCount(0)
    // On: one ring to start; the legend says so, and the query holds the disk.
    await smooth.click()
    await expect(rings).toHaveValue('1')
    await expect.poll(() => sqlText(page), { timeout: 30000 }).toContain('h3_grid_disk(cell, 1)')
    await expect(page.getByText('with neighbors within 1 ring').first()).toBeVisible({ timeout: 30000 })
    // The arrow keys step the number, and any whole number up to 10 is allowed (not only 1 to 3).
    await rings.focus()
    await page.keyboard.press('ArrowUp')
    await expect(rings).toHaveValue('2')
    await expect.poll(() => sqlText(page), { timeout: 30000 }).toContain('h3_grid_disk(cell, 2)')
    await rings.fill('4')
    await rings.press('Enter')
    await expect.poll(() => sqlText(page), { timeout: 30000 }).toContain('h3_grid_disk(cell, 4)')
    // The themed buttons step it too, and a number out of range or text is put right.
    await dialog(page).getByRole('button', { name: 'Increase Rings of neighbors' }).click()
    await expect(rings).toHaveValue('5')
    await dialog(page).getByRole('button', { name: 'Decrease Rings of neighbors' }).click()
    await expect(rings).toHaveValue('4')
    await rings.fill('999')
    await rings.press('Enter')
    await expect(rings).toHaveValue('10')
    await rings.fill('abc')
    await rings.press('Tab')
    await expect(rings).toHaveValue('10')
    await rings.fill('4')
    await rings.press('Enter')
    await expect(rings).toHaveValue('4')
    // Past 5 rings a warning says what it costs; at 5 and under there is none.
    const warning = dialog(page).getByText(/rings makes each cell a disk of/)
    await expect(warning).toHaveCount(0)
    await rings.fill('5')
    await rings.press('Enter')
    await expect(warning).toHaveCount(0)
    await rings.fill('6')
    await rings.press('Enter')
    await expect(warning).toContainText('6 rings makes each cell a disk of 127 cells')
    await rings.fill('3')
    await rings.press('Enter')
    await expect(warning).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('rings.png') })
    // Off: the disk goes, and the number is remembered for the next time it is switched on.
    await smooth.click()
    await expect(rings).toHaveCount(0)
    await expect.poll(() => sqlText(page), { timeout: 30000 }).not.toContain('grid_disk')
    await smooth.click()
    await expect(rings).toHaveValue('3')
    // A5 has no smoothing; switching clears it.
    await dialog(page).getByRole('radio', { name: 'A5' }).click()
    await expect(dialog(page).getByRole('switch', { name: 'Smooth with neighbors' })).toHaveCount(0)
    await expect.poll(() => sqlText(page), { timeout: 30000 }).not.toContain('grid_disk')
    await dialog(page).getByRole('radio', { name: 'H3' }).click()
    // A median cannot be smoothed: choosing it clears the smoothing and disables the switch.
    await choose(page, dialog(page).getByRole('button', { name: 'What each cell shows' }), 'Median of a column')
    await expect(dialog(page).getByRole('switch', { name: 'Smooth with neighbors' })).toBeDisabled()
    await expect.poll(() => sqlText(page), { timeout: 30000 }).not.toContain('grid_disk')
  })
})
