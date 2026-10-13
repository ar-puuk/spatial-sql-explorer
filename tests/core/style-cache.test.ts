// A style change that only recolors reuses the engine's classification data (user report 2026-10-13:
// hovering ramps in the picker lagged, each one re-ran the classification).
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STYLE, styleDataKey, withCounts, type LayerStyle, type ResolvedStyle } from '@spatial-explorer/core'

const graduated = (patch: Record<string, unknown>): LayerStyle =>
  ({ ...DEFAULT_LAYER_STYLE, renderer: { kind: 'graduated', column: 'value', method: 'jenks', classCount: 5, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: { visible: true }, ...patch } }) as unknown as LayerStyle

describe('styleDataKey', () => {
  it('is the same when only colors change (ramp, class color, fill)', () => {
    const a = graduated({})
    expect(styleDataKey(graduated({ ramp: { id: 'magma', reversed: true } }))).toBe(styleDataKey(a))
    expect(styleDataKey({ ...a, fillColor: '#ff0000', fillOpacity: 0.2 })).toBe(styleDataKey(a))
  })
  it('changes with the column, method or class count', () => {
    const a = styleDataKey(graduated({}))
    expect(styleDataKey(graduated({ column: 'other' }))).not.toBe(a)
    expect(styleDataKey(graduated({ method: 'quantile' }))).not.toBe(a)
    expect(styleDataKey(graduated({ classCount: 4 }))).not.toBe(a)
  })
})

describe('withCounts', () => {
  const cls = (kind: string, count: number, color: string) => ({ kind, count, color, label: '', visible: true })
  it('keeps the fresh colors and the counted numbers, and drops an empty Other as before', () => {
    const fresh = { status: 'ok', classes: [cls('range', 0, '#111'), cls('range', 0, '#222'), cls('other', 0, '#999'), cls('noValue', 0, '#ccc')] } as unknown as ResolvedStyle
    const counted = { status: 'ok', classes: [cls('range', 7, '#aaa'), cls('range', 3, '#bbb'), cls('noValue', 2, '#ddd')] } as unknown as ResolvedStyle
    const out = withCounts(fresh, counted)
    expect(out.classes.map((c) => [c.kind, c.count, c.color])).toEqual([
      ['range', 7, '#111'],
      ['range', 3, '#222'],
      ['noValue', 2, '#ccc'],
    ])
  })
})
