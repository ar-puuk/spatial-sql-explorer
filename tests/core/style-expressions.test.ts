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

  it('produces the same paint MapView built before spec 003 (selected now also means ticked, spec 008)', () => {
    const selected = ['any', ['boolean', ['feature-state', 'selected'], false], ['boolean', ['feature-state', 'ticked'], false]]
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

describe('categorized: the map picks the class the legend counted (SC-006)', () => {
  const values: unknown[] = []
  for (let i = 0; i < 200; i++) {
    const pick = i % 9
    values.push(pick === 0 ? null : pick === 1 ? '' : pick === 2 ? true : pick === 3 ? i % 4 : pick === 4 ? 1.5 : pick === 5 ? 0.1 + 0.2 : `zone ${i % 15}`)
  }
  const features = values.map((v, id) => ({ id, geometry: null, attributes: { zone: v as never } }))
  const layer = { features, columns: [{ name: 'zone', type: 'VARCHAR' }] }

  for (const cap of [12, 4]) {
    it(`every feature's color is its class color (cap ${cap})`, () => {
      const style: LayerStyle = {
        ...DEFAULT_LAYER_STYLE,
        renderer: { kind: 'categorized', column: 'zone', ramp: { id: 'brewer-paired', reversed: false }, cap, manual: false, classes: [], other: {}, noValue: {} },
      }
      const resolved = resolveStyle(style, layer)
      const fill = paintFor(style, resolved, '#0078d4').fill['fill-color'] as unknown[]
      const classExpr = fill[3] // ['case', selected, sel, <class color>]
      const counts = new Map<string, number>()
      for (const f of features) {
        // Without a property spec the evaluator returns the match output as-is: the hex string.
        const hex = evaluate(classExpr, f.attributes) as string
        counts.set(hex, (counts.get(hex) ?? 0) + 1)
      }
      const expected = new Map<string, number>()
      for (const c of resolved.classes) expected.set(c.color, (expected.get(c.color) ?? 0) + c.count)
      expect(counts).toEqual(expected)
    })
  }

  it('hidden classes are filtered out on the map', () => {
    const style: LayerStyle = {
      ...DEFAULT_LAYER_STYLE,
      renderer: { kind: 'categorized', column: 'zone', ramp: { id: 'brewer-paired', reversed: false }, cap: 12, manual: false, classes: [{ value: 'true', visible: false }], other: {}, noValue: { visible: false } },
    }
    const resolved = resolveStyle(style, layer)
    const filter = visibilityFilter(style, resolved)
    const shown = features.filter((f) => evaluate(filter, f.attributes, 'layers[0].filter') === true).length
    const hiddenCount = resolved.classes.filter((c) => !c.visible).reduce((n, c) => n + c.count, 0)
    expect(hiddenCount).toBeGreaterThan(0)
    expect(shown).toBe(features.length - hiddenCount)
  })
})

describe('graduated: the map picks the class the legend counted (SC-006)', () => {
  // Values on every break, nulls, '', numeric strings, text, booleans, extremes.
  const raw: unknown[] = []
  for (let i = 0; i <= 100; i++) raw.push(i)
  raw.push(null, '', '12.50', '50', 'abc', true, false, 'Infinity', 0.5, 99.999)
  const features = raw.map((v, id) => ({ id, geometry: null, attributes: { v: v as never } }))
  const layer = { features, columns: [{ name: 'v', type: 'DECIMAL(9,2)' }] }

  for (const method of ['equal', 'quantile', 'jenks'] as const) {
    it(`${method}: every feature's color is its class color`, () => {
      const style: LayerStyle = {
        ...DEFAULT_LAYER_STYLE,
        renderer: { kind: 'graduated', column: 'v', method, classCount: 5, ramp: { id: 'brewer-ylorrd', reversed: false }, classes: [], noValue: {} },
      }
      const resolved = resolveStyle(style, layer)
      const classExpr = (paintFor(style, resolved, '#0078d4').fill['fill-color'] as unknown[])[3]
      const counts = new Map<string, number>()
      for (const f of features) {
        const hex = evaluate(classExpr, f.attributes) as string
        counts.set(hex, (counts.get(hex) ?? 0) + 1)
      }
      const expected = new Map<string, number>()
      for (const c of resolved.classes) expected.set(c.color, (expected.get(c.color) ?? 0) + c.count)
      expect(counts).toEqual(expected)
    })
  }

  it('manual: values outside the ranges draw as Other, and hidden ranges are filtered', () => {
    const style: LayerStyle = {
      ...DEFAULT_LAYER_STYLE,
      renderer: {
        kind: 'graduated',
        column: 'v',
        method: 'manual',
        classCount: 2,
        ramp: { id: 'viridis', reversed: false },
        classes: [
          { index: 0, lower: 10, upper: 40 },
          { index: 1, lower: 40, upper: 60, visible: false },
        ],
        noValue: {},
      },
    }
    const resolved = resolveStyle(style, layer)
    const classExpr = (paintFor(style, resolved, '#0078d4').fill['fill-color'] as unknown[])[3]
    const other = resolved.classes.find((c) => c.kind === 'other')
    expect(other).toBeDefined()
    expect(evaluate(classExpr, { v: 5 })).toBe(other?.color)
    expect(evaluate(classExpr, { v: 10 })).toBe(resolved.classes[0].color)
    expect(evaluate(classExpr, { v: 40 })).toBe(resolved.classes[0].color)
    const filter = visibilityFilter(style, resolved)
    expect(evaluate(filter, { v: 50 }, 'layers[0].filter')).toBe(false)
    expect(evaluate(filter, { v: 30 }, 'layers[0].filter')).toBe(true)
  })
})
