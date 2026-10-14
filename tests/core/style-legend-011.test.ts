// Spec 011 T045 (US5, research §10): legend groups merge when they read the
// same column with the same classes (and the same hidden ones); otherwise each
// property keeps its own group.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYER_STYLE,
  legendGroups,
  resolveStyle,
  sanitizeStyle,
  setChannelClass,
  setChannelColumn,
  setSizeChannel,
  setSizeClassVisible,
  setSizeMethod,
  startStyle,
  type LayerStyle,
} from '@spatial-explorer/core'

const values = Array.from({ length: 40 }, (_, i) => (i === 7 ? null : (i * 37) % 101))
const layer = {
  features: values.map((pop, i) => ({ id: i, geometry: null, attributes: { pop, kind: ['a', 'b', 'c'][i % 3] } })),
  columns: [
    { name: 'pop', type: 'DOUBLE' },
    { name: 'kind', type: 'VARCHAR' },
  ],
}
const base = sanitizeStyle(DEFAULT_LAYER_STYLE)
const graduatedPop = sanitizeStyle(startStyle(base, 'graduated', layer, 'pop'))
const groupsOf = (style: LayerStyle) => legendGroups(style, resolveStyle(style, layer))

describe('legendGroups', () => {
  it('color and size classed by the same column and breaks: one group, colored and sized', () => {
    const style = sanitizeStyle(setSizeChannel(graduatedPop, 'pop', 'point'))
    const groups = groupsOf(style)
    expect(groups).toHaveLength(1)
    expect(groups[0].channels).toEqual(['color', 'size'])
    expect(groups[0].title).toBe('pop · Quantile, 5 classes')
    const r = resolveStyle(style, layer)
    const ranges = groups[0].entries.filter((e) => e.kind === 'range')
    expect(ranges.map((e) => e.symbol.fillColor)).toEqual(r.classes.filter((c) => c.kind === 'range').map((c) => c.color))
    expect(ranges.map((e) => e.symbol.radius)).toEqual(r.size?.classes.filter((c) => c.kind === 'range').map((c) => c.size))
    // Hiding an entry hides the class in both properties.
    expect(ranges[1].toggles).toEqual([
      { channel: 'color', key: 'range:1' },
      { channel: 'size', key: 'size:range:1' },
    ])
  })

  it('the same column with different breaks: two groups', () => {
    const style = sanitizeStyle(setSizeMethod(sanitizeStyle(setSizeChannel(graduatedPop, 'pop', 'point')), 'equal'))
    const groups = groupsOf(style)
    expect(groups.map((g) => g.channels)).toEqual([['color'], ['size']])
  })

  it('a class hidden in one property only: two groups', () => {
    const style = sanitizeStyle(setSizeClassVisible(sanitizeStyle(setSizeChannel(graduatedPop, 'pop', 'point')), 'size:range:2', false))
    expect(groupsOf(style).map((g) => g.channels)).toEqual([['color'], ['size']])
  })

  it('color and shape by the same categories: one group with each category in its color and shape', () => {
    let style = sanitizeStyle(startStyle(base, 'categorized', layer, 'kind'))
    style = setChannelColumn(style, 'shape', 'kind', layer)
    const groups = groupsOf(style)
    expect(groups).toHaveLength(1)
    expect(groups[0].channels).toEqual(['color', 'shape'])
    const values = groups[0].entries.filter((e) => e.kind === 'value')
    expect(values.map((e) => e.symbol.shape)).toEqual(['circle', 'square', 'triangle'])
    expect(new Set(values.map((e) => e.symbol.fillColor)).size).toBe(3)
  })

  it('different columns: a group each, in panel order', () => {
    let style = sanitizeStyle(startStyle(base, 'categorized', layer, 'kind'))
    style = setChannelColumn(style, 'opacity', 'pop', layer)
    style = setChannelColumn(style, 'strokeColor', 'kind', layer)
    // Outline color merges with the color (same categories); opacity reads another column.
    expect(groupsOf(style).map((g) => g.channels)).toEqual([['color', 'strokeColor'], ['opacity']])
    // Once a class differs in visibility, they part.
    const hidden = setChannelClass(style, 'strokeColor', 'v:a', { visible: false })
    expect(groupsOf(hidden).map((g) => g.channels)).toEqual([['color'], ['strokeColor'], ['opacity']])
  })

  it('a hidden-from-legend property has no group; single color has none', () => {
    let style = setChannelColumn(base, 'shape', 'kind', layer)
    expect(groupsOf(style).map((g) => g.channels)).toEqual([['shape']])
    style = { ...style, channels: { ...style.channels, shape: { ...style.channels!.shape!, legend: { hidden: true } } } }
    expect(groupsOf(style)).toEqual([])
  })
})
