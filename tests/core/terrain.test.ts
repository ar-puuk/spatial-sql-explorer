// Spec 014: terrain's shading follows the basemap (imagery looked glossy under a white highlight).
import { describe, expect, it } from 'vitest'
import { BASEMAP_CATALOG, clampExaggeration, formatElevation, hillshadePaint, reliefKindFor } from '@spatial-explorer/core'

const entry = (over: Partial<Parameters<typeof reliefKindFor>[0]>) => ({ id: 'x', name: 'X', type: 'vector' as const, ...over })

describe('reliefKindFor', () => {
  it('the catalog: Satellite is imagery, Dark is dark, the others are light', () => {
    const kind = (id: string) => reliefKindFor(BASEMAP_CATALOG.find((b) => b.id === id)!)
    expect(kind('esri-imagery')).toBe('imagery')
    expect(kind('openfreemap-dark')).toBe('dark')
    expect(kind('openfreemap-positron')).toBe('light')
    expect(kind('openfreemap-liberty')).toBe('light')
  })
  it('gallery imagery rows are found by their name or their tile host', () => {
    expect(reliefKindFor(entry({ type: 'raster', name: 'Sentinel-2 cloudless' }))).toBe('imagery')
    expect(reliefKindFor(entry({ type: 'raster', name: 'World', tiles: ['https://x/World_Imagery/tile/{z}/{y}/{x}'] }))).toBe('imagery')
    expect(reliefKindFor(entry({ type: 'raster', name: 'OpenStreetMap' }))).toBe('light')
    // A vector style named for imagery is still a vector map: only raster rows are photographs.
    expect(reliefKindFor(entry({ type: 'vector', name: 'Imagery labels' }))).toBe('light')
    expect(reliefKindFor(entry({ type: 'vector', name: 'Dark Matter' }))).toBe('dark')
    expect(reliefKindFor(entry({ type: 'blank', name: 'Blank' }))).toBe('light')
  })
})

describe('hillshadePaint', () => {
  const highlightAlpha = (kind: 'imagery' | 'dark' | 'light'): number => Number(/,\s*([\d.]+)\)$/.exec(String(hillshadePaint(kind)['hillshade-highlight-color']))?.[1])
  it('imagery gets no highlight and a gentle shadow; a dark map a faint highlight; the rest a soft one', () => {
    expect(highlightAlpha('imagery')).toBe(0)
    expect(highlightAlpha('dark')).toBeGreaterThan(0)
    expect(highlightAlpha('dark')).toBeLessThan(highlightAlpha('light'))
    expect(highlightAlpha('light')).toBeLessThan(1)
    expect(hillshadePaint('imagery')['hillshade-exaggeration'] as number).toBeLessThan(hillshadePaint('light')['hillshade-exaggeration'] as number)
  })
  it('no kind uses a pure white highlight', () => {
    for (const k of ['imagery', 'dark', 'light'] as const) expect(String(hillshadePaint(k)['hillshade-highlight-color'])).not.toMatch(/^#fff/i)
  })
})

describe('elevation helpers', () => {
  it('clamps the exaggeration and formats meters', () => {
    expect(clampExaggeration(9)).toBe(5)
    expect(clampExaggeration(0.1)).toBe(0.5)
    expect(formatElevation(1234.6)).toBe('1,235 m')
  })
})
