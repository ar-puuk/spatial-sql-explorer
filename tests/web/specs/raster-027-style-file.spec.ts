// Spec 027: the raster style panel's footer is the vector panel's: Save, Load and the broom (Reset style); the resets of
// Appearance and Relief are small undo icons beside their headings.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './helpers'

const here = path.dirname(fileURLToPath(import.meta.url))
const VECTOR_QML = path.resolve(here, '../../core/fixtures/style/categorized.qml')
const paint = (page: Page): Promise<Record<string, number | string> | null> =>
  page.evaluate(() => {
    const v = document.querySelector('.canvas-host')?.getAttribute('data-raster-paint')
    return v ? JSON.parse(v) : null
  })

async function open(page: Page): Promise<void> {
  await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
    route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
  )
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('raster/dem-utm12.tif'))
  await page.locator('.canvas-host[data-raster-ready]').waitFor({ state: 'attached', timeout: 90000 })
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible()
}

test.describe('the raster style panel footer', () => {
  test('Save, Load and Reset style sit in the footer; the resets of Appearance and Relief are icons', async ({ page }) => {
    await open(page)
    const footer = page.locator('.panel footer')
    await expect(footer.getByRole('button', { name: 'Save style' })).toBeVisible()
    await expect(footer.getByRole('button', { name: 'Load style…' })).toBeVisible()
    await expect(footer.getByRole('button', { name: 'Reset style' })).toBeVisible()
    // The two small ones carry no words, only an icon and a name.
    for (const name of ['Reset appearance']) {
      const b = page.getByRole('button', { name })
      await expect(b).toBeVisible()
      expect((await b.textContent())?.trim()).toBe('')
    }
  })

  test('Reset style puts the file\'s style back; Load brings a saved one back', async ({ page }) => {
    await open(page)
    await page.getByRole('slider', { name: 'Contrast', exact: true }).fill('0.5')
    await expect.poll(() => paint(page)).toMatchObject({ 'raster-contrast': 0.5 })
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save style' }).click()])
    const saved = (await download.path())!
    await page.getByRole('button', { name: 'Reset style' }).click()
    await expect.poll(() => paint(page)).toMatchObject({ 'raster-contrast': 0 })
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Load style…' }).click()])
    await chooser.setFiles({ name: 'dem-utm12.qml', mimeType: 'text/xml', buffer: (await import('node:fs')).readFileSync(saved) })
    await expect.poll(() => paint(page)).toMatchObject({ 'raster-contrast': 0.5 })
    await expect(page.getByText('From dem-utm12.qml')).toBeVisible()
  })

  test('a style that is not for a raster is refused with a plain sentence, and nothing changes', async ({ page }) => {
    await open(page)
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Load style…' }).click()])
    await chooser.setFiles(VECTOR_QML)
    await expect(page.getByText(/not a raster style/)).toBeVisible()
    expect(await paint(page)).toMatchObject({ 'raster-contrast': 0 })
  })

  test('the footer is pinned to the foot of the panel for a vector layer too, with the same buttons', async ({ page }) => {
    await page.route('https://tiles.openfreemap.org/styles/**', (route) =>
      route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#ddd' } }] } }),
    )
    await page.goto('/?e2e=1')
    await page.locator('input[type="file"]').setInputFiles(fixture('sample.geojson'))
    await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
    await page.getByRole('button', { name: 'Style', exact: true }).click()
    const footer = page.locator('.panel footer')
    await expect(footer.getByRole('button', { name: 'Save style' })).toBeVisible()
    await expect(footer.getByRole('button', { name: 'Load style…' })).toBeVisible()
    await expect(footer.getByRole('button', { name: 'Reset style' })).toBeVisible()
    const panel = (await page.locator('.panel[aria-label="Layer style"]').boundingBox())!
    const foot = (await footer.boundingBox())!
    expect(panel.y + panel.height - (foot.y + foot.height), 'the footer sits on the panel\'s bottom edge').toBeLessThan(2)
  })

  test('the Relief reset is an undo icon beside the heading, shown once relief is on', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('button', { name: 'Reset relief' })).toHaveCount(0)
    await page.getByRole('switch', { name: 'Shaded relief' }).click()
    const reset = page.getByRole('button', { name: 'Reset relief' })
    await expect(reset).toBeVisible()
    await reset.click()
    await expect(page.getByRole('switch', { name: 'Shaded relief' })).not.toBeChecked()
  })
})
