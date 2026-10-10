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
  },
  {
    id: 'openfreemap-positron',
    name: 'Positron',
    type: 'vector',
    url: 'https://tiles.openfreemap.org/styles/positron',
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    requiresKey: false,
    region: 'global',
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
  },
  {
    id: 'openfreemap-bright',
    name: 'Bright',
    type: 'vector',
    url: 'https://tiles.openfreemap.org/styles/bright',
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    requiresKey: false,
    region: 'global',
  },
  {
    id: 'openfreemap-dark',
    name: 'Dark',
    type: 'vector',
    url: 'https://tiles.openfreemap.org/styles/dark',
    attribution: '© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors',
    requiresKey: false,
    region: 'global',
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
