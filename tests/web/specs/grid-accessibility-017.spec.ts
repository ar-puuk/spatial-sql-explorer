// Spec 017 (Constitution VII): the Bin into cells dialog, with axe-core in the light, dark and forced-color themes,
// and by keyboard alone: every control reachable, Esc closes and puts focus back where it came from.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { choose, fixture, openFile, openQueryPanel, writeParcels } from './helpers'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Bin into cells' })

async function audit(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary, `axe violations in state "${state}"`).toEqual([])
}

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no violations in the Bin into cells dialog (${scheme})`, async ({ page }) => {
    test.setTimeout(180000)
    await page.emulateMedia({ colorScheme: scheme })
    await openFile(page, writeParcels(2000, 'parcels-bin-a11y.geojson'))
    for (let n = 1; n <= 3; n++) await page.getByRole('checkbox', { name: `Select row ${n}`, exact: true }).check()
    await page.getByRole('button', { name: 'Bin into cells…' }).click()
    await expect(dialog(page)).toBeVisible()
    await audit(page, 'bin: defaults, with a selection')

    await dialog(page).getByRole('radio', { name: 'A5' }).click()
    await audit(page, 'bin: A5')

    await choose(page, dialog(page).getByRole('button', { name: 'What each cell shows' }), 'Sum of a column')
    await audit(page, 'bin: a column measure')

    await dialog(page).getByRole('switch', { name: 'All resolutions' }).click()
    await audit(page, 'bin: all resolutions')
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })
}

test('axe: no violations in forced colors', async ({ page }) => {
  test.setTimeout(120000)
  await page.emulateMedia({ forcedColors: 'active' })
  await openFile(page, fixture('crashes.geojson'))
  await page.getByRole('button', { name: 'Bin into cells…' }).click()
  await expect(dialog(page)).toBeVisible()
  await audit(page, 'bin: forced colors')
  await page.keyboard.press('Escape')
})

test('keyboard: every control is reachable, Enter keeps the bin, Esc closes and returns focus to the button', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, fixture('crashes.geojson'))
  await openQueryPanel(page)
  const opener = page.getByRole('button', { name: 'Bin into cells', exact: true })
  await opener.focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  // Focus starts on the chosen grid system, inside the dialog.
  await expect(dialog(page).getByRole('radio', { name: 'H3' })).toBeFocused()

  const reached = new Set<string>()
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab')
    reached.add(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el ? (el.getAttribute('aria-label') ?? el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 30) ?? el.tagName) : ''
      })
    )
  }
  for (const name of ['Resolution', 'What each cell shows', 'Cancel', 'Keep']) {
    expect([...reached].some((label) => label.startsWith(name)), `Tab should reach "${name}" (reached: ${[...reached].join(' | ')})`).toBe(true)
  }

  // The slider moves with the arrow keys, and the estimate is announced in a status region.
  const slider = dialog(page).getByRole('slider', { name: 'Resolution' })
  await slider.focus()
  const before = await slider.inputValue()
  await slider.press('ArrowRight')
  expect(await slider.inputValue()).not.toBe(before)
  await expect(dialog(page).getByRole('status').filter({ hasText: /^About / })).toBeVisible()

  // Esc cancels and focus returns to the button that opened the dialog.
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(opener).toBeFocused()

  // Enter keeps the bin.
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByRole('slider', { name: 'Resolution' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog(page)).toBeHidden()
  await expect(page.getByRole('region', { name: 'Legend' }).getByRole('button', { name: /^Number of features/ })).toBeVisible()
})
