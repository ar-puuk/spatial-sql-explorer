// Spec 018: the search box's Words switch (ranked word search with the fts extension).
import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fixture, openFile, openQueryPanel, runQuery } from './helpers'

const notes = [
  ['Old Mill', 'A stone bridge crosses the river beside the old mill. Bridges here date from 1820.'],
  ['Harbour', 'Fishing boats run from the harbour every morning; the bridge is closed to traffic.'],
  ['Station', 'Trains stop here. The station has a cafe and a bike shop.'],
  ['Castle', 'The castle stands above the river. Visitors cross the bridge at the north gate.'],
  ['Meadow', 'Open meadow with wildflowers and no buildings at all.'],
]

function writeNotes(): string {
  const features = notes.map(([name, text], i) => ({ type: 'Feature', properties: { name, text, n: i }, geometry: { type: 'Point', coordinates: [8 + i * 0.1, 47 + i * 0.1] } }))
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-words-')), 'notes.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  return file
}

const box = (page: Page) => page.getByRole('combobox', { name: 'Search' })
const words = (page: Page) => page.getByRole('button', { name: 'Search by words' })

test('Words mode ranks rows by every word, in any form, and a choice selects the row', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeNotes())
  await box(page).focus()
  await expect(words(page)).toBeVisible()
  await expect(words(page)).toHaveAttribute('aria-pressed', 'false')
  await words(page).click()
  await expect(words(page)).toHaveAttribute('aria-pressed', 'true')

  // "bridges" finds the rows that say bridge or bridges (stemming), and not the others.
  await box(page).fill('bridges')
  const options = page.getByRole('group', { name: /^(Words )?in notes.geojson$/i }).getByRole('option')
  await expect(options).toHaveCount(3, { timeout: 60000 })
  await expect(page.getByRole('group', { name: 'Words in notes.geojson' })).toBeVisible()

  // Every word has to be there.
  await box(page).fill('bridge river')
  await expect(options).toHaveCount(2)

  // A word nobody says.
  await box(page).fill('volcano')
  await expect(page.getByText(/No row in .* has all of these words/)).toBeVisible()

  // The plain search still works when the switch is off, and finds the substring "bridg" the words search would not.
  await words(page).click()
  await box(page).fill('bridg')
  await expect(options.first()).toBeVisible()

  // Choosing a hit selects that row.
  await words(page).click()
  await box(page).fill('castle')
  await expect(options).toHaveCount(1)
  await box(page).press('Enter')
  await expect(page.getByText('Castle').first()).toBeVisible()
})

test('a new result gets its own index', async ({ page }) => {
  test.setTimeout(120000)
  await openFile(page, writeNotes())
  await box(page).focus()
  await words(page).click()
  await box(page).fill('bridge')
  const options = page.getByRole('group', { name: /^(Words )?in notes.geojson$/i }).getByRole('option')
  await expect(options).toHaveCount(3, { timeout: 60000 })
  await openQueryPanel(page)
  await runQuery(page, 'SELECT name, text, geom FROM layer WHERE n >= 3')
  await box(page).focus()
  await box(page).fill('bridge ')
  await box(page).fill('bridge')
  await expect(options).toHaveCount(1, { timeout: 60000 })
  await expect(options.first()).toContainText('bridge')
})

test('Words mode is not offered for a layer without text', async ({ page }) => {
  test.setTimeout(120000)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'se-words-')), 'numbers.geojson')
  fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { n: 1 }, geometry: { type: 'Point', coordinates: [8, 47] } }] }))
  await openFile(page, file)
  await box(page).focus()
  await page.waitForTimeout(500)
  await expect(words(page)).toHaveCount(0)
  void fixture
})
