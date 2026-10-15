// Spec 014: terrain, on or off. A height source (a DEM), not a second basemap: MapLibre lifts the one basemap
// and our data onto it. Keyless Terrarium tiles (Mapzen / Tilezen, on AWS Open Data); the host list for a
// webview's CSP is TERRAIN_HOSTS (keep apps/vscode-ext/src/extension.ts in sync).

export const TERRAIN_SOURCE_ID = 'terrain-dem'
export const TERRAIN_HILLSHADE_ID = 'terrain-hillshade'

export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
/** Hosts the DEM tiles come from, for connect-src and img-src. */
export const TERRAIN_HOSTS = 'https://s3.amazonaws.com'
export const TERRAIN_MAX_ZOOM = 15
export const TERRAIN_ATTRIBUTION =
  'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen, Tilezen, USGS and others</a>'

/** The vertical exaggeration the user can set. */
export const TERRAIN_EXAGGERATION = { min: 0.5, max: 5, step: 0.1, default: 1 } as const

export function clampExaggeration(value: number): number {
  if (!Number.isFinite(value)) return TERRAIN_EXAGGERATION.default
  const clamped = Math.min(TERRAIN_EXAGGERATION.max, Math.max(TERRAIN_EXAGGERATION.min, value))
  // One decimal, as the slider steps.
  return Math.round(clamped * 10) / 10
}

/** A saved exaggeration, checked (anything odd falls back to the default). */
export function readExaggeration(saved: unknown): number {
  return typeof saved === 'number' ? clampExaggeration(saved) : TERRAIN_EXAGGERATION.default
}

/** The raster-dem source MapLibre is given. */
export function terrainSource(): Record<string, unknown> {
  return { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: TERRAIN_MAX_ZOOM, attribution: TERRAIN_ATTRIBUTION }
}

/** Shows a height in the unit people read it in: meters, with a thousands separator. */
export function formatElevation(meters: number): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(meters))} m`
}

/** The short message when the DEM tiles can't be loaded. */
export const TERRAIN_FAILURE_MESSAGE = 'Terrain could not be loaded (the elevation tiles are unreachable). Terrain is off.'

/**
 * What the shading has to work with. Imagery already carries its own light and shadow (a bright white highlight
 * over it looks glossy), a dark basemap turns a white highlight into glare, and everything else (light vector
 * styles, raster maps, blank) takes a soft highlight and a clear shadow.
 */
export type ReliefKind = 'imagery' | 'dark' | 'light'

const IMAGERY = /imagery|satellite|aerial|ortho|sentinel|landsat|maxar|worldview|blue.?marble|true.?color/i
const DARK = /dark|fiord|night|black|midnight/i

/** The relief kind for a basemap (by what it is called and where its tiles come from). */
export function reliefKindFor(entry: { id: string; name: string; type: string; url?: string; tiles?: string[]; defaultFor?: 'light' | 'dark' }): ReliefKind {
  const text = `${entry.id} ${entry.name} ${entry.url ?? ''} ${(entry.tiles ?? []).join(' ')}`
  if (entry.type === 'raster' && IMAGERY.test(text)) return 'imagery'
  if (entry.type === 'vector' && (entry.defaultFor === 'dark' || DARK.test(`${entry.id} ${entry.name}`))) return 'dark'
  return 'light'
}

/**
 * Paint properties for the hillshade layer. Imagery gets shadows only (no highlight), kept gentle; a dark basemap
 * a faint highlight; the rest a soft one. These are the relief's own colors, not theme chrome.
 */
export function hillshadePaint(kind: ReliefKind): Record<string, unknown> {
  switch (kind) {
    case 'imagery':
      return { 'hillshade-exaggeration': 0.22, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': 'rgba(255, 255, 255, 0)', 'hillshade-accent-color': '#000000' }
    case 'dark':
      return { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': 'rgba(255, 255, 255, 0.16)', 'hillshade-accent-color': '#000000' }
    default:
      return { 'hillshade-exaggeration': 0.38, 'hillshade-shadow-color': '#1f2933', 'hillshade-highlight-color': 'rgba(255, 255, 255, 0.45)', 'hillshade-accent-color': '#1f2933' }
  }
}
