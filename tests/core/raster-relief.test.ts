// Spec 027 US2: the relief setting, its MapLibre paint, when it is offered, and the packing of values into a DEM tile.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RELIEF,
  DEM_TOP,
  RELIEF_METHODS,
  canOfferRelief,
  defaultRasterStyle,
  demEncodingFor,
  demFill,
  demSourceEncoding,
  encodingFor,
  factsFromTiler,
  isReliefStored,
  packValue,
  reliefPaint,
  sanitizeRasterStyle,
  sanitizeRelief,
  unpackValue,
  type FactsInput,
} from '@spatial-explorer/core'
import captured from './fixtures/raster/tiler-info.json'

const files = captured as unknown as Record<string, Pick<FactsInput, 'info' | 'levels' | 'mode' | 'hasPalette' | 'header' | 'stats'>>
const dem = factsFromTiler(files.dem_32612)
const rgb = factsFromTiler(files.rgb_cog)
const classes = factsFromTiler(files.classes_pal)

describe('sanitizing a relief', () => {
  it('anything that is not an object is the default, off', () => {
    for (const bad of [null, undefined, 4, 'x', [], true]) expect(sanitizeRelief(bad)).toEqual(DEFAULT_RELIEF)
    expect(DEFAULT_RELIEF.on).toBe(false)
  })
  it('keeps values in MapLibre\'s ranges and refuses a method or color it does not know', () => {
    const r = sanitizeRelief({ on: true, method: 'nonsense', direction: -90, altitude: 200, exaggeration: 3, shadow: 'red', highlight: '#12345', accent: '#abcdef' })
    expect(r).toMatchObject({ on: true, method: 'standard', direction: 270, altitude: 90, exaggeration: 1, shadow: '#000000', highlight: '#ffffff', accent: '#abcdef' })
  })
  it('every method MapLibre has is accepted', () => {
    for (const m of RELIEF_METHODS) expect(sanitizeRelief({ method: m.id }).method).toBe(m.id)
    expect(RELIEF_METHODS.map((m) => m.id).sort()).toEqual(['basic', 'combined', 'igor', 'multidirectional', 'standard'])
  })
  it('only a relief that is on or changed is worth storing', () => {
    expect(isReliefStored(undefined)).toBe(false)
    expect(isReliefStored(DEFAULT_RELIEF)).toBe(false)
    expect(isReliefStored({ ...DEFAULT_RELIEF, on: true })).toBe(true)
    expect(isReliefStored({ ...DEFAULT_RELIEF, direction: 10 })).toBe(true)
  })
})

describe('in the style', () => {
  it('an old style without relief reads as it did, and a default relief is not stored', () => {
    expect(sanitizeRasterStyle(defaultRasterStyle(dem), dem)!.relief).toBeUndefined()
    expect(sanitizeRasterStyle({ ...defaultRasterStyle(dem), relief: DEFAULT_RELIEF }, dem)!.relief).toBeUndefined()
  })
  it('a relief that is on is kept, cleaned', () => {
    const s = sanitizeRasterStyle({ ...defaultRasterStyle(dem), relief: { ...DEFAULT_RELIEF, on: true, altitude: 500 } }, dem)!
    expect(s.relief).toMatchObject({ on: true, altitude: 90 })
  })
})

describe('the hillshade layer\'s paint', () => {
  it('names MapLibre\'s properties and fixes the light to the map', () => {
    expect(reliefPaint({ ...DEFAULT_RELIEF, on: true, direction: 90, altitude: 20, exaggeration: 0.8, method: 'igor' })).toEqual({
      'hillshade-method': 'igor',
      'hillshade-illumination-direction': 90,
      'hillshade-illumination-altitude': 20,
      'hillshade-illumination-anchor': 'map',
      'hillshade-exaggeration': 0.8,
      'hillshade-shadow-color': '#000000',
      'hillshade-highlight-color': '#ffffff',
      'hillshade-accent-color': '#000000',
    })
  })
})

describe('when relief is offered', () => {
  it('one band of numbers: yes', () => {
    expect(canOfferRelief(dem, defaultRasterStyle(dem)).ok).toBe(true)
  })
  it('a colour image is not, and the reason says what to do', () => {
    const offer = canOfferRelief(rgb, defaultRasterStyle(rgb))
    expect(offer.ok).toBe(false)
    expect(offer.reason).toMatch(/one band/)
  })
  it('classes are not', () => {
    const offer = canOfferRelief(classes, defaultRasterStyle(classes))
    expect(offer.ok).toBe(false)
    expect(offer.reason).toMatch(/classes/)
  })
  it('a colour image drawn as one band can have it', () => {
    expect(canOfferRelief(rgb, { mode: 'single' }).ok).toBe(true)
  })
})

describe('packing values into a tile', () => {
  it('holds the range with room, and the step is fine', () => {
    const e = encodingFor(1000, 3000)
    expect(e.base).toBeLessThan(1000)
    expect(e.base + e.step * DEM_TOP).toBeGreaterThan(3000)
    expect(e.step).toBeLessThan(0.002)
  })
  it('a value comes back within one step', () => {
    const e = encodingFor(-500, 9000)
    for (const v of [-500, 0, 1234.5678, 8848.86, 9000]) {
      const n = packValue(v, e)
      const back = unpackValue(Math.floor(n / 65536), Math.floor(n / 256) % 256, n % 256, e)
      expect(Math.abs(back - v)).toBeLessThanOrEqual(e.step)
    }
  })
  it('a value beyond the range is held at the end, not wrapped', () => {
    const e = encodingFor(0, 100)
    expect(packValue(1e9, e)).toBe(DEM_TOP)
    expect(packValue(-1e9, e)).toBe(0)
  })
  it('MapLibre\'s custom encoding gives the same number as ours for any three bytes', () => {
    const e = encodingFor(1400, 2500)
    const m = demSourceEncoding(e)
    expect(m.encoding).toBe('custom')
    for (const [r, g, b] of [[0, 0, 0], [1, 2, 3], [128, 255, 7], [255, 255, 255]]) {
      expect(m.baseShift + r * m.redFactor + g * m.greenFactor + b * m.blueFactor).toBeCloseTo(unpackValue(r, g, b, e), 9)
    }
  })
  it('the packing for a band follows its statistics with room, else the sample type', () => {
    const e = demEncodingFor({ min: 1000, max: 2000 }, 'float32')
    expect(e.base).toBeLessThan(900)
    expect(e.base + e.step * DEM_TOP).toBeGreaterThan(2100)
    expect(demEncodingFor(undefined, 'uint8').base).toBeLessThan(0)
    expect(demEncodingFor({ min: 5, max: 5 }, 'int16').base).toBeLessThan(-30000)
  })
  it('empty ground is packed as the band\'s mean, else the middle', () => {
    const e = encodingFor(0, 100)
    expect(demFill({ mean: 42 }, e)).toBe(42)
    expect(demFill(undefined, e)).toBeCloseTo(50, 6)
  })
})
