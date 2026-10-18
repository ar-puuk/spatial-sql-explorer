// The query editor colors a function call (a name followed by "(") the way it colors a known function, but leaves
// keywords before a bracket, strings and comments alone.
import { test, expect } from '@playwright/test'
import { editor, fixture, openFile, openQueryPanel, setQuery } from './helpers'

test('function calls are colored; keywords, strings and comments are not', async ({ page }) => {
  await openFile(page, fixture('world-boundaries.geojson'))
  await openQueryPanel(page)
  await setQuery(page, "SELECT ST_Union(geom), h3_latlng_to_cell(1, 2, 3) FROM layer WHERE name IN ('foo(1)') -- bar(2)")
  const calls = page.locator('.cm-sql-call')
  await expect(calls).toHaveText(['ST_Union', 'h3_latlng_to_cell'])
  const color = (sel: string) => editor(page).locator(sel).first().evaluate((el) => getComputedStyle(el).color)
  const fn = await color('.cm-sql-call')
  const keyword = await editor(page).getByText('SELECT', { exact: true }).first().evaluate((el) => getComputedStyle(el).color)
  expect(fn).not.toBe(keyword)
})
