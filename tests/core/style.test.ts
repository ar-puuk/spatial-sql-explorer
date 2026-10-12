// @vitest-environment happy-dom
// Style interchange (design-plan.md §8.5): QGIS QML (sidecar), OGC SLD and
// Mapbox GL style JSON, single-symbol. Exercises round trips through our own
// writers AND files shaped like what QGIS / GeoServer / Maputnik actually
// write, since interop with those tools is the point of the feature.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYER_STYLE,
  exportStyle,
  importStyle,
  parseColor,
  sidecarStyleFileName,
  styleFileName,
  type LayerStyle,
  type StyleFormat,
} from '@spatial-explorer/core'

const CUSTOM: LayerStyle = {
  fillColor: '#e5b636',
  fillOpacity: 0.6,
  strokeColor: '#232323',
  strokeOpacity: 1,
  strokeWidth: 2,
  pointRadius: 7,
}

describe('round trips through our own writers', () => {
  const formats: StyleFormat[] = ['qml', 'sld', 'mapbox']
  for (const format of formats) {
    for (const geometry of ['Polygon', 'LineString', 'Point'] as const) {
      it(`${format} / ${geometry}`, () => {
        const { text } = exportStyle(CUSTOM, format, geometry, 'world.geojson')
        const { style, notes } = importStyle(styleFileName('world.geojson', format), text)
        expect(notes).toEqual([])
        if (geometry !== 'LineString') {
          expect(style.fillColor).toBe(CUSTOM.fillColor)
          // QML stores alpha as 0-255, so allow one step of rounding.
          expect(style.fillOpacity).toBeCloseTo(CUSTOM.fillOpacity, 2)
        }
        expect(style.strokeColor).toBe(CUSTOM.strokeColor)
        expect(style.strokeWidth).toBeCloseTo(CUSTOM.strokeWidth, 3)
        if (geometry === 'Point') expect(style.pointRadius).toBeCloseTo(CUSTOM.pointRadius, 3)
      })
    }
  }

  it('mixed-geometry exports keep every symbolizer the format allows', () => {
    const sld = exportStyle(CUSTOM, 'sld', 'Mixed', 'mix.geojson').text
    expect(sld).toContain('<PolygonSymbolizer>')
    expect(sld).toContain('<LineSymbolizer>')
    expect(sld).toContain('<PointSymbolizer>')
    const mb = JSON.parse(exportStyle(CUSTOM, 'mapbox', 'Mixed', 'mix.geojson').text)
    expect(mb.layers.map((l: { type: string }) => l.type)).toEqual(['fill', 'line', 'line', 'circle'])
    const qml = exportStyle(CUSTOM, 'qml', 'Mixed', 'mix.geojson')
    expect(qml.notes.length).toBe(1)
    expect(qml.text).toContain('class="SimpleFill"')
  })

  it('the Mapbox export is a loadable style document pointing at the data file', () => {
    const doc = JSON.parse(exportStyle(CUSTOM, 'mapbox', 'Polygon', 'parcels.gpkg').text)
    expect(doc.version).toBe(8)
    expect(doc.sources.data).toEqual({ type: 'geojson', data: 'parcels.gpkg' })
  })
})

describe('QML written by QGIS', () => {
  it('reads the QGIS >= 3.26 <Option> form with default millimetre units', () => {
    const qml = `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.4-Prizren" styleCategories="Symbology">
  <renderer-v2 type="singleSymbol" forceraster="0" symbollevels="0" enableorderby="0" referencescale="-1">
    <symbols>
      <symbol alpha="1" type="fill" name="0" clip_to_extent="1" force_rhr="0" frame_rate="10" is_animated="0">
        <data_defined_properties>
          <Option type="Map">
            <Option value="" type="QString" name="name"/>
            <Option name="properties"/>
            <Option value="collection" type="QString" name="type"/>
          </Option>
        </data_defined_properties>
        <layer class="SimpleFill" enabled="1" locked="0" pass="0" id="{a}">
          <Option type="Map">
            <Option value="3x:0,0,0,0,0,0" type="QString" name="border_width_map_unit_scale"/>
            <Option value="229,182,54,255,rgb:0.898,0.714,0.212,1" type="QString" name="color"/>
            <Option value="bevel" type="QString" name="joinstyle"/>
            <Option value="35,35,35,255,rgb:0.137,0.137,0.137,1" type="QString" name="outline_color"/>
            <Option value="solid" type="QString" name="outline_style"/>
            <Option value="0.26" type="QString" name="outline_width"/>
            <Option value="MM" type="QString" name="outline_width_unit"/>
            <Option value="solid" type="QString" name="style"/>
          </Option>
        </layer>
      </symbol>
    </symbols>
    <rotation/>
    <sizescale/>
  </renderer-v2>
  <layerGeometryType>2</layerGeometryType>
</qgis>`
    const { style, notes } = importStyle('parcels.qml', qml)
    expect(notes).toEqual([])
    expect(style.fillColor).toBe('#e5b636')
    expect(style.fillOpacity).toBe(1)
    expect(style.strokeColor).toBe('#232323')
    expect(style.strokeWidth).toBeCloseTo(0.26 * (96 / 25.4), 3)
  })

  it('reads the legacy <prop k v> form (QGIS < 3.26) and a marker size diameter', () => {
    const qml = `<qgis version="3.16.0-Hannover">
  <renderer-v2 type="singleSymbol">
    <symbols>
      <symbol alpha="0.5" type="marker" name="0">
        <layer class="SimpleMarker" enabled="1" locked="0" pass="0">
          <prop k="color" v="255,0,0,255"/>
          <prop k="name" v="square"/>
          <prop k="outline_color" v="0,0,0,255"/>
          <prop k="outline_width" v="1"/>
          <prop k="outline_width_unit" v="Pixel"/>
          <prop k="size" v="10"/>
          <prop k="size_unit" v="Pixel"/>
        </layer>
      </symbol>
    </symbols>
  </renderer-v2>
</qgis>`
    const { style, notes } = importStyle('pts.qml', qml)
    expect(style.fillColor).toBe('#ff0000')
    expect(style.fillOpacity).toBe(0.5) // symbol alpha multiplies color alpha
    expect(style.pointRadius).toBe(5)
    expect(style.strokeWidth).toBe(1)
    expect(style.markerShape).toBe('square')
    expect(notes).toEqual([])
  })

  // Spec 003 replaced spec 001's "first symbol only" import with real categorized classes.
  it('imports a categorized renderer as categorized classes, keeping the symbol settings', () => {
    const qml = `<qgis><renderer-v2 type="categorizedSymbol" attr="kind">
      <categories><category symbol="0" value="a" label="a"/></categories>
      <symbols><symbol type="line" name="0" alpha="1"><layer class="SimpleLine" enabled="1">
        <Option type="Map"><Option name="line_color" value="0,128,0,255" type="QString"/><Option name="line_width" value="3" type="QString"/><Option name="line_width_unit" value="Pixel" type="QString"/></Option>
      </layer></symbol></symbols></renderer-v2></qgis>`
    const { style, notes } = importStyle('roads.qml', qml)
    expect(style.strokeColor).toBe('#008000')
    expect(style.strokeWidth).toBe(3)
    expect(notes).toEqual([])
    expect(style.renderer).toMatchObject({ kind: 'categorized', column: 'kind', manual: true, classes: [{ value: 'a', color: '#008000' }] })
  })

  it('rejects a QML without symbology', () => {
    expect(() => importStyle('x.qml', '<qgis version="3.34"><fieldConfiguration/></qgis>')).toThrow(/no symbology/)
  })
})

describe('SLD written by other tools', () => {
  it('reads SLD 1.1 / Symbology Encoding (se:SvgParameter)', () => {
    const sld = `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:se="http://www.opengis.net/se" version="1.1.0">
  <NamedLayer><se:Name>lakes</se:Name><UserStyle><se:FeatureTypeStyle><se:Rule>
    <se:PolygonSymbolizer>
      <se:Fill><se:SvgParameter name="fill">#a6cee3</se:SvgParameter></se:Fill>
      <se:Stroke><se:SvgParameter name="stroke">#1f78b4</se:SvgParameter><se:SvgParameter name="stroke-width">0.5</se:SvgParameter></se:Stroke>
    </se:PolygonSymbolizer>
  </se:Rule></se:FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>`
    const { style, notes } = importStyle('lakes.sld', sld)
    expect(notes).toEqual([])
    expect(style.fillColor).toBe('#a6cee3')
    expect(style.fillOpacity).toBe(DEFAULT_LAYER_STYLE.fillOpacity)
    expect(style.strokeColor).toBe('#1f78b4')
    expect(style.strokeWidth).toBe(0.5)
  })
})

describe('Mapbox GL style JSON written by other tools', () => {
  it('reads literal paints and notes expression values it skipped', () => {
    const json = JSON.stringify({
      version: 8,
      sources: {},
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#fff' } },
        { id: 'f', type: 'fill', source: 's', paint: { 'fill-color': 'rgba(255, 0, 0, 0.5)', 'fill-opacity': 0.8 } },
        { id: 'l', type: 'line', source: 's', paint: { 'line-color': '#00f', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 10, 4] } },
      ],
    })
    const { style, notes } = importStyle('style.json', json)
    expect(style.fillColor).toBe('#ff0000')
    expect(style.fillOpacity).toBeCloseTo(0.4, 5)
    expect(style.strokeColor).toBe('#0000ff')
    expect(style.strokeWidth).toBe(DEFAULT_LAYER_STYLE.strokeWidth)
    expect(notes[0]).toMatch(/expressions/)
  })
})

describe('helpers', () => {
  it('names the sidecar the way QGIS expects', () => {
    expect(sidecarStyleFileName('world.geojson')).toBe('world.qml')
    expect(sidecarStyleFileName('parcels.shp')).toBe('parcels.qml')
    expect(styleFileName('a.b.gpkg', 'mapbox')).toBe('a.b.style.json')
  })

  it('parses every color notation the formats use', () => {
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 })
    expect(parseColor('#11223380')?.a).toBeCloseTo(128 / 255)
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
    expect(parseColor('10,20,30,51,rgb:0.1,0.2,0.3,0.2')).toEqual({ r: 10, g: 20, b: 30, a: 0.2 })
    expect(parseColor('red')).toBeNull()
  })
})
