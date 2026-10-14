// Spec 010 phase 11: rule-based styling and graduated by SQL expression, in
// GeoJSON mode and in tiles mode. The engine computes each feature's rule (or
// value); the legend's counts are checked against a first-match query of our
// own, and the map against what it drew.
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { openFile, openStyle, chooseStyleType } from './helpers'

const CONTINENTS = ['Africa', 'Asia', 'Europe', 'Americas', 'Oceania']

/** 80 squares like countries: a continent, a population and a GDP (world-boundaries.geojson has only names). */
function writeCountries(): string {
  const features = Array.from({ length: 80 }, (_, i) => {
    const x = -170 + (i % 16) * 20
    const y = -60 + Math.floor(i / 16) * 25
    const pop = 1_000_000 * (((i * 37) % 300) + 1)
    const gdp = 1000 * (((i * 53) % 900) + 10)
    const props = { name: `Country ${i}`, continent: CONTINENTS[i % CONTINENTS.length], pop_est: pop, gdp_md: gdp }
    return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 15, y], [x + 15, y + 20], [x, y + 20], [x, y]]] } }
  })
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-rules-')), 'countries.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  return file
}

const raw = (page: Page, sql: string): Promise<Array<Record<string, unknown>>> =>
  page.evaluate(
    (s) =>
      (window as unknown as { __spatialExplorerE2E: { runRaw: (sql: string) => Promise<Array<Record<string, unknown>>> } }).__spatialExplorerE2E
        .runRaw(s)
        .then((rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])))),
    sql
  )

/** The features the map drew (unique by id), with their properties. */
async function drawn(page: Page): Promise<Map<unknown, Record<string, unknown>>> {
  const list = await page.locator('.canvas-host').evaluate((el) => (el as HTMLElement & { seRendered?: () => Array<{ id: unknown; properties: Record<string, unknown> }> }).seRendered?.() ?? [])
  return new Map(list.map((f) => [f.id, f.properties]))
}

const legend = (page: Page) => page.getByRole('region', { name: 'Legend' })
/** A legend row: its label, then its count. */
const row = (label: string, count: number): RegExp => new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${count.toLocaleString('en-US')}\\s*$`)
const condition = (page: Page, n: number) => page.getByRole('textbox', { name: new RegExp(`^Condition of (rule ${n}|.+)$`) }).nth(n - 1)

for (const mode of ['GeoJSON', 'tiles'] as const) {
  test.describe(`${mode} mode`, () => {
    const search = mode === 'tiles' ? '?e2e=1&tileRows=10' : '?e2e=1'

    test('two rules: counts by first match in the legend, the map drawn by rule; an invalid rule says why without breaking the map', async ({ page }) => {
      test.setTimeout(90000)
      await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
      await openFile(page, writeCountries(), search)
      await openStyle(page)
      await chooseStyleType(page, 'Rules')
      // Two example rules from the data arrive first.
      await expect(page.getByRole('list', { name: 'Rules' }).locator('li')).toHaveCount(2)

      await condition(page, 1).fill("continent = 'Africa'")
      await condition(page, 1).press('Enter')
      await condition(page, 2).fill('pop_est > 100000000')
      await condition(page, 2).press('Enter')

      const expected = await raw(page, "SELECT CASE WHEN continent = 'Africa' THEN 0 WHEN pop_est > 100000000 THEN 1 ELSE -1 END AS cls, count(*) AS n FROM layer GROUP BY 1")
      const want = (cls: number) => Number(expected.find((r) => Number(r.cls) === cls)?.n ?? 0)
      expect(want(0)).toBeGreaterThan(0)
      expect(want(1)).toBeGreaterThan(0)
      const rows = legend(page).locator('li')
      await expect(rows.nth(0)).toHaveText(row("continent = 'Africa'", want(0)))
      await expect(rows.nth(1)).toHaveText(row('pop_est > 100000000', want(1)))
      await expect(rows.nth(2)).toHaveText(row('Everything else', want(-1)))

      // The map drew every feature with the engine's rule index, matching the counts.
      await expect
        .poll(async () => {
          const byClass = new Map<number, number>()
          for (const p of (await drawn(page)).values()) byClass.set(Number(p.__se_cls), (byClass.get(Number(p.__se_cls)) ?? 0) + 1)
          return [byClass.get(0) ?? 0, byClass.get(1) ?? 0, byClass.get(-1) ?? 0]
        }, { timeout: 20000 })
        .toEqual([want(0), want(1), want(-1)])

      // An invalid rule: its error under the field, it matches nothing, the rest still draws.
      await condition(page, 2).fill('nope > 1')
      await condition(page, 2).press('Enter')
      // In plain words, with the closest columns (not the engine's "FROM clause! Candidate bindings").
      await expect(page.getByRole('list', { name: 'Rules' }).getByRole('alert')).toHaveText(/^No column "nope" in this layer\. Closest: .*pop_est/)
      await expect(rows.nth(0)).toHaveText(row("continent = 'Africa'", want(0)))
      await expect(rows.nth(2)).toHaveText(row('Everything else', 80 - want(0)))
      await expect.poll(async () => (await drawn(page)).size, { timeout: 20000 }).toBe(80)
    })

    test('graduated by expression: gdp_md * 1e6 / pop_est makes classes, and the map draws its values', async ({ page }) => {
      test.setTimeout(90000)
      await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
      await openFile(page, writeCountries(), search)
      await openStyle(page)
      await chooseStyleType(page, 'Graduated')
      await page.getByRole('combobox', { name: 'Column' }).selectOption({ label: 'Expression…' })
      const input = page.getByRole('textbox', { name: 'Expression' })
      await expect(page.getByText("A SQL expression over this layer's columns, e.g. gdp_md * 1e6 / pop_est")).toBeVisible()
      await input.fill('gdp_md * 1e6 / pop_est')
      await input.press('Enter')

      await expect(legend(page)).toContainText('gdp_md * 1e6 / pop_est · Quantile, 5 classes')
      const [range] = await raw(page, 'SELECT min(gdp_md * 1e6 / pop_est) AS lo, max(gdp_md * 1e6 / pop_est) AS hi FROM layer')
      await expect
        .poll(async () => {
          const values = [...(await drawn(page)).values()].map((p) => Number(p.__se_val)).filter(Number.isFinite)
          return values.length ? [values.length, Math.min(...values), Math.max(...values)] : null
        }, { timeout: 20000 })
        .toEqual([80, Number(range.lo), Number(range.hi)])

      // A bad expression falls back to the single symbol, with the reason.
      await input.fill('nope * 2')
      await input.press('Enter')
      await expect(page.getByRole('region', { name: 'Layer style' })).toContainText('nope')
      await expect(page.getByRole('region', { name: 'Layer style' })).toContainText('Showing the single symbol.')
    })
  })
}
