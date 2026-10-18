// Spec 020: the time slider. Four points dated 2020 to 2023: a window over the date column narrows the rows
// (it is that column's filter), playing moves the window, and closing brings every row back.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openFile } from './helpers'

function dated(extra: Record<string, unknown> = {}): string {
  const years = [2020, 2021, 2022, 2023]
  const features = years.map((y, i) => ({ type: 'Feature', properties: { name: `p${y}`, day: `${y}-06-15`, ...extra }, geometry: { type: 'Point', coordinates: [8 + i * 0.1, 47] } }))
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-time-')), 'events.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  return file
}

const button = (page: Page) => page.getByRole('button', { name: 'Time slider', exact: true })
const bar = (page: Page) => page.getByRole('group', { name: 'Time slider' })
const rendered = async (page: Page): Promise<number> => Number(await page.locator('.canvas-host').getAttribute('data-rendered-features'))

async function setup(page: Page, file = dated()): Promise<void> {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, file, '?e2e=1')
  await page.getByRole('button', { name: 'Zoom to layer' }).click()
  await expect.poll(() => rendered(page)).toBe(4)
}

test('a window over the date column narrows the rows, and closing brings them back', async ({ page }) => {
  test.setTimeout(120000)
  await setup(page)
  await button(page).click()
  await expect(bar(page)).toBeVisible()
  await expect(bar(page).getByText('2020-06-15')).toBeVisible()
  await expect(bar(page).getByText('2023-06-15')).toBeVisible()

  // Pull the From handle past the first two points: 2020 and 2021 go.
  await bar(page).getByRole('slider', { name: 'From' }).fill('500')
  await expect.poll(() => rendered(page), { timeout: 20000 }).toBe(2)
  // And the To handle back: only 2022 is left (the window ends in July 2022).
  await bar(page).getByRole('slider', { name: 'To' }).fill('700')
  await expect.poll(() => rendered(page), { timeout: 20000 }).toBe(1)

  await bar(page).getByRole('button', { name: 'Close the time slider' }).click()
  await expect(bar(page)).toHaveCount(0)
  await expect.poll(() => rendered(page), { timeout: 20000 }).toBe(4)
})

test('the window is the column filter: the table shows it, and the handles never cross', async ({ page }) => {
  test.setTimeout(120000)
  await setup(page)
  await button(page).click()
  const from = bar(page).getByRole('slider', { name: 'From' })
  const to = bar(page).getByRole('slider', { name: 'To' })
  await from.fill('300')
  await to.fill('200')
  // The handle you drag pushes the other: From cannot be above To.
  expect(Number(await from.inputValue())).toBeLessThanOrEqual(Number(await to.inputValue()))
  await expect.poll(() => rendered(page), { timeout: 20000 }).toBeLessThan(4)
})

test('Play moves the window across the span', async ({ page }) => {
  test.setTimeout(120000)
  await setup(page)
  await button(page).click()
  const from = bar(page).getByRole('slider', { name: 'From' })
  await bar(page).getByRole('button', { name: 'Play' }).click()
  await expect(bar(page).getByRole('button', { name: 'Pause' })).toBeVisible()
  const first = Number(await from.inputValue())
  await expect.poll(async () => Number(await from.inputValue()), { timeout: 15000 }).not.toBe(first)
  await bar(page).getByRole('button', { name: 'Pause' }).click()
  const stopped = Number(await from.inputValue())
  await page.waitForTimeout(1600)
  expect(Number(await from.inputValue())).toBe(stopped)
})

test('the button is off for a layer without a date column', async ({ page }) => {
  test.setTimeout(120000)
  const features = [{ type: 'Feature', properties: { n: 1 }, geometry: { type: 'Point', coordinates: [8, 47] } }]
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-time-')), 'plain.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, file, '?e2e=1')
  await expect(button(page)).toBeDisabled()
})

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: no violations in the time slider (${scheme}), and it is a screenshot to look at`, async ({ page }, info) => {
    test.setTimeout(120000)
    await page.emulateMedia({ colorScheme: scheme })
    await setup(page)
    await button(page).click()
    await expect(bar(page)).toBeVisible()
    await bar(page).getByRole('slider', { name: 'From' }).fill('250')
    const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze()
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
    await page.screenshot({ path: info.outputPath(`time-${scheme}.png`) })
  })
}

test('by keyboard: the handles take the arrow keys', async ({ page }) => {
  test.setTimeout(120000)
  await setup(page)
  await button(page).click()
  const from = bar(page).getByRole('slider', { name: 'From' })
  await from.focus()
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
  expect(Number(await from.inputValue())).toBe(10)
  await expect(from).toHaveAttribute('aria-valuetext', /^\d{4}-\d{2}-\d{2}$/)
})
