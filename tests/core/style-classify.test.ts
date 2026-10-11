// T014/T022 (spec 003, research §3-§4): classification over the displayed
// result. Categorized: frequency order, cap + "Other", "No value".
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STYLE, OTHER_COLOR, NO_VALUE_COLOR, rampColors, resolveStyle, toCategory, type Feature, type LayerStyle } from '@spatial-explorer/core'

const feature = (id: number, attributes: Feature['attributes']): Feature => ({ id, geometry: null, attributes })
const layerOf = (values: unknown[], column = 'zone', type = 'VARCHAR') => ({
  features: values.map((v, i) => feature(i, { [column]: v as Feature['attributes'][string] })),
  columns: [{ name: column, type }],
})
const categorized = (patch: object = {}): LayerStyle => ({
  ...DEFAULT_LAYER_STYLE,
  renderer: { kind: 'categorized', column: 'zone', ramp: { id: 'brewer-set2', reversed: false }, cap: 12, manual: false, classes: [], other: {}, noValue: {}, ...patch },
})

describe('toCategory', () => {
  it('maps null and empty to no value, everything else through String()', () => {
    expect(toCategory(null)).toBeNull()
    expect(toCategory(undefined)).toBeNull()
    expect(toCategory('')).toBeNull()
    expect(toCategory('R1')).toBe('R1')
    expect(toCategory(1.5)).toBe('1.5')
    expect(toCategory(0)).toBe('0')
    expect(toCategory(true)).toBe('true')
  })
})

describe('categorized', () => {
  it('orders classes most frequent first, ties alphabetical, with counts and ramp colors', () => {
    const r = resolveStyle(categorized(), layerOf(['b', 'a', 'c', 'a', 'b', 'a', 'd']))
    expect(r.status).toBe('ok')
    expect(r.classes.map((c) => [c.label, c.count])).toEqual([
      ['a', 3],
      ['b', 2],
      ['c', 1],
      ['d', 1],
    ])
    expect(r.classes.map((c) => c.color)).toEqual(rampColors({ id: 'brewer-set2', reversed: false }, 4))
    expect(r.caption).toBe('zone · 4 categories')
  })

  it('numbers sort numerically among ties', () => {
    const r = resolveStyle(categorized(), layerOf([10, 9, 100, 2]))
    expect(r.classes.map((c) => c.value)).toEqual(['2', '9', '10', '100'])
  })

  it('above the cap, the most frequent values get classes and the rest go to Other', () => {
    const values = [...'aaaabbbcc'.split(''), 'd', 'e', 'f']
    const r = resolveStyle(categorized({ cap: 3 }), layerOf(values))
    expect(r.classes.map((c) => c.key)).toEqual(['v:a', 'v:b', 'v:c', '__other'])
    const other = r.classes[3]
    expect(other).toMatchObject({ kind: 'other', label: 'Other (3 values)', count: 3, groups: 3, color: OTHER_COLOR })
  })

  it('nulls and empty strings go to No value, last', () => {
    const r = resolveStyle(categorized(), layerOf(['a', null, '', 'a']))
    expect(r.classes.map((c) => [c.key, c.count])).toEqual([
      ['v:a', 2],
      ['__null', 2],
    ])
    expect(r.classes[1]).toMatchObject({ kind: 'noValue', label: 'No value', color: NO_VALUE_COLOR })
  })

  it('counts add up to every row of the result', () => {
    const values = Array.from({ length: 997 }, (_, i) => (i % 7 === 0 ? null : `owner ${i % 40}`))
    const r = resolveStyle(categorized(), layerOf(values))
    expect(r.classes.reduce((n, c) => n + c.count, 0)).toBe(997)
    expect(r.classes.filter((c) => c.kind === 'value')).toHaveLength(12)
  })

  it('overrides apply by value: color, label, visibility', () => {
    const r = resolveStyle(categorized({ classes: [{ value: 'b', color: '#ff0000', label: 'Bee', visible: false }] }), layerOf(['a', 'b']))
    expect(r.classes.find((c) => c.value === 'b')).toMatchObject({ color: '#ff0000', label: 'Bee', visible: false })
    expect(r.classes.find((c) => c.value === 'a')).toMatchObject({ visible: true, label: 'a' })
  })

  it('palettes shorter than the class count repeat, with a note', () => {
    const r = resolveStyle(categorized({ ramp: { id: 'brewer-set2', reversed: false } }), layerOf('abcdefghij'.split('')))
    expect(r.classes[8].color).toBe(r.classes[0].color)
    expect(r.notes.join()).toMatch(/repeat/)
  })

  it('a missing column falls back to the single symbol with a reason', () => {
    const r = resolveStyle(categorized({ column: 'gone' }), layerOf(['a']))
    expect(r.status).toBe('fallback')
    expect(r.reason).toBe('Column "gone" is not in this result.')
    expect(r.classes).toHaveLength(1)
  })
})
