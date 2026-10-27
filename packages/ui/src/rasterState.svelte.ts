// Spec 026: the raster half of the viewer store (kept apart so viewerStore.svelte.ts, already very large,
// only composes it). One raster at a time; it is the open layer, so installing one and clearing it go with
// the store's own layer changes.
import { defaultRasterStyle, demEncodingFor, demFill, sameRender, sanitizeRasterStyle, toRenderOptions, type DemEncoding, type PixelReading, type RasterStyle } from '@spatial-explorer/core'
import type { RasterHandle } from './raster/handle.js'
import { rasterTileProvider } from './raster/rasterSource.js'
import { registerDemProvider, registerRasterProvider } from './raster/rasterTiles.js'

export function createRasterState() {
  let handle = $state.raw<RasterHandle | null>(null)
  let style = $state.raw<RasterStyle | null>(null)
  /** Bumped when the picture changes (not for opacity): it is in the tile URL, so the map fetches again. */
  let version = $state(0)
  let pixel = $state.raw<PixelReading | null>(null)
  /** Spec 027: goes up when what the relief tiles hold changes (the band, or what counts as no data); it is in their URL. */
  let demVersion = $state(0)
  let demSig = ''
  let unregisterDem: (() => void) | null = null
  const demSigOf = (s: RasterStyle): string => `${s.bands[0] ?? 1}/${s.nodata.mode}/${s.nodata.mode === 'value' ? s.nodata.value : ''}`
  /** The nodata the relief tiles use: undefined is the file's own. */
  const demNodata = (s: RasterStyle): number | null | undefined => (s.nodata.mode === 'value' ? s.nodata.value : s.nodata.mode === 'none' ? null : undefined)
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
    get demVersion() {
      return demVersion
    },
    /** How the relief tiles pack the values of the band being drawn. */
    get demEncoding(): DemEncoding | null {
      return handle && style ? demEncodingFor(handle.facts.bands[(style.bands[0] ?? 1) - 1], handle.facts.dataType) : null
    },
    get cardOpen() {
      return cardOpen
    },
    /** A raster became the open layer, with the style it starts with (a sidecar's, saved, or the file's default). */
    install(next: RasterHandle, start?: RasterStyle | null): void {
      unregister?.()
      unregisterDem?.()
      handle?.dispose()
      handle = next
      style = start ? (sanitizeRasterStyle(start, next.facts) ?? defaultRasterStyle(next.facts)) : defaultRasterStyle(next.facts)
      version++
      pixel = null
      // Tiles are drawn with the style in force when MapLibre asks for them.
      unregister = registerRasterProvider(next.key, rasterTileProvider(next, () => toRenderOptions(style ?? defaultRasterStyle(next.facts), next.facts)))
      demSig = demSigOf(style)
      demVersion++
      // The values of the band being drawn, packed for the hillshade (spec 027); read from the style in force when MapLibre asks.
      unregisterDem = registerDemProvider(next.key, (z, x, y) => {
        const st = style ?? defaultRasterStyle(next.facts)
        const band = next.facts.bands[(st.bands[0] ?? 1) - 1]
        const enc = demEncodingFor(band, next.facts.dataType)
        return next.reader.demTilePng(z, x, y, st.bands[0] ?? 1, enc.base, enc.step, demFill(band, enc), demNodata(st))
      })
    },
    /** The raster is no longer the open layer. */
    clear(): void {
      unregister?.()
      unregister = null
      unregisterDem?.()
      unregisterDem = null
      handle?.dispose()
      handle = null
      style = null
      pixel = null
      cardOpen = false
    },
    /** Changes the style; the result is made safe for this file. Returns true when the picture (not just opacity) changed. */
    setStyle(patch: Partial<RasterStyle>): boolean {
      if (!style) return false
      return this.replaceStyle({ ...style, ...patch })
    },
    /** Replaces the whole style (a key the new one does not have is gone, unlike a patch); made safe for this file. */
    replaceStyle(next: RasterStyle): boolean {
      if (!handle || !style) return false
      const safe = sanitizeRasterStyle(next, handle.facts)
      if (!safe) return false
      const redraw = !sameRender(style, safe, handle.facts)
      style = safe
      if (demSigOf(safe) !== demSig) {
        demSig = demSigOf(safe)
        demVersion++
      }
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
