// Spec 026 US3: the raster style sidecar. Written in QGIS's own elements plus our JSON, read back exactly; a QML that only
// QGIS wrote is read from its elements; a vector QML is not mistaken for a raster one.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { importStyle, RASTER_QML_PROPERTY, defaultRasterStyle, factsFromTiler, isRasterQml, rasterQmlNotes, rasterStyleFromQml, rasterStyleToQml, type FactsInput, type RasterFacts, type RasterStyle } from '@spatial-explorer/core'
import captured from './fixtures/raster/tiler-info.json'

const files = captured as unknown as Record<string, Pick<FactsInput, 'info' | 'levels' | 'mode' | 'hasPalette' | 'header' | 'stats'>>
const facts = (name: string): RasterFacts => factsFromTiler(files[name])
const dem = facts('dem_32612')
const rgb = facts('rgb_cog')
const classes = facts('classes_pal')
const RAMP = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']

describe('detecting what kind of style it is', () => {
  it('a raster renderer is a raster style; a vector renderer is not', () => {
    expect(isRasterQml(rasterStyleToQml(defaultRasterStyle(dem), dem))).toBe(true)
    expect(isRasterQml('<qgis><renderer-v2 type="singleSymbol"/></qgis>')).toBe(false)
    expect(isRasterQml('')).toBe(false)
  })
  it('a vector style next to a raster is refused with a plain reason', () => {
    expect(() => rasterStyleFromQml('<qgis><renderer-v2 type="singleSymbol"/></qgis>', dem)).toThrow(/not a raster style/)
  })
  it('the real vector fixtures are never mistaken for a raster style', () => {
    for (const name of ['categorized.qml', 'graduated.qml']) expect(isRasterQml(readFileSync(new URL(`./fixtures/style/${name}`, import.meta.url), 'utf8')), name).toBe(false)
  })
})

describe('the vector style importer', () => {
  it('refuses a raster style with a plain sentence, never the vector parser error', () => {
    const qml = rasterStyleToQml(defaultRasterStyle(dem), dem)
    expect(() => importStyle('dem.qml', qml)).toThrow('This style is for a raster layer. Open a GeoTIFF to use it.')
    expect(() => importStyle('anything.xml', qml)).toThrow(/raster layer/)
  })
})

describe('what is written', () => {
  it('a continuous band: pseudocolor with the range, the ramp colors in order, and our JSON', () => {
    const style: RasterStyle = { ...defaultRasterStyle(dem), min: 100, max: 2000, colormap: 'viridis' }
    const qml = rasterStyleToQml(style, dem, { ramp: RAMP })
    expect(qml).toMatch(/<rasterrenderer type="singlebandpseudocolor" band="1"[^>]*classificationMin="100" classificationMax="2000"/)
    expect(qml).toContain('<colorrampshader colorRampType="INTERPOLATED"')
    const items = [...qml.matchAll(/<item value="([^"]+)" color="([^"]+)"/g)].map((m) => [Number(m[1]), m[2]])
    expect(items.map((i) => i[1])).toEqual(RAMP)
    expect(items[0][0]).toBe(100)
    expect(items[4][0]).toBe(2000)
    expect(items[2][0]).toBe(1050)
    expect(qml).toContain(`name="${RASTER_QML_PROPERTY}"`)
  })
  it('reversed puts the ramp the other way round', () => {
    const qml = rasterStyleToQml({ ...defaultRasterStyle(dem), reversed: true, min: 0, max: 4 }, dem, { ramp: RAMP })
    expect([...qml.matchAll(/<item value="[^"]+" color="([^"]+)"/g)].map((m) => m[1])).toEqual([...RAMP].reverse())
  })
  it('a gray single band is a gray renderer, white to black when reversed', () => {
    const style: RasterStyle = { ...defaultRasterStyle(dem), colormap: 'gray', min: 0, max: 255 }
    expect(rasterStyleToQml(style, dem)).toMatch(/type="singlebandgray" grayBand="1" gradient="BlackToWhite"/)
    expect(rasterStyleToQml({ ...style, reversed: true }, dem)).toMatch(/gradient="WhiteToBlack"/)
  })
  it('colour bands: red, green and blue band numbers and a range for each', () => {
    const style: RasterStyle = { ...defaultRasterStyle(rgb), bands: [3, 2, 1], rescale: [[0, 200], [10, 220], [20, 240]] }
    const qml = rasterStyleToQml(style, rgb)
    expect(qml).toMatch(/type="multibandcolor" redBand="3" greenBand="2" blueBand="1"/)
    expect(qml).toMatch(/<redContrastEnhancement><minValue>0<\/minValue><maxValue>200<\/maxValue>/)
    expect(qml).toMatch(/<blueContrastEnhancement><minValue>20<\/minValue><maxValue>240<\/maxValue>/)
  })
  it('a colour table: a paletted renderer on the band', () => {
    expect(rasterStyleToQml(defaultRasterStyle(classes), classes)).toMatch(/type="paletted" band="1"/)
  })
  it('opacity and a nodata value become QGIS opacity and a fully transparent pixel entry', () => {
    const qml = rasterStyleToQml({ ...defaultRasterStyle(dem), opacity: 0.4, nodata: { mode: 'value', value: -32768 } }, dem, { ramp: RAMP })
    expect(qml).toContain('opacity="0.4"')
    expect(qml).toContain('<pixelListEntry min="-32768" max="-32768" percentTransparent="100"/>')
  })
  it('says what QGIS cannot hold, and nothing when everything is held', () => {
    expect(rasterQmlNotes(defaultRasterStyle(dem))).toEqual([])
    expect(rasterQmlNotes({ ...defaultRasterStyle(dem), stretch: 'sqrt' })[0]).toMatch(/linear stretch/)
    expect(rasterQmlNotes({ ...defaultRasterStyle(dem), nodata: { mode: 'none' } })[0]).toMatch(/nodata/)
  })
  it('is well formed XML even with odd characters', () => {
    const qml = rasterStyleToQml({ ...defaultRasterStyle(dem), colormap: 'viridis' }, dem, { ramp: RAMP, version: '3.34 "x" <y>' })
    expect(qml.startsWith("<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>")).toBe(true)
    expect(qml).not.toContain('<y>')
    expect(qml.match(/<qgis\b/g)).toHaveLength(1)
    expect(qml.match(/<\/qgis>/g)).toHaveLength(1)
  })
})

describe('round trip through our own JSON', () => {
  const styles: Array<[string, RasterFacts, RasterStyle]> = [
    ['single band, every setting', dem, { mode: 'single', bands: [1], min: -10.5, max: 1234.25, stretch: 'sqrt', gamma: 1.5, colormap: 'magma', reversed: true, nodata: { mode: 'value', value: -1 }, opacity: 0.6 }],
    ['no nodata', dem, { ...defaultRasterStyle(dem), nodata: { mode: 'none' } }],
    ['colour bands with their own ranges', rgb, { ...defaultRasterStyle(rgb), bands: [2, 3, 1], rescale: [[1, 100], [2, 200], [3, 250]] }],
    ['paletted', classes, defaultRasterStyle(classes)],
  ]
  for (const [name, f, style] of styles) {
    it(name, () => {
      const result = rasterStyleFromQml(rasterStyleToQml(style, f, { ramp: RAMP }), f)
      expect(result.style).toEqual(style)
      expect(result.notes).toEqual([])
    })
  }
  it('a style for another file (a band that is not there) is made safe, not trusted', () => {
    const wide: RasterStyle = { ...defaultRasterStyle(rgb), bands: [1, 2, 9] }
    const qml = rasterStyleToQml(wide, { bands: Array.from({ length: 9 }, (_, i) => ({ index: i + 1, name: `b${i}` })) })
    expect(rasterStyleFromQml(qml, rgb).style.bands).toEqual([1, 2, 3])
  })
  it('damaged JSON falls back to what QGIS\'s elements say, with a note', () => {
    const qml = rasterStyleToQml({ ...defaultRasterStyle(dem), min: 5, max: 50 }, dem, { ramp: RAMP }).replace(/value="\{[^"]*"/, 'value="{not json"')
    const r = rasterStyleFromQml(qml, dem)
    expect(r.notes.join(' ')).toMatch(/could not be read/)
    expect([r.style.min, r.style.max]).toEqual([5, 50])
  })
})

describe('a QML written by QGIS alone', () => {
  const header = "<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'><qgis version=\"3.34.2\"><pipe>"
  const footer = '</pipe><blendMode>0</blendMode></qgis>'
  it('singleband pseudocolor: the band, the range, the opacity; the ramp is ours (viridis) and it says so', () => {
    const r = rasterStyleFromQml(`${header}<rasterrenderer type="singlebandpseudocolor" band="1" opacity="0.8" classificationMin="200" classificationMax="2300" nodataColor=""><rasterTransparency/><rastershader><colorrampshader colorRampType="INTERPOLATED" minimumValue="200" maximumValue="2300"><item value="200" color="#0000ff" alpha="255" label="200"/><item value="2300" color="#ff0000" alpha="255" label="2300"/></colorrampshader></rastershader></rasterrenderer>${footer}`, dem)
    expect(r.style).toMatchObject({ mode: 'single', bands: [1], min: 200, max: 2300, opacity: 0.8, colormap: 'viridis' })
    expect(r.notes.join(' ')).toMatch(/not one of Spatial Explorer's colormaps; viridis/)
  })
  it('multiband color: the three bands and a range for each', () => {
    const r = rasterStyleFromQml(`${header}<rasterrenderer type="multibandcolor" redBand="3" greenBand="2" blueBand="1" opacity="1"><redContrastEnhancement><minValue>0</minValue><maxValue>100</maxValue><algorithm>StretchToMinimumMaximum</algorithm></redContrastEnhancement><greenContrastEnhancement><minValue>5</minValue><maxValue>150</maxValue></greenContrastEnhancement><blueContrastEnhancement><minValue>7</minValue><maxValue>170</maxValue></blueContrastEnhancement></rasterrenderer>${footer}`, rgb)
    expect(r.style).toMatchObject({ mode: 'rgb', bands: [3, 2, 1], rescale: [[0, 100], [5, 150], [7, 170]] })
  })
  it('singleband gray, reversed', () => {
    const r = rasterStyleFromQml(`${header}<rasterrenderer type="singlebandgray" grayBand="1" gradient="WhiteToBlack" opacity="1"><contrastEnhancement><minValue>10</minValue><maxValue>90</maxValue></contrastEnhancement></rasterrenderer>${footer}`, dem)
    expect(r.style).toMatchObject({ mode: 'single', colormap: 'gray', reversed: true, min: 10, max: 90 })
  })
  it('a fully transparent pixel entry becomes the nodata value', () => {
    const r = rasterStyleFromQml(`${header}<rasterrenderer type="singlebandgray" grayBand="1"><rasterTransparency><singleValuePixelList><pixelListEntry min="-9999" max="-9999" percentTransparent="100"/></singleValuePixelList></rasterTransparency></rasterrenderer>${footer}`, dem)
    expect(r.style.nodata).toEqual({ mode: 'value', value: -9999 })
  })
  it('a renderer we do not draw: the default style and a note', () => {
    const r = rasterStyleFromQml(`${header}<rasterrenderer type="hillshade" band="1"/>${footer}`, dem)
    expect(r.style).toEqual(defaultRasterStyle(dem))
    expect(r.notes.join(' ')).toMatch(/"hillshade".*does not draw/)
  })
  it('a color table style for a file without one: the default style and a note', () => {
    const r = rasterStyleFromQml(`${header}<rasterrenderer type="paletted" band="1"/>${footer}`, dem)
    expect(r.style.mode).toBe('single')
    expect(r.notes.join(' ')).toMatch(/color table the file does not have/)
  })
  it('colour bands for a file with one band: not applied', () => {
    const r = rasterStyleFromQml(`${header}<rasterrenderer type="multibandcolor" redBand="1" greenBand="2" blueBand="3"/>${footer}`, dem)
    expect(r.style.mode).toBe('single')
  })
})
