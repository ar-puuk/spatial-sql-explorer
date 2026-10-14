// @vitest-environment happy-dom
// Spec 011 T040 (US4): Continuous and As is on the properties that vary by
// attribute. The map's expressions are evaluated with MapLibre's own
// evaluator and compared with values computed here independently.
import { describe, expect, it } from 'vitest'
import { expression, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import {
  DEFAULT_LAYER_STYLE,
  ICON_COLOR_STEPS,
  addCondition,
  computedColumns,
  exportStyle,
  updateCondition,
  setConditionElse,
  IDENTITY_ICON_CAP,
  channelValue,
  layoutFor,
  legendGroups,
  rampColors,
  resolveStyle,
  sanitizeStyle,
  setChannelClass,
  setChannelColumn,
  setChannelCurve,
  setChannelDomain,
  setChannelRange,
  setChannelRamp,
  setFixed,
  setScaleKind,
  visibilityFilter,
  type ChannelId,
  type LayerStyle,
} from '@spatial-explorer/core'

const rows = Array.from({ length: 21 }, (_, i) => ({ v: i === 20 ? null : i * 5, hex: i % 5 === 0 ? 'oops' : `#${(i * 12).toString(16).padStart(2, '0')}3366`, deg: i * 17 }))
const columns = [
  { name: 'v', type: 'DOUBLE' },
  { name: 'hex', type: 'VARCHAR' },
  { name: 'deg', type: 'INTEGER' },
]
const layer = { features: rows.map((attributes, id) => ({ id, geometry: null, attributes })), columns }
const base = sanitizeStyle(DEFAULT_LAYER_STYLE)

function by(style: LayerStyle, id: ChannelId, column: string, kind: 'continuous' | 'identity'): LayerStyle {
  return setScaleKind(setChannelColumn(style, id, column, layer), id, kind, layer)
}
function evaluate(expr: unknown, properties: Record<string, unknown>, type: string): unknown {
  if (!Array.isArray(expr)) return expr
  const parsed = expression.createExpression(expr, { type: type as never, 'property-type': 'data-driven', expression: { interpolated: false, parameters: ['zoom', 'feature'] } } as never)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  const v = parsed.value.evaluate({ zoom: 0 }, { type: 'Point', properties } as never, {} as never)
  return v && typeof v === 'object' && 'r' in (v as object) ? (v as { toString(): string }).toString() : v
}
const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
const rgba = (rgb: number[]) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`

describe('Continuous (spec 011 US4)', () => {
  it('outline color runs along the ramp in RGB: at a stop, the stop; halfway between stops, their mix', () => {
    const style = setChannelRamp(by(base, 'strokeColor', 'v', 'continuous'), 'strokeColor', { id: 'brewer-ylorrd', reversed: false })
    const resolved = resolveStyle(style, layer)
    const rc = resolved.channels!.strokeColor!
    expect(rc.status).toBe('ok')
    expect(rc.domain).toEqual({ min: 0, max: 95 })
    const stops = rampColors({ id: 'brewer-ylorrd', reversed: false }, 7)
    const value = channelValue(style, resolved, 'strokeColor')
    expect(evaluate(value, { v: 0 }, 'color')).toBe(rgba(hex(stops[0])))
    expect(evaluate(value, { v: 95 }, 'color')).toBe(rgba(hex(stops[6])))
    // Halfway along the first segment (95 / 6 / 2): the RGB mix of the first two stops, rounded.
    const [a, b] = [hex(stops[0]), hex(stops[1])]
    const mid = a.map((x, i) => Math.round((x + b[i]) / 2))
    const got = String(evaluate(value, { v: 95 / 12 }, 'color')).match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number)
    got.forEach((x, i) => expect(Math.abs(x - mid[i])).toBeLessThanOrEqual(1))
    // No value: the fixed outline color.
    expect(evaluate(value, { v: null }, 'color')).toBe(rgba(hex(base.strokeColor)))
    // The legend: a bar from 0 to 95, and No value.
    const g = legendGroups(style, resolved).find((x) => x.channels.includes('strokeColor'))!
    expect(g.gradient).toEqual({ stops: expect.any(Array), min: '0', max: '95' })
    expect(g.gradient!.stops).toHaveLength(7)
    expect(g.entries.map((e) => e.kind)).toEqual(['noValue'])
  })

  it('numbers: linear, or by area; a domain clamps; the legend shows three samples (not toggles) and No value', () => {
    let style = setChannelRange(by(base, 'opacity', 'v', 'continuous'), 'opacity', 0.2, 1)
    let resolved = resolveStyle(style, layer)
    let value = channelValue(style, resolved, 'opacity')
    expect(evaluate(value, { v: 47.5 }, 'number')).toBeCloseTo(0.6, 6)
    style = setChannelDomain(style, 'opacity', { min: 0, max: 50 })
    resolved = resolveStyle(style, layer)
    value = channelValue(style, resolved, 'opacity')
    expect(evaluate(value, { v: 90 }, 'number')).toBeCloseTo(1, 6)
    expect(evaluate(value, { v: 25 }, 'number')).toBeCloseTo(0.6, 6)

    let width = setChannelRange(by(base, 'strokeWidth', 'v', 'continuous'), 'strokeWidth', 1, 5)
    width = setChannelCurve(width, 'strokeWidth', 'area')
    const wr = resolveStyle(width, layer)
    expect(evaluate(channelValue(width, wr, 'strokeWidth'), { v: 95 / 4 }, 'number')).toBeCloseTo(1 + 4 * Math.sqrt(0.25), 6)
    const g = legendGroups(width, wr).find((x) => x.channels.includes('strokeWidth'))!
    expect(g.entries.map((e) => [e.label, e.toggles.length])).toEqual([
      ['0', 0],
      ['47.5', 0],
      ['95', 0],
      ['No value', 1],
    ])
  })

  it('a hidden No value hides features with no value', () => {
    let style = by(base, 'opacity', 'v', 'continuous')
    style = setChannelClass(style, 'opacity', '__null', { visible: false })
    const filter = visibilityFilter(style, resolveStyle(style, layer))
    expect(evaluate(filter, { v: null }, 'boolean')).toBe(false)
    expect(evaluate(filter, { v: 3 }, 'boolean')).toBe(true)
  })

  it(`shaped markers: a continuous outline color takes ${ICON_COLOR_STEPS} steps (each an icon); circles stay smooth`, () => {
    const style = setFixed(by(base, 'strokeColor', 'v', 'continuous'), 'shape', 'triangle')
    const resolved = resolveStyle(style, layer)
    const find = (e: unknown): unknown[] | null => (Array.isArray(e) ? (e[0] === 'step' ? e : e.map(find).find(Boolean) ?? null) : null)
    expect(resolved.channels!.strokeColor!.notes.join(' ')).toMatch(/in 32 steps/)
    const step = find(layoutFor(style, resolved).marker?.['icon-image'])
    expect(step).not.toBeNull()
    expect(JSON.stringify(step).match(/#[0-9a-f]{6}/g)!.length).toBe(ICON_COLOR_STEPS)
    expect(JSON.stringify(channelValue(style, resolved, 'strokeColor'))).toContain('"interpolate"')
  })
})

describe('As is (spec 011 US4)', () => {
  it('colors pass; values that are not colors get the fixed color, counted in a note', () => {
    const style = by(base, 'strokeColor', 'hex', 'identity')
    const resolved = resolveStyle(style, layer)
    const rc = resolved.channels!.strokeColor!
    expect(rc.status).toBe('ok')
    expect(rc.notes).toEqual(['5 values are not a color (#rrggbb): they have the fixed outline color.'])
    const value = channelValue(style, resolved, 'strokeColor')
    expect(evaluate(value, { hex: '#0c3366' }, 'color')).toBe(rgba([12, 51, 102]))
    expect(evaluate(value, { hex: 'oops' }, 'color')).toBe(rgba(hex(base.strokeColor)))
    expect(legendGroups(style, resolved).find((g) => g.channels.includes('strokeColor'))?.note).toBe('Colors read from the column')
  })

  it(`shaped markers: more than ${IDENTITY_ICON_CAP} colors fall back, with the reason`, () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ hex: `#${i.toString(16).padStart(6, '0')}` }))
    const big = { features: many.map((attributes, id) => ({ id, geometry: null, attributes })), columns: [{ name: 'hex', type: 'VARCHAR' }] }
    const style = setFixed(setScaleKind(setChannelColumn(base, 'strokeColor', 'hex', big), 'strokeColor', 'identity', big), 'shape', 'square')
    const rc = resolveStyle(style, big).channels!.strokeColor!
    expect(rc.status).toBe('fallback')
    expect(rc.reason).toMatch(/^300 different colors: shaped markers can show at most 256\./)
  })

  it('numbers: degrees as they are; opacity clamped to 0–1; missing values fixed', () => {
    const rot = by(base, 'rotation', 'deg', 'identity')
    expect(evaluate(channelValue(rot, resolveStyle(rot, layer), 'rotation'), { deg: 170 }, 'number')).toBe(170)
    const op = by(base, 'opacity', 'v', 'identity')
    const value = channelValue(op, resolveStyle(op, layer), 'opacity')
    expect(evaluate(value, { v: 1.5 }, 'number')).toBe(1)
    expect(evaluate(value, { v: 0.25 }, 'number')).toBe(0.25)
    expect(evaluate(value, { v: null }, 'number')).toBe(1)
  })

  it('a text column for a number reads as not available', () => {
    const style = by(base, 'rotation', 'hex', 'identity')
    expect(resolveStyle(style, layer).channels!.rotation!.status).toBe('fallback')
  })
})

describe('Conditions (spec 011 US4)', () => {
  /** Outline width: lanes-like rules on v, the engine's counts and one refused condition. */
  function widthByConditions(): LayerStyle {
    let style = setScaleKind(setChannelColumn(base, 'strokeWidth', 'v', layer), 'strokeWidth', 'conditions', layer)
    style = updateCondition(style, 'strokeWidth', 'r1', { where: 'v > 50', output: 4 })
    style = addCondition(style, 'strokeWidth', 'v > 20')
    style = updateCondition(style, 'strokeWidth', 'r2', { output: 2 })
    style = addCondition(style, 'strokeWidth', 'nope > 1')
    return setConditionElse(style, 'strokeWidth', { output: 0.5 })
  }
  const engine = { ...layer, ruleCountsByChannel: { strokeWidth: new Map([[0, 9], [1, 6], [-1, 6]]) }, ruleErrorsByChannel: { strokeWidth: { r3: 'No column "nope" in this layer.' } } }

  it('the first condition that holds wins, then everything else; a refused one matches nothing', () => {
    const style = widthByConditions()
    const resolved = resolveStyle(style, engine)
    const rc = resolved.channels!.strokeWidth!
    expect(rc.classes.map((c) => [c.label, c.count, c.output, c.error ?? ''])).toEqual([
      ['v > 50', 9, 4, ''],
      ['v > 20', 6, 2, ''],
      ['nope > 1', 0, rc.classes[2].output, 'No column "nope" in this layer.'],
      ['Everything else', 6, 0.5, ''],
    ])
    expect(computedColumns(style, resolved)).toContainEqual({ name: '__se_cls_strokeWidth', sql: 'CASE WHEN (v > 50) THEN 0 WHEN (v > 20) THEN 1 ELSE -1 END', type: 'INTEGER' })
    const value = channelValue(style, resolved, 'strokeWidth')
    expect(evaluate(value, { __se_cls_strokeWidth: 0 }, 'number')).toBe(4)
    expect(evaluate(value, { __se_cls_strokeWidth: 1 }, 'number')).toBe(2)
    expect(evaluate(value, { __se_cls_strokeWidth: -1 }, 'number')).toBe(0.5)
    const hidden = updateCondition(style, 'strokeWidth', 'r2', { visible: false })
    const filter = visibilityFilter(hidden, resolveStyle(hidden, engine))
    expect(evaluate(filter, { __se_cls_strokeWidth: 1 }, 'boolean')).toBe(false)
    expect(evaluate(filter, { __se_cls_strokeWidth: 0 }, 'boolean')).toBe(true)
  })

  it('files: QML a QGIS CASE; Mapbox GL a case over the data (valid); SLD the fixed value with a note', () => {
    const style = widthByConditions()
    const resolved = resolveStyle(style, engine)
    const qml = exportStyle(style, 'qml', 'Polygon', 'layer', resolved, columns)
    expect(qml.text).toContain('CASE WHEN (v &gt; 50) THEN 4 WHEN (v &gt; 20) THEN 2 ELSE 0.5 END')
    expect(qml.text).not.toContain('WHEN (nope')
    expect(qml.notes.join(' ')).toMatch(/Conditions were written as QGIS expressions/)
    const mapbox = exportStyle(style, 'mapbox', 'Polygon', 'layer', resolved, columns)
    const doc = JSON.parse(mapbox.text)
    expect(mapbox.text).not.toContain('__se_cls_strokeWidth')
    const width = doc.layers.find((l: { id: string }) => l.id === 'layer-outline').paint['line-width']
    expect(evaluate(width, { v: 60 }, 'number')).toBe(4)
    expect(evaluate(width, { v: 30 }, 'number')).toBe(2)
    expect(evaluate(width, { v: 5 }, 'number')).toBe(0.5)
    doc.sources.data.data = { type: 'FeatureCollection', features: [] }
    expect(validateStyleMin(doc).map((e: { message: string }) => e.message)).toEqual([])
    const sld = exportStyle(style, 'sld', 'Polygon', 'layer', resolved, columns)
    expect(sld.notes.join(' ')).toMatch(/Outline width by conditions isn't written to SLD/)
  })

  it('shape by conditions: a shape per condition', () => {
    let style = setScaleKind(setChannelColumn(base, 'shape', 'hex', layer), 'shape', 'conditions', layer)
    style = updateCondition(style, 'shape', 'r1', { where: 'deg > 100', output: 'star' })
    const resolved = resolveStyle(style, { ...layer, ruleCountsByChannel: { shape: new Map([[0, 14], [-1, 7]]) } })
    expect(evaluate(channelValue(style, resolved, 'shape'), { __se_cls_shape: 0 }, 'string')).toBe('star')
    expect(evaluate(channelValue(style, resolved, 'shape'), { __se_cls_shape: -1 }, 'string')).toBe('circle')
  })
})
