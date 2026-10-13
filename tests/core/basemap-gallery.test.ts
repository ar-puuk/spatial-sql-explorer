// Spec 010 T041: the generated "More basemaps…" gallery and its key handling.
import { describe, expect, it } from 'vitest'
import { applyKey, BASEMAP_CATALOG, GALLERY, galleryCategories, rasterStyle, searchGallery, toCatalogEntry, type GalleryBasemap } from '@spatial-explorer/core'

describe('gallery catalog', () => {
  it('has no excluded provider, category or overlay', () => {
    const providers = new Set(GALLERY.map((g) => g.provider))
    for (const p of ['google', 'tianditu', 'amap', 'tencent', 'here', 'tomtom', 'mapbox', 'amazon', 'waymarkedtrails', 'openrailwaymap']) expect(providers.has(p)).toBe(false)
    for (const c of ['Labels', 'Traffic', '3D']) expect(galleryCategories()).not.toContain(c)
    expect(GALLERY.some((g) => g.tags.includes('overlay'))).toBe(false)
    expect(GALLERY.some((g) => JSON.stringify(g).includes('{session}'))).toBe(false)
  })

  it('every entry has a name and either a style URL or tiles, and an id that is not a featured one', () => {
    const featured = new Set(BASEMAP_CATALOG.map((e) => e.id))
    for (const g of GALLERY) {
      expect(g.name).toBeTruthy()
      expect(g.kind === 'vector' ? g.url : g.tiles?.[0]).toMatch(/^https:\/\//)
      expect(g.id.startsWith('g-') && !featured.has(g.id)).toBe(true)
    }
  })

  it('keeps no tag but links in attributions', () => {
    for (const g of GALLERY) expect(g.attribution.replace(/<a href="https:\/\/[^"]+">[^<]*<\/a>/g, '')).not.toMatch(/</)
  })

  it('every MapTiler style needs a key (two upstream URLs lacked the placeholder)', () => {
    const maptiler = GALLERY.filter((g) => g.provider === 'maptiler')
    expect(maptiler.length).toBeGreaterThan(0)
    for (const g of maptiler) expect([g.key, g.url]).toEqual(['required', expect.stringContaining('key={api-key}')])
  })
})

describe('searchGallery', () => {
  // The plan's example ("esri imagery") is the featured Satellite row, so it isn't in the gallery.
  it('"esri topo" finds World Topographic, and the featured Satellite is not repeated', () => {
    expect(searchGallery('esri topo').map((g) => g.name)).toContain('World Topographic')
    expect(searchGallery('esri imagery')).toEqual([])
  })
  it('every word must match, in any case', () => {
    expect(searchGallery('ESRI zzzz')).toEqual([])
  })
  it('filters by category, provider and keyless', () => {
    expect(searchGallery('', { category: 'Imagery' }).every((g) => g.category === 'Imagery')).toBe(true)
    expect(searchGallery('', { provider: 'esri' }).every((g) => g.provider === 'esri')).toBe(true)
    expect(searchGallery('', { keylessOnly: true }).some((g) => g.provider === 'maptiler')).toBe(false)
  })
})

describe('applyKey', () => {
  const base = { id: 'g-x', name: 'X', provider: 'p', providerName: 'P', category: 'Street', description: '', attribution: '', tags: [] }
  const required: GalleryBasemap = { ...base, kind: 'vector', url: 'https://api.example.com/style.json?key={api-key}', key: 'required' }
  const optional: GalleryBasemap = { ...base, kind: 'raster', tiles: ['https://a.example.com/{z}/{x}/{y}.png?key={api-key}', 'https://b.example.com/{z}/{x}/{y}.png?api_key={api-key}&lang=en'], key: 'optional' }
  const none: GalleryBasemap = { ...base, kind: 'raster', tiles: ['https://t.example.com/{z}/{x}/{y}.png'], key: 'none' }

  it('required: needs a key, and puts it in encoded', () => {
    expect(applyKey(required, null)).toEqual({ needsKey: true })
    expect(applyKey(required, '  ')).toEqual({ needsKey: true })
    expect(applyKey(required, 'a b&c')).toEqual({ url: 'https://api.example.com/style.json?key=a%20b%26c' })
  })
  it('optional: the key parameter goes away cleanly without one', () => {
    expect(applyKey(optional, null)).toEqual({ tiles: ['https://a.example.com/{z}/{x}/{y}.png', 'https://b.example.com/{z}/{x}/{y}.png?lang=en'] })
    expect(applyKey(optional, 'k')).toEqual({ tiles: ['https://a.example.com/{z}/{x}/{y}.png?key=k', 'https://b.example.com/{z}/{x}/{y}.png?api_key=k&lang=en'] })
  })
  it('none: unchanged', () => {
    expect(applyKey(none, null)).toEqual({ tiles: none.tiles })
  })
  it('a raster entry becomes a catalog entry whose style uses its tiles', () => {
    const entry = toCatalogEntry(none, { tiles: none.tiles })
    expect(entry).toMatchObject({ id: 'g-x', type: 'raster', url: 'https://t.example.com/{z}/{x}/{y}.png', provider: 'p' })
    expect((rasterStyle(entry).sources['basemap-raster'] as { tiles: string[] }).tiles).toEqual(none.tiles)
  })
})
