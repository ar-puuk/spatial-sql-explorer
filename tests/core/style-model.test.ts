// T004 (spec 003, data-model.md): the renderer model, its defaults, and
// back-compatibility with spec 001 single-symbol styles.
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STYLE, rendererOf, sanitizeStyle, validateStyle, type LayerStyle } from '@spatial-explorer/core'

const SPEC_001: LayerStyle = {
  fillColor: '#e5b636',
  fillOpacity: 0.6,
  strokeColor: '#232323',
  strokeOpacity: 1,
  strokeWidth: 2,
  pointRadius: 7,
}

describe('renderer model', () => {
  it('a spec 001 style without a renderer behaves as single', () => {
    expect(rendererOf(SPEC_001)).toEqual({ kind: 'single' })
    expect(rendererOf(sanitizeStyle(SPEC_001))).toEqual({ kind: 'single' })
  })

  it('the default style is single', () => {
    expect(rendererOf(DEFAULT_LAYER_STYLE).kind).toBe('single')
  })

  it('unknown renderer kinds sanitize to single, and values are clamped', () => {
    expect(rendererOf(sanitizeStyle({ ...SPEC_001, renderer: { kind: 'dot-density' } as never }))).toEqual({ kind: 'single' })
    const g = rendererOf(sanitizeStyle({ ...SPEC_001, renderer: { kind: 'graduated', column: 'v', classCount: 40, method: 'nope' } as never }))
    expect(g).toMatchObject({ kind: 'graduated', column: 'v', classCount: 10, method: 'quantile', ramp: { id: 'viridis', reversed: false } })
  })

  it('validation rejects out-of-range counts, caps, bad colors and duplicate values', () => {
    const base = { ...SPEC_001 }
    const grad = (classCount: number): LayerStyle => ({
      ...base,
      renderer: { kind: 'graduated', column: 'v', method: 'quantile', classCount, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} },
    })
    expect(validateStyle(grad(5))).toEqual([])
    expect(validateStyle(grad(1)).join()).toMatch(/between 2 and 10/)
    expect(validateStyle(grad(11)).join()).toMatch(/between 2 and 10/)

    const cat = (patch: object): LayerStyle => ({
      ...base,
      renderer: { kind: 'categorized', column: 'z', ramp: { id: 'brewer-set2', reversed: false }, cap: 12, manual: false, classes: [], other: {}, noValue: {}, ...patch },
    })
    expect(validateStyle(cat({}))).toEqual([])
    expect(validateStyle(cat({ cap: 0 })).join()).toMatch(/cap/)
    expect(validateStyle(cat({ cap: 13 })).join()).toMatch(/cap/)
    expect(validateStyle(cat({ classes: [{ value: 'a' }, { value: 'a' }] })).join()).toMatch(/used by two classes/)
    expect(validateStyle(cat({ other: { color: 'red' } })).join()).toMatch(/#rrggbb/)
  })

  it('manual ranges must be ordered and contiguous', () => {
    const manual = (classes: Array<{ index: number; lower: number; upper: number }>): LayerStyle => ({
      ...SPEC_001,
      renderer: { kind: 'graduated', column: 'v', method: 'manual', classCount: classes.length, ramp: { id: 'viridis', reversed: false }, classes, noValue: {} },
    })
    expect(validateStyle(manual([{ index: 0, lower: 0, upper: 10 }, { index: 1, lower: 10, upper: 20 }]))).toEqual([])
    expect(validateStyle(manual([{ index: 0, lower: 0, upper: 10 }, { index: 1, lower: 12, upper: 20 }])).join()).toMatch(/must start where/)
    expect(validateStyle(manual([{ index: 0, lower: 10, upper: 5 }, { index: 1, lower: 5, upper: 20 }])).join()).toMatch(/below the upper/)
  })
})
