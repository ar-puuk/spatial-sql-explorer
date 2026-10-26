// Spec 026 T021: what the facts card says, from the real facts of the fixtures.
import { describe, expect, it } from 'vitest'
import { bandsText, describeRaster, factsFromTiler, nodataText, valueText, type FactsInput, type RasterFacts } from '@spatial-explorer/core'
import captured from './fixtures/raster/tiler-info.json'

const files = captured as unknown as Record<string, Pick<FactsInput, 'info' | 'levels' | 'mode' | 'hasPalette' | 'header' | 'stats'>>
const facts = (name: string, over: Partial<RasterFacts> = {}): RasterFacts => ({ ...factsFromTiler(files[name]), ...over })
const rows = (f: RasterFacts): Record<string, string> => Object.fromEntries(describeRaster(f).map((r) => [r.label, r.value]))

describe('the card rows', () => {
  it('a float DEM in UTM: every fact with its unit, one fact per row', () => {
    const r = rows(facts('dem_32612'))
    expect(r['Coordinate system']).toBe('EPSG:32612 (WGS 84 / UTM zone 12N)')
    expect(r['Size']).toBe('2,595 × 3,383 pixels')
    expect(r['Bands']).toBe('1 band: Band 1')
    expect(r['Data type']).toBe('32-bit floating point')
    expect(r['No data']).toBe('−9,999')
    expect(r['Pixel size']).toMatch(/^29\.65 metres$/)
    expect(r['X range']).toMatch(/ to .* metres$/)
    expect(r['Y range']).toMatch(/ to .* metres$/)
    expect(r['Compression']).toBe('Deflate')
    expect(r['Storage']).toBe('Tiled, 512 × 512 pixels')
    expect(r['Overviews']).toBe('3 levels')
    expect(r['Drawn']).toBe('Reprojected for the map')
  })

  it('a geographic raster is in longitude and latitude, in degrees', () => {
    const r = rows(facts('dem_4326'))
    expect(r['Longitude']).toBe('−111.900000 to −111.000000')
    expect(r['Latitude']).toBe('39.900000 to 40.800000')
    expect(r['Pixel size']).toBe('0.00030000 degrees')
    expect(r).not.toHaveProperty('X range')
  })

  it('a state plane says feet', () => {
    const r = rows(facts('dem_3567'))
    expect(r['Pixel size']).toMatch(/ feet$/)
    expect(r['X range']).toMatch(/ feet$/)
  })

  it('Web Mercator tiles are drawn as stored', () => {
    expect(rows(facts('dem_3857'))['Drawn']).toBe('As stored (Web Mercator)')
  })

  it('three bands, 8 bit; a colour table; 16 bit', () => {
    expect(rows(facts('rgb_cog'))['Bands']).toBe('3 bands: Band 1, Band 2, Band 3')
    expect(rows(facts('rgb_cog'))['Data type']).toBe('8-bit unsigned integer')
    expect(rows(facts('rgb_u16'))['Data type']).toBe('16-bit unsigned integer')
    expect(rows(facts('classes_pal'))['No data']).toBe('0')
  })

  it('a converted file says how it is stored; no overviews says None', () => {
    const f = facts('conv_striped_49m', { origin: 'converted' })
    expect(rows(f)['Storage']).toBe('Prepared in memory as a COG')
    expect(rows(facts('dem_32612', { overviews: 0 }))['Overviews']).toBe('None')
    expect(rows(facts('dem_32612', { overviews: 1 }))['Overviews']).toBe('1 level')
  })

  it('a file that is not tiled; a pixel that is not square', () => {
    expect(rows(facts('dem_32612', { tiled: false, tileSize: null }))['Storage']).toBe('Not tiled')
    expect(rows(facts('dem_32612', { pixelSize: [10, 30] }))['Pixel size']).toBe('10.00 × 30.00 metres')
    expect(rows(facts('dem_32612', { pixelSize: null }))).not.toHaveProperty('Pixel size')
  })

  it('no all-caps labels, no dot-joined strings (spec 015)', () => {
    for (const r of describeRaster(facts('dem_32612'))) {
      expect(r.label).not.toBe(r.label.toUpperCase())
      expect(r.value).not.toContain(' · ')
    }
  })
})

describe('words for single facts', () => {
  it('no data', () => {
    expect(nodataText(null)).toBe('None recorded')
    expect(nodataText('nan')).toBe('NaN (not a number)')
    expect(nodataText(-32768)).toBe('−32,768')
    expect(nodataText(0.5)).toBe('0.5')
  })
  it('bands: names up to six, then the count', () => {
    expect(bandsText({ bands: [{ index: 1, name: 'Red' }, { index: 2, name: 'Green' }] })).toBe('2 bands: Red, Green')
    expect(bandsText({ bands: Array.from({ length: 12 }, (_, i) => ({ index: i + 1, name: `Band ${i + 1}` })) })).toBe('12 bands')
  })
  it('a value under the cursor: the stored value, "no data" for none, readable decimals', () => {
    expect(valueText(null)).toBe('no data')
    expect(valueText(412)).toBe('412')
    expect(valueText(-1234)).toBe('−1,234')
    expect(valueText(1990.15588)).toBe('1,990.2')
    expect(valueText(412.3456)).toBe('412.35')
    expect(valueText(4.17967)).toBe('4.180')
    expect(valueText(0.012345)).toBe('0.0123')
  })
})
