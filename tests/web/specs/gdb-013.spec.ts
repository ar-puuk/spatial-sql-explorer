// Spec 013: File Geodatabases and zipped data in the web app. The fixture
// (tests/vscode-ext/fixtures/network.gdb, scripts/fixtures-013.mjs) has a feature
// dataset with two layers, coded and range domains, and a plain table.
import { test, expect, type Page } from '@playwright/test'
import { fixture, openQueryPanel, rowCount, runQuery, showSql } from './helpers'

const layerPicker = (page: Page) => page.getByRole('combobox', { name: 'Layer' })
const statusBar = (page: Page) => page.locator('.status-bar')
const rendered = (page: Page) => page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 90000 })

async function start(page: Page, keepDirectoryPicker = false): Promise<void> {
  // Playwright can only drive the <input> chooser: hide Chrome's directory picker unless a test wants it.
  if (!keepDirectoryPicker) await page.addInitScript(() => delete (window as unknown as Record<string, unknown>).showDirectoryPicker)
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

async function openGdb(page: Page): Promise<void> {
  await start(page)
  await pickFolder(page, fixture('network.gdb'))
  await rendered(page)
}

/** The first column of the Table tab, as text. */
const column = async (page: Page, index: number): Promise<string[]> =>
  page.locator('[role="grid"][aria-label="Attribute table"] tbody tr:not(.spacer):not(.skeleton)').evaluateAll((rows, i) => rows.map((r) => r.querySelectorAll('td[role="gridcell"]')[i + 2]?.textContent?.trim() ?? ''), index)

test.describe('a geodatabase folder', () => {
  test.setTimeout(180000)

  test('the folder button uses the directory picker when the browser has one (its prompt is not worded as an upload)', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>
      w.pickerCalls = 0
      w.showDirectoryPicker = () => {
        ;(w.pickerCalls as number)++
        return Promise.reject(new DOMException('cancelled', 'AbortError'))
      }
    })
    await start(page, true)
    await page.getByRole('button', { name: 'Choose a geodatabase folder' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { pickerCalls: number }).pickerCalls)).toBe(1)
    // Cancelled: still on the landing page.
    await expect(page.getByRole('button', { name: 'Choose a geodatabase folder' })).toBeVisible()
  })

  test('when the directory picker fails, the input chooser takes over', async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as unknown as Record<string, unknown>).showDirectoryPicker = () => Promise.reject(new DOMException('blocked', 'SecurityError'))
    })
    await start(page, true)
    await pickFolder(page, fixture('network.gdb'))
    await rendered(page)
    await expect(layerPicker(page)).toHaveValue('roads')
  })

  test('opens: its layers are listed (by feature dataset) and the first one is on the map', async ({ page }) => {
    await openGdb(page)
    const options = layerPicker(page).locator('option')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toHaveText('codes, table, 3')
    await expect(options.nth(1)).toHaveText('roads, LineString, 6')
    await expect(options.nth(2)).toHaveText('nodes, Point, 5')
    await expect(layerPicker(page).locator('optgroup')).toHaveAttribute('label', 'net')
    await expect(layerPicker(page)).toHaveValue('roads')
    await expect(statusBar(page)).toContainText('6 features')
    await expect(page.locator('.file')).toContainText('network.gdb')
    await expect(page.locator('.layer-picker .badge')).toHaveText('experimental')
  })

  test('every layer is a table in the geodatabase’s schema; a layer is read when a query first names it', async ({ page }) => {
    await openGdb(page)
    await openQueryPanel(page)
    await runQuery(page, 'SELECT name, class, speed FROM network.roads ORDER BY name')
    expect(await rowCount(page)).toBe(6)
    // `nodes` and `codes` were not read at the open: this statement reads them.
    await runQuery(page, 'SELECT count(*) AS n FROM network.nodes')
    expect((await column(page, 0))[0]).toBe('5')
    await runQuery(page, 'SELECT label FROM network.codes ORDER BY code')
    expect(await column(page, 0)).toEqual(['one', 'two', 'three'])
    // A join across layers (nodes on a road, in the layers' own CRS).
    await runQuery(
      page,
      'SELECT n.node_id, r.name FROM network.nodes n JOIN network.roads r ON ST_DWithin(n.geom, r.geom, 1) ORDER BY n.node_id, r.name'
    )
    expect(await rowCount(page)).toBeGreaterThan(2)
    // The open layer is also `layer`, and the unread layers show their columns to autocomplete before they are read.
    await runQuery(page, 'SELECT count(*) AS n FROM layer')
    expect((await column(page, 0))[0]).toBe('6')
  })

  test('domains: descriptions by default, codes on the switch; SQL and filters use the codes', async ({ page }) => {
    await openGdb(page)
    // The table tab shows the layer: class is a coded domain, lanes a range (shown as it is).
    const table = page.getByRole('tab', { name: 'Table' })
    if ((await table.getAttribute('aria-selected')) !== 'true') await table.click()
    await expect(page.getByRole('gridcell', { name: 'Freeway' }).first()).toBeVisible()
    await expect(page.getByRole('gridcell', { name: 'Arterial' }).first()).toBeVisible()
    const toggle = page.getByRole('button', { name: 'Showing descriptions' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // The cell’s tooltip keeps the code.
    await expect(page.getByRole('gridcell', { name: 'Freeway' }).first()).toHaveAttribute('title', 'Freeway (1)')

    // The filter lists descriptions and filters on the code.
    const classFilter = page.getByRole('combobox', { name: 'Filter class' })
    await classFilter.selectOption({ label: 'Arterial' })
    await expect(page.locator('.table-toolbar .count')).toContainText('2 of 6 rows')
    await classFilter.selectOption({ label: 'Any' })

    await toggle.click()
    const codes = page.getByRole('button', { name: 'Showing codes' })
    await expect(codes).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('gridcell', { name: 'Freeway' })).toHaveCount(0)
    expect((await column(page, 0)).sort()).toEqual(['1', '1', '2', '2', '3', '3'])
    // With codes shown the filter is the plain number box.
    await expect(page.getByRole('textbox', { name: 'Filter class' })).toBeVisible()

    // SQL always sees the stored code.
    await showSql(page)
    await runQuery(page, "SELECT DISTINCT class FROM network.roads ORDER BY class")
    expect(await column(page, 0)).toEqual(['1', '2', '3'])
    // The choice is remembered.
    await page.reload()
    await pickFolder(page, fixture('network.gdb'))
    await rendered(page)
    await expect(page.getByRole('button', { name: 'Showing codes' })).toBeVisible()
    await page.getByRole('button', { name: 'Showing codes' }).click()
  })

  test('switching to another layer opens it with its own domain', async ({ page }) => {
    await openGdb(page)
    await layerPicker(page).selectOption('nodes')
    await expect(layerPicker(page)).toHaveValue('nodes')
    await expect(statusBar(page)).toContainText('5 features')
    await expect(page.getByRole('gridcell', { name: 'Junction' }).first()).toBeVisible()
    await expect(page.getByRole('gridcell', { name: 'Signal' }).first()).toBeVisible()
    // A table with no shapes opens as a result.
    await layerPicker(page).selectOption('codes')
    await expect(page.locator('.query-status, .table-toolbar .count').first()).toBeVisible()
    await expect(page.getByRole('gridcell', { name: 'three' })).toBeVisible({ timeout: 30000 })
  })

  test('opening it again is quick: the converted layers are kept in the browser', async ({ page }) => {
    await openGdb(page)
    await page.reload()
    const t0 = Date.now()
    await pickFolder(page, fixture('network.gdb'))
    await rendered(page)
    await expect(statusBar(page)).toContainText('6 features')
    expect(Date.now() - t0).toBeLessThan(15000)
  })
})

test.describe('a layer with no coordinate system', () => {
  test.setTimeout(180000)

  test('asks for one; the layer is converted with the answer and drawn there', async ({ page }) => {
    await start(page)
    await pickFolder(page, fixture('nocrs.gdb'))
    const dialog = page.getByRole('dialog', { name: 'Which coordinate system?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('sketch')
    await dialog.getByLabel('Coordinate system').click()
    const search = page.getByRole('combobox', { name: 'Search coordinate reference systems' })
    await search.fill('26912')
    await page.getByRole('tree', { name: 'Coordinate reference systems' }).locator('[aria-level="2"]', { hasText: '26912' }).first().click()
    await expect(dialog.getByLabel('Coordinate system')).toHaveText(/EPSG:26912/)
    await dialog.getByRole('button', { name: 'Open' }).click()
    await rendered(page)
    await expect(statusBar(page)).toContainText('EPSG:26912')
    await expect(statusBar(page)).not.toContainText('assumed')
    await expect(statusBar(page)).toContainText('3 features')
  })

  test('going on without one says the coordinates are assumed; Cancel goes back', async ({ page }) => {
    await start(page)
    await pickFolder(page, fixture('nocrs.gdb'))
    const dialog = page.getByRole('dialog', { name: 'Which coordinate system?' })
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: /Open a map file/ })).toBeVisible()
    await pickFolder(page, fixture('nocrs.gdb'))
    await dialog.getByRole('button', { name: 'Open' }).click()
    await rendered(page)
    await expect(statusBar(page)).toContainText('assumed')
  })
})

test.describe('the reader and its storage', () => {
  test.setTimeout(180000)

  test('stored layers are listed in the header and can be cleared', async ({ page }) => {
    await openGdb(page)
    const clear = page.getByRole('button', { name: /Clear stored layers/ })
    await expect(clear).toBeVisible()
    await clear.click()
    await expect(page.getByRole('status').filter({ hasText: /^Cleared [0-9]+ stored layers?/ })).toBeVisible()
    await expect(clear).toHaveCount(0)
    // Layers are converted again on the next open.
    await page.reload()
    await pickFolder(page, fixture('network.gdb'))
    await rendered(page)
    await expect(statusBar(page)).toContainText('6 features')
  })

  test('the reader is downloaded once: after the first open it works with the network blocked', async ({ page }) => {
    await openGdb(page)
    await page.route('**/engine-mirror/npm/gdal3.js@*/**', (route) => route.abort())
    await page.reload()
    await pickFolder(page, fixture('network.gdb'))
    await rendered(page)
    await expect(statusBar(page)).toContainText('6 features')
  })

  test('a geodatabase open shows what it is doing and can be cancelled', async ({ page }) => {
    await start(page)
    // Hold the reader's download back so the open is still going when Cancel appears (after one second).
    await page.route('**/engine-mirror/npm/gdal3.js@*/**', async (route) => {
      await new Promise((r) => setTimeout(r, 3000))
      await route.continue()
    })
    await pickFolder(page, fixture('network.gdb'))
    const progress = page.getByRole('status').filter({ hasText: /geodatabase reader|Reading the geodatabase|Converting layer|Reading layer/ })
    await expect(progress).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Cancel opening' }).click()
    await expect(page.getByRole('heading', { name: /Open a map file/ })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('a reader that cannot be downloaded says so, and nothing stays half-open', async ({ page }) => {
    await start(page)
    await page.route('**/engine-mirror/npm/gdal3.js@*/**', (route) => route.abort())
    await pickFolder(page, fixture('network.gdb'))
    await expect(page.getByRole('alert')).toContainText('geodatabase reader could not be loaded')
    await expect(page.getByRole('alert')).toContainText('internet connection')
  })
})

test.describe('zipped data', () => {
  test.setTimeout(180000)

  async function openZip(page: Page, name: string): Promise<void> {
    await start(page)
    await page.locator('input[type="file"]').setInputFiles(fixture(name))
  }

  test('a .gdb.zip opens like the folder', async ({ page }) => {
    await openZip(page, 'network.gdb.zip')
    await rendered(page)
    await expect(layerPicker(page).locator('option')).toHaveCount(3)
    await expect(statusBar(page)).toContainText('6 features')
    await expect(page.getByRole('gridcell', { name: 'Freeway' }).first()).toBeVisible()
  })

  test('a zipped Shapefile opens with its parts', async ({ page }) => {
    await openZip(page, 'roads.shp.zip')
    await rendered(page)
    await expect(page.locator('.file')).toContainText('roads.shp')
    await expect(statusBar(page)).toContainText('features')
    await openQueryPanel(page)
    await runQuery(page, 'SELECT count(*) AS n FROM roads')
    expect(Number((await column(page, 0))[0])).toBeGreaterThan(0)
  })

  test('a zipped GeoPackage lists its layers', async ({ page }) => {
    await openZip(page, 'multi-layer.gpkg.zip')
    await rendered(page)
    expect(await layerPicker(page).locator('option').count()).toBeGreaterThan(1)
  })

  test('a zip with two datasets asks which; Cancel goes back', async ({ page }) => {
    await openZip(page, 'two-datasets.zip')
    const dialog = page.getByRole('dialog', { name: 'Which dataset?' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radio')).toHaveCount(2)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('heading', { name: /Open a map file/ })).toBeVisible()

    await page.locator('input[type="file"]').setInputFiles(fixture('two-datasets.zip'))
    await expect(dialog).toBeVisible()
    await dialog.getByRole('radio', { name: /crashes\.geojson/ }).check()
    await dialog.getByRole('button', { name: 'Open' }).click()
    await rendered(page)
    await expect(page.locator('.file')).toContainText('two-datasets.zip')
  })
})
