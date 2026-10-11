// @vitest-environment happy-dom
// Spec 008 (user request, 2026-10-11): a layer opacity on top of the fill and
// outline opacities, saved as QGIS's <layerOpacity>, folded into the symbol
// opacities where a format has no layer opacity.
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STYLE, exportStyle, importStyle, paintFor, resolveStyle, sanitizeStyle, withLayerOpacity } from '@spatial-explorer/core'

const style = sanitizeStyle({ ...DEFAULT_LAYER_STYLE, fillOpacity: 0.8, strokeOpacity: 1, layerOpacity: 0.5 })

describe('layer opacity', () => {
  it('is kept only below 1, clamped', () => {
    expect(style.layerOpacity).toBe(0.5)
    expect(sanitizeStyle({ ...DEFAULT_LAYER_STYLE, layerOpacity: 1 }).layerOpacity).toBeUndefined()
    expect(sanitizeStyle({ ...DEFAULT_LAYER_STYLE, layerOpacity: -2 }).layerOpacity).toBe(0)
  })

  it('scales the map paint', () => {
    const p = paintFor(style, resolveStyle(style, null), '#0078d4')
    expect((p.fill['fill-opacity'] as unknown[]).at(-1)).toBeCloseTo(0.4)
    expect((p['fill-outline']['line-opacity'] as unknown[]).at(-1)).toBeCloseTo(0.5)
  })

  it('round-trips through QML as <layerOpacity>', () => {
    const { text } = exportStyle(style, 'qml', 'Polygon', 'parcels.geojson')
    expect(text).toContain('<layerOpacity>0.5</layerOpacity>')
    const back = importStyle('parcels.qml', text).style
    expect(back.layerOpacity).toBe(0.5)
    expect(back.fillOpacity).toBeCloseTo(0.8, 2)
  })

  it('is folded into the symbol opacities for SLD and Mapbox GL', () => {
    expect(withLayerOpacity(style)).toMatchObject({ fillOpacity: 0.4, strokeOpacity: 0.5 })
    expect(withLayerOpacity(style).layerOpacity).toBeUndefined()
    const mapbox = JSON.parse(exportStyle(style, 'mapbox', 'Polygon', 'parcels.geojson').text) as { layers: Array<{ paint: Record<string, unknown> }> }
    expect(mapbox.layers.find((l) => 'fill-opacity' in l.paint)?.paint['fill-opacity']).toBeCloseTo(0.4)
    expect(exportStyle(style, 'sld', 'Polygon', 'parcels.geojson').text).toMatch(/name="fill-opacity">0\.4</)
  })
})
