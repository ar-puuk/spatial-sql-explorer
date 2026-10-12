// @vitest-environment happy-dom
// T034 (spec 003, FR-013..FR-015, SC-004; contracts/interchange-mapping.md):
// thematic styles through QGIS QML, OGC SLD and Mapbox GL style JSON. QGIS
// 4.2.3 wrote the QML fixtures, so the import side is checked against what
// QGIS really writes.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_LAYER_STYLE,
  exportStyle,
  importStyle,
  previewExportNotice,
  rendererOf,
  resolveStyle,
  setClassVisible,
  styleFileName,
  type LayerStyle,
  type StyleFormat,
} from '@spatial-explorer/core'

// import.meta.dirname, not new URL(..., import.meta.url): under happy-dom the latter resolves against the page.
const fixture = (name: string): string => readFileSync(`${import.meta.dirname}/fixtures/style/${name}`, 'utf8')

const zones = ['R1', 'R2', 'C', 'R1', 'I', null, 'AG', 'R1', 'C', 'Z9']
const values = Array.from({ length: 40 }, (_, i) => (i === 7 ? null : i * 3.5))
const layer = {
  features: zones.map((zone, i) => ({ id: i, geometry: null, attributes: { zone, value: values[i] } })).concat(values.slice(10).map((value, i) => ({ id: 10 + i, geometry: null, attributes: { zone: 'R1', value } }))),
  columns: [
    { name: 'zone', type: 'VARCHAR' },
    { name: 'value', type: 'DOUBLE' },
  ],
}

const categorized: LayerStyle = {
  ...DEFAULT_LAYER_STYLE,
  strokeColor: '#4b5563',
  strokeWidth: 0.75,
  renderer: {
    kind: 'categorized',
    column: 'zone',
    ramp: { id: 'brewer-set2', reversed: false },
    cap: 5,
    manual: false,
    classes: [{ value: 'C', color: '#ff00ff', label: 'Commercial' }],
    other: {},
    noValue: { label: 'Unknown' },
  },
}
const graduated = (method: 'quantile' | 'equal' | 'jenks' | 'manual' = 'quantile'): LayerStyle => ({
  ...DEFAULT_LAYER_STYLE,
  renderer:
    method === 'manual'
      ? {
          kind: 'graduated',
          column: 'value',
          method,
          classCount: 3,
          ramp: { id: 'brewer-reds', reversed: true },
          classes: [
            { index: 0, lower: 0, upper: 40, label: 'Low' },
            { index: 1, lower: 40, upper: 80 },
            { index: 2, lower: 80, upper: 140 },
          ],
          noValue: {},
        }
      : { kind: 'graduated', column: 'value', method, classCount: 4, ramp: { id: 'brewer-reds', reversed: true }, classes: [], noValue: {} },
})

/** What a user sees: renderer, column, classes with values/bounds, colors, labels, visibility. */
function seen(style: LayerStyle) {
  const r = resolveStyle(style, layer)
  return {
    kind: rendererOf(style).kind,
    caption: r.caption,
    classes: r.classes.map((c) => ({ key: c.key, label: c.label, color: c.color, visible: c.visible, lower: c.lower, upper: c.upper, count: c.count })),
  }
}

function roundTrip(style: LayerStyle, format: StyleFormat, geometry: 'Polygon' | 'Point' | 'LineString' | 'Mixed' = 'Polygon') {
  const exported = exportStyle(style, format, geometry, 'parcels.geojson', resolveStyle(style, layer))
  return { exported, imported: importStyle(styleFileName('parcels.geojson', format), exported.text) }
}

describe('QML written by QGIS 4.2.3 imports exactly', () => {
  it('categorized: values, colors, labels, hidden flag, NULL and "all other values"', () => {
    const { style, notes } = importStyle('x.qml', fixture('categorized.qml'))
    expect(notes).toEqual([])
    const r = rendererOf(style)
    expect(r).toMatchObject({ kind: 'categorized', column: 'zone', manual: true })
    if (r.kind !== 'categorized') throw new Error('categorized')
    expect(r.classes).toEqual([
      { value: 'R1', color: '#e41a1c', label: 'Residential 1' },
      { value: 'R2', color: '#377eb8', visible: false },
    ])
    expect(r.noValue).toEqual({ color: '#999999' }) // 'No value' is the default label
    expect(r.other).toEqual({ color: '#cccccc' }) // a plain 'Other' is the default label
  })

  it('graduated: method, class count, colors and the hidden range', () => {
    const { style, notes } = importStyle('x.qml', fixture('graduated.qml'))
    expect(notes).toEqual([])
    const r = rendererOf(style)
    expect(r).toMatchObject({ kind: 'graduated', column: 'value', method: 'quantile', classCount: 5 })
    if (r.kind !== 'graduated') throw new Error('graduated')
    expect(r.classes.map((c) => [c.index, c.color, c.visible])).toEqual([
      [0, '#fee5d9', undefined],
      [1, '#fcae91', undefined],
      [2, '#fb6a4a', false],
      [3, '#de2d26', undefined],
      [4, '#a50f15', undefined],
    ])
  })
})

describe('round trips: what the user sees is unchanged (SC-004)', () => {
  const cases: Array<[string, LayerStyle]> = [
    ['categorized', setClassVisible(categorized, 'v:R2', false)],
    ['graduated quantile', setClassVisible(graduated('quantile'), 'range:1', false)],
    ['graduated jenks', graduated('jenks')],
    ['graduated manual', graduated('manual')],
  ]
  for (const [name, style] of cases) {
    for (const format of ['qml', 'mapbox'] as const) {
      it(`${name} through ${format}`, () => {
        const { exported, imported } = roundTrip(style, format)
        expect(exported.notes).toEqual([])
        expect(imported.notes).toEqual([])
        expect(seen(imported.style)).toEqual(seen(style))
      })
    }
  }

  it('categorized through SLD: classes, colors and labels survive; the hidden class is left out, as announced', () => {
    const style = setClassVisible(categorized, 'v:R2', false)
    const { exported, imported } = roundTrip(style, 'sld')
    expect(exported.notes.join()).toMatch(/1 hidden class/)
    const before = seen(style).classes.filter((c) => c.visible && c.key.startsWith('v:'))
    const after = seen(imported.style).classes.filter((c) => c.key.startsWith('v:'))
    expect(after.map((c) => [c.key, c.label, c.color])).toEqual(before.map((c) => [c.key, c.label, c.color]))
  })

  it('graduated through SLD: bounds and colors survive as fixed classes (Manual), as announced', () => {
    const style = graduated('quantile')
    const { exported, imported } = roundTrip(style, 'sld')
    expect(exported.notes.join()).toMatch(/classification method/)
    expect(rendererOf(imported.style)).toMatchObject({ kind: 'graduated', method: 'manual' })
    const ranges = (s: LayerStyle) => seen(s).classes.filter((c) => c.key.startsWith('range:')).map((c) => [c.lower, c.upper, c.color])
    expect(ranges(imported.style)).toEqual(ranges(style))
  })

  it('mixed-geometry SLD rules keep one class list', () => {
    const { imported } = roundTrip(categorized, 'sld', 'Mixed')
    expect(seen(imported.style).classes.filter((c) => c.key.startsWith('v:')).map((c) => c.key)).toEqual(['v:R1', 'v:C', 'v:AG', 'v:I', 'v:R2'])
  })
})

describe('export notices are known before writing (FR-015)', () => {
  it('SLD lists the method and hidden classes; QML and Mapbox lose nothing', () => {
    const style = setClassVisible(graduated('quantile'), 'range:1', false)
    const resolved = resolveStyle(style, layer)
    expect(previewExportNotice(style, 'sld', resolved).items).toEqual([
      "SLD can't store the classification method: the classes will import as fixed (Manual).",
      "SLD can't mark a class as hidden: 1 hidden class will be left out.",
    ])
    expect(previewExportNotice(style, 'qml', resolved).items).toEqual([])
    expect(previewExportNotice(style, 'mapbox', resolved).items).toEqual([])
  })

  it('a style whose column is missing exports its single symbol, with a notice', () => {
    const style = { ...categorized, renderer: { ...rendererOf(categorized), column: 'gone' } } as LayerStyle
    const resolved = resolveStyle(style, layer)
    const { notes } = exportStyle(style, 'qml', 'Polygon', 'parcels.geojson', resolved)
    expect(notes.join()).toMatch(/Column "gone" is not in this result/)
  })
})

describe('foreign files import with notices for what is left out', () => {
  it('a QGIS rule-based renderer imports as a single symbol', () => {
    const qml = fixture('categorized.qml').replace('type="categorizedSymbol"', 'type="RuleRenderer"')
    const { style, notes } = importStyle('x.qml', qml)
    expect(rendererOf(style).kind).toBe('single')
    expect(notes.join()).toMatch(/RuleRenderer/)
  })

  it('QGIS size-graduated ranges import as size classes (style-symbols.test.ts has the details)', () => {
    const qml = fixture('graduated.qml').replace('graduatedMethod="GraduatedColor"', 'graduatedMethod="GraduatedSize"')
    const r = rendererOf(importStyle('x.qml', qml).style)
    expect(r.kind === 'graduated' && r.vary).toBe('size')
  })

  it('a GeoLibre-shaped SLD: the "< first value" guard rule is skipped', () => {
    const rule = (filter: string, color: string, title: string) =>
      `<se:Rule><se:Name>${title}</se:Name><se:Description><se:Title>${title}</se:Title></se:Description><ogc:Filter>${filter}</ogc:Filter><se:PolygonSymbolizer><se:Fill><se:SvgParameter name="fill">${color}</se:SvgParameter></se:Fill></se:PolygonSymbolizer></se:Rule>`
    const prop = '<ogc:PropertyName>value</ogc:PropertyName>'
    const lit = (n: number) => `<ogc:Literal>${n}</ogc:Literal>`
    const sld = `<?xml version="1.0"?><StyledLayerDescriptor xmlns="http://www.opengis.net/sld" xmlns:se="http://www.opengis.net/se" xmlns:ogc="http://www.opengis.net/ogc" version="1.1.0"><NamedLayer><se:Name>l</se:Name><UserStyle><se:FeatureTypeStyle>
      ${rule(`<ogc:PropertyIsLessThan>${prop}${lit(0)}</ogc:PropertyIsLessThan>`, '#000000', '< 0')}
      ${rule(`<ogc:And><ogc:PropertyIsGreaterThanOrEqualTo>${prop}${lit(0)}</ogc:PropertyIsGreaterThanOrEqualTo><ogc:PropertyIsLessThan>${prop}${lit(50)}</ogc:PropertyIsLessThan></ogc:And>`, '#fee5d9', '0 - 50')}
      ${rule(`<ogc:PropertyIsGreaterThanOrEqualTo>${prop}${lit(50)}</ogc:PropertyIsGreaterThanOrEqualTo>`, '#a50f15', '>= 50')}
    </se:FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`
    const { style, notes } = importStyle('x.sld', sld)
    const r = rendererOf(style)
    expect(r).toMatchObject({ kind: 'graduated', column: 'value', method: 'manual' })
    if (r.kind !== 'graduated') throw new Error('graduated')
    expect(r.classes.map((c) => c.color)).toEqual(['#fee5d9', '#a50f15'])
    expect(r.classes[0].lower).toBe(0)
    expect(notes.join()).toMatch(/below the first class/)
  })

  it('a GeoLibre-shaped Mapbox file (step, no metadata) imports as fixed classes', () => {
    const json = JSON.stringify({
      version: 8,
      sources: {},
      layers: [{ id: 'l', type: 'fill', source: 's', paint: { 'fill-color': ['step', ['to-number', ['get', 'value'], 0], '#fee5d9', 30, '#fcae91', 60, '#a50f15'], 'fill-opacity': 0.8 } }],
    })
    const { style, notes } = importStyle('x.json', json)
    const r = rendererOf(style)
    expect(r).toMatchObject({ kind: 'graduated', column: 'value', method: 'manual' })
    if (r.kind !== 'graduated') throw new Error('graduated')
    expect(r.classes.map((c) => c.color)).toEqual(['#fee5d9', '#fcae91', '#a50f15'])
    expect(r.classes[1]).toMatchObject({ lower: 30, upper: 60 })
    expect(notes.join()).toMatch(/fixed classes/)
  })

  it('a Mapbox match expression imports as categorized', () => {
    const json = JSON.stringify({
      version: 8,
      layers: [{ id: 'l', type: 'circle', paint: { 'circle-color': ['match', ['get', 'zone'], 'R1', '#ff0000', ['C', 'I'], '#00ff00', '#cccccc'] } }],
    })
    const { style } = importStyle('x.json', json)
    const r = rendererOf(style)
    expect(r).toMatchObject({ kind: 'categorized', column: 'zone', manual: true, other: { color: '#cccccc' } })
    if (r.kind !== 'categorized') throw new Error('categorized')
    expect(r.classes).toEqual([
      { value: 'R1', color: '#ff0000' },
      { value: 'C', color: '#00ff00' },
      { value: 'I', color: '#00ff00' },
    ])
  })
})
