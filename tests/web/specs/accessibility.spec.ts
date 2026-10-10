// T045 (specs/001-quick-look/tasks.md, Constitution Principle VII):
// accessibility pass with axe-core over every state of the viewer, light and
// dark, plus keyboard reachability of the table, map controls, basemap
// picker, style panel and inspector.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
    await page.getByRole('button', { name: 'Export' }).click()
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
