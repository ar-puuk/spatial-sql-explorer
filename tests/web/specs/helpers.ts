// Shared helpers for spec 002's query specs. Not a spec file itself.
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const FIXTURES = path.resolve(__dirname, '../../vscode-ext/fixtures')
export const fixture = (name: string): string => path.join(FIXTURES, name)

/** Opens a file in the web app and waits until its data is drawn. Basemap requests get a stub style (no network). */
export async function openFile(page: Page, file: string, search = ''): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } })
  )
  await page.goto('/' + search)
  await page.locator('input[type="file"]').setInputFiles(file)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
}

export const queryPanel = (page: Page) => page.getByRole('region', { name: 'Query' })
export const editor = (page: Page) => page.getByRole('textbox', { name: 'SQL query' })
export const status = (page: Page) => page.locator('.query-status')
export const grid = (page: Page) => page.getByRole('grid', { name: 'Attribute table' })

export async function openQueryPanel(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+Q')
  await expect(editor(page)).toBeVisible()
}

/** Replaces the editor text (no auto-indent surprises: inserted, not typed). */
export async function setQuery(page: Page, sql: string): Promise<void> {
  // Spec 010: a result switches the bottom panel to its Table tab; the editor is on the SQL tab.
  if (!(await editor(page).isVisible())) await openQueryPanel(page)
  await editor(page).click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(sql)
}

/** Runs with Ctrl+Enter and waits for the query to settle. */
export async function runQuery(page: Page, sql?: string): Promise<void> {
  if (sql !== undefined) await setQuery(page, sql)
  await editor(page).press('Control+Enter')
  await expect(status(page)).not.toContainText(/Running|Fetching/, { timeout: 60000 })
}

// A CSS locator: the grid keeps its row count while its tab is hidden (spec 010 bottom panel).
export const rowCount = async (page: Page): Promise<number> => Number(await page.locator('[role="grid"][aria-label="Attribute table"]').getAttribute('aria-rowcount')) - 1

/** Spec 010: a result shows the Table tab; the query panel's buttons are on the SQL tab. */
export async function showSql(page: Page): Promise<void> {
  if (!(await editor(page).isVisible())) await page.getByRole('tab', { name: 'SQL' }).click()
  await expect(editor(page)).toBeVisible()
}

/** Deterministic parcel-like polygons (spec 001's performance fixture shape), written to a temp file. */
export function writeParcels(count: number, name = `parcels-${count}.geojson`): string {
  const features: string[] = []
  let seed = 42
  const rand = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < count; i++) {
    const cx = -112.2 + rand() * 0.8
    const cy = 40.4 + rand() * 0.8
    const r = 0.0004 + rand() * 0.0008
    const ring: string[] = []
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      ring.push(`[${(cx + Math.cos(a) * r * (0.8 + rand() * 0.4)).toFixed(6)},${(cy + Math.sin(a) * r * (0.8 + rand() * 0.4)).toFixed(6)}]`)
    }
    ring.push(ring[0])
    features.push(
      `{"type":"Feature","properties":{"parcel_id":"P-${100000 + i}","zone":"${['R1', 'R2', 'C', 'I', 'AG'][i % 5]}","acres":${(rand() * 5).toFixed(3)},"value":${Math.round(rand() * 900000)},"owner":"Owner ${i % 997}"},"geometry":{"type":"Polygon","coordinates":[[${ring.join(',')}]]}}`
    )
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-q-')), name)
  fs.writeFileSync(file, `{"type":"FeatureCollection","features":[\n${features.join(',\n')}\n]}`)
  return file
}

/** Points, cheaper than polygons, for the large-result threshold (FR-012). */
export function writePoints(count: number): string {
  const features: string[] = []
  for (let i = 0; i < count; i++) {
    const x = -114 + (i % 1000) * 0.005
    const y = 37 + Math.floor(i / 1000) * 0.005
    features.push(`{"type":"Feature","properties":{"id":${i}},"geometry":{"type":"Point","coordinates":[${x.toFixed(4)},${y.toFixed(4)}]}}`)
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-p-')), `points-${count}.geojson`)
  fs.writeFileSync(file, `{"type":"FeatureCollection","features":[\n${features.join(',\n')}\n]}`)
  return file
}

/** 100 points with value = i² (spec 003 graduated parity fixture; the VS Code suite writes the same file). */
export function writeSquares(): string {
  const features = Array.from({ length: 100 }, (_, i) => `{"type":"Feature","properties":{"value":${i * i}},"geometry":{"type":"Point","coordinates":[${(-112 + i * 0.01).toFixed(2)},40.5]}}`)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-sq-')), 'squares.geojson')
  fs.writeFileSync(file, `{"type":"FeatureCollection","features":[${features.join(',')}]}`)
  return file
}

// --- Spec 007 ---------------------------------------------------------------

/**
 * Opens a committed fixture (tests/vscode-ext/fixtures) and waits for data.
 *
 * `search` may carry the spec 007 test overrides, which the app honors only
 * with `e2e=1` (packages/core/src/source/readModes.ts, `TEST_OVERRIDE_KEYS`):
 * - `wholeThreshold=<bytes>`: whole-read announcement / FlatGeobuf in-memory threshold;
 * - `materializeCap=<n>`: results above this many rows stay views;
 * - `jenksSample=<n>`: natural-breaks sample size;
 * - `memoryLimit=<size>`: engine memory limit (out-of-memory tests);
 * - `slowTileMs=<ms>` / `slowParse=1`: artificial delays for loading-cue and cancel tests;
 * - `tileRows=<n>`: results with at least this many rows are drawn as tiles (spec 010).
 */
export async function openFixture(page: Page, name: string, search = '?e2e=1'): Promise<void> {
  await openFile(page, fixture(name), search)
}

/** A file from the gitignored tests/.large-data (npm run large-data); skips the test when it's missing. */
export function largeData(name: string): string {
  const file = path.resolve(__dirname, '../../.large-data', name)
  test.skip(!fs.existsSync(file), `Run \`npm run large-data\` to generate ${name}`)
  return file
}

// Spec 005 export helpers (shared by export.spec and paging.spec).
export const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'Export data' })

/**
 * Spec 008: picks the output CRS in the export dialog's CRS picker: the
 * result's own, or an EPSG code (searched, then the first match).
 */
export async function chooseCrs(page: Page, crs: 'result' | 'wgs84' | number): Promise<void> {
  await exportDialog(page).getByLabel('CRS', { exact: true }).click()
  const search = page.getByRole('combobox', { name: 'Search coordinate reference systems' })
  await expect(search).toBeFocused()
  if (crs === 'result') {
    await page.getByRole('treeitem', { name: /as the result/ }).click()
  } else {
    await search.fill(String(crs === 'wgs84' ? 4326 : crs))
    await search.press('Enter')
  }
  await expect(search).toHaveCount(0)
}

/** Opens the dialog, sets choices, exports, and returns the downloaded bytes. */
export async function exportVia(page: Page, choices: { format: string; crs?: 'result' | 'wgs84' | number; geometry?: string; fileName?: string }): Promise<{ name: string; bytes: Buffer }> {
  if (!(await exportDialog(page).isVisible())) await page.getByRole('button', { name: 'Export data…' }).click()
  await expect(exportDialog(page)).toBeVisible()
  await exportDialog(page).getByLabel('Format', { exact: true }).selectOption({ label: choices.format })
  if (choices.crs !== undefined) await chooseCrs(page, choices.crs)
  if (choices.fileName !== undefined) await exportDialog(page).getByLabel('File name').fill(choices.fileName)
  if (choices.geometry) await exportDialog(page).getByRole('radio', { name: choices.geometry }).click()
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), exportDialog(page).getByRole('button', { name: 'Export…' }).click()])
  const file = await download.path()
  await expect(exportDialog(page).getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  return { name: download.suggestedFilename(), bytes: fs.readFileSync(file) }
}

export async function inspectParquet(page: Page, bytes: Buffer) {
  return page.evaluate(
    (b64) =>
      (
        window as unknown as {
          __spatialExplorerE2E: { inspectParquet: (b: string) => Promise<{ rows: number; columns: string[]; geo: any; geoKeys: number }> }
        }
      ).__spatialExplorerE2E.inspectParquet(b64),
    bytes.toString('base64')
  )
}

/**
 * Spec 010: opens the side panel on Style (a remembered layout may have it open
 * already), then fits the layer again: the panel takes width from the map, and
 * tests that count drawn features need them all in view.
 */
export async function openStyle(page: Page): Promise<void> {
  const panel = page.getByRole('region', { name: 'Layer style' })
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Style', exact: true }).click()
  await expect(panel).toBeVisible()
  await page.getByRole('button', { name: 'Zoom to layer' }).click()
}

/** Spec 011: adds a property under Vary by attribute ("Size", "Width", "Outline color", …; the panel must be open). */
export async function varyBy(page: Page, property: string): Promise<void> {
  const panel = page.getByRole('region', { name: 'Layer style' })
  await panel.getByRole('button', { name: 'Add…' }).click()
  await page.getByRole('menu', { name: 'Vary by attribute' }).getByRole('menuitem', { name: property, exact: true }).click()
  await expect(panel.getByRole('group', { name: `${property} by` })).toBeVisible()
}

/** Chooses a style type from the Style panel's dropdown (the panel must be open). */
export async function chooseStyleType(page: Page, name: string): Promise<void> {
  // Spec 011: the style type sets the color; "Single" is "Single color".
  if (name === 'Single') name = 'Single color'
  await page.getByRole('button', { name: /^Color: / }).click()
  await page.getByRole('listbox', { name: 'Color styles' }).getByRole('option', { name, exact: true }).click()
  await expect(page.getByRole('button', { name: `Color: ${name}` })).toBeVisible()
}
