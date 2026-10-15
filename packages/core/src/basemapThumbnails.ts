// Spec 012: basemap previews. Keyless vector styles have a thumbnail rendered
// once by scripts/basemap-thumbnails.mjs and bundled (basemapThumbnails.json,
// loaded on first use, not at startup); raster rows load one live tile of the
// same place, since their imagery isn't ours to ship. Every preview frames
// GeoLibre's preview center (8°E, 47°N: Zurich and its lake) at city scale.
import type { BasemapCatalogEntry } from './basemapCatalog.js'

/** Where every preview looks: kept in step with scripts/basemap-thumbnails.mjs. */
export const BASEMAP_PREVIEW_VIEW = Object.freeze({ center: [8.54, 47.37] as const, zoom: 10 })

let loading: Promise<Record<string, string>> | null = null

/** The bundled thumbnails (id → data URI), by featured id or gallery id. Loaded once, on first call. */
export function loadBasemapThumbnails(): Promise<Record<string, string>> {
  loading ??= import('./basemapThumbnails.json').then((m) => (m.default ?? m).thumbnails as Record<string, string>).catch(() => ({}))
  return loading
}

/** A raster tile of the preview place, and where the place sits in it (fractions across and down). */
export interface PreviewTile {
  src: string
  /** 0–1: the preview center's position in the tile, for `object-position`. */
  x: number
  y: number
}

/**
 * One raster tile showing the preview place at the thumbnails' scale: a
 * 256 px tile two zooms past the vector view (MapLibre's zoom counts 512 px
 * tiles, and the tile shows at half size on a 2x screen), capped at the
 * provider's own maxzoom. `{s}` takes the first subdomain; TMS rows count
 * rows from the bottom.
 */
export function basemapPreviewTile(template: string, options: { scheme?: 'xyz' | 'tms'; maxzoom?: number; subdomains?: string[] } = {}): PreviewTile {
  const z = Math.min(BASEMAP_PREVIEW_VIEW.zoom + 2, options.maxzoom ?? 22)
  const n = 2 ** z
  const [lon, lat] = BASEMAP_PREVIEW_VIEW.center
  const fx = ((lon + 180) / 360) * n
  const rad = (lat * Math.PI) / 180
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  const [x, y] = [Math.floor(fx), Math.floor(fy)]
  const src = template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(options.scheme === 'tms' ? n - 1 - y : y))
    .replace('{s}', options.subdomains?.[0] ?? 'a')
    .replace('{r}', '')
  return { src, x: fx - x, y: fy - y }
}

/** A featured catalog row's live preview tile (raster rows only). */
export function catalogPreviewTile(entry: BasemapCatalogEntry): PreviewTile | null {
  return entry.type === 'raster' ? basemapPreviewTile(entry.url, { maxzoom: entry.maxzoom, subdomains: entry.subdomains }) : null
}
