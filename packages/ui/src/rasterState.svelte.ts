// Spec 026: the raster half of the viewer store (kept apart so viewerStore.svelte.ts, already very large,
// only composes it). One raster at a time; it is the open layer, so installing one and clearing it go with
// the store's own layer changes.
import { defaultRasterStyle, sameRender, sanitizeRasterStyle, toRenderOptions, type PixelReading, type RasterStyle } from '@spatial-explorer/core'
import type { RasterHandle } from './raster/handle.js'
import { rasterTileProvider } from './raster/rasterSource.js'
import { registerRasterProvider } from './raster/rasterTiles.js'

export function createRasterState() {
  let handle = $state.raw<RasterHandle | null>(null)
  let style = $state.raw<RasterStyle | null>(null)
  /** Bumped when the picture changes (not for opacity): it is in the tile URL, so the map fetches again. */
  let version = $state(0)
  let pixel = $state.raw<PixelReading | null>(null)
  let cardOpen = $state(false)
  let unregister: (() => void) | null = null

  return {
    get handle() {
      return handle
    },
    get style() {
      return style
    },
    get version() {
      return version
    },
    get pixel() {
      return pixel
    },
    get cardOpen() {
      return cardOpen
    },
    /** A raster became the open layer, with the style it starts with (a sidecar's, saved, or the file's default). */
    install(next: RasterHandle, start?: RasterStyle | null): void {
      unregister?.()
      handle?.dispose()
      handle = next
      style = start ? (sanitizeRasterStyle(start, next.facts) ?? defaultRasterStyle(next.facts)) : defaultRasterStyle(next.facts)
      version++
      pixel = null
      // Tiles are drawn with the style in force when MapLibre asks for them.
      unregister = registerRasterProvider(next.key, rasterTileProvider(next, () => toRenderOptions(style ?? defaultRasterStyle(next.facts), next.facts)))
    },
    /** The raster is no longer the open layer. */
    clear(): void {
      unregister?.()
      unregister = null
      handle?.dispose()
      handle = null
      style = null
      pixel = null
      cardOpen = false
    },
    /** Changes the style; the result is made safe for this file. Returns true when the picture (not just opacity) changed. */
    setStyle(patch: Partial<RasterStyle>): boolean {
      if (!handle || !style) return false
      const next = sanitizeRasterStyle({ ...style, ...patch }, handle.facts)
      if (!next) return false
      const redraw = !sameRender(style, next, handle.facts)
      style = next
      if (redraw) version++
      return redraw
    },
    setPixel(next: PixelReading | null): void {
      pixel = next
    },
    setCardOpen(open: boolean): void {
      cardOpen = open
    },
  }
}

export type RasterState = ReturnType<typeof createRasterState>
