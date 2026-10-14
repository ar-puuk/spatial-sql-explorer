// @vitest-environment happy-dom
// Spec 011 T054: QGIS data-defined properties read back as properties by a
// column. QGIS's `CASE` forms become categories or classes; other forms keep
// the fixed value, with a note naming the property.
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STYLE, exportStyle, importStyle, resolveStyle, sanitizeStyle, setChannelColumn, startStyle, type LayerStyle } from '@spatial-explorer/core'

const rows = Array.from({ length: 40 }, (_, i) => ({ cls: ['A', 'B', 'C'][i % 3], kind: `k${i % 5}`, num: i % 7 === 3 ? null : i * 3 }))
const columns = [
  { name: 'cls', type: 'VARCHAR' },
  { name: 'kind', type: 'VARCHAR' },
  { name: 'num', type: 'DOUBLE' },
]
const layer = { features: rows.map((attributes, id) => ({ id, geometry: null, attributes })), columns }

/** The QML the app saves, as QGIS would see it without our own copy of the style. */
function asQgisWrote(style: LayerStyle, geometry: 'Point' | 'LineString' | 'Polygon'): string {
  const text = exportStyle(style, 'qml', geometry, 'data.geojson', resolveStyle(style, layer), columns).text
  return text.replace(/<Option name="spatialExplorer\/style"[^>]*\/>/, '')
}

/** A minimal QGIS point style with data-defined properties on the marker layer and the symbol. */
function qgisMarker(layerProps: Record<string, string>, symbolProps: Record<string, string> = {}): string {
  const block = (props: Record<string, string>) =>
    Object.keys(props).length
      ? `<data_defined_properties><Option type="Map"><Option name="name" type="QString" value=""/><Option name="properties" type="Map">${Object.entries(props)
          .map(([k, v]) => `<Option name="${k}" type="Map">${v}</Option>`)
          .join('')}</Option><Option name="type" type="QString" value="collection"/></Option></data_defined_properties>`
      : ''
  return `<!DOCTYPE qgis><qgis version="3.34"><renderer-v2 type="singleSymbol"><symbols>
<symbol type="marker" name="0" alpha="1">${block(symbolProps)}<layer class="SimpleMarker" enabled="1" locked="0" pass="0"><Option type="Map">
<Option name="color" type="QString" value="31,120,180,255"/><Option name="name" type="QString" value="circle"/><Option name="angle" type="QString" value="0"/>
<Option name="outline_color" type="QString" value="0,0,0,255"/><Option name="outline_width" type="QString" value="1"/><Option name="outline_width_unit" type="QString" value="Pixel"/>
<Option name="size" type="QString" value="6"/><Option name="size_unit" type="QString" value="Pixel"/></Option>${block(layerProps)}</layer></symbol></symbols></renderer-v2></qgis>`
}
const expr = (e: string) => `<Option name="active" type="bool" value="true"/><Option name="expression" type="QString" value="${e.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"/><Option name="type" type="int" value="3"/>`
const field = (f: string) => `<Option name="active" type="bool" value="true"/><Option name="field" type="QString" value="${f}"/><Option name="type" type="int" value="2"/>`

describe('QML import of QGIS data-defined properties (spec 011 T054)', () => {
  it('reads back outline color by categories and outline width by classes, as written', () => {
    let style = sanitizeStyle(startStyle(sanitizeStyle(DEFAULT_LAYER_STYLE), 'categorized', layer, 'cls'))
    style = setChannelColumn(style, 'strokeColor', 'kind', layer)
    style = setChannelColumn(style, 'strokeWidth', 'num', layer)
    const resolved = resolveStyle(style, layer)
    const { style: back, notes } = importStyle('style.qml', asQgisWrote(style, 'Polygon'))
    const sc = back.channels?.strokeColor
    expect(sc?.source).toEqual({ kind: 'column', column: 'kind' })
    expect(sc?.scale.kind).toBe('categories')
    const wantColors = resolved.channels!.strokeColor!.classes.filter((c) => c.kind === 'value').map((c) => [c.value, c.output])
    expect(sc?.scale.kind === 'categories' && sc.scale.categories.map((c) => [c.value, c.output])).toEqual(wantColors)
    const sw = back.channels?.strokeWidth
    expect(sw?.source).toEqual({ kind: 'column', column: 'num' })
    const ranges = resolved.channels!.strokeWidth!.classes.filter((c) => c.kind === 'range')
    expect(sw?.scale.kind === 'classes' && sw.scale.method).toBe('manual')
    expect(sw?.scale.kind === 'classes' && sw.scale.classes.map((c) => [c.lower, c.upper, c.output])).toEqual(ranges.map((c) => [c.lower, c.upper, c.output]))
    expect(notes.join(' ')).not.toMatch(/Outline/)
  })

  it('reads back a line pattern by categories', () => {
    const style = setChannelColumn(sanitizeStyle(DEFAULT_LAYER_STYLE), 'dash', 'cls', layer)
    const { style: back } = importStyle('style.qml', asQgisWrote(style, 'LineString'))
    const dash = back.channels?.dash
    expect(dash?.scale.kind === 'categories' && dash.scale.categories.map((c) => c.value)).toEqual(['A', 'B', 'C'])
    expect(dash?.scale.kind === 'categories' && dash.scale.categories.every((c) => typeof c.output === 'string')).toBe(true)
  })

  it("reads QGIS's own CASE forms: classes with only upper bounds, categories, opacity 0 as hidden", () => {
    const qml = qgisMarker(
      { angle: expr('CASE WHEN "num" >= 0 AND "num" <= 30 THEN 15 WHEN "num" <= 60 THEN 45 WHEN "num" <= 120 THEN 90 END'), name: expr(`CASE WHEN "cls" = 'A' THEN 'square' WHEN "cls" = 'B' THEN 'star' ELSE 'circle' END`) },
      { alpha: expr(`CASE WHEN "cls" = 'A' THEN 0 WHEN "cls" = 'B' THEN 50 ELSE 100 END`) },
    )
    const { style, notes } = importStyle('style.qml', qml)
    const rot = style.channels?.rotation
    expect(rot?.scale.kind === 'classes' && rot.scale.classes.map((c) => [c.lower, c.upper, c.output])).toEqual([
      [0, 30, 15],
      [30, 60, 45],
      [60, 120, 90],
    ])
    const shape = style.channels?.shape
    expect(shape?.scale.kind === 'categories' && shape.scale.categories.map((c) => [c.value, c.output])).toEqual([
      ['A', 'square'],
      ['B', 'star'],
    ])
    expect(shape?.scale.kind === 'categories' && shape.scale.other.output).toBe('circle')
    const op = style.channels?.opacity
    expect(op?.scale.kind === 'categories' && op.scale.categories).toEqual([
      { value: 'A', visible: false },
      { value: 'B', output: 0.5 },
    ])
    expect(notes).toEqual([])
  })

  it('keeps the fixed value, with a note naming the property, for other forms', () => {
    const qml = qgisMarker({ outlineWidth: expr('scale_linear("num", 0, 100, 1, 5)'), angle: field('num') })
    const { style, notes } = importStyle('style.qml', qml)
    expect(style.channels?.strokeWidth).toBeUndefined()
    expect(style.channels?.rotation).toBeUndefined()
    expect(notes.some((n) => /^Outline width/.test(n))).toBe(true)
    expect(notes.some((n) => /^Rotation/.test(n))).toBe(true)
  })

  it("imports a fixed marker angle as the style's rotation", () => {
    const qml = qgisMarker({}).replace('<Option name="angle" type="QString" value="0"/>', '<Option name="angle" type="QString" value="30"/>')
    expect(importStyle('style.qml', qml).style.rotation).toBe(30)
  })

  it('our own files keep their saved properties (spatialExplorer/style wins)', () => {
    const style = setChannelColumn(sanitizeStyle(DEFAULT_LAYER_STYLE), 'opacity', 'num', layer)
    const text = exportStyle(style, 'qml', 'Point', 'data.geojson', resolveStyle(style, layer), columns).text
    expect(importStyle('style.qml', text).style.channels?.opacity).toEqual(style.channels?.opacity)
  })
})
