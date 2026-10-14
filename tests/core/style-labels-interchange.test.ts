// @vitest-environment happy-dom
// Spec 011 T066 (US6): labels in QML (QGIS's simple labeling), SLD (a
// TextSymbolizer in each rule) and Mapbox GL (symbol layers), and back.
// QGIS's own read-back is checked by tests/qgis/check_011.py.
import { describe, expect, it } from 'vitest'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { DEFAULT_LAYER_STYLE, exportStyle, importStyle, labelColumnOf, resolveStyle, sanitizeStyle, setLabels, startStyle, type LayerStyle } from '@spatial-explorer/core'

const rows = Array.from({ length: 9 }, (_, i) => ({ name: `Place ${i}`, cls: ['A', 'B', 'C'][i % 3], lanes: i }))
const columns = [
  { name: 'name', type: 'VARCHAR' },
  { name: 'cls', type: 'VARCHAR' },
  { name: 'lanes', type: 'INTEGER' },
]
const layer = { features: rows.map((attributes, id) => ({ id, geometry: null, attributes })), columns }
const base = sanitizeStyle(DEFAULT_LAYER_STYLE)
const labeled = setLabels(base, { enabled: true, size: 14, color: '#112233', halo: { color: '#fefefe', width: 2 }, placement: { anchor: 'right', offset: 6 } }, columns)

function out(style: LayerStyle, format: 'qml' | 'sld' | 'mapbox', geometry: 'Point' | 'LineString' | 'Polygon' = 'Point') {
  return exportStyle(style, format, geometry, 'layer', resolveStyle(style, layer), columns)
}
/** As another tool would leave it: without our own copy of the style. */
const foreign = (text: string, format: 'qml' | 'sld' | 'mapbox'): string =>
  format === 'qml' ? text.replace(/<Option name="spatialExplorer\/style"[^>]*\/>/, '') : format === 'mapbox' ? JSON.stringify({ ...JSON.parse(text), metadata: {} }) : text

describe('labels in QML (spec 011 US6)', () => {
  it("writes QGIS's simple labeling, loaded with the Labeling category", () => {
    const { text } = out(labeled, 'qml')
    expect(text).toMatch(/styleCategories="Symbology\|Symbology3D\|Labeling\|Rendering\|CustomProperties" labelsEnabled="1"/)
    expect(text).toMatch(/<text-style fieldName="name" isExpression="0" fontSize="14" fontSizeUnit="Pixel" textColor="17,34,51,255"/)
    expect(text).toMatch(/<text-buffer bufferDraw="1" bufferSize="2" bufferSizeUnits="Pixel" bufferColor="254,254,254,255"/)
    expect(text).toMatch(/<placement placement="1" quadOffset="5" dist="6" distUnits="Pixel"\/>/)
    expect(out(labeled, 'qml', 'LineString').text).toMatch(/<placement placement="3" placementFlags="10"/)
    expect(out(labeled, 'qml', 'Polygon').text).toMatch(/<placement placement="1" quadOffset="4" dist="0"/)
  })

  it('no labels: no labeling, the categories as before', () => {
    const { text } = out(base, 'qml')
    expect(text).not.toMatch(/labeling|labelsEnabled/)
    expect(text).toMatch(/styleCategories="Symbology\|Symbology3D\|Rendering\|CustomProperties">/)
  })

  it("reads QGIS's labeling back (an expression as SQL, with a note)", () => {
    expect(importStyle('a.qml', foreign(out(labeled, 'qml').text, 'qml')).style.labels).toEqual(labeled.labels)
    const expr = setLabels(labeled, { source: { kind: 'expression', expression: "name || ' ' || cls" } })
    const back = importStyle('a.qml', foreign(out(expr, 'qml').text, 'qml'))
    expect(back.style.labels?.source).toEqual({ kind: 'expression', expression: "name || ' ' || cls" })
    expect(back.notes.join(' ')).toMatch(/QGIS expression/)
  })
})

describe('labels in SLD (spec 011 US6)', () => {
  it('a TextSymbolizer in every drawn rule (hidden classes stay unlabeled), and back', () => {
    let style = sanitizeStyle(startStyle(labeled, 'categorized', layer, 'cls'))
    const resolved = resolveStyle(style, layer)
    style = { ...style }
    const hidden = { ...resolved, classes: resolved.classes.map((c) => (c.value === 'B' ? { ...c, visible: false } : c)) }
    const { text } = exportStyle(style, 'sld', 'Point', 'layer', hidden, columns)
    expect((text.match(/<Rule>/g) ?? []).length).toBe((text.match(/<TextSymbolizer>/g) ?? []).length)
    expect(text).toMatch(/<Label><ogc:PropertyName>name<\/ogc:PropertyName><\/Label>/)
    expect(text).toMatch(/<AnchorPointX>0<\/AnchorPointX><AnchorPointY>0.5<\/AnchorPointY><\/AnchorPoint><Displacement><DisplacementX>6<\/DisplacementX>/)
    expect(text).toMatch(/<Halo><Radius>2<\/Radius><Fill><CssParameter name="fill">#fefefe<\/CssParameter><\/Fill><\/Halo>/)
    expect(importStyle('a.sld', out(labeled, 'sld').text).style.labels).toEqual(labeled.labels)
  })

  it('an expression label reads its first column, with a note', () => {
    const expr = setLabels(labeled, { source: { kind: 'expression', expression: "upper(\"cls\") || ' ' || name" } })
    expect(labelColumnOf(expr.labels!)).toBe('cls')
    const { text, notes } = out(expr, 'sld')
    expect(text).toMatch(/<Label><ogc:PropertyName>cls<\/ogc:PropertyName><\/Label>/)
    expect(notes.join(' ')).toMatch(/SLD labels read one column: the labels show "cls"/)
  })
})

describe('labels in Mapbox GL (spec 011 US6)', () => {
  it("the map's label layers, with glyphs for other tools; a valid style; read back", () => {
    const { text, notes } = out(labeled, 'mapbox', 'LineString')
    const doc = JSON.parse(text)
    const line = doc.layers.find((l: { id: string }) => l.id === 'layer-line-labels')
    expect(line.layout['symbol-placement']).toBe('line')
    expect(line.layout['text-font']).toEqual(['Noto Sans Regular'])
    expect(doc.glyphs).toMatch(/openfreemap/)
    expect(notes.join(' ')).toMatch(/Noto Sans/)
    doc.sources.data.data = { type: 'FeatureCollection', features: [] }
    expect(validateStyleMin(doc).map((e: { message: string }) => e.message)).toEqual([])
    const point = JSON.parse(out(labeled, 'mapbox', 'Point').text)
    expect(point.layers.map((l: { id: string }) => l.id)).toContain('layer-labels')
    const back = importStyle('a.json', foreign(out(labeled, 'mapbox', 'Point').text, 'mapbox')).style.labels
    expect(back).toEqual(labeled.labels)
  })

  it('an expression label reads its first column, with a note', () => {
    const expr = setLabels(labeled, { source: { kind: 'expression', expression: "name || ' (' || lanes || ')'" } })
    const { text, notes } = out(expr, 'mapbox')
    expect(JSON.parse(text).layers.find((l: { id: string }) => l.id === 'layer-labels').layout['text-field']).toEqual(['coalesce', ['to-string', ['get', 'name']], ''])
    expect(notes.join(' ')).toMatch(/Mapbox GL labels read one column: the labels show "name"/)
  })
})
