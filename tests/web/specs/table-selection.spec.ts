// T025 (spec 008 US2, FR-012–FR-014): ticking rows, map Ctrl-click, zoom to
// the selection, show selected only, and exporting the selected rows.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { exportDialog, grid, inspectParquet, openFile, rowCount, writeParcels } from './helpers'

type Sel = { kind: string; count: number; ids: number[] | null }
const hook = <T,>(page: Page, name: string) => page.evaluate((n) => (window as unknown as { __spatialExplorerE2E: Record<string, () => T> }).__spatialExplorerE2E[n](), name)
const selectionState = (page: Page) => hook<Sel>(page, 'selectionState')
const bar = (page: Page) => page.getByRole('group', { name: 'Selection' })

test('tick rows, zoom to them, show only them, export them', async ({ page }) => {
  test.setTimeout(180000)
  await openFile(page, writeParcels(2000), '?e2e=1')
  for (const n of [1, 2, 3]) await page.getByRole('checkbox', { name: `Select row ${n}`, exact: true }).check()
  await expect(bar(page)).toContainText('3 selected')
  expect((await selectionState(page)).count).toBe(3)
  const header = page.getByRole('checkbox', { name: 'Select all matching rows' })
  await expect(header).toHaveAttribute('aria-checked', 'mixed')

  const before = await hook<number[]>(page, 'mapBounds')
  await bar(page).getByRole('button', { name: 'Zoom to selection' }).click()
  await expect.poll(async () => JSON.stringify(await hook<number[]>(page, 'mapBounds'))).not.toBe(JSON.stringify(before))
  const after = await hook<number[]>(page, 'mapBounds')
  expect(after[2] - after[0]).toBeLessThan(before[2] - before[0])

  await bar(page).getByRole('button', { name: 'Show selected only' }).click()
  await expect(bar(page).getByRole('button', { name: 'Show selected only' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => rowCount(page)).toBe(3)
  await expect(page.locator('.drawer-header > .count')).toHaveText('3 of 2,000 rows')

  // Export the selected rows only.
  await page.getByRole('button', { name: 'Export data…' }).click()
  await exportDialog(page).getByRole('radio', { name: /^Selected \(3\)/ }).click()
  await exportDialog(page).getByLabel('Format', { exact: true }).selectOption({ label: 'GeoParquet' })
  const [download] = await Promise.all([page.waitForEvent('download'), exportDialog(page).getByRole('button', { name: 'Export…' }).click()])
  const parquet = await inspectParquet(page, fs.readFileSync(await download.path()))
  expect(parquet.rows).toBe(3)
  await exportDialog(page).getByRole('button', { name: 'Done' }).click()

  await bar(page).getByRole('button', { name: 'Clear selection' }).click()
  await expect(bar(page)).toHaveCount(0)
  await expect.poll(() => rowCount(page)).toBe(2000)
})

test('the header box selects every matching row; Space ticks the cursor row', async ({ page }) => {
  await openFile(page, writeParcels(500), '?e2e=1')
  await page.getByRole('textbox', { name: 'Filter zone' }).fill('r1')
  await expect(page.locator('.drawer-header > .count')).toHaveText('100 of 500 rows')
  await page.getByRole('checkbox', { name: 'Select all matching rows' }).check()
  await expect(bar(page)).toContainText('100 selected')
  expect((await selectionState(page)).kind).toBe('all-matching')
  await page.getByRole('checkbox', { name: 'Select all matching rows' }).uncheck()
  await expect(bar(page)).toHaveCount(0)

  const grid = page.getByRole('grid', { name: 'Attribute table' })
  await grid.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Space')
  await expect(bar(page)).toContainText('1 selected')
})

test('a map click selects that feature; Ctrl-click adds another', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeParcels(200), '?e2e=1')
  const drawn = await hook<number[]>(page, 'drawnIds')
  const idles = async () => Number((await page.locator('.canvas-host').getAttribute('data-idles')) ?? 0)
  // Zoom to the feature and wait for the map to settle (an idle after the zoom
  // began), not a fixed time: under load the camera or tiles lag, and the
  // click lands on nothing. The count is read in the same evaluate that zooms,
  // so an idle from before can't pass for it.
  const center = async (id: number) => {
    const before = await page.evaluate((i) => {
      const n = Number(document.querySelector<HTMLElement>('.canvas-host')?.dataset.idles ?? 0)
      ;(window as unknown as { __spatialExplorerE2E: { zoomToFeature(id: number): void } }).__spatialExplorerE2E.zoomToFeature(i)
      return n
    }, id)
    await expect.poll(idles, { timeout: 15000, intervals: [50] }).toBeGreaterThan(before)
    const box = (await page.locator('.canvas-host').boundingBox())!
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const a = await center(drawn[0])
  await page.mouse.click(a.x, a.y)
  await expect.poll(async () => (await selectionState(page)).ids).toEqual([drawn[0]])
  const b = await center(drawn[1])
  await page.keyboard.down('Control')
  await page.mouse.click(b.x, b.y)
  await page.keyboard.up('Control')
  await expect.poll(async () => ((await selectionState(page)).ids ?? []).sort()).toEqual([drawn[0], drawn[1]].sort())
})

test('opening another file clears the previous one at once (user report)', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeParcels(200), '?e2e=1')
  await expect.poll(() => rowCount(page)).toBe(200)
  await page.locator('input[type="file"]').setInputFiles(writeParcels(20000))
  // While the next file opens, nothing of the previous one is shown: nothing on the map (asked of
  // MapLibre itself), no table, no row count.
  const drawn = () => page.evaluate(() => (document.querySelector('.canvas-host') as HTMLElement & { seRendered?: () => unknown[] }).seRendered?.().length ?? 0)
  await expect.poll(drawn, { timeout: 1000, intervals: [50] }).toBe(0)
  await expect(grid(page)).toHaveCount(0, { timeout: 1000 })
  await expect(page.locator('.drawer-header > .count')).not.toContainText('200', { timeout: 1000 })
  await expect(page.getByText('200 features')).toHaveCount(0)
  await expect.poll(() => rowCount(page), { timeout: 60000 }).toBe(20000)
})

test('show selected only ends when a map click clears the selection (user report)', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeParcels(200), '?e2e=1')
  await page.getByRole('checkbox', { name: 'Select row 4', exact: true }).check()
  await expect(bar(page)).toContainText('1 selected')
  await bar(page).getByRole('button', { name: 'Show selected only' }).click()
  await expect.poll(() => rowCount(page)).toBe(1)
  // A click on empty map: nothing is selected, so every row comes back.
  const box = (await page.locator('.canvas-host').boundingBox())!
  await page.mouse.click(box.x + box.width - 80, box.y + box.height - 60)
  await expect.poll(async () => (await selectionState(page)).count).toBe(0)
  await expect.poll(() => rowCount(page)).toBe(200)
  await expect(page.locator('.drawer-header > .count')).not.toContainText(' of ')
})
