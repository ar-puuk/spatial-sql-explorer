// Spec 026 T008: defaults chosen from the file, the tiler's options, and reading a style back safely.
import { describe, expect, it } from 'vitest'
import { NO_NODATA_VALUE, RASTER_COLORMAPS, COLORMAP_GROUPS, defaultRange, defaultRasterStyle, factsFromTiler, isColormap, sameRender, sanitizeRasterStyle, toRenderOptions, withBand, withChannel, withCommonRange, withMode, withRangePreset, type FactsInput, type RasterFacts, type RasterStyle } from '@spatial-explorer/core'
import captured from './fixtures/raster/tiler-info.json'
import colormapFixture from './fixtures/raster/colormaps.json'

const files = captured as unknown as Record<string, Pick<FactsInput, 'info' | 'levels' | 'mode' | 'hasPalette' | 'header' | 'stats'>>
const facts = (name: string): RasterFacts => factsFromTiler(files[name])

describe('colormaps', () => {
  it('the list is exactly what cog-tiler-wasm 0.5.0 reports (fixtures/raster/colormaps.json, from `colormaps()`), every featured name is in it, no duplicates', () => {
    expect([...RASTER_COLORMAPS]).toEqual(colormapFixture.names)
    expect(new Set(RASTER_COLORMAPS).size).toBe(RASTER_COLORMAPS.length)
    for (const g of COLORMAP_GROUPS) for (const n of g.names) expect(isColormap(n), n).toBe(true)
    expect(isColormap('not-a-map')).toBe(false)
  })
})

describe('defaults from the file', () => {
  it('a float measurement: one band, viridis, 2nd to 98th percentile (not min to max)', () => {
    const f = facts('dem_32612')
    const s = defaultRasterStyle(f)
    expect(s).toMatchObject({ mode: 'single', bands: [1], colormap: 'viridis', stretch: 'linear', gamma: 1, reversed: false, opacity: 1, nodata: { mode: 'file' } })
    expect(s.min).toBe(f.bands[0].p2)
    expect(s.max).toBe(f.bands[0].p98)
    expect(s.min).toBeGreaterThan(f.bands[0].min!)
  })
  it('an 8-bit three band image is drawn as a colour image with a 0 to 255 range', () => {
    const s = defaultRasterStyle(facts('rgb_cog'))
    expect(s).toMatchObject({ mode: 'rgb', bands: [1, 2, 3], rescale: [[0, 255], [0, 255], [0, 255]] })
  })
  it('a 16-bit three band image stretches each band by its own percentiles', () => {
    const f = facts('rgb_u16')
    const s = defaultRasterStyle(f)
    expect(s.mode).toBe('rgb')
    expect(s.rescale).toHaveLength(3)
    expect(s.rescale![0][0]).toBeLessThan(s.rescale![0][1])
  })
  it('a colour table raster is paletted', () => {
    expect(defaultRasterStyle(facts('classes_pal'))).toMatchObject({ mode: 'paletted', bands: [1] })
  })
  it('bands tagged red, green and blue pick their own numbers', () => {
    const f = facts('rgb_cog')
    f.bands = [{ ...f.bands[0], index: 1, interpretation: 'blue' }, { ...f.bands[1], interpretation: 'green' }, { ...f.bands[2], interpretation: 'red' }]
    expect(defaultRasterStyle(f).bands).toEqual([3, 2, 1])
  })
  it('one 8-bit band is an image: gray', () => {
    const f = facts('rgb_cog')
    f.bands = [f.bands[0]]
    expect(defaultRasterStyle(f)).toMatchObject({ mode: 'single', colormap: 'gray' })
  })
  it('a flat band still gets a range; a band with no statistics gets its type\'s range', () => {
    expect(defaultRange({ index: 1, name: 'b', min: 5, max: 5 }, 'float32')).toEqual([5, 6])
    expect(defaultRange(undefined, 'uint8')).toEqual([0, 255])
    expect(defaultRange(undefined, 'uint16')).toEqual([0, 65535])
    expect(defaultRange({ index: 1, name: 'b', p2: 3, p98: 3, min: 0, max: 9 }, 'float32')).toEqual([0, 9])
  })
})

describe('the tiler\'s options', () => {
  const f = facts('rgb_cog')
  const d = facts('dem_32612')
  it('single: band, range, colormap, reversed, stretch, gamma; no nodata override when the file\'s is used', () => {
    expect(toRenderOptions({ ...defaultRasterStyle(d), colormap: 'magma', reversed: true, stretch: 'sqrt', gamma: 1.5, min: 1, max: 9 }, d)).toEqual({ bidx: [1], min: 1, max: 9, colormap: 'magma', reversed: true, stretch: 'sqrt', gamma: 1.5 })
  })
  it('rgb: three bands and a range per band', () => {
    expect(toRenderOptions(defaultRasterStyle(f), f)).toEqual({ bidx: [1, 2, 3], rescale: [[0, 255], [0, 255], [0, 255]], stretch: 'linear', gamma: 1 })
  })
  it('rgb with one range for all', () => {
    const s: RasterStyle = { ...defaultRasterStyle(f), rescale: undefined, min: 10, max: 200 }
    expect(toRenderOptions(s, f).rescale).toEqual([[10, 200], [10, 200], [10, 200]])
  })
  it('paletted: only the band (the file\'s table is the colors)', () => {
    const c = facts('classes_pal')
    expect(toRenderOptions(defaultRasterStyle(c), c)).toEqual({ bidx: [1] })
  })
  it('nodata: a value overrides, "none" uses a value no sample has', () => {
    expect(toRenderOptions({ ...defaultRasterStyle(d), nodata: { mode: 'value', value: -1 } }, d).nodata).toBe(-1)
    expect(toRenderOptions({ ...defaultRasterStyle(d), nodata: { mode: 'none' } }, d).nodata).toBe(NO_NODATA_VALUE)
    expect(NO_NODATA_VALUE).toBeGreaterThan(3e29)
  })
  it('a band number past the file\'s is brought back into range', () => {
    expect(toRenderOptions({ ...defaultRasterStyle(d), bands: [9] }, d).bidx).toEqual([1])
    expect(toRenderOptions({ ...defaultRasterStyle(f), bands: [1, 2, 7] }, f).bidx).toEqual([1, 2, 3])
  })
  it('opacity is not a tiler option (it is the map layer\'s), so it never changes the tiles', () => {
    const a = defaultRasterStyle(d)
    expect(sameRender(a, { ...a, opacity: 0.3 }, d)).toBe(true)
    expect(sameRender(a, { ...a, max: a.max + 1 }, d)).toBe(false)
  })
})

describe('reading a style back', () => {
  const d = facts('dem_32612')
  it('a style written by us survives', () => {
    const s: RasterStyle = { ...defaultRasterStyle(d), colormap: 'turbo', reversed: true, min: -10, max: 40, stretch: 'log', gamma: 2, opacity: 0.4, nodata: { mode: 'value', value: -5 } }
    expect(sanitizeRasterStyle(JSON.parse(JSON.stringify(s)), d)).toEqual(s)
  })
  it('not a style: null', () => {
    for (const v of [null, undefined, 3, 'x', [], [1]]) expect(sanitizeRasterStyle(v, d)).toBeNull()
  })
  it('unknown fields are dropped; an unknown colormap, stretch and bad numbers are replaced', () => {
    const s = sanitizeRasterStyle({ mode: 'single', bands: [1], min: 0, max: 10, colormap: 'nope', stretch: 'cubic', gamma: -3, opacity: 7, evil: '<script>', nodata: { mode: 'value', value: 'x' } }, d)!
    expect(s.colormap).toBe('viridis')
    expect(s.stretch).toBe('linear')
    expect(s.gamma).toBe(1)
    expect(s.opacity).toBe(1)
    expect(s.nodata).toEqual({ mode: 'file' })
    expect(s).not.toHaveProperty('evil')
  })
  it('min not below max falls back to the file\'s range; bands past the file\'s fall back too', () => {
    const def = defaultRasterStyle(d)
    const s = sanitizeRasterStyle({ mode: 'single', bands: [4], min: 9, max: 9 }, d)!
    expect([s.min, s.max]).toEqual([def.min, def.max])
    expect(s.bands).toEqual([1])
  })
  it('paletted needs a colour table; rgb needs three bands in the file', () => {
    expect(sanitizeRasterStyle({ mode: 'paletted' }, d)!.mode).toBe('single')
    const rgb = facts('rgb_cog')
    expect(sanitizeRasterStyle({ mode: 'rgb', bands: [3, 2, 1] }, rgb)!.bands).toEqual([3, 2, 1])
    expect(sanitizeRasterStyle({ mode: 'rgb', bands: [1] }, rgb)!.bands).toEqual([1, 2, 3])
  })
})

describe('the edits the style panel makes', () => {
  const rgbFacts = facts('rgb_u16')
  const d = facts('dem_32612')
  it('a ramp to colour bands: bands 1, 2, 3 and a range for each', () => {
    const s = withMode(defaultRasterStyle(rgbFacts), rgbFacts, 'rgb')
    expect(s).toMatchObject({ mode: 'rgb', bands: [1, 2, 3] })
    expect(s.rescale).toHaveLength(3)
    expect([s.min, s.max]).toEqual(s.rescale![0])
  })
  it('colour bands to a ramp: one band, its own range, no per-band ranges left', () => {
    const rgb = defaultRasterStyle(rgbFacts)
    const s = withMode({ ...rgb, bands: [2, 3, 1] }, rgbFacts, 'single')
    expect(s.mode).toBe('single')
    expect(s.bands).toEqual([2])
    expect(s).not.toHaveProperty('rescale')
    expect(s.min).toBeLessThan(s.max)
  })
  it('another band for a ramp takes that band percentiles; another band for a channel changes only that channel', () => {
    const s = withBand(defaultRasterStyle(rgbFacts), rgbFacts, 3)
    expect(s.bands).toEqual([3])
    const c = withChannel(defaultRasterStyle(rgbFacts), rgbFacts, 1, 4)
    expect(c.bands).toEqual([1, 4, 3])
    expect(c.rescale![0]).toEqual(defaultRasterStyle(rgbFacts).rescale![0])
  })
  it('the presets: percentiles inside the extremes, the full range at them', () => {
    const base = defaultRasterStyle(d)
    const full = withRangePreset(base, d, 'full')
    const pct = withRangePreset(full, d, 'percentile')
    expect([full.min, full.max]).toEqual([d.bands[0].min, d.bands[0].max])
    expect([pct.min, pct.max]).toEqual([d.bands[0].p2, d.bands[0].p98])
    expect(pct.min).toBeGreaterThan(full.min)
    expect(pct.max).toBeLessThan(full.max)
  })
  it('the presets for colour bands act on each band; 8 bit stays 0 to 255', () => {
    const u8 = facts('rgb_cog')
    const s = withRangePreset(defaultRasterStyle(u8), u8, 'percentile')
    expect(s.rescale).toEqual([[0, 255], [0, 255], [0, 255]])
    const s16 = withRangePreset(defaultRasterStyle(rgbFacts), rgbFacts, 'full')
    expect(s16.rescale![0][1]).toBe(rgbFacts.bands[0].max)
  })
  it('one range for every colour band drops the per-band ranges', () => {
    const s = withCommonRange(defaultRasterStyle(rgbFacts), 10, 20)
    expect([s.min, s.max]).toEqual([10, 20])
    expect(s).not.toHaveProperty('rescale')
    expect(toRenderOptions(s, rgbFacts).rescale).toEqual([[10, 20], [10, 20], [10, 20]])
  })
})

describe('a converted file keeps what it was', () => {
  it('a 16-bit three band file that was prepared as float is still drawn as a colour image', () => {
    const base = facts('rgb_u16')
    const converted: RasterFacts = { ...base, dataType: 'float32', originalDataType: 'uint16', origin: 'converted' }
    expect(defaultRasterStyle(converted)).toMatchObject({ mode: 'rgb', bands: [1, 2, 3] })
    // ... and a float file of three bands is not.
    expect(defaultRasterStyle({ ...base, dataType: 'float32' }).mode).toBe('single')
  })
})
