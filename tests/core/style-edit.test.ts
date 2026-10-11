// T029 (spec 003, FR-009, data-model.md Transitions): style edits.
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYER_STYLE, THEMATIC_SYMBOL, rendererOf, setClassVisible, startStyle, type LayerStyle } from '@spatial-explorer/core'

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
