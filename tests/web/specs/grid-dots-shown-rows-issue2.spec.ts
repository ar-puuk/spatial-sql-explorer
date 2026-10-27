// Issue 2: "Bin into cells" and "Dot density" used every row of the layer when the table showed a query result. They now read the
// rows on show: the query behind the result (written into the generated SQL as a subquery), narrowed by the column filters on it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { editor, openFile, runQuery, status, writeParcels } from './helpers'

const raw = (page: Page, sql: string) =>
  page.evaluate((q) => (window as unknown as { __spatialExplorerE2E: { runRaw: (s: string) => Promise<Array<Record<string, unknown>>> } }).__spatialExplorerE2E.runRaw(q), sql)

/** The sum of a number the kept query produces (the SQL in the editor, run as it is). */
async function sumOf(page: Page, column: string): Promise<number> {
  await expect(status(page)).not.toContainText(/Running|Fetching/, { timeout: 60000 })
  const sql = (await editor(page).innerText()).trim()
  const [row] = await raw(page, `SELECT sum(${column})::DOUBLE AS t FROM (${sql})`)
  return Number(row.t)
}

test.describe('Bin into cells of a query result (issue 2)', () => {
  const mapBin = (page: Page) => page.getByRole('button', { name: 'Bin into cells…' })
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Bin into cells' })

  test('a query that names the file by its own name (not `layer`) works the same', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(2000), '?e2e=1')
    await runQuery(page, "SELECT * FROM parcels_2000 WHERE zone = 'R1'")
    await mapBin(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(editor(page)).toContainText('FROM parcels_2000')
    expect(await sumOf(page, 'n')).toBe(400)
  })

  test('after a query that keeps some rows, the cells count only those rows', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(2000), '?e2e=1')
    await runQuery(page, "SELECT * FROM layer WHERE zone = 'R1'")
    await mapBin(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(editor(page)).toContainText("WHERE zone = 'R1'")
    expect(await sumOf(page, 'n')).toBe(400)
  })

  test('a column filter on that result narrows the cells further', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(2000), '?e2e=1')
    await runQuery(page, "SELECT * FROM layer WHERE zone IN ('R1', 'R2')")
    await page.getByRole('textbox', { name: 'Filter zone' }).fill('r2')
    await expect(page.locator('.drawer-header > .count')).toHaveText('400 of 800 rows')
    await mapBin(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    expect(await sumOf(page, 'n')).toBe(400)
  })

  test('opening the dialog again after a bin bins the same rows, not the cells', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(2000), '?e2e=1')
    await runQuery(page, "SELECT * FROM layer WHERE zone = 'R1'")
    await mapBin(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await mapBin(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    await expect(editor(page)).toContainText("WHERE zone = 'R1'")
    expect(await sumOf(page, 'n')).toBe(400)
  })

  test('with the layer itself shown, the cells count every row', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(2000), '?e2e=1')
    await mapBin(page).click()
    await dialog(page).getByRole('button', { name: 'Keep', exact: true }).click()
    expect(await sumOf(page, 'n')).toBe(2000)
  })

  test('a result with no geometry cannot be put in cells', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writeParcels(200), '?e2e=1')
    await runQuery(page, 'SELECT zone, count(*) AS n FROM layer GROUP BY zone')
    await expect(mapBin(page)).toBeDisabled()
  })
})

test.describe('Dot density of a query result (issue 2)', () => {
  const SQUARES = [
    { name: 'north', pop: 1000, x: 8.0 },
    { name: 'east', pop: 2500, x: 8.2 },
    { name: 'south', pop: 400, x: 8.4 },
  ]
  const ring = (x: number): number[][] => [[x, 47.0], [x + 0.1, 47.0], [x + 0.1, 47.1], [x, 47.1], [x, 47.0]]
  function writePolygons(): string {
    const features = SQUARES.map((s) => ({ type: 'Feature', properties: { pop: s.pop, name: s.name }, geometry: { type: 'Polygon', coordinates: [ring(s.x)] } }))
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-dots2-')), 'districts.geojson')
    fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
    return file
  }
  const dots = (page: Page) => page.getByRole('button', { name: 'Dot density…' })
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Dot density' })

  test('after a query that drops a district, the dots add up to the districts left', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writePolygons(), '?e2e=1')
    await runQuery(page, "SELECT * FROM layer WHERE name <> 'east'")
    await dots(page).click()
    await dialog(page).getByRole('button', { name: 'Keep' }).click()
    await expect(editor(page)).toContainText("WHERE name <> 'east'")
    // 1,000 and 400 people, one dot each (the amount per dot is chosen from the rows on show).
    const sql = (await editor(page).innerText()).trim()
    const [row] = await raw(page, `SELECT count(*)::DOUBLE AS n FROM (${sql})`)
    expect(Number(row.n)).toBe(1400)
  })

  test('changing the amount after the preview keeps the column: the dialog still reads the query, not its own dots', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writePolygons(), '?e2e=1')
    await runQuery(page, "SELECT * FROM layer WHERE name <> 'east'")
    await dots(page).click()
    await expect(dialog(page).getByText('About 1,400 dots')).toBeVisible()
    // The preview has replaced the result on show with the dots; the choices still refer to the districts' columns.
    await dialog(page).getByRole('button', { name: 'Amount one dot stands for' }).click()
    await page.getByRole('option', { name: '2', exact: true }).click()
    await expect(dialog(page).getByText('About 700 dots')).toBeVisible()
    await expect(dialog(page).getByRole('alert')).toHaveCount(0)
    await dialog(page).getByRole('button', { name: 'Keep' }).click()
    const sql = (await editor(page).innerText()).trim()
    const [row] = await raw(page, `SELECT count(*)::DOUBLE AS n FROM (${sql})`)
    expect(Number(row.n)).toBe(700)
  })

  test('with the layer itself shown, every district has dots', async ({ page }) => {
    test.setTimeout(120000)
    await openFile(page, writePolygons(), '?e2e=1')
    await dots(page).click()
    await dialog(page).getByRole('button', { name: 'Keep' }).click()
    const sql = (await editor(page).innerText()).trim()
    const [row] = await raw(page, `SELECT count(*)::DOUBLE AS n FROM (${sql})`)
    expect(Number(row.n)).toBe(3900)
  })
})
