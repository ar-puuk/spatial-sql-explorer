// T009/T015/T023 (spec 003, research §4): paint and filters built in core.
// Thematic expressions are evaluated per feature with MapLibre's own
// style-spec evaluator and must pick the class `resolveStyle` counted the
// feature in (SC-006: the map equals the legend).
import { describe, expect, it } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import { DEFAULT_LAYER_STYLE, haloColor, paintFor, resolveStyle, visibilityFilter, type LayerStyle } from '@spatial-explorer/core'

/** Evaluates a paint/filter expression for one feature (not selected, not hovered). */
function evaluate(expr: unknown, properties: Record<string, unknown>, key = 'layers[0].paint.fill-color'): unknown {
  const parsed = expression.createExpression(expr, key)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 0 }, { type: 'Polygon', properties } as never, {} as never)
}

describe('single symbol (spec 001 behavior, unchanged)', () => {
  const style: LayerStyle = { ...DEFAULT_LAYER_STYLE, fillColor: '#123456', strokeColor: '#654321', strokeWidth: 2 }
  const resolved = resolveStyle(style, { features: [], columns: [] })
  const p = paintFor(style, resolved, '#0078d4')

  it('produces the same paint MapView built before spec 003', () => {
    const selected = ['boolean', ['feature-state', 'selected'], false]
    const hovered = ['boolean', ['feature-state', 'hover'], false]
    expect(p.fill['fill-color']).toEqual(['case', selected, '#0078d4', '#123456'])
    expect(p.fill['fill-opacity']).toEqual(['case', selected, 0.6, hovered, Math.min(1, style.fillOpacity + 0.15), style.fillOpacity])
    expect(p['fill-outline']).toEqual({
      'line-color': ['case', selected, '#0078d4', '#654321'],
      'line-width': ['case', selected, 3.5, 2],
      'line-opacity': ['case', selected, 1, 1],
    })
    expect(p.line['line-color']).toEqual(['case', selected, '#0078d4', '#654321'])
    expect(p.circle['circle-color']).toEqual(['case', selected, '#0078d4', '#123456'])
    expect(p.circle['circle-stroke-color']).toEqual(['case', selected, '#ffffff', '#654321'])
  })

  it('draws no halo and hides nothing', () => {
    expect(p.halo['line-width']).toBe(0)
    expect(visibilityFilter(style, resolved)).toBeNull()
  })

  it('every paint value parses as a valid MapLibre expression', () => {
    for (const [layerId, props] of Object.entries(p)) {
      for (const [prop, value] of Object.entries(props)) {
        if (!Array.isArray(value)) continue
        const r = expression.createExpression(value, `layers[${layerId}].paint.${prop}`)
        expect(r.result, `${layerId}.${prop}`).toBe('success')
      }
    }
  })

  it('the halo contrasts with the selection color', () => {
    expect(haloColor('#ffd700')).toBe('#000000')
    expect(haloColor('#0b3d91')).toBe('#ffffff')
  })
})
