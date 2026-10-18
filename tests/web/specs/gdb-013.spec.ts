// Spec 013: File Geodatabases and zipped data in the web app. The fixture
// (tests/vscode-ext/fixtures/network.gdb, scripts/fixtures-013.mjs) has a feature
// dataset with two layers, coded and range domains, and a plain table.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openQueryPanel, rowCount, runQuery } from './helpers'

const layerPicker = (page: Page) => page.getByRole('combobox', { name: 'Layer' })
const statusBar = (page: Page) => page.locator('.status-bar')

async function start(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } })
  )
  await page.goto('/')
}

/** Picks the geodatabase folder the way a user does: the folder button, then the browser's chooser. */
async function pickFolder(page: Page, folder: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Choose a geodatabase folder' }).click()
  await (await chooser).setFiles(folder)
}

const rendered = (page: Page) => page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 90000 })

test('a geodatabase folder opens: its layers are listed and the first one is on the map', async ({ page }) => {
  test.setTimeout(180000)
  await start(page)
  await pickFolder(page, fixture('network.gdb'))
  await rendered(page)
  const options = layerPicker(page).locator('option')
  await expect(options).toHaveCount(3)
  await expect(options.nth(0)).toHaveText('roads, LineString, 6')
  await expect(options.nth(1)).toHaveText('nodes, Point, 5')
  await expect(options.nth(2)).toHaveText('codes, table, 3')
  await expect(layerPicker(page)).toHaveValue('roads')
  await expect(statusBar(page)).toContainText('6 features')
  await expect(page.locator('.file')).toContainText('network.gdb')
  await openQueryPanel(page)
  await runQuery(page, 'SELECT name, class, speed FROM network.roads ORDER BY name')
  expect(await rowCount(page)).toBe(6)
})
