// Spec 011 T033 (US3, research §11): recipes set only the properties they're
// about; Draw as keeps the markers' properties when points become a heatmap.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYER_STYLE,
  RECIPES,
  applyRecipe,
  drawOf,
  recipeUnavailable,
  rendererOf,
  sanitizeStyle,
  setChannelColumn,
  setDraw,
  sizeOf,
  type LayerStyle,
} from '@spatial-explorer/core'

const roads = {
  features: Array.from({ length: 12 }, (_, i) => ({ id: i, geometry: null, attributes: { id: i, los: 'ABCDEF'[i % 6], volume: (i + 1) * 100 } })),
  columns: [
    { name: 'id', type: 'INTEGER' },
    { name: 'los', type: 'VARCHAR' },
    { name: 'volume', type: 'INTEGER' },
  ],
}
const oneNumber = { features: [], columns: [{ name: 'v', type: 'DOUBLE' }] }
const base = sanitizeStyle(DEFAULT_LAYER_STYLE)

describe('RECIPES', () => {
  it('lists the seven recipes, each with a one-line hint', () => {
    expect(RECIPES.map((r) => r.label)).toEqual(['Categorized', 'Graduated', 'Proportional symbols', 'Bivariate', 'Rules', 'Heatmap', 'Flow / network'])
    for (const r of RECIPES) expect(r.hint.length).toBeGreaterThan(10)
  })
})

describe('recipeUnavailable', () => {
  it('says why a recipe does not fit the layer', () => {
    expect(recipeUnavailable('bivariate', 'Polygon', oneNumber)).toBe('Bivariate maps need two numeric columns.')
    expect(recipeUnavailable('heatmap', 'Polygon', roads)).toBe('Heatmaps need points; this layer has none.')
    expect(recipeUnavailable('proportional', 'Polygon', roads)).toMatch(/Polygons have no size/)
    expect(recipeUnavailable('flow', 'Point', roads)).toBe('Flow maps are for lines.')
    expect(recipeUnavailable('flow', 'LineString', oneNumber)).toMatch(/text column/)
    expect(recipeUnavailable('flow', 'LineString', roads)).toBeNull()
    expect(recipeUnavailable('graduated', 'Point', { features: [], columns: [{ name: 'name', type: 'VARCHAR' }] })).toMatch(/numeric column/)
  })
})

describe('applyRecipe', () => {
  it('Flow / network on lines: color by categories of a text column, width by classes of a number', () => {
    const s = applyRecipe(base, 'flow', 'LineString', roads)
    expect(rendererOf(s)).toMatchObject({ kind: 'categorized', column: 'los' })
    expect(sizeOf(s)).toMatchObject({ column: 'volume', mode: 'classed' })
    expect(Object.keys(s)).not.toContain('renderer')
  })

  it('Graduated sets the color and leaves other properties alone', () => {
    const shaped = setChannelColumn(base, 'shape', 'los', roads)
    const s = applyRecipe(shaped, 'graduated', 'Point', roads)
    expect(rendererOf(s)).toMatchObject({ kind: 'graduated', column: 'volume' })
    expect(s.channels?.shape).toEqual(shaped.channels?.shape)
  })

  it('Proportional symbols: points by area, lines linearly', () => {
    expect(sizeOf(applyRecipe(base, 'proportional', 'Point', roads))).toMatchObject({ column: 'volume', mode: 'proportional', scale: 'area' })
    expect(sizeOf(applyRecipe(base, 'proportional', 'LineString', roads))).toMatchObject({ column: 'volume', mode: 'proportional' })
  })

  it('a color recipe on a heatmap draws markers again', () => {
    const heat = applyRecipe(base, 'heatmap', 'Point', roads)
    expect(drawOf(heat).points).toBe('heatmap')
    expect(drawOf(applyRecipe(heat, 'categorized', 'Point', roads)).points).toBe('markers')
  })
})

describe('setDraw', () => {
  it('a heatmap keeps the markers properties, and they come back with markers', () => {
    let s: LayerStyle = setChannelColumn(base, 'shape', 'los', roads)
    s = applyRecipe(s, 'categorized', 'Point', roads)
    const heat = setDraw(s, { points: 'heatmap' })
    expect(rendererOf(heat).kind).toBe('heatmap')
    expect(heat.heatmap).toMatchObject({ weight: '', radius: 20, intensity: 1 })
    expect(heat.channels).toEqual(s.channels)
    const back = setDraw(heat, { points: 'markers' })
    expect(rendererOf(back)).toEqual(rendererOf(s))
    expect(back.channels).toEqual(s.channels)
  })

  it('3D shows the height; fills keep its encoding', () => {
    const tall = setDraw(base, { polygons: '3d' })
    expect(drawOf(tall).polygons).toBe('3d')
    const withHeight = { ...tall, channels: { height: { source: { kind: 'column' as const, column: 'h' }, scale: { kind: 'identity' as const, noValue: {} } } } }
    const flat = setDraw(withHeight, { polygons: 'fills' })
    expect(flat.draw).toBeUndefined()
    expect(flat.channels?.height?.source).toEqual({ kind: 'column', column: 'h' })
  })
})
