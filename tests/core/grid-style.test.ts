// Spec 017: how a binned result opens (grid/gridStyle.ts).
import { describe, expect, it } from 'vitest'
import { BIN_COLUMNS, gridStyle, isBinResult, rendererOf, sanitizeStyle } from '@spatial-explorer/core'

describe('gridStyle (spec 017)', () => {
  it('colors the cells by value in quantile classes, with the measure as the legend title', () => {
    const style = gridStyle('Number of features')
    const color = style.channels?.color
    expect(color?.source).toEqual({ kind: 'column', column: 'value' })
    expect(color?.scale.kind).toBe('classes')
    expect(color?.scale).toMatchObject({ method: 'quantile', classCount: 5 })
    expect(color?.legend?.title).toBe('Number of features')
  })

  it('draws a thin light outline over a mostly opaque fill', () => {
    const style = gridStyle('Sum of pop')
    expect(style.strokeWidth).toBe(0.5)
    expect(style.strokeColor).toBe('#ffffff')
    expect(style.fillOpacity).toBeGreaterThan(0.6)
  })

  it('is a whole style that survives sanitizing, and reads as a graduated renderer on value', () => {
    const style = gridStyle('Average of pop')
    const clean = sanitizeStyle(style)
    expect(clean.channels?.color?.source).toEqual({ kind: 'column', column: 'value' })
    expect(clean.channels?.color?.legend?.title).toBe('Average of pop')
    const renderer = rendererOf(clean)
    expect(renderer.kind).toBe('graduated')
    expect(renderer.kind === 'graduated' && renderer.column).toBe('value')
  })

  it('recognizes a bin result by its columns, however the query was edited otherwise', () => {
    expect(isBinResult(BIN_COLUMNS.map((name) => ({ name })))).toBe(true)
    expect(isBinResult([...BIN_COLUMNS, 'extra'].map((name) => ({ name })))).toBe(true)
    expect(isBinResult([{ name: 'value' }, { name: 'geom' }])).toBe(false)
    expect(isBinResult([])).toBe(false)
  })
})
