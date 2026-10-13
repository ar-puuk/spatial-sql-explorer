// Basemap selection + style loading (User Story 4, FR-009/FR-016/FR-017).
// Pure logic with an injectable fetch, so failure handling is unit-tested
// (tests/core/basemap.test.ts) without a browser or network.
import { BASEMAP_CATALOG, getDefaultBasemap, type BasemapCatalogEntry } from './basemapCatalog.js'
import { applyKey, findGalleryBasemap, toCatalogEntry } from './basemapGallery.js'

/** `'auto'` follows the host theme (FR-017); anything else is a catalog or gallery (`g-…`) id. */
export type BasemapChoice = 'auto' | string

/**
 * The entry for a choice. Gallery entries resolve here without a key (keyless,
 * or key-optional); one that needs a key resolves to the theme default, and the
 * store supplies the keyed entry itself (spec 010 T042).
 */
export function resolveBasemap(choice: BasemapChoice, appearance: 'light' | 'dark'): BasemapCatalogEntry {
  if (choice === 'auto') return getDefaultBasemap(appearance)
  const featured = BASEMAP_CATALOG.find((e) => e.id === choice)
  if (featured) return featured
  const g = findGalleryBasemap(choice)
  const resolved = g ? applyKey(g, null) : null
  if (g && resolved && !('needsKey' in resolved)) return toCatalogEntry(g, resolved)
  return getDefaultBasemap(appearance)
}

/** A loaded MapLibre style document (style spec v8), kept opaque here. */
export interface BasemapStyle {
  version: 8
  sources: Record<string, unknown>
  layers: Array<{ id: string; type: string; [k: string]: unknown }>
  [k: string]: unknown
}

export type BasemapLoadResult =
  | { ok: true; entry: BasemapCatalogEntry; style: BasemapStyle | null }
  | { ok: false; entry: BasemapCatalogEntry; message: string }

export const BASEMAP_TIMEOUT_MS = 8000

/** The FR-016 message: short, visible, and says what the user now sees. */
export function basemapFailureMessage(entry: BasemapCatalogEntry, reason: string): string {
  // Spec 010: with a key in the URL, a wrong key is the likely cause.
  if (entry.keyed) return `${entry.name} basemap unavailable (check the ${entry.providerName ?? entry.provider ?? ''} API key). Showing a blank background.`
  return `${entry.name} basemap unavailable (${reason}). Showing a blank background.`
}

/**
 * Fetches a vector basemap's style document. Never throws: offline, blocked
 * (CSP), slow, missing or malformed styles all become `{ ok: false }` with
 * a short message, and the caller falls back to blank (FR-016). The data
 * layer never depends on this succeeding.
 */
export async function loadBasemapStyle(
  entry: BasemapCatalogEntry,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = BASEMAP_TIMEOUT_MS
): Promise<BasemapLoadResult> {
  if (entry.type === 'blank') return { ok: true, entry, style: null }
  if (entry.type === 'raster') return { ok: true, entry, style: rasterStyle(entry) }
  if (entry.type !== 'vector') return { ok: false, entry, message: basemapFailureMessage(entry, 'unsupported basemap type') }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response: Response
    try {
      response = await fetchImpl(entry.url, { signal: controller.signal })
    } catch {
      return { ok: false, entry, message: basemapFailureMessage(entry, controller.signal.aborted ? 'timed out' : 'offline or blocked') }
    }
    if (!response.ok) return { ok: false, entry, message: basemapFailureMessage(entry, `HTTP ${response.status}`) }
    let json: unknown
    try {
      json = await response.json()
    } catch {
      return { ok: false, entry, message: basemapFailureMessage(entry, 'invalid style') }
    }
    const style = json as Partial<BasemapStyle>
    if (style?.version !== 8 || typeof style.sources !== 'object' || !Array.isArray(style.layers)) {
      return { ok: false, entry, message: basemapFailureMessage(entry, 'invalid style') }
    }
    // Spec 010: Mapbox styles name their sprites, fonts and tilesets as mapbox:// URLs.
    const token = entry.provider === 'mapbox' ? new URL(entry.url).searchParams.get('access_token') : null
    return { ok: true, entry, style: token ? transformMapboxStyle(style as BasemapStyle, token) : (style as BasemapStyle) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A raster row's style, built here: there is no style document to fetch.
 * `{s}` expands to one URL per subdomain (MapLibre spreads requests across
 * them); `{r}` (retina) is dropped. Tile failures are caught by
 * BasemapHealth like any other source.
 */
export function rasterStyle(entry: BasemapCatalogEntry): BasemapStyle {
  const template = entry.url.replace('{r}', '')
  const tiles = entry.tiles ?? (template.includes('{s}') ? (entry.subdomains ?? ['a']).map((s) => template.replace('{s}', s)) : [template])
  return {
    version: 8,
    sources: {
      'basemap-raster': {
        type: 'raster',
        tiles,
        tileSize: entry.tileSize ?? 256,
        maxzoom: entry.maxzoom ?? 19,
        attribution: entry.attribution,
        ...(entry.scheme ? { scheme: entry.scheme } : {}),
      },
    },
    // No cross-fade: on the globe, fading tiles draw their stretched borders
    // past the limb while spinning (spec 008, user report: green patches in space).
    layers: [{ id: 'basemap-raster', type: 'raster', source: 'basemap-raster', paint: { 'raster-fade-duration': 0 } }],
  }
}

/**
 * Tile-level failure detection after a style loaded: the style document can
 * arrive while its tiles are blocked (CSP connect-src, a captive portal).
 * Falls back once enough tile/sprite/glyph requests have failed with none
 * succeeding, so a single flaky tile never blanks a working basemap.
 */
export class BasemapHealth {
  private failures = 0
  private successes = 0
  constructor(private readonly threshold = 4) {}
  recordSuccess(): void {
    this.successes++
  }
  /** Returns true when the basemap should be abandoned. */
  recordFailure(): boolean {
    this.failures++
    return this.successes === 0 && this.failures >= this.threshold
  }
  /**
   * Spec 008: the map settled (idle) with failed tiles and none loaded. A
   * small view may need fewer tiles than the threshold (a raster basemap over
   * a city is one or two tiles), so this ends the wait too.
   */
  settledWithoutTiles(): boolean {
    return this.successes === 0 && this.failures > 0
  }
}



// Adapted from maplibre-gl-basemap-control (MIT, © 2026 Qiusheng Wu), BasemapControl._transformMapboxStyle.
/** A Mapbox style with its mapbox:// sprite, font and tileset URLs turned into API URLs that carry the token. */
export function transformMapboxStyle(style: BasemapStyle, accessToken: string): BasemapStyle {
  const token = encodeURIComponent(accessToken)
  const resolve = (url: string): string => {
    const sprite = /^mapbox:\/\/sprites\/([^/]+)\/(.+)$/.exec(url)
    if (sprite) return `https://api.mapbox.com/styles/v1/${sprite[1]}/${sprite[2]}/sprite?access_token=${token}`
    const font = /^mapbox:\/\/fonts\/([^/]+)\/(.+)$/.exec(url)
    if (font) return `https://api.mapbox.com/fonts/v1/${font[1]}/${font[2]}?access_token=${token}`
    if (url.startsWith('mapbox://')) return `https://api.mapbox.com/v4/${url.slice('mapbox://'.length)}.json?secure&access_token=${token}`
    return url
  }
  const sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, source]) => {
      const s = source as { url?: unknown }
      return [id, typeof s.url === 'string' ? { ...s, url: resolve(s.url) } : source]
    })
  )
  const sprite = style.sprite
  return {
    ...style,
    sources,
    ...(typeof style.glyphs === 'string' ? { glyphs: resolve(style.glyphs) } : {}),
    ...(typeof sprite === 'string'
      ? { sprite: resolve(sprite) }
      : Array.isArray(sprite)
        ? { sprite: sprite.map((s: { id: string; url: string }) => ({ ...s, url: resolve(s.url) })) }
        : {}),
  }
}
