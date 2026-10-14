// @vitest-environment happy-dom
// Spec 011 T056: Mapbox GL style JSON writes each property by a column with
// the expression the map draws with (symbolExpressions), and reads `match` /
// `step` over one `get` back as properties by that column.
import { describe, expect, it } from 'vitest'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { DEFAULT_LAYER_STYLE, exportStyle, importStyle, resolveStyle, sanitizeStyle, setChannelColumn, setFixed, symbolExpressions, visibilityFilter, setChannelClass, type LayerStyle } from '@spatial-explorer/core'

const rows = Array.from({ length: 40 }, (_, i) => ({ cls: ['A', 'B', 'C'][i % 3], num: i % 7 === 3 ? null : i * 3 }))
const columns = [
  { name: 'cls', type: 'VARCHAR' },
  { name: 'num', type: 'DOUBLE' },
]
const layer = { features: rows.map((attributes, id) => ({ id, geometry: null, attributes })), columns }
const base = sanitizeStyle(DEFAULT_LAYER_STYLE)

type Doc = { layers: Array<{ id: string; type: string; filter?: unknown; paint: Record<string, unknown>; layout?: Record<string, unknown> }>; metadata: Record<string, unknown> }
function mapbox(style: LayerStyle, geometry: 'Point' | 'LineString' | 'Polygon') {
  const out = exportStyle(style, 'mapbox', geometry, 'layer', resolveStyle(style, layer), columns)
  return { doc: JSON.parse(out.text) as Doc, notes: out.notes, text: out.text }
}

describe('Mapbox GL export of properties by a column (spec 011 T056)', () => {
  it("writes outline color, outline width and opacity with the map's own expressions", () => {
    let style = setChannelColumn(base, 'strokeColor', 'cls', layer)
    style = setChannelColumn(style, 'strokeWidth', 'num', layer)
    style = setChannelColumn(style, 'opacity', 'cls', layer)
    const sym = symbolExpressions(style, resolveStyle(style, layer))
    const { doc } = mapbox(style, 'Point')
    const point = doc.layers.find((l) => l.type === 'circle')!
    expect(point.paint['circle-stroke-color']).toEqual(sym.strokeColor)
    expect(point.paint['circle-stroke-width']).toEqual(sym.strokeWidth)
    expect(point.paint['circle-opacity']).toEqual(['*', Math.round(style.fillOpacity * 100) / 100, sym.opacity])
  })

  it('writes the pattern per feature and hides hidden classes with the same filter as the map', () => {
    let style = setChannelColumn(base, 'dash', 'cls', layer)
    style = setChannelClass(style, 'dash', 'v:B', { visible: false })
    const resolved = resolveStyle(style, layer)
    const { doc } = mapbox(style, 'LineString')
    const line = doc.layers.find((l) => l.type === 'line')!
    expect(line.paint['line-dasharray']).toEqual(symbolExpressions(style, resolved).dash)
    expect(line.layout?.['line-cap']).toBe('butt')
    expect(JSON.stringify(line.filter)).toContain(JSON.stringify(visibilityFilter(style, resolved)))
  })

  it("every export is a valid style (MapLibre's validator)", () => {
    let points = setChannelColumn(base, 'strokeColor', 'cls', layer)
    points = setChannelColumn(setChannelColumn(points, 'strokeWidth', 'num', layer), 'opacity', 'num', layer)
    let polygons = setChannelColumn(base, 'dash', 'cls', layer)
    polygons = setChannelColumn(setChannelColumn(polygons, 'strokeWidth', 'cls', layer), 'opacity', 'cls', layer)
    const lines = setChannelColumn(setChannelColumn(base, 'dash', 'num', layer), 'width', 'cls', layer)
    for (const [style, geometry] of [[points, 'Point'], [polygons, 'Polygon'], [lines, 'LineString']] as const) {
      const { doc } = mapbox(style, geometry)
      ;(doc as unknown as { sources: Record<string, unknown> }).sources = { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }
      expect(validateStyleMin(doc as never).map((e) => e.message)).toEqual([])
    }
  })

  it('says shapes by attribute need a sprite', () => {
    const { notes } = mapbox(setChannelColumn(base, 'shape', 'cls', layer), 'Point')
    expect(notes.join(' ')).toMatch(/shapes by attribute/)
  })

  it('round-trips through the embedded style', () => {
    const style = setFixed(setChannelColumn(base, 'strokeColor', 'cls', layer), 'rotation', 20)
    const back = importStyle('style.json', mapbox(style, 'Point').text).style
    expect(back.channels?.strokeColor).toEqual(style.channels?.strokeColor)
    expect(back.rotation).toBe(20)
  })
})

describe('Mapbox GL import of foreign data-driven paint (spec 011 T056)', () => {
  const doc = (paint: Record<string, unknown>, type = 'circle') => JSON.stringify({ version: 8, sources: {}, layers: [{ id: 'p', type, source: 'd', paint }] })

  it('reads match over one get as categories, and step as classes', () => {
    const { style, notes } = importStyle(
      'style.json',
      doc({
        'circle-color': '#336699',
        'circle-stroke-color': ['match', ['get', 'cls'], 'A', '#ff0000', ['B', 'C'], '#00ff00', '#000000'],
        'circle-stroke-width': ['step', ['get', 'num'], 1, 10, 2, 50, 4],
      })
    )
    const sc = style.channels?.strokeColor
    expect(sc?.scale.kind === 'categories' && sc.scale.categories.map((c) => [c.value, c.output])).toEqual([
      ['A', '#ff0000'],
      ['B', '#00ff00'],
      ['C', '#00ff00'],
    ])
    expect(sc?.scale.kind === 'categories' && sc.scale.other.output).toBe('#000000')
    const sw = style.channels?.strokeWidth
    expect(sw?.source).toEqual({ kind: 'column', column: 'num' })
    expect(sw?.scale.kind === 'classes' && sw.scale.classes.map((c) => [c.lower, c.upper, c.output])).toEqual([
      [-30, 10, 1],
      [10, 50, 2],
      [50, 90, 4],
    ])
    expect(notes.join(' ')).not.toMatch(/only literal values/)
  })

  it('spec 011 US4: a two-stop linear interpolate over one get is continuous', () => {
    const { style } = importStyle('style.json', doc({ 'circle-color': '#336699', 'circle-stroke-width': ['interpolate', ['linear'], ['get', 'num'], 0, 1, 100, 5] }))
    expect(style.channels?.strokeWidth?.scale).toEqual({ kind: 'continuous', domain: { min: 0, max: 100 }, range: { min: 1, max: 5 }, noValue: {} })
  })

  it('reads a line width by categories as width', () => {
    const { style } = importStyle('style.json', doc({ 'line-color': '#333333', 'line-width': ['match', ['get', 'cls'], 'A', 1, 'B', 3, 2] }, 'line'))
    expect(style.channels?.width?.scale.kind).toBe('categories')
  })

  it('anything else keeps the fixed value, with the usual note', () => {
    const { style, notes } = importStyle('style.json', doc({ 'circle-color': '#336699', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 3] }))
    expect(style.channels?.strokeWidth).toBeUndefined()
    expect(notes.join(' ')).toMatch(/only literal values/)
  })
})
