// Spec 027 US1: the picture adjustments of a raster. Sanitizing, MapLibre paint, the QGIS filters and the round trip.
import { describe, expect, it } from 'vitest'
import {
  NEUTRAL_DISPLAY,
  defaultRasterStyle,
  displayPaint,
  factsFromTiler,
  fromQgis,
  isNeutralAdjustment,
  isNeutralDisplay,
  rasterQmlNotes,
  rasterStyleFromQml,
  rasterStyleToQml,
  resamplingFor,
  sanitizeDisplay,
  sanitizeRasterStyle,
  toQgisBrightnessContrast,
  toQgisSaturation,
  type FactsInput,
  type RasterDisplay,
} from '@spatial-explorer/core'
import captured from './fixtures/raster/tiler-info.json'

const files = captured as unknown as Record<string, Pick<FactsInput, 'info' | 'levels' | 'mode' | 'hasPalette' | 'header' | 'stats'>>
const dem = factsFromTiler(files.dem_32612)
const classes = factsFromTiler(files.classes_pal)
const adjusted: RasterDisplay = { brightnessMin: 0.1, brightnessMax: 0.9, contrast: 0.4, saturation: -0.3, hue: 90, resampling: 'nearest' }

describe('sanitizing a display', () => {
  it('anything that is not an object is neutral', () => {
    for (const bad of [null, undefined, 3, 'x', [], true]) expect(sanitizeDisplay(bad)).toEqual(NEUTRAL_DISPLAY)
  })
  it('brings values into MapLibre\'s ranges and puts min below max', () => {
    const d = sanitizeDisplay({ brightnessMin: 2, brightnessMax: -1, contrast: 5, saturation: -9, hue: -90, resampling: 'cubic' })
    expect(d.brightnessMin).toBe(0)
    expect(d.brightnessMax).toBe(1)
    expect(d.contrast).toBe(1)
    expect(d.saturation).toBe(-1)
    expect(d.hue).toBe(270)
    expect(d.resampling).toBe('auto')
  })
  it('ignores NaN and text', () => {
    expect(sanitizeDisplay({ contrast: NaN, hue: 'red' })).toEqual(NEUTRAL_DISPLAY)
  })
  it('knows neutral from adjusted, and adjustments from resampling alone', () => {
    expect(isNeutralDisplay(NEUTRAL_DISPLAY)).toBe(true)
    expect(isNeutralDisplay(undefined)).toBe(true)
    expect(isNeutralDisplay({ ...NEUTRAL_DISPLAY, hue: 1 })).toBe(false)
    expect(isNeutralAdjustment({ ...NEUTRAL_DISPLAY, resampling: 'nearest' })).toBe(true)
    expect(isNeutralAdjustment({ ...NEUTRAL_DISPLAY, saturation: 0.2 })).toBe(false)
  })
})

describe('the map layer\'s paint', () => {
  it('names MapLibre\'s properties', () => {
    expect(displayPaint(adjusted, false)).toEqual({
      'raster-brightness-min': 0.1,
      'raster-brightness-max': 0.9,
      'raster-contrast': 0.4,
      'raster-saturation': -0.3,
      'raster-hue-rotate': 90,
      'raster-resampling': 'nearest',
    })
  })
  it('auto is sharp for classes and smooth otherwise; a choice wins', () => {
    expect(resamplingFor(undefined, true)).toBe('nearest')
    expect(resamplingFor(undefined, false)).toBe('linear')
    expect(resamplingFor({ ...NEUTRAL_DISPLAY, resampling: 'linear' }, true)).toBe('linear')
    expect(resamplingFor({ ...NEUTRAL_DISPLAY, resampling: 'nearest' }, false)).toBe('nearest')
  })
  it('the neutral display paints the neutral values', () => {
    const p = displayPaint(undefined, false)
    expect(p['raster-brightness-min']).toBe(0)
    expect(p['raster-brightness-max']).toBe(1)
    expect(p['raster-contrast']).toBe(0)
  })
})

describe('QGIS\'s scales', () => {
  it('neutral is zero', () => {
    expect(toQgisBrightnessContrast(NEUTRAL_DISPLAY)).toEqual({ brightness: 0, contrast: 0 })
    expect(toQgisSaturation(NEUTRAL_DISPLAY)).toBe(0)
  })
  it('a brighter range shifts up, a darker one down, within ±255', () => {
    expect(toQgisBrightnessContrast({ ...NEUTRAL_DISPLAY, brightnessMin: 0.5, brightnessMax: 1 }).brightness).toBeGreaterThan(0)
    expect(toQgisBrightnessContrast({ ...NEUTRAL_DISPLAY, brightnessMin: 0, brightnessMax: 0.5 }).brightness).toBeLessThan(0)
    expect(Math.abs(toQgisBrightnessContrast({ ...NEUTRAL_DISPLAY, brightnessMin: 1, brightnessMax: 1 }).brightness)).toBeLessThanOrEqual(255)
  })
  it('contrast and saturation are a hundredth of a percent scale', () => {
    expect(toQgisBrightnessContrast({ ...NEUTRAL_DISPLAY, contrast: 0.4 }).contrast).toBe(40)
    expect(toQgisSaturation({ ...NEUTRAL_DISPLAY, saturation: -0.3 })).toBe(-30)
  })
  it('reading QGIS\'s values back stays inside MapLibre\'s ranges', () => {
    const d = fromQgis(100, 40, -30)
    expect(d.contrast).toBeCloseTo(0.4)
    expect(d.saturation).toBeCloseTo(-0.3)
    expect(d.brightnessMin).toBeGreaterThanOrEqual(0)
    expect(d.brightnessMax).toBeLessThanOrEqual(1)
  })
})

describe('in the style', () => {
  it('a neutral display is not stored', () => {
    const s = sanitizeRasterStyle({ ...defaultRasterStyle(dem), display: NEUTRAL_DISPLAY }, dem)!
    expect(s.display).toBeUndefined()
  })
  it('an old style without display reads as it did', () => {
    const s = sanitizeRasterStyle(defaultRasterStyle(dem), dem)!
    expect(s.display).toBeUndefined()
  })
  it('an adjusted display is kept and cleaned', () => {
    const s = sanitizeRasterStyle({ ...defaultRasterStyle(dem), display: { ...adjusted, contrast: 7 } }, dem)!
    expect(s.display).toEqual({ ...adjusted, contrast: 1 })
  })
})

describe('the QGIS file', () => {
  it('writes the filters only when something is adjusted, and our JSON carries all of it', () => {
    const plain = rasterStyleToQml(defaultRasterStyle(dem), dem)
    expect(plain).not.toContain('<brightnesscontrast')
    const style = { ...defaultRasterStyle(dem), display: adjusted }
    const text = rasterStyleToQml(style, dem)
    expect(text).toMatch(/<brightnesscontrast brightness="\d+" contrast="40" gamma="1"\/>/)
    expect(text).toMatch(/<huesaturation [^>]*saturation="-30"/)
    expect(rasterStyleFromQml(text, dem).style.display).toEqual(adjusted)
  })
  it('resampling alone writes no QGIS filter', () => {
    const text = rasterStyleToQml({ ...defaultRasterStyle(dem), display: { ...NEUTRAL_DISPLAY, resampling: 'nearest' } }, dem)
    expect(text).not.toContain('<brightnesscontrast')
  })
  it('a QML QGIS wrote alone gives the display from its filters', () => {
    const text = rasterStyleToQml({ ...defaultRasterStyle(dem), display: adjusted }, dem).replace(/<Option name="spatialExplorer\/raster"[^>]*\/>/, '')
    const d = rasterStyleFromQml(text, dem).style.display!
    expect(d.contrast).toBeCloseTo(0.4)
    expect(d.saturation).toBeCloseTo(-0.3)
  })
  it('says what QGIS cannot show', () => {
    expect(rasterQmlNotes({ ...defaultRasterStyle(dem), display: adjusted }).join(' ')).toMatch(/hue/)
    expect(rasterQmlNotes(defaultRasterStyle(dem)).join(' ')).not.toMatch(/hue/)
  })
  it('a color table keeps its sharp pixels in the JSON', () => {
    const style = { ...defaultRasterStyle(classes), display: { ...NEUTRAL_DISPLAY, resampling: 'linear' as const } }
    expect(rasterStyleFromQml(rasterStyleToQml(style, classes, { palette: classes.palette }), classes).style.display?.resampling).toBe('linear')
  })
})
