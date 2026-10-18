// Spec 023: the snippet library, in the real engine. Every snippet that fits a layer is run as written (its fields at their
// defaults) against a polygon, a line and a point layer; then the popover: search, choose, edit a field, run.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { SNIPPETS, plainSql, snippetContextFor, snippetTemplate, snippetsFor, type SnippetContext } from '../../../packages/core/src/snippets/snippets'
import { editor, fixture, openFile, runQuery, showSql, status } from './helpers'

type Row = Record<string, unknown>
const num = (v: unknown): number => Number(v)
const runner = (page: Page) => (sql: string) =>
  page.evaluate((q) => (window as unknown as { __spatialExplorerE2E: { runRaw: (s: string) => Promise<Row[]> } }).__spatialExplorerE2E.runRaw(q), sql)

async function layerContext(page: Page, geometryType: 'Point' | 'LineString' | 'Polygon'): Promise<{ run: (sql: string) => Promise<Row[]>; ctx: SnippetContext }> {
  const run = runner(page)
  const described = await run('DESCRIBE layer')
  const geom = described.find((r) => String(r.column_type).startsWith('GEOMETRY'))
  expect(geom, 'a geometry column').toBeTruthy()
  const g = `"${String(geom?.column_name)}"`
  const columns = described.filter((r) => r !== geom && !String(r.column_name).startsWith('__se_')).map((r) => ({ name: String(r.column_name), type: String(r.column_type) }))
  const [e] = await run(`SELECT min(ST_XMin(${g}))::DOUBLE AS x0, min(ST_YMin(${g}))::DOUBLE AS y0, max(ST_XMax(${g}))::DOUBLE AS x1, max(ST_YMax(${g}))::DOUBLE AS y1 FROM layer`)
  const ctx = snippetContextFor({
    table: 'layer',
    geom: g,
    srid: 4326,
    geometryType,
    extent: [num(e?.x0), num(e?.y0), num(e?.x1), num(e?.y1)],
    columns,
    files: ['data/other.geojson'],
  })
  return { run, ctx }
}

// A path in a snippet stands for another file of the workspace; here it is the layer itself.
const asRun = (sql: string): string => sql.replace(/ST_Read\('[^']*'\)/g, 'layer')

const LAYERS = [
  { file: 'counties-011.geojson', type: 'Polygon' },
  { file: 'roads-los.geojson', type: 'LineString' },
  { file: 'crashes.geojson', type: 'Point' },
] as const

/** The snippets that return one row per feature (so the count must match the layer's). */
const PER_FEATURE = new Set(['buffer', 'centroids', 'bounding-boxes', 'convex-hull', 'simplify', 'boundaries', 'make-valid', 'area', 'length', 'vertices', 'lon-lat', 'density'])

test.describe('every snippet runs (spec 023)', () => {
  for (const { file, type } of LAYERS) {
    test(`on a ${type} layer`, async ({ page }) => {
      test.setTimeout(240000)
      await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
      await openFile(page, fixture(file), '?e2e=1')
      const { run, ctx } = await layerContext(page, type)
      const fits = snippetsFor(ctx)
      expect(fits.length, 'snippets offered').toBeGreaterThan(12)
      const [counted] = await run('SELECT count(*)::DOUBLE AS n FROM layer')
      const total = num(counted?.n)
      for (const def of fits) {
        const sql = asRun(plainSql(snippetTemplate(def, ctx)))
        let rows: Row[]
        try {
          rows = await run(sql)
        } catch (e) {
          throw new Error(`${def.id} failed: ${(e as Error).message}\n${sql}`)
        }
        if (PER_FEATURE.has(def.id)) expect(rows.length, `${def.id}: a row for each feature`).toBe(total)
        if (def.id === 'dissolve-all') expect(rows.length).toBe(1)
        if (def.id === 'top-n') expect(rows.length).toBeLessThanOrEqual(10)
        if (def.id === 'sample') expect(rows.length).toBeLessThanOrEqual(1000)
        if (def.id === 'area') expect(num(rows[0]?.area_km2)).toBeGreaterThan(0)
        if (def.id === 'length') expect(num(rows[0]?.length_km)).toBeGreaterThan(0)
        if (def.id === 'distance-from-point') expect(rows.length).toBeLessThanOrEqual(20)
        if (def.id === 'in-box') expect(rows.length, 'a box inside the extent holds some features').toBeGreaterThan(0)
        if (def.id === 'invalid') expect(rows.length).toBeLessThanOrEqual(total)
      }
    })
  }

  test('the numbers: an area in square kilometers, a density, a buffer that grows', async ({ page }) => {
    test.setTimeout(120000)
    await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
    await openFile(page, fixture('sample.geojson'), '?e2e=1')
    const run = runner(page)
    // A tenth of a degree square at 47 degrees north is about 84.5 km².
    await run(`CREATE OR REPLACE TEMP TABLE sq AS SELECT ST_GeomFromText('POLYGON((8.0 47.0, 8.1 47.0, 8.1 47.1, 8.0 47.1, 8.0 47.0))') AS geom, 1000 AS pop`)
    const ctx = snippetContextFor({ table: 'sq', geom: '"geom"', srid: 4326, geometryType: 'Polygon', extent: [8, 47, 8.1, 47.1], columns: [{ name: 'pop', type: 'INTEGER' }], files: [] })
    const sql = (id: string): string => plainSql(snippetTemplate(SNIPPETS.find((s) => s.id === id)!, ctx))
    const [a] = await run(sql('area'))
    expect(num(a?.area_km2)).toBeGreaterThan(84)
    expect(num(a?.area_km2)).toBeLessThan(85)
    const [d] = await run(sql('density'))
    expect(num(d?.per_km2)).toBeCloseTo(1000 / num(a?.area_km2), 6)
    const [b] = await run(`SELECT ST_Area(geom)::DOUBLE AS grown FROM (${sql('buffer')})`)
    expect(num(b?.grown)).toBeGreaterThan(0.01)
    // The same square in Web Mercator meters: the snippet converts to longitude and latitude first, so the area is the same.
    await run(`CREATE OR REPLACE TEMP TABLE sq3857 AS SELECT ST_Transform(geom, 'EPSG:4326', 'EPSG:3857', always_xy := true) AS geom, pop FROM sq`)
    const projected = snippetContextFor({ table: 'sq3857', geom: '"geom"', srid: 3857, geometryType: 'Polygon', extent: [8, 47, 8.1, 47.1], columns: [{ name: 'pop', type: 'INTEGER' }], files: [] })
    const [p] = await run(plainSql(snippetTemplate(SNIPPETS.find((s) => s.id === 'area')!, projected)))
    expect(num(p?.area_km2)).toBeCloseTo(num(a?.area_km2), 3)
  })
})

// The popover and the editor.
const button = (page: Page) => page.getByRole('button', { name: 'Snippet library' })
const library = (page: Page) => page.getByRole('dialog', { name: 'Snippet library' })
const search = (page: Page) => page.getByRole('combobox', { name: 'Search snippets' })

async function openPolygons(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('counties-011.geojson'), '?e2e=1')
  await showSql(page)
}

test.describe('the library (spec 023)', () => {
  test('lists what fits the layer, and the search narrows it', async ({ page }) => {
    test.setTimeout(120000)
    await openPolygons(page)
    await button(page).click()
    await expect(library(page)).toBeVisible()
    await expect(search(page)).toBeFocused()
    await expect(library(page).getByRole('option', { name: /^Area in square kilometers/ })).toBeVisible()
    await expect(library(page).getByRole('option', { name: /^Length in kilometers/ })).toHaveCount(0)
    await search(page).fill('dissolve')
    await expect(library(page).getByRole('option')).toHaveCount(2)
    await search(page).fill('zzzz')
    await expect(library(page).getByText('No snippet matches that.')).toBeVisible()
  })

  test('choosing one fills the editor, its first value is selected, and it runs', async ({ page }) => {
    test.setTimeout(120000)
    await openPolygons(page)
    await button(page).click()
    await search(page).fill('buffer')
    await page.keyboard.press('Enter')
    await expect(library(page)).toHaveCount(0)
    await expect(editor(page)).toContainText('ST_Buffer(')
    await expect(editor(page)).toContainText('0.01')
    // The distance is selected: typing replaces it.
    await page.keyboard.type('0.02')
    await expect(editor(page)).toContainText('ST_Buffer("geom", 0.02)')
    await runQuery(page)
    await expect(status(page)).toContainText('rows')
    await expect(status(page)).not.toContainText('Error')
  })

  test('arrow keys move through the list, Esc closes it and the button has focus again', async ({ page }) => {
    test.setTimeout(120000)
    await openPolygons(page)
    await button(page).click()
    const options = library(page).getByRole('option')
    await expect(options.first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(options.first()).toHaveAttribute('aria-selected', 'false')
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await expect(library(page)).toHaveCount(0)
    await expect(button(page)).toBeFocused()
  })

  test('shows the query of the one under the cursor, and has no accessibility violations', async ({ page }) => {
    test.setTimeout(120000)
    await openPolygons(page)
    await button(page).click()
    await search(page).fill('area in square')
    await expect(library(page).locator('pre')).toContainText('ST_Area_Spheroid')
    const results = await new AxeBuilder({ page }).include('[role="dialog"][aria-label="Snippet library"]').analyze()
    expect(results.violations).toEqual([])
  })

  test('a point layer is not offered polygon snippets', async ({ page }) => {
    test.setTimeout(120000)
    await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
    await openFile(page, fixture('crashes.geojson'), '?e2e=1')
    await showSql(page)
    await button(page).click()
    await expect(library(page).getByRole('option', { name: /^Buffer/ })).toBeVisible()
    await expect(library(page).getByRole('option', { name: /^Area in square kilometers/ })).toHaveCount(0)
  })
})
