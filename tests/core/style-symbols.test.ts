// @vitest-environment happy-dom
// Marker shapes, line styles and size classes (QGIS GraduatedSize): the
// shared symbol model, the map paint (evaluated with MapLibre's own
// expression evaluator), and the three style formats. The QGIS-written files
// in fixtures/style/symbols check the import side against real QGIS output.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  DEFAULT_LAYER_STYLE,
  MARKER_SHAPES,
  classSymbols,
  dashFromPattern,
  exportStyle,
  importStyle,
  layoutFor,
  markerExtent,
  markerIconId,
  markerIconIds,
  markerPath,
  markerPolygon,
  paintFor,
  parseMarkerIconId,
  previewExportNotice,
  rendererOf,
  resolveStyle,
  sanitizeStyle,
  setGraduatedVary,
  setSizeRange,
  startStyle,
  validateStyle,
  type LayerStyle,
  type StyleFormat,
} from '@spatial-explorer/core'

const fixture = (name: string): string => readFileSync(`${import.meta.dirname}/fixtures/style/symbols/${name}`, 'utf8')

function evaluate(expr: unknown, properties: Record<string, unknown>, key: string, type = 'Point'): unknown {
  const parsed = expression.createExpression(expr, key)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 0 }, { type, properties } as never, {} as never)
}

const values = Array.from({ length: 30 }, (_, i) => (i === 4 ? null : i * 2))
const layer = {
  features: values.map((v, i) => ({ id: i, geometry: null, attributes: { v, kind: i % 3 === 0 ? 'a' : 'b' } })),
  columns: [
    { name: 'v', type: 'DOUBLE' },
    { name: 'kind', type: 'VARCHAR' },
  ],
}

/** Points by `v`, five quantile classes, sized 2..10 px. */
function sizeStyle(geometry: 'point' | 'line' = 'point'): LayerStyle {
  const graduated = { ...startStyle(DEFAULT_LAYER_STYLE as LayerStyle, 'graduated', layer, 'v') }
  return setGraduatedVary(graduated, 'size', geometry)
}

describe('shapes and line patterns', () => {
  it('every shape fits its extent, which is 1 but for the corners of the square and the x', () => {
    for (const shape of MARKER_SHAPES) {
      const poly = markerPolygon(shape)
      if (poly) for (const [x, y] of poly) expect(Math.hypot(x, y)).toBeLessThanOrEqual(markerExtent(shape) + 1e-9)
    }
    expect(markerExtent('circle')).toBe(1)
    expect(markerExtent('square')).toBeCloseTo(Math.SQRT2)
    expect(markerExtent('star')).toBeCloseTo(1)
    expect(markerPath('triangle', 10)).toBe('M-10 10L10 10L0 -10Z')
  })

  it('reads any dash array as the closest pattern, whatever its unit', () => {
    expect(dashFromPattern([4, 2])).toBe('dash')
    expect(dashFromPattern([8, 4])).toBe('dash')
    expect(dashFromPattern([1, 2])).toBe('dot')
    expect(dashFromPattern([5])).toBe('dash') // odd arrays repeat
    expect(dashFromPattern([4, 2, 1, 2])).toBe('dash-dot')
    expect(dashFromPattern([4, 2, 1, 2, 1, 2])).toBe('dash-dot-dot')
    expect(dashFromPattern([])).toBeNull()
    expect(dashFromPattern([0, 0])).toBeNull()
    expect(dashFromPattern([NaN, 2])).toBeNull()
  })

  it('an icon id holds everything drawn and reads back', () => {
    const id = markerIconId({ shape: 'star', fillColor: '#ff0000', fillOpacity: 0.456, strokeColor: '#000000', strokeOpacity: 1, strokeWidth: 1.5, radius: 6 })
    expect(parseMarkerIconId(id)).toEqual({ shape: 'star', fillColor: '#ff0000', fillOpacity: 0.46, strokeColor: '#000000', strokeOpacity: 1, strokeWidth: 1.5, radius: 6 })
    expect(parseMarkerIconId('poi-15')).toBeNull()
  })

  it('sanitize keeps a valid shape and pattern, and leaves the defaults out', () => {
    expect(sanitizeStyle({ markerShape: 'star', lineDash: 'dot' })).toMatchObject({ markerShape: 'star', lineDash: 'dot' })
    const plain = sanitizeStyle({ markerShape: 'circle', lineDash: 'solid' })
    expect('markerShape' in plain || 'lineDash' in plain).toBe(false)
    const bad = sanitizeStyle({ markerShape: 'hexagon' as never, lineDash: 'wavy' as never })
    expect('markerShape' in bad || 'lineDash' in bad).toBe(false)
  })
})

describe('size classes (graduated by size)', () => {
  it('runs class sizes evenly from the smallest to the largest, in the single color', () => {
    const style = { ...sizeStyle(), fillColor: '#112233' }
    const resolved = resolveStyle(style, layer)
    const ranges = resolved.classes.filter((c) => c.kind === 'range')
    expect(ranges.map((c) => c.size)).toEqual([2, 4, 6, 8, 10])
    expect(new Set(ranges.map((c) => c.color))).toEqual(new Set(['#112233']))
    // "No value" keeps its own color and the single size.
    const nv = resolved.classes.find((c) => c.kind === 'noValue')
    expect(nv?.size).toBeUndefined()
    expect(classSymbols(style, resolved).at(-1)?.radius).toBe(style.pointRadius)
  })

  it('switching back to color keeps the classes and drops the sizes', () => {
    const back = setGraduatedVary(sizeStyle(), 'color', 'point')
    const r = rendererOf(back)
    expect(r.kind === 'graduated' && [r.vary, r.sizeMin, r.sizeMax]).toEqual([undefined, undefined, undefined])
    expect(resolveStyle(back, layer).classes.some((c) => c.size !== undefined)).toBe(false)
  })

  it('line layers start from thinner widths', () => {
    const r = rendererOf(sizeStyle('line'))
    expect(r.kind === 'graduated' && [r.sizeMin, r.sizeMax]).toEqual([1, 6])
  })

  it('validates the range', () => {
    expect(validateStyle(setSizeRange(sizeStyle(), 8, 3))).toEqual(['The smallest size must not be larger than the largest.'])
    expect(validateStyle(setSizeRange(sizeStyle(), 0, 3))[0]).toMatch(/between 0.5 and 100/)
    expect(validateStyle(setSizeRange(sizeStyle(), 1, 3))).toEqual([])
  })
})

describe('map paint', () => {
  it('dashes lines and polygon outlines, with butt caps', () => {
    const style: LayerStyle = { ...DEFAULT_LAYER_STYLE, lineDash: 'dash-dot' }
    const resolved = resolveStyle(style, layer)
    const p = paintFor(style, resolved, '#f59e0b')
    expect(p.line['line-dasharray']).toEqual([4, 2, 1, 2])
    expect(p['fill-outline']['line-dasharray']).toEqual([4, 2, 1, 2])
    expect(layoutFor(style, resolved).line).toEqual({ 'line-cap': 'butt' })
    const solid = paintFor(DEFAULT_LAYER_STYLE as LayerStyle, resolved, '#f59e0b')
    expect(solid.line['line-dasharray']).toBeUndefined()
  })

  it('size classes size each point and line by its class', () => {
    for (const geometry of ['point', 'line'] as const) {
      const style = sizeStyle(geometry)
      const resolved = resolveStyle(style, layer)
      const p = paintFor(style, resolved, '#f59e0b')
      const [prop, layerId] = geometry === 'point' ? (['circle-radius', 'circle'] as const) : (['line-width', 'line'] as const)
      const expr = (p[layerId] as Record<string, unknown>)[prop]
      for (const f of layer.features) {
        const v = f.attributes.v
        const cls = resolved.classes.find((c) => (c.kind === 'range' ? v !== null && v <= (c.upper as number) : c.kind === 'noValue' && v === null))
        const want = cls?.size ?? (geometry === 'point' ? style.pointRadius : style.strokeWidth)
        expect(evaluate(expr, f.attributes, `layers[0].paint.${prop}`, geometry === 'point' ? 'Point' : 'LineString'), `v=${v}`).toBe(want)
      }
    }
  })

  it('shaped markers: one icon per class, and a selection disc reaching past the shape', () => {
    const style: LayerStyle = { ...startStyle(DEFAULT_LAYER_STYLE as LayerStyle, 'categorized', layer, 'kind'), markerShape: 'star' }
    const resolved = resolveStyle(style, layer)
    const icon = layoutFor(style, resolved).marker?.['icon-image']
    const symbols = classSymbols(style, resolved)
    resolved.classes.forEach((c, i) => {
      expect(evaluate(icon, { kind: c.value }, 'layers[0].layout.icon-image')).toBe(markerIconId(symbols[i]))
    })
    expect(markerIconIds(style, resolved)).toEqual(expect.arrayContaining(symbols.map(markerIconId)))
    const p = paintFor(style, resolved, '#f59e0b')
    expect(p['marker-select']['circle-radius']).toBe(style.pointRadius + style.strokeWidth / 2 + 3)
    expect(expression.createExpression(p['marker-select']['circle-opacity'], 'layers[0].paint.circle-opacity').result).toBe('success')
  })
})

describe('style files', () => {
  const formats: StyleFormat[] = ['qml', 'sld', 'mapbox']
  const shaped: LayerStyle = { ...DEFAULT_LAYER_STYLE, markerShape: 'diamond', pointRadius: 7 }
  const dashed: LayerStyle = { ...DEFAULT_LAYER_STYLE, lineDash: 'dot', strokeWidth: 2 }

  it.each(formats)('%s keeps the marker shape and the line style', (format) => {
    for (const shape of MARKER_SHAPES) {
      const style = { ...shaped, markerShape: shape }
      const back = importStyle(`x${format === 'mapbox' ? '.json' : '.' + format}`, exportStyle(style, format, 'Point', 'x.geojson').text).style
      expect(back.markerShape ?? 'circle', shape).toBe(shape)
      expect(back.pointRadius, shape).toBeCloseTo(7, 2)
    }
    for (const geom of ['LineString', 'Polygon'] as const) {
      const back = importStyle(`x${format === 'mapbox' ? '.json' : '.' + format}`, exportStyle(dashed, format, geom, 'x.geojson').text).style
      expect(back.lineDash, geom).toBe('dot')
    }
  })

  it.each(formats)('%s keeps size classes', (format) => {
    const style = sizeStyle()
    const resolved = resolveStyle(style, layer)
    const out = exportStyle(style, format, 'Point', 'x.geojson', resolved, layer.columns)
    const back = importStyle(`x${format === 'mapbox' ? '.json' : '.' + format}`, out.text).style
    const r = rendererOf(back)
    expect(r.kind === 'graduated' && [r.vary, r.sizeMin, r.sizeMax]).toEqual(['size', 2, 10])
    expect(resolveStyle(back, layer).classes.map((c) => c.size)).toEqual(resolved.classes.map((c) => c.size))
  })

  it('QML: QGIS names, a 45° cross_fill for the x, the pen style and GraduatedSize', () => {
    expect(exportStyle({ ...shaped, markerShape: 'x' }, 'qml', 'Point', 'x.geojson').text).toMatch(/name="angle" type="QString" value="45"[\s\S]*name="name" type="QString" value="cross_fill"/)
    expect(exportStyle({ ...dashed, lineDash: 'dash-dot' }, 'qml', 'LineString', 'x.geojson').text).toContain('name="line_style" type="QString" value="dash dot"')
    const style = sizeStyle()
    expect(exportStyle(style, 'qml', 'Point', 'x.geojson', resolveStyle(style, layer)).text).toContain('graduatedMethod="GraduatedSize"')
  })

  it('SLD: dashes in pixels, and the diamond as a square turned 45°', () => {
    expect(exportStyle(dashed, 'sld', 'LineString', 'x.geojson').text).toContain('<CssParameter name="stroke-dasharray">2 4</CssParameter>')
    const diamond = exportStyle(shaped, 'sld', 'Point', 'x.geojson').text
    expect(diamond).toContain('<WellKnownName>square</WellKnownName>')
    expect(diamond).toContain('<Rotation>45</Rotation>')
  })

  it('Mapbox GL: shaped markers are flagged (no sprite), and dashes and sizes are written', () => {
    expect(previewExportNotice(shaped, 'mapbox', undefined).items.join()).toMatch(/no diamond marker without a sprite/)
    expect(previewExportNotice(shaped, 'qml', undefined).items).toEqual([])
    const doc = JSON.parse(exportStyle(dashed, 'mapbox', 'LineString', 'x.geojson').text)
    expect(doc.layers[0].paint['line-dasharray']).toEqual([1, 2])
    const style = sizeStyle()
    const sized = JSON.parse(exportStyle(style, 'mapbox', 'Point', 'x.geojson', resolveStyle(style, layer)).text)
    expect(sized.layers[0].paint['circle-radius'][0]).toBe('match')
  })
})

describe('files written by QGIS 4.2.3', () => {
  it('reads each marker shape QGIS writes', () => {
    expect(importStyle('a.qml', fixture('pt_star.qml')).style.markerShape).toBe('star')
    expect(importStyle('a.qml', fixture('pt_cross_fill.qml')).style.markerShape).toBe('cross')
    const lines = importStyle('a.qml', fixture('pt_cross2.qml'))
    expect(lines.style.markerShape).toBe('x')
    expect(lines.notes.join()).toMatch(/QGIS draws the "cross2" marker as lines/)
    expect(importStyle('a.sld', fixture('pt_diamond.sld')).style.markerShape).toBe('diamond')
    expect(importStyle('a.sld', fixture('pt_cross2.sld')).style.markerShape).toBe('x')
  })

  it('reads the pen styles, in QML and in SLD (QGIS writes Qt patterns unscaled)', () => {
    expect(importStyle('a.qml', fixture('ln_dash_dot.qml')).style.lineDash).toBe('dash-dot')
    expect(importStyle('a.sld', fixture('ln_dot.sld')).style.lineDash).toBe('dot')
  })

  it('reads GraduatedSize: point sizes 2..10 mm and line widths 1..5 mm, in pixels', () => {
    const mm = 96 / 25.4
    const pts = rendererOf(importStyle('a.qml', fixture('pt_gradsize.qml')).style)
    expect(pts.kind === 'graduated' && pts.vary).toBe('size')
    if (pts.kind === 'graduated') {
      expect(pts.sizeMin).toBeCloseTo(mm, 1) // a 2 mm diameter is a 1 mm radius
      expect(pts.sizeMax).toBeCloseTo(5 * mm, 1)
    }
    const lns = rendererOf(importStyle('a.qml', fixture('ln_gradsize.qml')).style)
    if (lns.kind !== 'graduated') throw new Error('not graduated')
    expect([lns.vary, lns.sizeMin, lns.sizeMax].map((v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v))).toEqual(['size', Math.round(mm * 10) / 10, Math.round(5 * mm * 10) / 10])
    const sld = rendererOf(importStyle('a.sld', fixture('pt_gradsize.sld')).style)
    expect(sld.kind === 'graduated' && [sld.vary, sld.sizeMin, sld.sizeMax]).toEqual(['size', 3.5, 18])
  })
})
