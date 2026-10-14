// Basemap catalog — DATA, not code (CLAUDE.md "Basemaps"). The UI renders
// from this table; adding a provider later (spec 004) means adding a row.
// Spec 001 only needs: a light default, a dark default, and a blank option.

export interface BasemapCatalogEntry {
  id: string
  name: string
  type: 'vector' | 'raster' | 'blank'
  /** Style or tile URL template. Empty for the blank entry. */
  url: string
  attribution: string
  requiresKey: boolean
  /** 'global' or a region code; all spec-001 entries are global. */
  region: string
  /** Which host theme kind this entry is the default for, if any. */
  defaultFor?: 'light' | 'dark'
  /**
   * Picker preview (CLAUDE.md: "background color first, then a snapshot"):
   * the style's own background and water colors, read from the published
   * style JSON. Null for the blank entry, which previews as the host background.
   */
  preview: { land: string; water: string } | null
  /** Raster rows (spec 008): the highest zoom with tiles; MapLibre overzooms past it. */
  maxzoom?: number
  /** Raster rows: values for `{s}` in the URL template, spread across requests. */
  subdomains?: string[]
  /** Spec 010 gallery rows (basemapGallery.ts): raster tile URLs as they are, with the key applied. */
  tiles?: string[]
  tileSize?: number
  scheme?: 'xyz' | 'tms'
  /** Gallery rows: the provider id and name (for its API key and messages). */
  provider?: string
  providerName?: string
  /** Gallery rows: an API key is in the URLs. */
  keyed?: boolean
}

export const BASEMAP_CATALOG: BasemapCatalogEntry[] = [
  {
    id: 'blank',
    name: 'Blank',
    type: 'blank',
    url: '',
    attribution: '',
    requiresKey: false,
    region: 'global',
    preview: null,
  },
  {
    id: 'openfreemap-positron',
    name: 'Positron',
    type: 'vector',
    url: 'https://tiles.openfreemap.org/styles/positron',
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    requiresKey: false,
    region: 'global',
    preview: { land: '#f2f3f0', water: '#c2c8ca' },
    defaultFor: 'light',
  },
  {
    id: 'openfreemap-liberty',
    name: 'Liberty',
    type: 'vector',
    url: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    requiresKey: false,
    region: 'global',
    preview: { land: '#f8f4f0', water: '#9ebdff' },
  },
  {
    id: 'openfreemap-bright',
    name: 'Bright',
    type: 'vector',
    url: 'https://tiles.openfreemap.org/styles/bright',
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    requiresKey: false,
    region: 'global',
    preview: { land: '#f8f4f0', water: '#aecfe2' },
  },
  {
    id: 'openfreemap-dark',
    name: 'Dark',
    type: 'vector',
    url: 'https://tiles.openfreemap.org/styles/dark',
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    requiresKey: false,
    region: 'global',
    preview: { land: '#0c0c0c', water: '#1b1b1d' },
    defaultFor: 'dark',
  },
  {
    id: 'openfreemap-fiord',
    name: 'Fiord',
    type: 'vector',
    url: 'https://tiles.openfreemap.org/styles/fiord',
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    requiresKey: false,
    region: 'global',
    preview: { land: '#45516e', water: '#38435c' },
  },
  // Spec 008 (research §7): keyless raster basemaps, URL templates from
  // leaflet-providers as data. Each provider's usage policy applies: none is
  // ever a default, and OSM's standard tiles discourage heavy use.
  {
    id: 'esri-imagery',
    name: 'Satellite',
    type: 'raster',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    requiresKey: false,
    region: 'global',
    preview: { land: '#4b5a3c', water: '#1d3150' },
    maxzoom: 19,
  },
  {
    id: 'opentopomap',
    name: 'Topographic',
    type: 'raster',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)',
    requiresKey: false,
    region: 'global',
    preview: { land: '#e8e4d0', water: '#97d2e3' },
    maxzoom: 17,
    subdomains: ['a', 'b', 'c'],
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    type: 'raster',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    requiresKey: false,
    region: 'global',
    preview: { land: '#f2efe9', water: '#aad3df' },
    maxzoom: 19,
  },
]

export function getDefaultBasemap(theme: 'light' | 'dark'): BasemapCatalogEntry {
  const match = BASEMAP_CATALOG.find((e) => e.defaultFor === theme)
  if (!match) {
    throw new Error(`No default basemap configured for theme "${theme}"`)
  }
  return match
}

export function getBlankBasemap(): BasemapCatalogEntry {
  const blank = BASEMAP_CATALOG.find((e) => e.id === 'blank')
  if (!blank) {
    throw new Error('Basemap catalog is missing its required "blank" entry')
  }
  return blank
}
