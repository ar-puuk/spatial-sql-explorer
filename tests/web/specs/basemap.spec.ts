// User Story 4 (FR-009, FR-016) in the real browser build, network-independent:
// basemap requests are either answered with a stub style or blocked.
// - The default follows the appearance (Positron / Dark, marked "Theme default").
// - Blank keeps the data drawn; its color matches the theme unless the user
//   picks one, and a picked color is remembered across reloads.
// - Blocked basemap requests degrade to blank + a short message; data unaffected.
import { test, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.resolve(__dirname, '../../vscode-ext/fixtures/world-boundaries.geojson')
const STUB_STYLE = { version: 8, sources: {}, layers: [{ id: 'stub-bg', type: 'background', paint: { 'background-color': '#dddddd' } }] }

async function stubBasemap(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ json: STUB_STYLE }))
}

async function open(page: Page): Promise<void> {
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
}

async function renderedFeatures(page: Page): Promise<number> {
  return Number((await page.locator('.canvas-host').getAttribute('data-rendered-features')) ?? 0)
}

for (const [scheme, name] of [
  ['light', 'Positron'],
  ['dark', 'Dark'],
] as const) {
  test(`the default basemap matches the ${scheme} appearance (${name})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await stubBasemap(page)
    await open(page)
    await page.getByRole('button', { name: 'Basemap' }).click()
    const checked = page.getByRole('radio', { checked: true })
    await expect(checked).toHaveCount(1)
    await expect(checked).toContainText(name)
    await expect(checked).toContainText('Theme default')
    // No separate "Match theme" entry (user decision).
    await expect(page.getByRole('radio', { name: /Match theme/ })).toHaveCount(0)
  })
}

test('Blank keeps the data drawn, and a custom blank color is remembered', async ({ page }) => {
  await stubBasemap(page)
  await open(page)
  await page.getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('radio', { name: /Blank/ }).click()
  await expect(page.getByRole('radio', { name: /Blank/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: /Blank/ })).toContainText('Theme color')
  await expect.poll(() => renderedFeatures(page)).toBeGreaterThan(0)

  await page.locator('.color-input').fill('#123456')
  await expect(page.locator('.map-view')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await expect(page.getByRole('radio', { name: /Blank/ })).toContainText('#123456')

  // Remembered across sessions: reload, reopen, the blank color is still set.
  await page.reload()
  await open(page)
  await page.getByRole('button', { name: 'Basemap' }).click()
  await expect(page.getByRole('radio', { name: /Blank/ })).toContainText('#123456')

  // And "Match theme color" clears it.
  await page.getByRole('button', { name: 'Match theme color' }).click()
  await expect(page.getByRole('radio', { name: /Blank/ })).toContainText('Theme color')
})

test('a blocked basemap degrades to blank with a short message; data unaffected (FR-016)', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort('blockedbyclient'))
  await open(page)
  const notice = page.locator('.map-notice')
  await expect(notice).toContainText('basemap unavailable', { timeout: 15000 })
  await expect(notice).toContainText('Showing a blank background')
  await expect(page.getByRole('button', { name: 'Basemap' })).toHaveAttribute('title', 'Basemap: Blank')
  await expect.poll(() => renderedFeatures(page)).toBeGreaterThan(0)
  await expect(page.locator('.drawer-header .count')).toHaveText('179 features')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
