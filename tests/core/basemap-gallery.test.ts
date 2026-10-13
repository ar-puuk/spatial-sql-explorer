// Spec 010 T041: the generated "More basemaps…" gallery and its key handling.
import { describe, expect, it } from 'vitest'
import {
  applyKey,
  BASEMAP_CATALOG,
  GALLERY,
  galleryCategories,
  galleryGroups,
  rasterStyle,
  resolveGalleryUrls,
  searchGallery,
  toCatalogEntry,
  transformMapboxStyle,
  type BasemapStyle,
  type GalleryBasemap,
} from '@spatial-explorer/core'

describe('gallery catalog', () => {
  // User decision 2026-10-13: every provider; overlays (stacked basemaps) and 3D styles stay out.
  it('offers every provider, with keyless CARTO GL and VersaTiles styles, but no overlay or 3D style', () => {
    const providers = new Set(GALLERY.map((g) => g.provider))
    for (const p of ['google', 'mapbox', 'amazon', 'tianditu', 'amap', 'tencent', 'openfreemap', 'carto-gl', 'versatiles', 'protomaps']) expect(providers.has(p)).toBe(true)
    for (const c of ['Labels', 'Traffic', '3D']) expect(galleryCategories()).not.toContain(c)
    expect(GALLERY.some((g) => g.tags.includes('overlay'))).toBe(false)
    expect(GALLERY.filter((g) => g.provider === 'carto-gl' && g.key === 'none' && g.kind === 'vector')).toHaveLength(6)
  })

  it('shows the featured basemaps too, linked to their featured rows', () => {
    const linked = GALLERY.filter((g) => g.featuredId).map((g) => g.featuredId)
    const featured = BASEMAP_CATALOG.filter((e) => e.type !== 'blank').map((e) => e.id)
    expect([...linked].sort()).toEqual([...featured].sort())
  })

  it('marks the GCJ-02 datum offset of Amap and Tencent', () => {
    for (const g of GALLERY.filter((x) => x.provider === 'amap' || x.provider === 'tencent')) expect(g.warning).toMatch(/GCJ-02/)
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
  it('"esri imagery" finds World Imagery (the featured Satellite, in its provider group too)', () => {
    const found = searchGallery('esri imagery')
    expect(found.map((g) => g.name)).toContain('World Imagery')
    expect(found.find((g) => g.name === 'World Imagery')?.featuredId).toBe('esri-imagery')
  })
  it('filters vector or raster, and groups by provider', () => {
    expect(searchGallery('', { kind: 'vector' }).every((g) => g.kind === 'vector')).toBe(true)
    const groups = galleryGroups(searchGallery('carto'))
    expect(groups.map((g) => g.providerName)).toEqual(['CARTO (vector)', 'Carto']) // keyless vector first, keyed-only providers last
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

describe('provider specifics', () => {
  const base = { id: 'g-x', name: 'X', providerName: 'P', category: 'Street', description: '', attribution: '', tags: [] }

  it('Amazon needs a key and an AWS region; both go in the URL', () => {
    const g: GalleryBasemap = { ...base, provider: 'amazon', kind: 'vector', url: 'https://maps.geo.{aws-region}.amazonaws.com/v2/styles/Standard/descriptor?key={api-key}', key: 'required', region: true }
    expect(applyKey(g, 'k', null)).toEqual({ needsKey: true })
    expect(applyKey(g, 'k', 'eu-west-1')).toEqual({ url: 'https://maps.geo.eu-west-1.amazonaws.com/v2/styles/Standard/descriptor?key=k' })
  })

  it('Google works without a key; with one it mints a Map Tiles API session', async () => {
    const g = GALLERY.find((x) => x.id === 'g-google-maps')!
    expect(g.key).toBe('optional')
    expect(applyKey(g, null)).toEqual({ tiles: g.tiles })
    const calls: string[] = []
    const fetchStub = (async (url: string, init?: RequestInit) => {
      calls.push(`${url} ${init?.body ?? ''}`)
      return new Response(JSON.stringify({ session: 'S1', expiry: String(Date.now() / 1000 + 3600) }))
    }) as typeof fetch
    const resolved = await resolveGalleryUrls(g, 'KEY', null, fetchStub)
    expect(resolved).toEqual({ tiles: ['https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=S1&key=KEY'] })
    expect(calls[0]).toContain('https://tile.googleapis.com/v1/createSession?key=KEY')
    expect(calls[0]).toContain('"mapType":"roadmap"')
  })

  it('a Mapbox style gets API URLs, with the token, for its mapbox:// sprite, fonts and tilesets', () => {
    const style = {
      version: 8,
      sprite: 'mapbox://sprites/mapbox/streets-v12',
      glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
      sources: { composite: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' }, plain: { type: 'vector', url: 'https://example.com/t.json' } },
      layers: [],
    } as unknown as BasemapStyle
    const out = transformMapboxStyle(style, 'pk.T')
    expect(out.sprite).toBe('https://api.mapbox.com/styles/v1/mapbox/streets-v12/sprite?access_token=pk.T')
    expect(out.glyphs).toBe('https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=pk.T')
    expect((out.sources as Record<string, { url: string }>).composite.url).toBe('https://api.mapbox.com/v4/mapbox.mapbox-streets-v8.json?secure&access_token=pk.T')
    expect((out.sources as Record<string, { url: string }>).plain.url).toBe('https://example.com/t.json')
  })
})
