// Spec 012: what each basemap's preview shows (basemapThumbnails.ts): the
// bundled thumbnail of a keyless vector style, one live tile of a raster
// row, Blank's color, or an honest "Needs key" tile. Thumbnails load on
// first use and are shared by the side panel and the gallery.
import { BASEMAP_CATALOG, basemapPreviewTile, catalogPreviewTile, loadBasemapThumbnails, type GalleryBasemap } from '@spatial-explorer/core'

export type BasemapPreview =
  | { kind: 'image'; src: string; x?: number; y?: number }
  | { kind: 'blank'; color: string | null }
  | { kind: 'key' }
  /** Not known yet (thumbnails loading) or nothing to show: a neutral tile. */
  | { kind: 'none' }

let thumbs = $state.raw<Record<string, string> | null>(null)
let started = false

/** The bundled thumbnails, once loaded (the first call starts the load). */
export function basemapThumbnails(): Record<string, string> | null {
  if (!started) {
    started = true
    void loadBasemapThumbnails().then((t) => (thumbs = t))
  }
  return thumbs
}

/** A featured row's preview (Blank: its color, or the map's own background when null). */
export function featuredPreview(id: string, blankColor: string | null = null): BasemapPreview {
  const entry = BASEMAP_CATALOG.find((e) => e.id === id)
  if (!entry) return { kind: 'none' }
  if (entry.type === 'blank') return { kind: 'blank', color: blankColor }
  const tile = catalogPreviewTile(entry)
  if (tile) return { kind: 'image', ...tile }
  const src = basemapThumbnails()?.[id]
  return src ? { kind: 'image', src } : { kind: 'none' }
}

/**
 * A gallery row's preview, without asking for anything: a featured row's own,
 * a bundled thumbnail, a keyless raster tile, or "Needs key". Keyed rows
 * with a stored key resolve their URLs through the store (null here).
 */
export function galleryPreview(g: GalleryBasemap, hasKey: boolean): BasemapPreview | null {
  if (g.featuredId) return featuredPreview(g.featuredId)
  if (g.key === 'required' && !hasKey) return { kind: 'key' }
  if (g.kind === 'vector') {
    if (g.key !== 'none') return null
    const src = basemapThumbnails()?.[g.id]
    return src ? { kind: 'image', src } : { kind: 'none' }
  }
  if (g.key === 'none' && g.tiles?.[0]) return { kind: 'image', ...basemapPreviewTile(g.tiles[0], { scheme: g.scheme, maxzoom: g.maxzoom }) }
  return null
}

/** A raster row's preview from its resolved tile URLs (keys applied). */
export function tilePreview(g: GalleryBasemap, tiles: readonly string[] | undefined): BasemapPreview {
  return tiles?.[0] ? { kind: 'image', ...basemapPreviewTile(tiles[0], { scheme: g.scheme, maxzoom: g.maxzoom }) } : { kind: 'none' }
}
