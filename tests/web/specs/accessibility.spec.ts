// T045 (specs/001-quick-look/tasks.md, Constitution Principle VII):
// accessibility pass with axe-core over every state of the viewer, light and
// dark, plus keyboard reachability of the table, map controls, basemap
// picker, style panel and inspector. T048 (spec 002, FR-017) adds the query
// panel: open, with an error, with the large-result dialog and with the
// history popover, and Tab through its controls. T043 (spec 003, FR-018)
// adds the thematic style panel, ramp picker, class list and legend.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeParcels } from './helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.resolve(__dirname, '../../vscode-ext/fixtures/world-boundaries.geojson')

async function audit(page: Page, state: string): Promise<void> {
  // The map canvas is a WebGL surface; its content is exposed through the
  // table and inspector, not the canvas itself.
  const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary, `axe violations in state "${state}"`).toEqual([])
}

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no violations in any state (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.route('https://tiles.openfreemap.org/**', (route) => route.abort())
    await page.goto('/')
    await audit(page, 'empty')

    await page.locator('input[type="file"]').setInputFiles(fixture)
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
    await page.locator('.map-notice').waitFor({ timeout: 15000 }) // basemap blocked -> notice shown
    await audit(page, 'loaded')

    await page.locator('.attribute-table tbody tr:not(.spacer)').nth(2).click()
    await audit(page, 'row selected')

    await page.getByRole('button', { name: 'Layer style' }).click()
    await audit(page, 'style panel')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await audit(page, 'export menu')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Basemap' }).click()
    await audit(page, 'basemap picker')
    await page.keyboard.press('Escape')

    const box = (await page.locator('.canvas-host').boundingBox())!
    await page.locator('.attribute-table tbody tr:not(.spacer)').nth(3).dblclick()
    await page.waitForTimeout(800)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await audit(page, 'inspector')
  })
}

test('keyboard: every control is reachable and the grid is navigable without a mouse', async ({ page }) => {
  // Stub styles (not blocked): with requests blocked, choosing a basemap
  // would fail over to Blank and move the checked state under the test.
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } })
  )
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })

  // Tab through the page and record what receives focus.
  const reached = new Set<string>()
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el ? (el.getAttribute('aria-label') ?? el.getAttribute('role') ?? el.textContent?.trim().slice(0, 30) ?? el.tagName) : ''
    })
    reached.add(label)
  }
  for (const name of ['Zoom in', 'Zoom out', 'Zoom to layer', 'Layer style', 'Basemap', 'Resize attribute table', 'Attribute table']) {
    expect([...reached], `Tab should reach "${name}"`).toContain(name)
  }

  // Grid: arrows move the selection, Enter zooms, Escape clears.
  await page.getByRole('grid', { name: 'Attribute table' }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.attribute-table tbody tr.selected')).toContainText('Afghanistan')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.attribute-table tbody tr.selected')).toContainText('Angola')
  await page.keyboard.press('End')
  await expect(page.locator('.attribute-table tbody tr.selected')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.attribute-table tbody tr.selected')).toHaveCount(0)

  // Sash: the drawer collapses and expands from the keyboard.
  await page.getByRole('separator', { name: 'Resize attribute table' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /Attributes/ })).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /Attributes/ })).toHaveAttribute('aria-expanded', 'true')

  // Basemap picker: arrow keys move between options, Escape closes.
  await page.getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('radio', { checked: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { checked: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Basemap' })).toHaveCount(0)
})

const editor = (page: Page) => page.getByRole('textbox', { name: 'SQL query' })

async function runSql(page: Page, sql: string): Promise<void> {
  await editor(page).click()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(sql)
  await editor(page).press('Control+Enter')
}

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no violations in the query states (${scheme})`, async ({ page }) => {
    test.setTimeout(120000)
    await page.emulateMedia({ colorScheme: scheme })
    await page.route('https://tiles.openfreemap.org/**', (route) => route.abort())
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(fixture)
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
    await page.keyboard.press('Control+Shift+Q')
    await expect(editor(page)).toBeVisible()
    await audit(page, 'query panel')

    await runSql(page, "SELECT * FROM layer WHERE name LIKE 'U%'")
    await expect(page.locator('.query-status')).toContainText('8 rows', { timeout: 60000 })
    await audit(page, 'query result')

    await runSql(page, 'SELECT *\nFORM layer')
    await expect(page.locator('.query-status')).toContainText('Parser Error')
    await audit(page, 'query error')

    // Spec 007: a large result is paged, with no prompt; mid-table rows may still be loading.
    await runSql(page, 'SELECT * FROM range(60000)')
    await expect(page.locator('.query-status')).toContainText('60,000 rows', { timeout: 60000 })
    await page.getByRole('grid', { name: 'Attribute table' }).evaluate((g) => {
      const scroller = g.closest('.attribute-table')
      if (scroller) scroller.scrollTop = scroller.scrollHeight / 2
    })
    await audit(page, 'paged table')

    await page.getByRole('button', { name: 'Query history' }).click()
    await expect(page.getByRole('listbox', { name: 'Query history' })).toBeVisible()
    await audit(page, 'history popover')
  })
}

// Spec 007 T042: the open progress (held open by the slowParse test override).
for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no violations while a file opens (${scheme})`, async ({ page }) => {
    test.setTimeout(120000)
    await page.emulateMedia({ colorScheme: scheme })
    await page.route('https://tiles.openfreemap.org/**', (route) => route.abort())
    await page.goto('/?e2e=1&slowParse=1')
    await page.locator('input[type="file"]').setInputFiles(path.resolve(__dirname, '../../vscode-ext/fixtures/parcels-10k.parquet'))
    await expect(page.getByRole('button', { name: 'Cancel opening' })).toBeVisible({ timeout: 10000 })
    await audit(page, 'open progress')
  })
}

test('keyboard: every query control is reachable, and Tab leaves the editor', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } })
  )
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(fixture)
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })

  // The shortcut opens the panel and puts focus in the editor.
  await page.keyboard.press('Control+Shift+Q')
  await expect(editor(page)).toBeFocused()

  // Tab leaves the editor (no keyboard trap) and the header controls are
  // reachable with Shift+Tab.
  await page.keyboard.press('Tab')
  await expect(editor(page)).not.toBeFocused()
  await editor(page).focus()
  const label = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el ? (el.getAttribute('aria-label') ?? el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 30) ?? el.tagName) : ''
    })
  const reached: string[] = []
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Shift+Tab')
    reached.push(await label())
  }
  await editor(page).focus()
  await page.keyboard.press('Tab')
  reached.push(await label())
  for (const name of ['Run', 'Reset to the original view', 'Query history', 'Spatial SQL function reference', 'Result CRS']) {
    expect(reached.some((l) => l.startsWith(name)), `Tab should reach "${name}" (reached: ${reached.join(' | ')})`).toBe(true)
  }

  // While a query runs, Cancel takes Run's place and is reachable too.
  await editor(page).focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.insertText('SELECT sum(a.range * b.range) FROM range(200000) a, range(200000) b')
  await editor(page).press('Control+Enter')
  const cancel = page.getByRole('button', { name: 'Cancel' })
  await expect(cancel).toBeVisible()
  await editor(page).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('.query-status')).toContainText('Cancelled', { timeout: 10000 })
})

const squares = (): string => {
  const features = Array.from({ length: 100 }, (_, i) => `{"type":"Feature","properties":{"value":${i * i},"zone":"Z${i % 4}"},"geometry":{"type":"Point","coordinates":[${(-112 + i * 0.01).toFixed(2)},40.5]}}`)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-a11y-')), 'squares.geojson')
  fs.writeFileSync(file, `{"type":"FeatureCollection","features":[${features.join(',')}]}`)
  return file
}

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no violations in the thematic style states (${scheme})`, async ({ page }) => {
    test.setTimeout(120000)
    await page.emulateMedia({ colorScheme: scheme })
    await page.route('https://tiles.openfreemap.org/**', (route) => route.abort())
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(squares())
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
    await page.getByRole('button', { name: 'Layer style' }).click()
    await page.getByRole('radio', { name: 'Categorized' }).click()
    await audit(page, 'categorized panel + legend')

    await page.getByRole('radio', { name: 'Graduated' }).click()
    await page.getByRole('button', { name: /^Colors:/ }).click()
    await expect(page.getByRole('listbox', { name: 'Color ramps' })).toBeVisible()
    await audit(page, 'ramp listbox open')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Edit bounds' }).click()
    await page.getByRole('button', { name: /^Rename / }).first().click()
    await audit(page, 'class list editing')
    await page.keyboard.press('Escape')

    await page.getByRole('region', { name: 'Legend' }).getByRole('button', { expanded: true }).click()
    await audit(page, 'legend collapsed')
  })
}

test('keyboard: every style control is reachable, and Esc returns to the Layer style button', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } })
  )
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(squares())
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  const styleButton = page.getByRole('button', { name: 'Layer style' })
  await styleButton.click()

  // Radio group: arrows move and apply.
  await page.getByRole('radio', { name: 'Single' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Categorized' })).toBeFocused()
  await expect(page.getByRole('radio', { name: 'Categorized' })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: 'Graduated' })).toHaveAttribute('aria-checked', 'true')
  // The classes resolve in the engine (spec 007): wait for them before tabbing.
  await expect(page.getByRole('button', { name: /^Hide 0/ }).first()).toBeVisible()

  // Tab through the panel and record what receives focus.
  // The legend comes before the panel in tab order, so go all the way around.
  const reached: string[] = []
  for (let i = 0; i < 70; i++) {
    await page.keyboard.press('Tab')
    reached.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el) return ''
        const id = el.getAttribute('id')
        const label = id ? document.querySelector(`label[for="${id}"]`)?.textContent : null
        return (el.getAttribute('aria-label') ?? label ?? el.textContent ?? '').trim()
      })
    )
  }
  for (const name of ['Column', 'Method', 'Classes', 'Colors:', 'Reverse colors', 'Hide 0', 'Color of 0', 'Rename 0', 'Delete 0', 'Hide class 0']) {
    expect(reached.some((l) => l.startsWith(name)), `Tab should reach "${name}" (reached: ${reached.join(' | ')})`).toBe(true)
  }

  // Esc closes the panel and returns focus to its button.
  await page.getByLabel('Method').focus()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Layer style' })).toHaveCount(0)
  await expect(styleButton).toBeFocused()

  // Esc while typing in the SQL editor closes the popover but leaves the caret there.
  await styleButton.click()
  await page.keyboard.press('Control+Shift+Q')
  const editor = page.getByRole('textbox', { name: 'SQL query' })
  await expect(editor).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Layer style' })).toHaveCount(0)
  await expect(editor).toBeFocused()
})

// T028 (spec 005, Constitution Principle VII): the export dialog, for a
// geometry result, a table result and while running (spec 007: never display-limited).
const exportDialog = (page: Page) => page.getByRole('dialog', { name: 'Export data' })

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no violations in the export dialog states (${scheme})`, async ({ page }) => {
    test.setTimeout(240000)
    await page.emulateMedia({ colorScheme: scheme })
    await page.route('https://tiles.openfreemap.org/**', (route) => route.abort())
    await page.goto('/')
    await page.locator('input[type="file"]').setInputFiles(writeParcels(20_000, 'parcels-a11y.geojson'))
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })

    await page.getByRole('button', { name: 'Export data…' }).click()
    await expect(exportDialog(page)).toBeVisible()
    await audit(page, 'export: geometry result')
    await exportDialog(page).getByRole('radio', { name: 'CSV', exact: true }).click()
    await audit(page, 'export: CSV geometry options')
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+Shift+Q')
    await runSql(page, 'SELECT zone, count(*) AS n FROM layer GROUP BY zone')
    await expect(page.locator('.query-status')).toContainText('rows', { timeout: 60000 })
    await page.getByRole('button', { name: 'Export data…' }).click()
    await audit(page, 'export: table result')
    await page.keyboard.press('Escape')

    await runSql(page, 'SELECT a.* FROM layer a, range(10) b')
    await expect(page.locator('.query-status')).toContainText('200,000 rows', { timeout: 120000 })
    await page.getByRole('button', { name: 'Export data…' }).click()
    await exportDialog(page).getByRole('radio', { name: 'GeoJSON', exact: true }).click()
    await exportDialog(page).getByRole('button', { name: 'Export…' }).click()
    await expect(exportDialog(page).getByRole('status').filter({ hasText: /rows written/ })).toBeVisible({ timeout: 30000 })
    await audit(page, 'export: running')
    await exportDialog(page).getByRole('button', { name: 'Cancel export' }).click()
    await expect(exportDialog(page)).toContainText('Export cancelled')
    await audit(page, 'export: cancelled')
  })
}

test('keyboard: every export control is reachable, and Esc returns to the Export button', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (route) => route.abort())
  await page.goto('/')
  await page.locator('input[type="file"]').setInputFiles(writeParcels(2_000, 'parcels-kbd.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })

  const button = page.getByRole('button', { name: 'Export data…' })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(exportDialog(page)).toBeVisible()
  // Focus starts on the first checked choice, inside the dialog.
  await expect(exportDialog(page).getByRole('radio', { name: 'GeoParquet' })).toBeFocused()

  // Format: arrows move and choose; choosing CSV adds the geometry group.
  await exportDialog(page).getByRole('radio', { name: 'GeoParquet' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(exportDialog(page).getByRole('radio', { name: 'CSV', exact: true })).toHaveAttribute('aria-checked', 'true')

  const reached: string[] = []
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab')
    reached.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el) return ''
        const id = el.getAttribute('id')
        const label = id ? document.querySelector(`label[for="${id}"]`)?.textContent : null
        return (el.getAttribute('aria-label') ?? label ?? el.textContent ?? '').trim()
      })
    )
    expect(await exportDialog(page).evaluate((d) => d.contains(document.activeElement)), 'focus stays in the dialog').toBe(true)
  }
  for (const name of ['Close', 'CSV', 'CRS', 'WKT text', 'Cancel', 'Export…']) {
    expect(reached.some((l) => l.startsWith(name)), `Tab should reach "${name}" (reached: ${reached.join(' | ')})`).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(exportDialog(page)).toHaveCount(0)
  await expect(button).toBeFocused()
})
