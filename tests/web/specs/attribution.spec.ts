// T008 (spec 008 FR-035): the compact attribution's "i" icon is painted with
// the text token, so it stays visible on dark themes (MapLibre's own icon is
// a black image, invisible on a dark control background).
import { test, expect } from '@playwright/test'
import { fixture, openFile } from './helpers'

const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
const luminance = ([r, g, b]: number[]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

for (const scheme of ['dark', 'light'] as const) {
  test(`attribution icon contrasts with its control in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await openFile(page, fixture('sample.geojson'))
    const button = page.locator('.maplibregl-ctrl-attrib-button')
    await expect(button).toBeAttached()
    const colors = await button.evaluate((el) => {
      const ctrl = el.closest('.maplibregl-ctrl-attrib') as HTMLElement
      return {
        icon: getComputedStyle(el, '::before').backgroundColor,
        image: getComputedStyle(el).backgroundImage,
        mask: getComputedStyle(el, '::before').maskImage || getComputedStyle(el, '::before').getPropertyValue('-webkit-mask-image'),
        control: getComputedStyle(ctrl).backgroundColor,
      }
    })
    expect(colors.image).toBe('none')
    expect(colors.mask).toContain('data:image/svg+xml')
    // The icon's color differs clearly from the control behind it.
    expect(Math.abs(luminance(parse(colors.icon)) - luminance(parse(colors.control)))).toBeGreaterThan(60)
  })
}
