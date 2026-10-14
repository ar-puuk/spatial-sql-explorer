// T080 (spec 008 US7, FR-031): the web share link.
import { test, expect, type Page } from '@playwright/test'
import { editor, fixture, openFile, openQueryPanel, runQuery, chooseStyleType } from './helpers'

type MapState = { projection: string; center?: [number, number]; zoom?: number; pitch?: number; bearing?: number }
const mapState = (page: Page) => page.evaluate(() => (window as unknown as { __spatialExplorerE2E: { mapState(): MapState } }).__spatialExplorerE2E.mapState())
const hook = <T,>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(([n, a]) => (window as unknown as { __spatialExplorerE2E: Record<string, (...x: unknown[]) => unknown> }).__spatialExplorerE2E[n as string](...(a as unknown[])) as T, [name, args] as const)

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

/** Opens a file, runs a query, styles it, picks a basemap, the globe, and a view; returns the copied link. */
async function makeLink(page: Page): Promise<string> {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await openQueryPanel(page)
  await runQuery(page, "SELECT * FROM layer WHERE name LIKE 'S%'")
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await chooseStyleType(page, 'Categorized')
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await page.getByRole('region', { name: 'Basemap' }).getByRole('radio', { name: /^Blank/ }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Globe view' }).click()
  await hook(page, 'jumpTo', 20, 10, 2.5)
  await expect.poll(async () => (await mapState(page)).zoom ?? 0).toBeCloseTo(2.5, 1)
  await page.getByRole('button', { name: 'Copy link' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toBe(await hook<string>(page, 'shareLink'))
  return link
}

test('Copy link: a #v1= link without data; opening it asks for the file, then restores the view', async ({ page, context }) => {
  test.setTimeout(120000)
  const link = await makeLink(page)
  expect(link).toMatch(/#v1=[A-Za-z0-9_-]+$/)
  expect(link.length).toBeLessThan(2048)
  expect(link).not.toContain('Senegal')

  const other = await context.newPage()
  await other.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  const [base, hash] = link.split('#')
  await other.goto(`${base}?e2e=1#${hash}`)
  await expect(other.getByRole('status').filter({ hasText: 'This link shows a view of world-boundaries.geojson' })).toBeVisible()
  await other.locator('input[type="file"]').setInputFiles(fixture('world-boundaries.geojson'))
  await expect(other.getByRole('status').filter({ hasText: 'The shared view was applied.' })).toBeVisible({ timeout: 60000 })
  await expect(other.locator('.query-status')).toContainText('rows')
  await openQueryPanel(other)
  await expect(editor(other)).toContainText("name LIKE 'S%'")
  await expect(other.getByRole('region', { name: 'Legend' })).toContainText('id · ')
  await expect(other.getByRole('button', { name: 'Basemap', exact: true })).toHaveAttribute('title', 'Basemap: Blank')
  await expect(other.getByRole('button', { name: 'Globe view' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await mapState(other)).zoom ?? 0).toBeCloseTo(2.5, 1)
  const center = (await mapState(other)).center!
  expect(Math.abs(center[0] - 20)).toBeLessThan(0.5)
  expect(Math.abs(center[1] - 10)).toBeLessThan(0.5)
  // Applied once: the hash is cleared.
  expect(new URL(other.url()).hash).toBe('')
})

test('a different file: a warning, and the link still applies', async ({ page, context }) => {
  test.setTimeout(120000)
  const link = await makeLink(page)
  const other = await context.newPage()
  await other.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  const [base, hash] = link.split('#')
  await other.goto(`${base}?e2e=1#${hash}`)
  await other.locator('input[type="file"]').setInputFiles(fixture('usa-utm12n.gpkg'))
  const notice = other.getByRole('alert').filter({ hasText: 'The link was made with world-boundaries.geojson' })
  await expect(notice).toBeVisible({ timeout: 60000 })
  await expect(other.getByRole('button', { name: 'Globe view' })).toHaveAttribute('aria-pressed', 'true')
})

test('a link that can not be read says so; an over-long link offers Copy query', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/?e2e=1#v1=not-a-real-link')
  await expect(page.getByRole('alert')).toContainText('This link could not be read')

  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await openQueryPanel(page)
  // Random text doesn't compress: the link would pass the 8,000-character limit.
  const noise = Array.from({ length: 9000 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
  await runQuery(page, `SELECT * FROM layer -- ${noise}`)
  await page.getByRole('button', { name: 'Copy link' }).click()
  const notice = page.getByRole('alert').filter({ hasText: 'characters long' })
  await expect(notice).toBeVisible()
  await notice.getByRole('button', { name: 'Copy query' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Query copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(noise)
})
