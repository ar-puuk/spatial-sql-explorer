// Spec 011 T073 (SC-007): the new controls (Vary by attribute with each scale,
// the Color types, the Labels panel and its rail button) in light, dark and
// forced colors (the browser's high contrast), with axe; and by keyboard alone.
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { chooseStyleType, fixture, openFile, openStyle, varyBy } from './helpers'

async function audit(page: Page, state: string): Promise<void> {
  // Forced colors: the browser paints the system's colors (nothing here opts out); axe reads the author's
  // colors under the emulation, so its contrast rule doesn't describe what is drawn.
  const forced = await page.evaluate(() => matchMedia('(forced-colors: active)').matches)
  const builder = new AxeBuilder({ page }).exclude('.maplibregl-canvas')
  const results = await (forced ? builder.disableRules(['color-contrast']) : builder).analyze()
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
  expect(summary, `axe violations in state "${state}"`).toEqual([])
}

for (const mode of ['light', 'dark', 'forced colors'] as const) {
  test(`axe: the style panel's new scales, the Color types and the Labels panel (${mode})`, async ({ page }) => {
    test.setTimeout(180000)
    if (mode === 'forced colors') await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' })
    else await page.emulateMedia({ colorScheme: mode })
    await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
    await openFile(page, fixture('crashes.geojson'))
    await openStyle(page)
    const panel = page.getByRole('region', { name: 'Layer style' })

    await varyBy(page, 'Opacity')
    await panel.getByLabel('Opacity column').selectOption('age_days')
    await panel.getByLabel('Opacity scale').selectOption({ label: 'Continuous' })
    await varyBy(page, 'Outline color')
    await panel.getByLabel('Outline color column').selectOption('hex_color')
    await panel.getByLabel('Outline color scale').selectOption({ label: 'As is' })
    await varyBy(page, 'Outline width')
    await panel.getByLabel('Outline width scale').selectOption({ label: 'Conditions' })
    const conditions = panel.getByRole('list', { name: 'Outline width conditions' })
    await conditions.getByLabel('Condition 1', { exact: true }).fill('nope > 1')
    await conditions.getByLabel('Condition 1', { exact: true }).press('Enter')
    await expect(conditions.getByRole('alert')).toBeVisible()
    await audit(page, 'vary by: continuous, as is, conditions with an error')

    await chooseStyleType(page, 'Continuous')
    await audit(page, 'color: continuous')

    await page.getByRole('button', { name: 'Labels', exact: true }).click()
    const side = page.getByRole('complementary', { name: 'Labels' })
    await audit(page, 'labels: off')
    await side.getByRole('checkbox', { name: 'Show labels' }).check()
    await side.getByLabel('From').selectOption({ label: 'SQL expression…' })
    await side.getByLabel('Label expression').fill('nope || 1')
    await side.getByLabel('Label expression').press('Enter')
    await expect(side.getByRole('alert')).toBeVisible()
    await audit(page, 'labels: on, an expression with an error')
  })
}

test('keyboard: the Labels button and every Labels setting; a condition added and edited without a mouse', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('crashes.geojson'))

  // The rail is a toolbar: arrow keys move between its buttons; Enter opens Labels.
  await page.getByRole('button', { name: 'Style', exact: true }).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: 'Labels', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  const side = page.getByRole('complementary', { name: 'Labels' })
  await expect(side).toBeVisible()
  // Tab reaches each setting, in order; Space turns labels on.
  const show = side.getByRole('checkbox', { name: 'Show labels' })
  await show.focus()
  await page.keyboard.press('Space')
  await expect(show).toBeChecked()
  const order = ['From', 'Size', 'Color']
  for (const name of order) {
    await page.keyboard.press('Tab')
    await expect(side.getByLabel(name, { exact: true })).toBeFocused()
  }
  await page.keyboard.press('Tab')
  await expect(side.getByRole('checkbox', { name: 'Halo' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(side.getByLabel('Halo color')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(side.getByLabel('Halo width')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(side.getByRole('radio', { name: 'Above' })).toBeFocused()
  // Arrow keys move the placement, as in any radio group.
  await page.keyboard.press('ArrowRight')
  await expect(side.getByRole('radio', { name: 'Below' })).toBeChecked()

  // Conditions: add one and write it, by keyboard.
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await openStyle(page)
  const panel = page.getByRole('region', { name: 'Layer style' })
  await varyBy(page, 'Outline width')
  await panel.getByLabel('Outline width scale').focus()
  await page.keyboard.press('End')
  await panel.getByLabel('Outline width scale').selectOption({ label: 'Conditions' })
  const add = panel.getByRole('button', { name: 'Add condition' })
  await add.focus()
  await page.keyboard.press('Enter')
  const second = panel.getByRole('list', { name: 'Outline width conditions' }).getByLabel('Condition 2', { exact: true })
  await second.focus()
  await page.keyboard.type('age_days > 100')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Legend' }).getByRole('group', { name: 'Outline width · 2 conditions' })).toBeVisible()
})
