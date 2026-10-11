// T029 (spec 003, FR-009, data-model.md Transitions): style edits.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYER_STYLE,
  THEMATIC_SYMBOL,
  addClass,
  deleteClass,
  rendererOf,
  resolveStyle,
  setCategorizedAuto,
  setCategoryValue,
  setClassBound,
  setClassColor,
  setClassCount,
  setClassLabel,
  setClassVisible,
  setMethod,
  startStyle,
  validateStyle,
  type LayerStyle,
} from '@spatial-explorer/core'

const layer = {
  features: ['a', 'b', 'a', 'c'].map((zone, id) => ({ id, geometry: null, attributes: { zone, n: id } })),
  columns: [
    { name: 'zone', type: 'VARCHAR' },
    { name: 'n', type: 'INTEGER' },
  ],
}

describe('switching renderers', () => {
  it('a thematic renderer starts with the thematic symbol when the symbol is untouched, and Single restores it', () => {
    const cat = startStyle(DEFAULT_LAYER_STYLE, 'categorized', layer)
    expect(rendererOf(cat)).toMatchObject({ kind: 'categorized', column: 'zone' })
    expect(cat).toMatchObject(THEMATIC_SYMBOL)
    expect(cat.fillColor).toBe(DEFAULT_LAYER_STYLE.fillColor)
    const back = startStyle(cat, 'single', layer)
    const { renderer: _r, ...symbol } = back
    const { renderer: _d, ...defaults } = DEFAULT_LAYER_STYLE
    expect(symbol).toEqual(defaults)
  })

  it('customized symbol settings are kept both ways', () => {
    const custom: LayerStyle = { ...DEFAULT_LAYER_STYLE, strokeColor: '#ff0000', strokeWidth: 3 }
    const cat = startStyle(custom, 'categorized', layer)
    expect(cat.strokeColor).toBe('#ff0000')
    expect(cat.strokeWidth).toBe(3)
    expect(cat.fillOpacity).toBe(THEMATIC_SYMBOL.fillOpacity)
    expect(startStyle(cat, 'single', layer).strokeColor).toBe('#ff0000')
  })

  it('graduated picks the first numeric column', () => {
    expect(rendererOf(startStyle(DEFAULT_LAYER_STYLE, 'graduated', layer))).toMatchObject({ kind: 'graduated', column: 'n', method: 'quantile', classCount: 5 })
  })
})

describe('class edits', () => {
  it('visibility is an override that keeps the renderer settings', () => {
    const cat = startStyle(DEFAULT_LAYER_STYLE, 'categorized', layer)
    const hidden = setClassVisible(cat, 'v:b', false)
    expect(rendererOf(hidden)).toMatchObject({ manual: false, classes: [{ value: 'b', visible: false }] })
    expect(rendererOf(setClassVisible(hidden, 'v:b', true))).toMatchObject({ classes: [{ value: 'b', visible: true }] })
    expect(rendererOf(setClassVisible(cat, '__other', false))).toMatchObject({ other: { visible: false } })
    expect(rendererOf(setClassVisible(cat, '__null', false))).toMatchObject({ noValue: { visible: false } })
  })
})

const numbers = {
  features: Array.from({ length: 100 }, (_, id) => ({ id, geometry: null, attributes: { n: id } })),
  columns: [{ name: 'n', type: 'INTEGER' }],
}
const grad = (): LayerStyle => startStyle(DEFAULT_LAYER_STYLE, 'graduated', numbers)

describe('edits that keep the method (FR-009)', () => {
  it('color and label are overrides; an empty label goes back to the generated one', () => {
    const cat = startStyle(DEFAULT_LAYER_STYLE, 'categorized', layer)
    const colored = setClassColor(cat, 'v:a', '#123456')
    const labeled = setClassLabel(colored, 'v:a', ' Alpha ')
    expect(rendererOf(labeled)).toMatchObject({ manual: false, classes: [{ value: 'a', color: '#123456', label: 'Alpha' }] })
    expect(resolveStyle(labeled, layer).classes[0]).toMatchObject({ label: 'Alpha', color: '#123456' })
    expect(resolveStyle(setClassLabel(labeled, 'v:a', ''), layer).classes[0].label).toBe('a')
    const g = setClassColor(grad(), 'range:2', '#00ff00')
    expect(rendererOf(g)).toMatchObject({ method: 'quantile', classes: [{ index: 2, color: '#00ff00' }] })
  })

  it('choosing a method again drops bounds but keeps color, label and visibility by index', () => {
    const manual = setClassBound(setClassColor(grad(), 'range:1', '#ff0000'), resolveStyle(grad(), numbers), 0, 'upper', 10)
    expect(rendererOf(manual)).toMatchObject({ method: 'manual' })
    const back = setMethod(manual, 'jenks')
    const r = rendererOf(back)
    expect(r).toMatchObject({ method: 'jenks' })
    if (r.kind !== 'graduated') throw new Error('graduated')
    expect(r.classes.every((c) => c.lower === undefined && c.upper === undefined)).toBe(true)
    expect(r.classes.find((c) => c.index === 1)?.color).toBe('#ff0000')
  })

  it('a new class count resets classes and leaves Manual', () => {
    expect(rendererOf(setClassCount(grad(), 7))).toMatchObject({ classCount: 7, method: 'quantile', classes: [] })
    expect(rendererOf(setClassCount(grad(), 40))).toMatchObject({ classCount: 10 })
  })
})

describe('edits that switch to Manual (FR-009)', () => {
  it('a bound edit fixes the ranges, moves the neighbour, and keeps them contiguous', () => {
    const base = grad()
    const resolved = resolveStyle(base, numbers)
    const edited = setClassBound(base, resolved, 1, 'lower', 15)
    const r = rendererOf(edited)
    if (r.kind !== 'graduated') throw new Error('graduated')
    expect(r.method).toBe('manual')
    expect(r.classes).toHaveLength(5)
    expect(r.classes[0].upper).toBe(15)
    expect(r.classes[1].lower).toBe(15)
    expect(validateStyle(edited)).toEqual([])
    expect(resolveStyle(edited, numbers).caption).toBe('n · Manual, 5 classes')
  })

  it('a bound that crosses its class is reported by validation', () => {
    const base = grad()
    const edited = setClassBound(base, resolveStyle(base, numbers), 1, 'lower', 1000)
    expect(validateStyle(edited).join()).toMatch(/below the upper bound/)
  })

  it('manual ranges keep their bounds when the data changes, and recount', () => {
    const base = grad()
    const manual = setClassBound(base, resolveStyle(base, numbers), 0, 'upper', 50)
    const fewer = { ...numbers, features: numbers.features.slice(0, 40) }
    const r = resolveStyle(manual, fewer)
    expect(r.classes[0]).toMatchObject({ upper: 50, count: 40 })
  })

  it('add splits the last range; delete merges a range into its neighbour', () => {
    const base = grad()
    const added = addClass(base, resolveStyle(base, numbers))
    const ra = rendererOf(added)
    if (ra.kind !== 'graduated') throw new Error('graduated')
    expect(ra.classes).toHaveLength(6)
    expect(ra.classes[4].upper).toBe(ra.classes[5].lower)
    const deleted = deleteClass(added, resolveStyle(added, numbers), 'range:0')
    const rd = rendererOf(deleted)
    if (rd.kind !== 'graduated') throw new Error('graduated')
    expect(rd.classes).toHaveLength(5)
    expect(rd.classes[0].lower).toBe(0)
    expect(rd.classes.map((c) => c.index)).toEqual([0, 1, 2, 3, 4])
    expect(validateStyle(deleted)).toEqual([])
  })

  it('categorized: a value edit, add or delete fixes the list; Auto goes back to frequency order', () => {
    const cat = setClassColor(startStyle(DEFAULT_LAYER_STYLE, 'categorized', layer), 'v:b', '#ff0000')
    const resolved = resolveStyle(cat, layer)
    const renamed = setCategoryValue(cat, resolved, 'v:c', 'z')
    expect(rendererOf(renamed)).toMatchObject({ manual: true })
    const r = resolveStyle(renamed, layer)
    expect(r.classes.map((c) => c.key)).toEqual(['v:a', 'v:b', 'v:z', '__other'])
    expect(r.classes[1].color).toBe('#ff0000')
    expect(r.classes.find((c) => c.key === '__other')?.count).toBe(1) // "c" now falls in Other
    const added = addClass(renamed, r)
    expect(resolveStyle(added, layer).classes.map((c) => c.key)).toContain('v:New value 1')
    const deleted = deleteClass(added, resolveStyle(added, layer), 'v:a')
    expect(resolveStyle(deleted, layer).classes.map((c) => c.key)).not.toContain('v:a')
    const auto = setCategorizedAuto(deleted)
    expect(rendererOf(auto)).toMatchObject({ manual: false })
    expect(resolveStyle(auto, layer).classes.map((c) => c.key)).toEqual(['v:a', 'v:b', 'v:c'])
    expect(resolveStyle(auto, layer).classes[1].color).toBe('#ff0000')
  })
})
