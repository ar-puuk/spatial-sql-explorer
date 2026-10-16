// T079 (spec 008 US7, FR-030, SC-007): the map as a PNG.
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { fixture, openFile, chooseStyleType, openStyle, varyBy } from './helpers'

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Print map' })
/** PNG width and height from the IHDR chunk. */
const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20), png: b.subarray(1, 4).toString('latin1') === 'PNG' })

type Shot = { width: number; height: number; notes: string[]; base64: string }
const capture = (page: Page, scale: 1 | 2, legend: boolean | object) =>
  page.evaluate(([s, l]) => (window as unknown as { __spatialExplorerE2E: { captureMap(s: 1 | 2, l: boolean | object): Promise<Shot> } }).__spatialExplorerE2E.captureMap(s, l), [scale, legend] as const)
/** One pixel of a PNG, decoded by the browser. */
const pixel = (page: Page, base64: string, x: number, y: number) =>
  page.evaluate(
    async ([b, px, py]) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return Array.from(ctx.getImageData(px, py, 1, 1).data)
    },
    [base64, x, y] as const
  )

test('Export map image: 1x and 2x PNGs of the map, through the dialog, in under 5 s', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const map = (await page.locator('.canvas-host').boundingBox())!
  const open = page.getByRole('button', { name: 'Print map…' })
  await open.click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('radio', { name: '2×' })).toHaveAttribute('aria-checked', 'true')

  for (const scale of [1, 2] as const) {
    await dialog(page).getByRole('radio', { name: `${scale}×` }).click()
    const started = Date.now()
    const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Save' }).click()])
    expect(download.suggestedFilename()).toBe('world-boundaries-map.png')
    const size = pngSize(fs.readFileSync((await download.path())!))
    expect(Date.now() - started).toBeLessThan(5000) // SC-007
    expect(size.png).toBe(true)
    expect(size.width).toBe(Math.round(map.width) * scale)
    expect(size.height).toBe(Math.round(map.height) * scale)
    await expect(dialog(page).getByRole('status').filter({ hasText: 'Saved' })).toContainText(`${size.width} × ${size.height} px`)
  }
  // The map goes back to the screen's pixel ratio.
  await dialog(page).getByRole('button', { name: 'Done' }).click()
  await expect(dialog(page)).toHaveCount(0)
  await expect(open).toBeFocused()
})

test('the legend is drawn into the image', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const without = await capture(page, 1, false)
  const withLegend = await capture(page, 1, true)
  expect(withLegend.width).toBe(without.width)
  // The test legend's swatch (#ff0000) sits in the bottom-left box.
  const [r, g, b] = await pixel(page, withLegend.base64, 24, withLegend.height - 45)
  expect(r).toBeGreaterThan(200)
  expect(g).toBeLessThan(60)
  expect(b).toBeLessThan(60)
  const plain = await pixel(page, without.base64, 24, without.height - 45)
  expect(plain[0] > 200 && plain[1] < 60).toBe(false)
})

test('the dialog offers the legend only when one is shown', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await page.getByRole('button', { name: 'Print map…' }).click()
  await expect(dialog(page).getByRole('checkbox', { name: 'Include legend' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await chooseStyleType(page, 'Categorized')
  await page.getByRole('button', { name: 'Style', exact: true }).click()
  await page.getByRole('button', { name: 'Print map…' }).click()
  await expect(dialog(page).getByRole('checkbox', { name: 'Include legend' })).toBeChecked()
})

test('a raster basemap whose tiles can not be read: the image is still made, and says the basemap is left out', async ({ page }) => {
  test.setTimeout(120000)
  // MapLibre fetches tiles with CORS: a server that doesn't allow it fails
  // the tiles (they can't taint the canvas); the basemap falls back to blank.
  await page.route(/arcgisonline\.com/, (route) => route.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await page.getByRole('region', { name: 'Basemap' }).getByRole('radio', { name: /^Satellite/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.map-notice')).toContainText(/Satellite basemap unavailable/, { timeout: 30000 })
  await page.getByRole('button', { name: 'Print map…' }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Save' }).click()])
  expect(pngSize(fs.readFileSync((await download.path())!)).png).toBe(true)
  await expect(dialog(page)).toContainText('basemap could not be loaded')
})

// Spec 009 T030 (US6): a second legend group (the size channel) is drawn under the first, with its own title.
test('the size channel group is drawn into the image, under the color group', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const symbol = { fillColor: '#0000ff', fillOpacity: 1, strokeColor: '#0000ff', strokeOpacity: 1, strokeWidth: 0, lineColor: '#0000ff', lineWidth: 3, radius: 6, shape: 'circle', dash: 'solid' }
  const legend = {
    title: 'Legend',
    shape: 'area',
    alpha: 1,
    rows: [{ color: '#ff0000', label: 'A' }],
    groups: [{ title: 'aadt · Quantile, 2 classes', shape: 'point', alpha: 1, rows: [{ color: '#0000ff', label: 'Small', symbol: { ...symbol, radius: 3 } }, { color: '#0000ff', label: 'Large', symbol }] }],
  }
  const shot = await capture(page, 1, legend)
  // Lines: title, A, group title, Small, Large. Each line is 18 px; the box sits 28 px above the bottom.
  const lines = 5
  const top = shot.height - (lines * 18 + 14) - 28
  const centerOf = (line: number) => top + 8 + 12 + 18 * line - 5
  const [r, g, b] = await pixel(page, shot.base64, 25, centerOf(4))
  expect(b).toBeGreaterThan(200)
  expect(r).toBeLessThan(60)
  expect(g).toBeLessThan(60)
  // The color group's swatch is still red, above.
  const red = await pixel(page, shot.base64, 24, centerOf(1))
  expect(red[0]).toBeGreaterThan(200)
})

// Spec 009 T049 (US6): the bivariate square is drawn into the image: axis 2's label, the cells
// (rows high to low), axis 1's label, No value; a hidden cell is hollow.
test('the bivariate square is drawn into the image, hidden cells hollow', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#800000', '#008000', '#000080']
  const legend = {
    title: 'a × b · Quantile',
    shape: 'area',
    alpha: 1,
    rows: [],
    bivariate: { x: 'a', y: 'b', nx: 3, ny: 3, cells: colors.map((color, k) => ({ color, visible: k !== 4 })), noValue: { color: '#8c8c8c', label: 'No value', count: 3, visible: true } },
  }
  const shot = await capture(page, 1, legend)
  // Lines: title, axis 2, three cell rows (j = 2, 1, 0), axis 1, No value.
  const lines = 7
  const top = shot.height - (lines * 18 + 14) - 28
  const centerOf = (line: number) => top + 8 + 12 + 18 * line - 5
  const hex = async (i: number, j: number) => {
    const [r, g, b] = await pixel(page, shot.base64, 26 + 18 * i, centerOf(2 + (2 - j)))
    return [r, g, b].map((v) => (v > 200 ? 'ff' : v < 60 ? '00' : 'xx')).join('')
  }
  expect(await hex(0, 0)).toBe('ff0000') // low/low: bottom-left
  expect(await hex(2, 0)).toBe('0000ff')
  expect(await hex(1, 2)).toBe('00xx00') // #008000: dark green, top row
  expect(await hex(1, 1)).toBe('ffffff') // hidden: hollow (the light legend box shows through)
})

// Spec 011 T049/T068 (US5, US8): the saved image has the labels as drawn and every legend group:
// one merged (color and shape by severity), a bar (outline color continuous), samples (opacity).
test('labels and the merged, bar and sample groups are in the saved image', async ({ page }) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('crashes.geojson'), '?e2e=1')
  await page.getByRole('button', { name: 'Basemap', exact: true }).click()
  await page.getByRole('radio', { name: /^Blank/ }).click()
  await openStyle(page)
  const panel = page.getByRole('region', { name: 'Layer style' })
  await chooseStyleType(page, 'Categorized')
  await panel.getByLabel('Column', { exact: true }).selectOption('severity')
  await varyBy(page, 'Shape')
  await panel.getByLabel('Shape column').selectOption('severity')
  await varyBy(page, 'Outline color')
  await panel.getByLabel('Outline color column').selectOption('age_days')
  await panel.getByLabel('Outline color scale').selectOption({ label: 'Continuous' })
  await varyBy(page, 'Opacity')
  await panel.getByLabel('Opacity column').selectOption('age_days')
  await panel.getByLabel('Opacity scale').selectOption({ label: 'Continuous' })
  const legend = page.getByRole('region', { name: 'Legend' })
  await expect(legend.getByRole('group')).toHaveCount(3)

  /** Saves the image through the dialog (with its legend) and returns it as base64. */
  const save = async (): Promise<string> => {
    await page.getByRole('button', { name: 'Print map…' }).click()
    await dialog(page).getByRole('radio', { name: '1×' }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Save' }).click()])
    const b64 = fs.readFileSync((await download.path())!).toString('base64')
    await dialog(page).getByRole('button', { name: 'Done' }).click()
    return b64
  }
  /** Pixels near `rgb` (within 40 per channel) in a region of the image. */
  const near = (b64: string, rgb: number[], region: { x0: number; y0: number; x1: number; y1: number }) =>
    page.evaluate(
      async ([b, c, r]) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b}`
        await img.decode()
        const cv = document.createElement('canvas')
        cv.width = img.width
        cv.height = img.height
        const ctx = cv.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const x1 = Math.min(r.x1, img.width)
        const y1 = Math.min(r.y1, img.height)
        const d = ctx.getImageData(r.x0, r.y0, x1 - r.x0, y1 - r.y0).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - c[0]) < 40 && Math.abs(d[i + 1] - c[1]) < 40 && Math.abs(d[i + 2] - c[2]) < 40) n++
        return n
      },
      [b64, rgb, region] as const
    )
  const before = await save()
  await page.getByRole('button', { name: 'Labels', exact: true }).click()
  await page.getByRole('complementary', { name: 'Labels' }).getByRole('checkbox', { name: 'Show labels' }).check()
  await expect.poll(async () => Number(await page.locator('.canvas-host').getAttribute('data-rendered-labels')), { timeout: 20000 }).toBeGreaterThan(0)
  const after = await save()
  // The labels' dark text (#1f2937) in the map's upper half, where the legend isn't.
  const top = { x0: 0, y0: 0, x1: 2000, y1: 250 }
  expect(await near(after, [31, 41, 55], top)).toBeGreaterThan((await near(before, [31, 41, 55], top)) + 200)
  // The outline color's bar: viridis' ends (#440154, #fde725) in the legend box (bottom left).
  const box = { x0: 0, y0: 200, x1: 340, y1: 2000 }
  expect(await near(after, [0x44, 0x01, 0x54], box)).toBeGreaterThan(5)
  expect(await near(after, [0xfd, 0xe7, 0x25], box)).toBeGreaterThan(5)
  fs.writeFileSync(test.info().outputPath('map-image-011.png'), Buffer.from(after, 'base64'))
})

// Spec 016 (GeoLibre's Print options): PNG, PDF and SVG, on the map's size or on paper.
async function saveAs(page: Page, setup: (d: ReturnType<typeof dialog>) => Promise<void>) {
  await page.getByRole('button', { name: 'Print map…' }).click()
  await setup(dialog(page))
  const [download] = await Promise.all([page.waitForEvent('download'), dialog(page).getByRole('button', { name: 'Save' }).click()])
  return { name: download.suggestedFilename(), bytes: fs.readFileSync((await download.path())!) }
}
const chooseFormat = (d: ReturnType<typeof dialog>, name: string) => d.getByRole('radio', { name, exact: true }).click()
const choosePage = async (page: Page, d: ReturnType<typeof dialog>, option: string) => {
  await d.getByRole('button', { name: 'Page', exact: true }).click()
  await page.getByRole('option', { name: option, exact: false }).first().click()
}

test('a PNG on A4, landscape for a wide map, at 150 dpi, with a title', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const out = await saveAs(page, async (d) => {
    await choosePage(page, d, 'A4')
    await d.getByLabel('Title').fill('World boundaries')
  })
  expect(out.name).toBe('world-boundaries-map.png')
  const size = pngSize(out.bytes)
  expect(size.png).toBe(true)
  // The map pane is wider than tall: A4 turned to landscape, 297 x 210 mm at 150 dpi.
  expect(size.width).toBe(1754)
  expect(size.height).toBe(1240)
  await expect(dialog(page).getByRole('status').filter({ hasText: 'Saved' })).toContainText('1754 × 1240 px')
})

test('a PDF: one page of the chosen paper', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const out = await saveAs(page, async (d) => {
    await chooseFormat(d, 'PDF')
    await choosePage(page, d, 'Letter')
    await d.getByRole('radio', { name: 'Portrait' }).click()
  })
  expect(out.name).toBe('world-boundaries-map.pdf')
  const text = out.bytes.toString('latin1')
  expect(text.startsWith('%PDF-')).toBe(true)
  // Letter portrait is 612 x 792 points.
  expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+612(\.\d*)?\s+792(\.\d*)?\s*\]/)
  expect(text.match(/\/Type\s*\/Page\b/g)?.length).toBe(1)
})

test('an SVG: the title, scale bar and north arrow are real text and shapes, the map one picture', async ({ page }) => {
  test.setTimeout(120000)
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  const out = await saveAs(page, async (d) => {
    await chooseFormat(d, 'SVG')
    await choosePage(page, d, 'A4')
    await d.getByLabel('Title').fill('Every country')
  })
  expect(out.name).toBe('world-boundaries-map.svg')
  const svg = out.bytes.toString('utf8')
  expect(svg.startsWith('<?xml')).toBe(true)
  expect(svg).toMatch(/width="297mm"/)
  expect(svg).toMatch(/height="210mm"/)
  expect(svg).toContain('Every country')
  expect(svg).toMatch(/<text[^>]*>[^<]*\bN\b/) // the north arrow's letter
  expect(svg).toMatch(/\d+ (km|m|cm)\b/) // the scale bar's length
  expect(svg.match(/<image\b/g)?.length).toBe(1) // the map, and nothing else is a picture
})

test('the paper options are only offered for a page, and a map-size page keeps 1x and 2x', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', (r) => r.abort())
  await openFile(page, fixture('world-boundaries.geojson'), '?e2e=1')
  await page.getByRole('button', { name: 'Print map…' }).click()
  await expect(dialog(page).getByRole('radio', { name: '2×' })).toBeVisible()
  await expect(dialog(page).getByRole('radio', { name: 'Portrait' })).toHaveCount(0)
  await choosePage(page, dialog(page), 'A3')
  await expect(dialog(page).getByRole('radio', { name: 'Portrait' })).toBeVisible()
  await expect(dialog(page).getByRole('radio', { name: '2×' })).toHaveCount(0)
  await chooseFormat(dialog(page), 'SVG')
  await expect(dialog(page).getByRole('radio', { name: '300 dpi' })).toHaveCount(0)
})
