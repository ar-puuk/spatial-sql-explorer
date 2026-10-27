// Spec 026 T007: the facts of a raster from what the tiler and the file header report. The fixtures are the
// real `cog.info()`, `cog.levels`, `cog.statistics()` and geotiff.js headers of the GDAL-made test rasters
// (tests/core/fixtures/raster/tiler-info.json, captured by specs/026-raster-view/spikes).
import { describe, expect, it } from 'vitest'
import { crsFromGeoKeys, dataTypeOf, factsFromTiler, paletteFromColorMap, placeholderLayer, type FactsInput, type RasterFacts } from '@spatial-explorer/core'
import captured from './fixtures/raster/tiler-info.json'

type Captured = Record<string, Pick<FactsInput, 'info' | 'levels' | 'mode' | 'hasPalette' | 'header' | 'stats'>>
const files = captured as unknown as Captured
const facts = (name: string, extra: Partial<FactsInput> = {}): RasterFacts => factsFromTiler({ ...files[name], ...extra })

describe('coordinate system from the GeoKeys', () => {
  it('UTM: code, the file\'s own name, metres', () => {
    expect(crsFromGeoKeys(files.dem_32612.header.geoKeys)).toEqual({ label: 'EPSG:32612 (WGS 84 / UTM zone 12N)', isWgs84: false, code: 32612, units: 'metres' })
  })
  it('a state plane in US survey feet', () => {
    const crs = crsFromGeoKeys(files.dem_3567.header.geoKeys)
    expect(crs.code).toBe(3567)
    expect(crs.units).toBe('feet')
    expect(crs.label).toBe('EPSG:3567 (NAD83 / Utah South (ftUS))')
  })
  it('WGS 84: degrees, no reprojection', () => {
    expect(crsFromGeoKeys(files.dem_4326.header.geoKeys)).toEqual({ label: 'EPSG:4326 (WGS 84)', isWgs84: true, code: 4326, units: 'degrees' })
  })
  it('Web Mercator in metres', () => {
    const crs = crsFromGeoKeys(files.dem_3857.header.geoKeys)
    expect(crs).toMatchObject({ code: 3857, units: 'metres', isWgs84: false })
  })
  it('user-defined and undefined codes are not EPSG codes', () => {
    expect(crsFromGeoKeys({ ProjectedCSTypeGeoKey: 32767, GTCitationGeoKey: 'My Lambert', ProjLinearUnitsGeoKey: 9001 })).toEqual({ label: 'User-defined: My Lambert', isWgs84: false, units: 'metres' })
    expect(crsFromGeoKeys({ ProjectedCSTypeGeoKey: 0 }).label).toBe('User-defined coordinate system')
    expect(crsFromGeoKeys({ GTModelTypeGeoKey: 2 }).units).toBe('degrees')
  })
})

describe('facts of a COG', () => {
  it('a float DEM in UTM: size, bands, type, nodata, compression, tiling, overviews, extent, pixel size', () => {
    const f = facts('dem_32612')
    expect(f).toMatchObject({ origin: 'file', width: 2595, height: 3383, dataType: 'float32', nodata: -9999, compression: 'Deflate', tiled: true, tileSize: [512, 512], overviews: 3, mode: 'warp', hasPalette: false })
    expect(f.bands).toHaveLength(1)
    expect(f.bands[0]).toMatchObject({ index: 1, name: 'Band 1' })
    expect(f.crs.code).toBe(32612)
    expect(f.extent[0]).toBeGreaterThan(400000)
    expect(f.extentWgs84[0]).toBeCloseTo(-111.912, 3)
    expect(f.pixelSize![0]).toBeCloseTo(29.647, 2)
    expect(f.pixelSize![1]).toBeCloseTo(29.647, 2)
    expect(f.warnings).toEqual([])
  })
  it('statistics become band estimates: percentiles and a histogram', () => {
    const f = facts('dem_32612')
    expect(f.bands[0].min).toBeLessThan(f.bands[0].max!)
    expect(f.bands[0].p2).toBeGreaterThan(f.bands[0].min!)
    expect(f.bands[0].p98).toBeLessThan(f.bands[0].max!)
    expect(f.bands[0].histogram!.length).toBeGreaterThan(8)
  })
  it('an RGB image: three bands, 8 bit', () => {
    const f = facts('rgb_cog')
    expect(f.bands.map((b) => b.name)).toEqual(['Band 1', 'Band 2', 'Band 3'])
    expect(f.dataType).toBe('uint8')
    expect(f.hasPalette).toBe(false)
  })
  it('16 bit', () => {
    expect(facts('rgb_u16').dataType).toBe('uint16')
  })
  it('a colour table raster: the palette flag and the band interpretation', () => {
    const f = facts('classes_pal')
    expect(f.hasPalette).toBe(true)
    expect(f.bands[0].interpretation).toBe('palette')
    expect(f.nodata).toBe(0)
  })
  it('a converted file says so', () => {
    expect(facts('conv_striped_49m', { origin: 'converted' }).origin).toBe('converted')
  })
  it('NaN nodata survives JSON as the string "nan"', () => {
    const base = files.dem_32612
    const f = factsFromTiler({ ...base, info: { ...base.info, nodata: NaN } })
    expect(f.nodata).toBe('nan')
    expect(JSON.parse(JSON.stringify(f)).nodata).toBe('nan')
  })
  it('a file with no overviews that is too big to draw zoomed out gets the warning', () => {
    const base = files.dem_32612
    const f = factsFromTiler({ ...base, info: { ...base.info, width: 40000, height: 40000 }, levels: [base.levels[0]] })
    expect(f.overviews).toBe(0)
    expect(f.warnings.join(' ')).toMatch(/no overviews/i)
    expect(factsFromTiler({ ...base, info: { ...base.info, width: 1000, height: 1000 }, levels: [base.levels[0]] }).warnings).toEqual([])
  })
})

describe('the classes of a colour table', () => {
  it('the real fixture: the classes between the lowest and highest value, with their colours', () => {
    const f = facts('classes_pal')
    expect(f.palette).toEqual([
      { value: 1, color: '#c83c28' },
      { value: 2, color: '#f09632' },
      { value: 3, color: '#f0dc50' },
      { value: 4, color: '#5aaa5a' },
      { value: 5, color: '#285aaa' },
    ])
  })
  it('without statistics: the whole table up to 256 entries', () => {
    const cm = new Uint16Array(768)
    cm[1] = 255 << 8
    expect(paletteFromColorMap(cm)).toHaveLength(256)
    expect(paletteFromColorMap(cm)[1]).toEqual({ value: 1, color: '#ff0000' })
  })
  it('a table that is not 3 planes, or none: nothing', () => {
    expect(paletteFromColorMap(null)).toEqual([])
    expect(paletteFromColorMap([1, 2])).toEqual([])
    expect(paletteFromColorMap(new Uint16Array(0))).toEqual([])
  })
  it('a file without a table has none', () => {
    expect(facts('dem_32612').palette).toBeUndefined()
  })
})

describe('sample type', () => {
  it('the tiler\'s name wins, else the level\'s format and width', () => {
    expect(dataTypeOf('int16')).toBe('int16')
    expect(dataTypeOf(undefined, { bits_per_sample: 32, sample_format: 'ieeefloat' })).toBe('float32')
    expect(dataTypeOf(undefined, { bits_per_sample: 64, sample_format: 'ieeefloat' })).toBe('float64')
    expect(dataTypeOf(undefined, { bits_per_sample: 16, sample_format: 'int' })).toBe('int16')
    expect(dataTypeOf(undefined, { bits_per_sample: 16, sample_format: 'uint' })).toBe('uint16')
    expect(dataTypeOf('weird', undefined)).toBe('uint8')
  })
})

describe('the layer the store holds', () => {
  it('has neutral vector fields, the raster facts and the WGS84 extent to fit', () => {
    const f = facts('dem_32612')
    const layer = placeholderLayer('dem.tif', f, { fileName: 'dem.qml', text: '<qgis/>' })
    expect(layer).toMatchObject({ id: 'dem.tif', sourceFormat: 'geotiff', geometryType: 'Mixed', rowCount: 0, featureCount: 0, columns: [], extent: f.extentWgs84, styleSidecar: { fileName: 'dem.qml' } })
    expect(layer.raster).toBe(f)
    expect(layer.sourceCrs.code).toBe(32612)
  })
})
