// Spec 022: dot density, in the real engine. The SQL is the app's own (dots/dotSql.ts) over temp tables instead of `layer`,
// then the dialog: the choices write the query, the preview draws the dots, Esc puts everything back.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { dotQuerySql, type DotSpec } from '../../../packages/core/src/dots/dotSql'
import { editor, fixture, openFile } from './helpers'

type Row = Record<string, unknown>
const num = (v: unknown): number => Number(v)

// Four squares a tenth of a degree wide; the last one has nothing to draw.
const SQUARES: Array<{ name: string; pop: number; farms: number; x: number }> = [
  { name: 'north', pop: 1000, farms: 40, x: 8.0 },
  { name: 'east', pop: 2500, farms: 10, x: 8.2 },
  { name: 'south', pop: 400, farms: 90, x: 8.4 },
  { name: 'empty', pop: 0, farms: 0, x: 8.6 },
]
const ring = (x: number): number[][] => [[x, 47.0], [x + 0.1, 47.0], [x + 0.1, 47.1], [x, 47.1], [x, 47.0]]
function writePolygons(): string {
  const features = SQUARES.map((s) => ({ type: 'Feature', properties: { pop: s.pop, farms: s.farms, name: s.name }, geometry: { type: 'Polygon', coordinates: [ring(s.x)] } }))
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-dots-')), 'districts.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  return file
}

const FACTS = { geom: '"geom"', srid: 4326, columns: [{ name: 'pop', type: 'BIGINT' }, { name: 'farms', type: 'BIGINT' }] }
const dotSql = (spec: DotSpec, srid: number | null = 4326): string => {
  const q = dotQuerySql(spec, { ...FACTS, srid })
  expect(q, JSON.stringify(spec)).not.toBeNull()
  return q!.sql.replace('FROM layer', 'FROM shapes')
}

async function openEngine(page: Page): Promise<(sql: string) => Promise<Row[]>> {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  const run = (sql: string) => page.evaluate((q) => (window as unknown as { __spatialExplorerE2E: { runRaw: (s: string) => Promise<Row[]> } }).__spatialExplorerE2E.runRaw(q), sql)
  const wkt = (x: number): string => `ST_GeomFromText('POLYGON((${ring(x).map((p) => p.join(' ')).join(', ')}))')`
  await run(`CREATE OR REPLACE TEMP TABLE shapes AS ${SQUARES.map((q) => `SELECT ${wkt(q.x)} AS geom, ${q.pop}::BIGINT AS pop, ${q.farms}::BIGINT AS farms`).join(' UNION ALL ')}`)
  return run
}

test.describe('the query (spec 022)', () => {
  test('puts exactly value / amount dots in each polygon, inside it, in the right category', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(`CREATE OR REPLACE TEMP TABLE dots AS ${dotSql({ columns: ['pop'], perDot: 100 })}`)
    const rows = await run(`SELECT feature::DOUBLE AS feature, count(*)::DOUBLE AS n FROM dots GROUP BY feature ORDER BY feature`)
    expect(rows.map((r) => [num(r.feature), num(r.n)])).toEqual([[1, 10], [2, 25], [3, 4]])
    const [c] = await run(`SELECT count(*)::DOUBLE AS n, count(DISTINCT category)::DOUBLE AS categories, min(one_dot)::DOUBLE AS per FROM dots`)
    expect(num(c.n)).toBe(39)
    expect(num(c.categories)).toBe(1)
    expect(num(c.per)).toBe(100)
    // Every dot is inside the polygon of its feature (feature n is the n-th square).
    const [inside] = await run(
      `SELECT count(*)::DOUBLE AS bad FROM dots d JOIN (SELECT row_number() OVER () AS feature, geom FROM shapes) s USING (feature) WHERE NOT ST_Within(d.geom, s.geom)`
    )
    expect(num(inside.bad)).toBe(0)
  })

  test('the same layer gives the same dots, and a polygon with nothing gets none', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    const sql = dotSql({ columns: ['pop'], perDot: 7 })
    const a = await run(`SELECT sum(ST_X(geom) * 1000 + ST_Y(geom))::DOUBLE AS s, count(*)::DOUBLE AS n FROM (${sql})`)
    const b = await run(`SELECT sum(ST_X(geom) * 1000 + ST_Y(geom))::DOUBLE AS s, count(*)::DOUBLE AS n FROM (${sql})`)
    expect(a).toEqual(b)
    const [none] = await run(`SELECT count(*)::DOUBLE AS n FROM (${sql}) WHERE feature = 4`)
    expect(num(none.n)).toBe(0)
  })

  test('a remainder is a dot with that chance: each polygon is within one dot of its share, and the total is about right', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    await run(`CREATE OR REPLACE TEMP TABLE dots AS ${dotSql({ columns: ['pop'], perDot: 300 })}`)
    const rows = await run(`SELECT feature::DOUBLE AS feature, count(*)::DOUBLE AS n FROM dots GROUP BY feature ORDER BY feature`)
    const want = [1000 / 300, 2500 / 300, 400 / 300]
    rows.forEach((r, i) => {
      expect(num(r.n)).toBeGreaterThanOrEqual(Math.floor(want[i]!))
      expect(num(r.n)).toBeLessThanOrEqual(Math.ceil(want[i]!))
    })
    // Thousands of small polygons: the total stays near the sum, not rounded away.
    await run(
      `CREATE OR REPLACE TEMP TABLE shapes AS SELECT ST_MakeEnvelope(8 + (i % 100) * 0.01, 47 + (i // 100) * 0.01, 8.0099 + (i % 100) * 0.01, 47.0099 + (i // 100) * 0.01) AS geom, 3::BIGINT AS pop, 0::BIGINT AS farms FROM range(2000) t(i)`
    )
    const [t] = await run(`SELECT count(*)::DOUBLE AS n FROM (${dotSql({ columns: ['pop'], perDot: 10 })})`)
    expect(num(t.n)).toBeGreaterThan(600 * 0.85)
    expect(num(t.n)).toBeLessThan(600 * 1.15)
  })

  test('each column is its own category, and a projected layer gives dots in longitude and latitude', async ({ page }) => {
    test.setTimeout(120000)
    const run = await openEngine(page)
    const rows = await run(`SELECT category, count(*)::DOUBLE AS n FROM (${dotSql({ columns: ['pop', 'farms'], perDot: 10 })}) GROUP BY category ORDER BY category`)
    expect(rows.map((r) => [r.category, num(r.n)])).toEqual([['farms', 14], ['pop', 390]])
    // The same squares in UTM zone 32N metres.
    await run(
      `CREATE OR REPLACE TEMP TABLE shapes AS SELECT ST_Transform(geom, 'EPSG:4326', 'EPSG:32632', always_xy := true) AS geom, pop, farms FROM (SELECT ST_GeomFromText('POLYGON((8.0 47.0, 8.1 47.0, 8.1 47.1, 8.0 47.1, 8.0 47.0))') AS geom, 1000::BIGINT AS pop, 0::BIGINT AS farms)`
    )
    const [p] = await run(
      `SELECT count(*)::DOUBLE AS n, min(ST_X(geom))::DOUBLE AS x0, max(ST_X(geom))::DOUBLE AS x1, min(ST_Y(geom))::DOUBLE AS y0, max(ST_Y(geom))::DOUBLE AS y1 FROM (${dotSql({ columns: ['pop'], perDot: 10 }, 32632)})`
    )
    expect(num(p.n)).toBe(100)
    expect(num(p.x0)).toBeGreaterThanOrEqual(7.99)
    expect(num(p.x1)).toBeLessThanOrEqual(8.11)
    expect(num(p.y0)).toBeGreaterThanOrEqual(46.99)
    expect(num(p.y1)).toBeLessThanOrEqual(47.11)
  })
})

// The dialog.
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Dot density' })
const rendered = async (page: Page): Promise<number> => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))
const sqlText = async (page: Page): Promise<string> => {
  await page.getByRole('tab', { name: 'SQL' }).click()
  return editor(page).innerText()
}
const openDistricts = async (page: Page): Promise<void> => {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, writePolygons(), '?e2e=1')
  await page.getByRole('button', { name: 'Zoom to layer' }).click()
}

test.describe('the dialog (spec 022)', () => {
  test('is offered for polygons only, and the choices draw the dots', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, fixture('crashes.geojson'))
    await expect(page.getByRole('button', { name: 'Dot density…' })).toBeDisabled()
    await openDistricts(page)
    await page.getByRole('button', { name: 'Dot density…' }).click()
    await expect(dialog(page)).toBeVisible()
    // The first number column, an amount that gives about 5,000 dots at most (3,500 people: one each), drawn at once.
    await expect(dialog(page).getByRole('checkbox', { name: 'pop' })).toBeChecked()
    await expect(dialog(page).getByText('About 3,900 dots')).toBeVisible()
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBe(3900)
    await expect.poll(() => sqlText(page), { timeout: 30000 }).toContain('ST_Within(ST_Point(x, y), g)')
    await dialog(page).getByRole('button', { name: 'Keep' }).click()
    await expect(dialog(page)).toHaveCount(0)
    expect(await rendered(page)).toBe(3900)
  })

  test('one dot can stand for more, and a second column draws a second color with a legend', async ({ page }) => {
    test.setTimeout(120000)
    await openDistricts(page)
    await page.getByRole('button', { name: 'Dot density…' }).click()
    await dialog(page).getByRole('button', { name: 'Amount one dot stands for' }).click()
    await page.getByRole('option', { name: '100', exact: true }).click()
    await expect(dialog(page).getByText('About 39 dots')).toBeVisible()
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBe(39)
    await dialog(page).getByRole('checkbox', { name: 'farms' }).check()
    // The amount is chosen again for the new total (4,040): one each.
    await expect(dialog(page).getByText('About 4,040 dots')).toBeVisible()
    await dialog(page).getByRole('button', { name: 'Amount one dot stands for' }).click()
    await page.getByRole('option', { name: '10', exact: true }).click()
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBe(404)
    await expect.poll(() => sqlText(page), { timeout: 30000 }).toContain("'farms' AS category")
    await dialog(page).getByRole('button', { name: 'Keep' }).click()
    await expect(page.getByText('One dot = 10').first()).toBeVisible()
  })

  test('Esc brings the old query and the old map back', async ({ page }) => {
    test.setTimeout(120000)
    await openDistricts(page)
    // A polygon is drawn as several map features (fill and outline), so the count before is the one to come back to.
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBeGreaterThan(0)
    const before = await rendered(page)
    await page.getByRole('button', { name: 'Dot density…' }).click()
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBe(3900)
    await dialog(page).getByRole('checkbox', { name: 'pop' }).focus()
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => rendered(page), { timeout: 30000 }).toBe(before)
    expect(await sqlText(page)).not.toContain('ST_Within')
  })

  test('has no accessibility violations', async ({ page }) => {
    test.setTimeout(120000)
    await openDistricts(page)
    await page.getByRole('button', { name: 'Dot density…' }).click()
    await expect(dialog(page)).toBeVisible()
    const results = await new AxeBuilder({ page }).include('[role="dialog"][aria-label="Dot density"]').analyze()
    expect(results.violations).toEqual([])
  })
})
