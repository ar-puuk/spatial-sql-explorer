// @vitest-environment happy-dom
// Spec 011 T055: SLD writes properties by a column as one rule per combination
// of classes (two properties, at most SLD_RULE_CAP rules; beyond that the
// first property alone, with a note), and reads per-class outline, shape,
// pattern and rotation on one column back as properties by that column.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYER_STYLE,
  exportStyle,
  importStyle,
  resolveStyle,
  sanitizeStyle,
  setChannelClass,
  setChannelColumn,
  setFixed,
  startStyle,
  type LayerStyle,
} from '@spatial-explorer/core'

const rows = Array.from({ length: 60 }, (_, i) => ({ cls: ['A', 'B', 'C'][i % 3], kind: `k${i % 12}`, num: i % 9 === 4 ? null : i * 2 }))
const columns = [
  { name: 'cls', type: 'VARCHAR' },
  { name: 'kind', type: 'VARCHAR' },
  { name: 'num', type: 'DOUBLE' },
]
const layer = { features: rows.map((attributes, id) => ({ id, geometry: null, attributes })), columns }
const base = sanitizeStyle(DEFAULT_LAYER_STYLE)

function sld(style: LayerStyle, geometry: 'Point' | 'LineString' | 'Polygon') {
  return exportStyle(style, 'sld', geometry, 'layer', resolveStyle(style, layer), columns)
}
const ruleCount = (text: string) => (text.match(/<Rule>/g) ?? []).length

describe('SLD export of properties by a column (spec 011 T055)', () => {
  it('crosses color classes with shapes by another column: one rule per combination', () => {
    let style = sanitizeStyle(startStyle(base, 'categorized', layer, 'cls'))
    style = setChannelColumn(style, 'shape', 'num', layer)
    const { text, notes } = sld(style, 'Point')
    const resolved = resolveStyle(style, layer)
    const colors = resolved.classes.filter((c) => c.visible).length
    const shapes = resolved.channels!.shape!.classes.filter((c) => c.visible).length
    expect(ruleCount(text)).toBe(colors * shapes)
    expect(text).toMatch(/<WellKnownName>triangle<\/WellKnownName>/)
    expect(notes.join(' ')).not.toMatch(/combination/)
  })

  it('writes a pattern per class, and leaves hidden classes out', () => {
    let style = setChannelColumn(base, 'dash', 'cls', layer)
    style = setChannelClass(style, 'dash', 'v:B', { visible: false })
    const { text } = sld(style, 'LineString')
    expect(text).toMatch(/stroke-dasharray/)
    expect(text).not.toMatch(/<ogc:Literal>B<\/ogc:Literal>\s*<\/ogc:PropertyIsEqualTo>\s*<\/ogc:Filter>/)
    // A, C, Other (none here) and No value: B is hidden.
    expect(text).not.toMatch(/<Name>B<\/Name>/)
  })

  it('beyond two properties or the rule cap: the first property alone, with a note naming the others', () => {
    let style = sanitizeStyle(startStyle(base, 'categorized', layer, 'kind'))
    style = setChannelColumn(style, 'strokeColor', 'cls', layer)
    style = setChannelColumn(style, 'rotation', 'num', layer)
    const { text, notes } = sld(style, 'Point')
    const colors = resolveStyle(style, layer).classes.filter((c) => c.visible).length
    expect(ruleCount(text)).toBe(colors)
    expect(notes.find((n) => /one rule per combination/.test(n))).toMatch(/Outline color, Rotation keep the fixed value/)
  })

  it('writes the fixed rotation and opacity', () => {
    const style = setFixed(setFixed(setFixed(base, 'rotation', 30), 'opacity', 0.5), 'shape', 'triangle')
    const { text } = sld(style, 'Point')
    expect(text).toMatch(/<Rotation>30<\/Rotation>/)
    expect(text).toContain(`fill-opacity">${Math.round(base.fillOpacity * 0.5 * 1000) / 1000}<`)
  })
})

describe('SLD import of per-class properties (spec 011 T055)', () => {
  it('reads color and shape by the same column back as both (one rule per class, not per combination)', () => {
    let style = sanitizeStyle(startStyle(base, 'categorized', layer, 'cls'))
    style = setChannelColumn(style, 'shape', 'cls', layer)
    const { text } = sld(style, 'Point')
    expect(ruleCount(text)).toBe(resolveStyle(style, layer).classes.filter((c) => c.visible).length)
    const { style: back } = importStyle('layer.sld', text)
    expect(back.channels?.color?.source).toEqual({ kind: 'column', column: 'cls' })
    const shape = back.channels?.shape
    expect(shape?.source).toEqual({ kind: 'column', column: 'cls' })
    const want = resolveStyle(style, layer).channels!.shape!.classes.filter((c) => c.kind === 'value').map((c) => [c.value, c.output])
    expect(shape?.scale.kind === 'categories' && shape.scale.categories.map((c) => [c.value, c.output])).toEqual(want)
  })

  it('reads outline width by classes, with one fill color, as a single color with outline width classes', () => {
    const style = setChannelColumn(base, 'strokeWidth', 'num', layer)
    const resolved = resolveStyle(style, layer)
    const { style: back } = importStyle('layer.sld', sld(style, 'Polygon').text)
    expect(back.channels?.color).toBeUndefined()
    const sw = back.channels?.strokeWidth
    const ranges = resolved.channels!.strokeWidth!.classes.filter((c) => c.kind === 'range')
    expect(sw?.scale.kind === 'classes' && sw.scale.classes.map((c) => [c.lower, c.upper, c.output])).toEqual(ranges.map((c) => [c.lower, c.upper, c.output]))
  })

  it("imports a mark's rotation as the style's rotation", () => {
    const style = setFixed(setFixed(base, 'rotation', 30), 'shape', 'triangle')
    const { style: back, notes } = importStyle('layer.sld', sld(style, 'Point').text)
    expect(back.rotation).toBe(30)
    expect(notes.join(' ')).not.toMatch(/rotation/)
  })
})
