// Shared helpers for spec 002's query specs. Not a spec file itself.
import { expect, type Page } from '@playwright/test'
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

export const rowCount = async (page: Page): Promise<number> => Number(await grid(page).getAttribute('aria-rowcount')) - 1

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
