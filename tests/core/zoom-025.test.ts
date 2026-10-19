// @vitest-environment happy-dom
// Spec 025: the zoom range a layer shows in, and sizes that follow the zoom.
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STYLE, layerZoomRange, paintWithZoom, previewExportNotice, qmlToStyle, sanitizeStyle, sanitizeZoom, sizeWithZoom, styleToMapbox, styleToQml, type LayerStyle } from '@spatial-explorer/core'

describe('sanitizeZoom', () => {
  it('keeps a range, rounded to a tenth', () => {
    expect(sanitizeZoom({ min: 10.04, max: 15 })).toEqual({ min: 10, max: 15 })
  })
  it('means no limit at 0 and at 24, and drops what is not a number', () => {
    expect(sanitizeZoom({ min: 0, max: 24 })).toBeUndefined()
    expect(sanitizeZoom({ min: 'x', max: null })).toBeUndefined()
    expect(sanitizeZoom({ max: 30 })).toBeUndefined()
    expect(sanitizeZoom({ min: -4, max: 12 })).toEqual({ max: 12 })
  })
  it('drops an end that comes before the start', () => {
    expect(sanitizeZoom({ min: 12, max: 8 })).toEqual({ min: 12 })
    expect(sanitizeZoom({ min: 12, max: 12 })).toEqual({ min: 12 })
  })
  it('keeps sizes that grow, with a fraction between a tenth and 1', () => {
    expect(sanitizeZoom({ sizes: { fromZoom: 10, toZoom: 14, factor: 0.35, lineFactor: 0.6 } })).toEqual({ sizes: { fromZoom: 10, toZoom: 14, factor: 0.35, lineFactor: 0.6 } })
    expect(sanitizeZoom({ sizes: { fromZoom: 10, toZoom: 14, factor: 0 } })?.sizes?.factor).toBe(0.1)
    expect(sanitizeZoom({ sizes: { fromZoom: 10, toZoom: 14 } })?.sizes?.factor).toBe(0.5)
  })
  it('drops sizes that do not grow: the zooms the wrong way round, or nothing smaller', () => {
    expect(sanitizeZoom({ sizes: { fromZoom: 14, toZoom: 10, factor: 0.5 } })).toBeUndefined()
    expect(sanitizeZoom({ sizes: { fromZoom: 10, toZoom: 14, factor: 1 } })).toBeUndefined()
  })
  it('a line fraction alone is enough, and one equal to the marker fraction is not kept', () => {
    expect(sanitizeZoom({ sizes: { fromZoom: 10, toZoom: 14, factor: 1, lineFactor: 0.5 } })?.sizes).toMatchObject({ lineFactor: 0.5 })
    expect(sanitizeZoom({ sizes: { fromZoom: 10, toZoom: 14, factor: 0.5, lineFactor: 0.5 } })?.sizes).not.toHaveProperty('lineFactor')
  })
})

describe('the map layers', () => {
  it('shows at every zoom without a range, else with MapLibre\'s own minzoom and maxzoom', () => {
    expect(layerZoomRange(undefined)).toEqual({ minzoom: 0, maxzoom: 24 })
    expect(layerZoomRange({ min: 9 })).toEqual({ minzoom: 9, maxzoom: 24 })
    expect(layerZoomRange({ min: 9, max: 15 })).toEqual({ minzoom: 9, maxzoom: 15 })
  })

  const sizes = { fromZoom: 10, toZoom: 14, factor: 0.4, lineFactor: 0.8 }
  it('a number size follows the zoom in a straight line to its full value', () => {
    expect(sizeWithZoom(5, sizes)).toEqual(['interpolate', ['linear'], ['zoom'], 10, 2, 14, 5])
  })
  it('an expression keeps its own logic inside both ends of the curve', () => {
    const expr = ['case', ['boolean', ['feature-state', 'selected'], false], 8, 5]
    expect(sizeWithZoom(expr, sizes)).toEqual(['interpolate', ['linear'], ['zoom'], 10, ['*', expr, 0.4], 14, ['*', expr, 1]])
  })
  it('radius and outline use the marker fraction, line widths the line fraction, and nothing else changes', () => {
    const paint = { 'circle-radius': 5, 'circle-stroke-width': 1.5, 'line-width': 3, 'circle-color': '#ff0000' }
    const out = paintWithZoom(paint, { sizes })
    expect(out['circle-radius']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 2, 14, 5])
    expect(out['circle-stroke-width']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 1.5])
    expect(out['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 10, 2.4, 14, 3])
    expect(out['circle-color']).toBe('#ff0000')
  })
  it('leaves a paint alone when sizes are fixed', () => {
    const paint = { 'circle-radius': 5 }
    expect(paintWithZoom(paint, undefined)).toBe(paint)
    expect(paintWithZoom(paint, { min: 4 })).toBe(paint)
  })
})

describe('the style', () => {
  const zoom = { min: 9, max: 16, sizes: { fromZoom: 10, toZoom: 14, factor: 0.5 } }
  const style: LayerStyle = sanitizeStyle({ ...DEFAULT_LAYER_STYLE, zoom })

  it('is kept by sanitizing, and left out when it is not set', () => {
    expect(style.zoom).toEqual(zoom)
    expect(sanitizeStyle({ ...DEFAULT_LAYER_STYLE }).zoom).toBeUndefined()
    expect(sanitizeStyle(JSON.parse(JSON.stringify(style)))).toEqual(style)
  })

  it('goes into a QGIS file as scale-based visibility and comes back whole', () => {
    const { text } = styleToQml(style, 'Point', 'layer')
    expect(text).toContain('hasScaleBasedVisibilityFlag="1"')
    // zoom 9 is 1:1,091,958 and zoom 16 is 1:8,531 at the equator (Web Mercator, 96 dpi).
    expect(text).toContain('minScale="1091958"')
    expect(text).toContain('maxScale="8531"')
    expect(qmlToStyle(text).style.zoom).toEqual(zoom)
  })

  it('is read from a QGIS file that only has scale-based visibility', () => {
    const { text } = styleToQml(sanitizeStyle({ ...DEFAULT_LAYER_STYLE, zoom: { min: 9, max: 16 } }), 'Point', 'layer')
    const plain = text.replace(/<Option name="spatialExplorer\/style"[\s\S]*?\/>/, '').replace(/<property key="spatialExplorer\/style"[^>]*\/>/, '')
    expect(qmlToStyle(plain).style.zoom).toMatchObject({ min: 9, max: 16 })
  })

  it('has no scale attributes without a range', () => {
    expect(styleToQml(sanitizeStyle({ ...DEFAULT_LAYER_STYLE, zoom: { sizes: { fromZoom: 10, toZoom: 14, factor: 0.5 } } }), 'Point', 'layer').text).not.toContain('hasScaleBasedVisibilityFlag')
  })

  it('is written to Mapbox GL as minzoom and maxzoom, with sizes as zoom curves', () => {
    const doc = JSON.parse(styleToMapbox(style, 'Point', 'layer', 'data.geojson').text) as { layers: Array<Record<string, unknown> & { paint?: Record<string, unknown> }> }
    expect(doc.layers.length).toBeGreaterThan(0)
    for (const l of doc.layers) {
      expect(l.minzoom).toBe(9)
      expect(l.maxzoom).toBe(16)
    }
    const circle = doc.layers.find((l) => l.type === 'circle')
    expect(JSON.stringify(circle?.paint?.['circle-radius'])).toContain('"zoom"')
  })

  it('says SLD cannot keep it', () => {
    expect(previewExportNotice(style, 'sld', undefined).items.join(' ')).toContain('zoom range')
    expect(previewExportNotice(style, 'qml', undefined).items.join(' ')).not.toContain('zoom range')
  })
})
