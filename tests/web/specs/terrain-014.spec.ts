// Spec 014: 3D terrain on and off, the exaggeration, the cursor elevation and failure handling. The DEM tiles are
// stubbed with a flat 1,000 m Terrarium tile (elevation = R*256 + G + B/256 - 32768, so R=131, G=232), so nothing
// depends on the network.
import { test, expect, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { fixture } from './helpers'

function crc32(buf: Buffer): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
/** A size × size RGB PNG of one color. */
function solidPng(size: number, [r, g, b]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size * 3 }, (_, i) => [r, g, b][i % 3]))])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const DEM_1000M = solidPng(256, [131, 232, 0])

type Hooked = { seMap: import('maplibre-gl').Map }
const demUrl = /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//

async function open(page: Page, stubDem = true): Promise<string[]> {
  const requests: string[] = []
  if (stubDem)
    await page.route(demUrl, (route) => {
      requests.push(route.request().url())
      return route.fulfill({ body: DEM_1000M, contentType: 'image/png' })
    })
  await page.goto('/?e2e=1')
  await page.locator('input[type="file"]').setInputFiles(fixture('world-boundaries.geojson'))
  await page.locator('.canvas-host[data-rendered-features]').waitFor({ state: 'attached', timeout: 60000 })
  return requests
}
const terrainButton = (page: Page) => page.getByRole('button', { name: 'Terrain', exact: true })
const sidePanel = (page: Page) => page.getByRole('region', { name: 'Basemap', exact: true })

test('the Terrain button turns terrain on and off, tilts the map, and shades the relief under the data', async ({ page }) => {
  const requests = await open(page)
  const state = () =>
    page.evaluate(() => {
      const m = (document.querySelector('.canvas-host') as unknown as Hooked).seMap
      const ids = (m.getStyle().layers ?? []).map((l) => l.id)
      return { terrain: !!m.getTerrain(), pitch: m.getPitch(), ids, hasSource: !!m.getSource('terrain-dem') }
    })
  await expect(terrainButton(page)).toHaveAttribute('aria-pressed', 'false')
  expect((await state()).terrain).toBe(false)

  await terrainButton(page).click()
  await expect(terrainButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await state()).terrain).toBe(true)
  await expect.poll(async () => (await state()).pitch).toBeGreaterThan(20)
  const on = await state()
  // The shading sits above the basemap and under our data.
  const shade = on.ids.indexOf('terrain-hillshade')
  expect(shade).toBeGreaterThan(-1)
  const firstData = on.ids.findIndex((id) => id.startsWith('se-'))
  expect(shade).toBeLessThan(firstData)
  await expect.poll(() => requests.length).toBeGreaterThan(0)

  await terrainButton(page).click()
  await expect(terrainButton(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await state()).terrain).toBe(false)
  const off = await state()
  expect(off.ids).not.toContain('terrain-hillshade')
  expect(off.hasSource).toBe(false)
})

test('the Basemap panel switch and slider; the exaggeration is remembered', async ({ page }) => {
  await open(page)
  await page.locator('.rail').getByRole('button', { name: 'Basemap' }).click()
  const section = page.getByRole('region', { name: 'Terrain', exact: true })
  await expect(section).toBeVisible()
  await section.getByRole('checkbox', { name: /^3D terrain/ }).check()
  await expect(terrainButton(page)).toHaveAttribute('aria-pressed', 'true')
  const slider = section.getByRole('slider', { name: 'Terrain exaggeration' })
  await slider.fill('2.5')
  await expect.poll(() => page.locator('.canvas-host').getAttribute('data-terrain')).toBe('2.5')
  await section.getByRole('checkbox', { name: /^3D terrain/ }).uncheck()
  await expect.poll(() => page.locator('.canvas-host').getAttribute('data-terrain')).toBe('')

  // Off at every start, the exaggeration kept.
  await page.reload()
  await open(page)
  await expect(terrainButton(page)).toHaveAttribute('aria-pressed', 'false')
  await page.locator('.rail').getByRole('button', { name: 'Basemap' }).click().catch(() => {})
  if (!(await sidePanel(page).isVisible())) await page.locator('.rail').getByRole('button', { name: 'Basemap' }).click()
  await expect(page.getByRole('slider', { name: 'Terrain exaggeration' })).toHaveValue('2.5')
})

test('the cursor reports meters, whatever the exaggeration', async ({ page }) => {
  await open(page)
  // Show the readout on the map.
  await page.locator('.rail').getByRole('button', { name: 'Map controls' }).click()
  await page.getByRole('checkbox', { name: /^Coordinates/ }).check()
  await terrainButton(page).click()
  const box = (await page.locator('.canvas-host').boundingBox())!
  const readout = page.locator('.map-view .coords')
  const wiggle = async (): Promise<void> => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2 + 5)
  }
  await expect.poll(async () => { await wiggle(); return (await readout.innerText()).includes('1,000 m') }, { timeout: 20000 }).toBe(true)

  // Exaggerate 2.5x: the surface is lifted, the reading stays 1,000 m.
  await page.locator('.rail').getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('slider', { name: 'Terrain exaggeration' }).fill('2.5')
  await expect.poll(() => page.locator('.canvas-host').getAttribute('data-terrain')).toBe('2.5')
  await page.waitForTimeout(500)
  await wiggle()
  await expect.poll(async () => { await wiggle(); return (await readout.innerText()).includes('1,000 m') }, { timeout: 20000 }).toBe(true)
  // What is copied is the coordinates only.
  expect(await readout.getAttribute('aria-label')).not.toContain('m')
})

test('terrain works on the globe too, and a basemap switch keeps the shading above it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page)
  await terrainButton(page).click()
  await expect.poll(() => page.locator('.canvas-host').getAttribute('data-terrain')).toBe('1')
  await page.getByRole('button', { name: 'Globe view' }).click()
  await page.waitForTimeout(1500)
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Globe view' }).click()
  await page.waitForTimeout(500)

  // A basemap swap (Blank needs no network): the new layers go under the shading.
  await page.locator('.rail').getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('radio', { name: /^Blank/ }).click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const m = (document.querySelector('.canvas-host') as unknown as Hooked).seMap
        const ids = (m.getStyle().layers ?? []).map((l) => l.id)
        const basemap = (document.querySelector('.canvas-host') as HTMLElement).dataset.basemapLayers?.split(',') ?? []
        const shade = ids.indexOf('terrain-hillshade')
        return shade > -1 && basemap.length > 0 && basemap.every((id) => ids.indexOf(id) < shade)
      })
    )
    .toBe(true)
  expect(errors).toEqual([])
})

test('when the elevation tiles fail, terrain goes off with a short message', async ({ page }) => {
  await page.route(demUrl, (route) => route.abort())
  await open(page, false)
  await terrainButton(page).click()
  await expect(page.getByRole('status').filter({ hasText: 'Terrain could not be loaded' })).toBeVisible({ timeout: 30000 })
  await expect(terrainButton(page)).toHaveAttribute('aria-pressed', 'false')
})

test('the relief follows the basemap: over satellite imagery it has shadows only, over a plain map a soft highlight', async ({ page }) => {
  // Imagery tiles are a pixel; nothing here needs the network.
  const PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await page.route(/^https:\/\/server\.arcgisonline\.com\//, (route) => route.fulfill({ body: PX, contentType: 'image/png' }))
  await open(page)
  await terrainButton(page).click()
  await expect.poll(() => page.locator('.canvas-host').getAttribute('data-terrain')).toBe('1')
  const highlight = () =>
    page.evaluate(() => {
      const m = (document.querySelector('.canvas-host') as unknown as Hooked).seMap
      return String(m.getPaintProperty('terrain-hillshade', 'hillshade-highlight-color'))
    })
  const alpha = async (): Promise<number> => {
    const v = await highlight()
    // MapLibre reports a color as a string or an object; take the last number of rgba(...).
    const m = /([\d.]+)\)?$/.exec(v.replace(/\s/g, '')) ?? []
    return Number(m[1])
  }
  await page.locator('.rail').getByRole('button', { name: 'Basemap' }).click()
  await page.getByRole('radio', { name: /^Satellite/ }).click()
  await expect.poll(async () => (await highlight()).replace(/\s/g, '')).toMatch(/,0\)$|^rgba\(255,255,255,0\)$|"a":0|a:0/)
  await page.getByRole('radio', { name: /^Blank/ }).click()
  await expect.poll(alpha).toBeGreaterThan(0.3)
})
