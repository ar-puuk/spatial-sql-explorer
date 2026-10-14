// @vitest-environment happy-dom
// Spec 011 T059 (US6): label settings, the map's label layers, and the text
// column the engine computes for an expression label.
import { describe, expect, it } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  DEFAULT_LAYER_STYLE,
  LABEL_COLUMN,
  computedColumns,
  defaultLabelColumn,
  labelLayers,
  labelOffset,
  resolveStyle,
  sanitizeLabels,
  sanitizeStyle,
  setChannelClass,
  setChannelColumn,
  setLabels,
  startStyle,
  styleDataColumns,
  type LayerStyle,
  type ResolvedStyle,
} from '@spatial-explorer/core'

const rows = Array.from({ length: 12 }, (_, i) => ({ name: i === 3 ? null : `Place ${i}`, cls: ['A', 'B', 'C'][i % 3], lanes: i % 4 }))
const columns = [
  { name: 'name', type: 'VARCHAR' },
  { name: 'cls', type: 'VARCHAR' },
  { name: 'lanes', type: 'INTEGER' },
]
const layer = { features: rows.map((attributes, id) => ({ id, geometry: null, attributes })), columns }
const base = sanitizeStyle(DEFAULT_LAYER_STYLE)
const on = (style: LayerStyle = base) => setLabels(style, { enabled: true }, columns)

function evaluate(expr: unknown, properties: Record<string, unknown>, type: string, spec: { type: string; [k: string]: unknown }): unknown {
  const parsed = expression.createExpression(expr, spec as never)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 10 }, { type, properties } as never, {} as never)
}
const FILTER_SPEC = { type: 'boolean', 'property-type': 'data-driven', expression: { interpolated: false, parameters: ['zoom', 'feature'] } }

describe('label settings (spec 011 US6)', () => {
  it('sanitizeLabels clamps, fills defaults, and drops labels with no text source', () => {
    expect(sanitizeLabels({ enabled: true })).toBeUndefined()
    expect(sanitizeLabels({ enabled: true, source: { kind: 'expression', expression: '  ' } })).toBeUndefined()
    const l = sanitizeLabels({ enabled: true, source: { kind: 'column', column: 'name' }, size: 200, color: 'red', halo: { width: -1 }, placement: { kind: 'point', anchor: 'sideways', offset: 99 } })
    expect(l).toEqual({ enabled: true, source: { kind: 'column', column: 'name' }, size: 48, color: '#1f2937', halo: { enabled: true, color: '#ffffff', width: 0.5 }, placement: { kind: 'point', anchor: 'above', offset: 20 } })
  })

  it('setLabels turns labels on from a name-like column, and merges halo and placement', () => {
    expect(defaultLabelColumn([{ name: 'id', type: 'INTEGER' }, { name: 'street_name', type: 'VARCHAR' }, { name: 'zone', type: 'VARCHAR' }])).toBe('street_name')
    const s = on()
    expect(s.labels?.source).toEqual({ kind: 'column', column: 'name' })
    const t = setLabels(setLabels(s, { halo: { color: '#000000' } }), { placement: { anchor: 'right' } })
    expect(t.labels?.halo).toEqual({ enabled: true, color: '#000000', width: 1.5 })
    expect(t.labels?.placement).toEqual({ kind: 'point', anchor: 'right', offset: 4 })
    expect(setLabels(base, { enabled: true }, [])).toBe(base)
  })

  it('the label text is a data column while labels are on (an expression: the engine-computed one)', () => {
    expect(styleDataColumns(base)).toEqual([])
    expect(styleDataColumns(on())).toEqual(['name'])
    expect(styleDataColumns(setLabels(on(), { enabled: false }))).toEqual([])
    const expr = setLabels(on(), { source: { kind: 'expression', expression: "name || ' (' || lanes || ')'" } })
    expect(styleDataColumns(expr)).toEqual([LABEL_COLUMN])
    const resolved = resolveStyle(expr, layer)
    expect(computedColumns(expr, resolved)).toEqual([{ name: LABEL_COLUMN, sql: "TRY_CAST((name || ' (' || lanes || ')') AS VARCHAR)", type: 'VARCHAR' }])
    expect(computedColumns(expr, { ...resolved, labelError: 'No column "nam" in this layer.' })).toEqual([])
  })
})

describe('label layers (spec 011 US6)', () => {
  it('points: text from the column, system font, size, color, halo, anchor and offset; never overlapping', () => {
    const s = setLabels(on(), { size: 16, color: '#112233', placement: { anchor: 'below', offset: 8 } })
    const L = labelLayers(s, resolveStyle(s, layer))!
    expect(L.label.layout['text-field']).toEqual(['coalesce', ['to-string', ['get', 'name']], ''])
    expect(L.label.layout['text-font']).toEqual(['sans-serif'])
    expect(L.label.layout['text-size']).toBe(16)
    expect(L.label.layout['text-allow-overlap']).toBe(false)
    expect(L.label.paint).toEqual({ 'text-color': '#112233', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5, 'text-halo-blur': 0 })
    expect(evaluate(L.label.layout['text-anchor'], {}, 'Point', { type: 'enum', values: {} })).toBe('top')
    expect(evaluate(L.label.layout['text-offset'], {}, 'Point', { type: 'array', value: 'number', length: 2 })).toEqual([0, 0.5])
    expect(labelOffset('left', 6, 12)).toEqual([-0.5, 0])
  })

  it('polygons are centered at their label point; lines follow the line, upright', () => {
    const s = on()
    const L = labelLayers(s, resolveStyle(s, layer))!
    expect(evaluate(L.label.layout['text-anchor'], {}, 'Polygon', { type: 'enum', values: {} })).toBe('center')
    expect(evaluate(L.label.layout['text-offset'], {}, 'Polygon', { type: 'array', value: 'number', length: 2 })).toEqual([0, 0])
    expect(L['label-line'].layout['symbol-placement']).toBe('line')
    expect(L['label-line'].layout['text-keep-upright']).toBe(true)
    expect(evaluate(L['label-line'].filter, { name: 'Main St' }, 'LineString', FILTER_SPEC)).toBe(true)
    expect(evaluate(L['label-line'].filter, { name: 'Main St' }, 'Point', FILTER_SPEC)).toBe(false)
  })

  it("with the engine's label points, polygons are labeled once, from their point, and the point layer takes points only", () => {
    const s = setLabels(on(), { placement: { anchor: 'right', offset: 6 } })
    const L = labelLayers(s, resolveStyle(s, layer), true)!
    expect(evaluate(L.label.filter, { name: 'X' }, 'Point', FILTER_SPEC)).toBe(true)
    expect(evaluate(L.label.filter, { name: 'X' }, 'Polygon', FILTER_SPEC)).toBe(false)
    expect(L['label-area']!.layout['text-anchor']).toBe('center')
    expect(evaluate(L['label-area']!.filter, { name: 'X' }, 'Point', FILTER_SPEC)).toBe(true)
    expect(evaluate(L['label-area']!.filter, { name: '' }, 'Point', FILTER_SPEC)).toBe(false)
    expect(L.label.layout['text-anchor']).toBe('left')
    // Without them (PMTiles, the Mapbox GL file), polygons stay on the point layer.
    expect(labelLayers(s, resolveStyle(s, layer))!['label-area']).toBeUndefined()
  })

  it('no halo is width 0; empty and missing text get no label', () => {
    const s = setLabels(on(), { halo: { enabled: false } })
    const L = labelLayers(s, resolveStyle(s, layer))!
    expect(L.label.paint['text-halo-width']).toBe(0)
    expect(evaluate(L.label.filter, { name: null }, 'Point', FILTER_SPEC)).toBe(false)
    expect(evaluate(L.label.filter, { name: '' }, 'Point', FILTER_SPEC)).toBe(false)
    expect(evaluate(L.label.filter, { name: 'X' }, 'Point', FILTER_SPEC)).toBe(true)
  })

  it('features hidden through the legend lose their labels', () => {
    let s = on(sanitizeStyle(startStyle(base, 'categorized', layer, 'cls')))
    s = setChannelColumn(s, 'opacity', 'lanes', layer)
    s = setChannelClass(s, 'opacity', 'range:0', { visible: false })
    const resolved = resolveStyle(s, layer)
    const hiddenColor = { ...resolved, classes: resolved.classes.map((c) => (c.value === 'B' ? { ...c, visible: false } : c)) } as ResolvedStyle
    const L = labelLayers(s, hiddenColor)!
    expect(evaluate(L.label.filter, { name: 'X', cls: 'A', lanes: 3 }, 'Point', FILTER_SPEC)).toBe(true)
    expect(evaluate(L.label.filter, { name: 'X', cls: 'B', lanes: 3 }, 'Point', FILTER_SPEC)).toBe(false)
    expect(evaluate(L.label.filter, { name: 'X', cls: 'A', lanes: 0 }, 'Point', FILTER_SPEC)).toBe(false)
  })

  it('off, or an expression the engine refused: no label layers', () => {
    expect(labelLayers(base, resolveStyle(base, layer))).toBeNull()
    const s = setLabels(on(), { source: { kind: 'expression', expression: 'nam' } })
    expect(labelLayers(s, { ...resolveStyle(s, layer), labelError: 'No column "nam" in this layer.' })).toBeNull()
  })
})
