// Spec 011 T022 (US1): every property by its own column, with categories or
// classes: defaults, outputs, the map's expressions evaluated by MapLibre per
// feature, the icon id per feature, the circle/marker split, hidden classes,
// and back to Fixed.
import { describe, expect, it } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  DEFAULT_LAYER_STYLE,
  layerFilters,
  layoutFor,
  markerIconIds,
  paintFor,
  parseMarkerIconId,
  resolveStyle,
  sanitizeStyle,
  setChannelClass,
  setChannelColumn,
  setChannelRange,
  setEncoding,
  setFixed,
  startEncoding,
  visibilityFilter,
  withRenderer,
  type LayerStyle,
} from '@spatial-explorer/core'

function evaluate(expr: unknown, properties: Record<string, unknown>, state: Record<string, unknown> = {}): unknown {
  const parsed = expression.createExpression(expr, 'layers[0].paint.x')
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  const v = parsed.value.evaluate({ zoom: 0 } as never, { type: 'Point', properties } as never, state as never)
  return v
}
const filterPasses = (filter: unknown, properties: Record<string, unknown>): boolean => filter === null || evaluate(filter, properties) === true

/** 24 crashes: severity (4), type (9, uneven), heading, age, and a null or two. */
const TYPES = ['Rear end', 'Rear end', 'Rear end', 'Rear end', 'Angle', 'Angle', 'Angle', 'Sideswipe', 'Sideswipe', 'Head on', 'Head on', 'Single', 'Single', 'Pedestrian', 'Pedestrian', 'Bicycle', 'Animal', 'Rollover', 'Rear end', 'Angle', 'Sideswipe', 'Head on', 'Single', null]
const crashes = {
  features: TYPES.map((t, i) => ({ id: i, geometry: null, attributes: { crash_type: t, severity: ['Fatal', 'Serious', 'Minor', 'Damage'][i % 4], heading: (i * 37) % 360, age: i === 5 ? null : i * 10 } })),
  columns: [
    { name: 'crash_type', type: 'VARCHAR' },
    { name: 'severity', type: 'VARCHAR' },
    { name: 'heading', type: 'INTEGER' },
    { name: 'age', type: 'DOUBLE' },
  ],
}
const props = (i: number) => crashes.features[i].attributes as Record<string, unknown>
const base = sanitizeStyle(DEFAULT_LAYER_STYLE)

describe('startEncoding (data-model "Default scale")', () => {
  it('text: categories; numbers: classes (quantile, 5); shapes and patterns: always categories', () => {
    expect(startEncoding('strokeColor', 'severity', crashes).scale).toMatchObject({ kind: 'categories', cap: 12, ramp: { id: 'brewer-set2' } })
    expect(startEncoding('opacity', 'age', crashes).scale).toEqual({ kind: 'classes', method: 'quantile', classCount: 5, classes: [], noValue: {}, range: { min: 0.3, max: 1 } })
    expect(startEncoding('shape', 'age', crashes).scale).toMatchObject({ kind: 'categories', cap: 6 })
    expect(startEncoding('dash', 'severity', crashes).scale).toMatchObject({ kind: 'categories', cap: 4 })
    expect(startEncoding('strokeWidth', 'age', crashes).scale).toMatchObject({ kind: 'classes', range: { min: 0.5, max: 4 } })
  })
})

describe('outputs', () => {
  it('shapes: 6 values get their own shape, the rest share Other (the seventh), with a note', () => {
    const style = setChannelColumn(base, 'shape', 'crash_type', crashes)
    const r = resolveStyle(style, crashes).channels?.shape
    const values = r?.classes.filter((c) => c.kind === 'value') ?? []
    expect(values).toHaveLength(6)
    expect(values.map((c) => c.output)).toEqual(['circle', 'square', 'triangle', 'diamond', 'star', 'cross'])
    expect(r?.classes.find((c) => c.kind === 'other')).toMatchObject({ output: 'x', groups: 3 })
    expect(r?.notes.join()).toMatch(/Only 6 values get their own shape/)
    // No value: the fixed shape.
    expect(r?.classes.find((c) => c.kind === 'noValue')?.output).toBe('circle')
  })

  it('numbers spread over the range; a class keeps its own output', () => {
    let style = setChannelColumn(base, 'strokeWidth', 'age', crashes)
    style = setChannelRange(style, 'strokeWidth', 1, 5)
    let r = resolveStyle(style, crashes).channels?.strokeWidth
    expect(r?.classes.filter((c) => c.kind === 'range').map((c) => c.output)).toEqual([1, 2, 3, 4, 5])
    style = setChannelClass(style, 'strokeWidth', 'range:2', { output: 9 })
    r = resolveStyle(style, crashes).channels?.strokeWidth
    expect(r?.classes.find((c) => c.key === 'range:2')?.output).toBe(9)
  })

  it('colors come from the ramp, and a category keeps its own', () => {
    let style = setChannelColumn(base, 'strokeColor', 'severity', crashes)
    style = setChannelClass(style, 'strokeColor', 'v:Fatal', { output: '#000000' })
    const r = resolveStyle(style, crashes).channels?.strokeColor
    expect(r?.classes.find((c) => c.key === 'v:Fatal')?.output).toBe('#000000')
    expect(new Set(r?.classes.map((c) => c.output)).size).toBe(r?.classes.length)
  })
})

describe('the map draws each property from its own column (MapLibre evaluator)', () => {
  // Color by severity (the pre-011 path), outline color, outline width, opacity, rotation and shape each by their own column.
  let style: LayerStyle = withRenderer(base, { kind: 'categorized', column: 'severity', ramp: { id: 'brewer-set1', reversed: false }, cap: 12, manual: false, classes: [], other: {}, noValue: {} })
  style = setChannelColumn(style, 'shape', 'crash_type', crashes)
  style = setChannelColumn(style, 'strokeColor', 'severity', crashes)
  style = setChannelColumn(style, 'strokeWidth', 'age', crashes)
  style = setChannelColumn(style, 'opacity', 'age', crashes)
  style = setChannelColumn(style, 'rotation', 'heading', crashes)
  const resolved = resolveStyle(style, crashes)
  const paint = paintFor(style, resolved, '#f59e0b')
  const layout = layoutFor(style, resolved)
  const out = (id: 'strokeColor' | 'strokeWidth' | 'opacity' | 'rotation' | 'shape', key: string) => resolved.channels?.[id]?.classes.find((c) => c.key === key)?.output

  it('outline color and width, per feature', () => {
    for (const i of [0, 1, 2, 3, 6]) {
      const p = props(i)
      const widthKey = resolved.channels?.strokeWidth?.classes.find((c) => c.kind === 'range' && Number(p.age) >= (c.lower ?? 0) && Number(p.age) <= (c.upper ?? 0))?.key
      const color = evaluate(['to-rgba', paint.circle['circle-stroke-color']], p) as number[]
      const want = out('strokeColor', `v:${p.severity}`) as string
      expect(color.slice(0, 3).map(Math.round)).toEqual([1, 3, 5].map((k) => parseInt(want.slice(k, k + 2), 16)))
      if (widthKey) expect(evaluate(paint.circle['circle-stroke-width'], p)).toBe(out('strokeWidth', widthKey))
    }
    // A feature with no age: the fixed outline width.
    expect(evaluate(paint.circle['circle-stroke-width'], props(5))).toBe(base.strokeWidth)
  })

  it('opacity multiplies the fill and outline opacities', () => {
    const p = props(12)
    const key = resolved.channels?.opacity?.classes.find((c) => c.kind === 'range' && Number(p.age) >= (c.lower ?? 0) && Number(p.age) <= (c.upper ?? 0))?.key as string
    const o = out('opacity', key) as number
    expect(evaluate(paint.circle['circle-opacity'], p)).toBeCloseTo(Math.max(base.fillOpacity, 0.05) * o, 6)
    expect(evaluate(paint.circle['circle-stroke-opacity'], p)).toBeCloseTo(base.strokeOpacity * o, 6)
    expect(evaluate(paint.marker['icon-opacity'], p)).toBeCloseTo(o, 6)
  })

  it('rotation turns the icons', () => {
    const p = props(9)
    const key = resolved.channels?.rotation?.classes.find((c) => c.kind === 'range' && Number(p.heading) >= (c.lower ?? 0) && Number(p.heading) <= (c.upper ?? 0))?.key as string
    expect(evaluate(layout.marker?.['icon-rotate'], p)).toBe(out('rotation', key))
  })

  it('the icon id carries the shape, fill, outline color and width of each feature', () => {
    for (const i of [4, 7, 9]) {
      const p = props(i)
      const id = parseMarkerIconId(String(evaluate(layout.marker?.['icon-image'], p)))
      expect(id?.shape).toBe(out('shape', `v:${p.crash_type}`))
      expect(id?.strokeColor).toBe(out('strokeColor', `v:${p.severity}`))
      expect(id?.fillColor).toBe(resolved.classes.find((c) => c.key === `v:${p.severity}`)?.color)
    }
    // Icons built per feature are made when the map asks: nothing to list.
    expect(markerIconIds(style, resolved)).toEqual([])
  })

  it('circles stay on the circle layer; other shapes go to the marker layer', () => {
    const f = layerFilters(style, resolved)
    const circle = props(0) // "Rear end": the most common type, the circle
    const angle = props(4) // "Angle": the square
    expect(filterPasses(f.circle, circle)).toBe(true)
    expect(filterPasses(f.marker, circle)).toBe(false)
    expect(filterPasses(f.circle, angle)).toBe(false)
    expect(filterPasses(f.marker, angle)).toBe(true)
  })

  it('a class hidden in any property hides its features', () => {
    const hidden = setChannelClass(style, 'shape', 'v:Angle', { visible: false })
    const r = resolveStyle(hidden, crashes)
    const filter = visibilityFilter(hidden, r)
    expect(filterPasses(filter, props(4))).toBe(false)
    expect(filterPasses(filter, props(0))).toBe(true)
  })
})

describe('back to Fixed', () => {
  it('every feature takes the fixed value again; other properties are untouched', () => {
    let style = setChannelColumn(base, 'strokeWidth', 'age', crashes)
    style = setChannelColumn(style, 'strokeColor', 'severity', crashes)
    style = setFixed(setEncoding(style, 'strokeWidth', null), 'strokeWidth', 2.5)
    const r = resolveStyle(style, crashes)
    const paint = paintFor(style, r, '#f59e0b')
    expect(evaluate(paint.circle['circle-stroke-width'], props(3))).toBe(2.5)
    expect(r.channels?.strokeColor?.status).toBe('ok')
    expect(style.channels?.strokeWidth).toBeUndefined()
  })

  it('setFixed writes the layer symbol fields (a line color is the stroke color)', () => {
    expect(setFixed(base, 'color', '#112233', 'line').strokeColor).toBe('#112233')
    expect(setFixed(base, 'color', '#112233').fillColor).toBe('#112233')
    expect(setFixed(base, 'width', 4).lineWidth).toBe(4)
    expect(setFixed(setFixed(base, 'shape', 'star'), 'shape', 'circle').markerShape).toBeUndefined()
    expect(setFixed(base, 'opacity', 2)).toBe(base) // not a valid opacity
  })
})
