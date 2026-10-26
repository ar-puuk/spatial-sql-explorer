// Spec 026: what the interface holds for an open raster. `RasterReader` is the part of cog-tiler-wasm's
// `CogSource` the app uses, written as a structural type so the store, the map and tests do not need the
// wasm (and so the tiler package stays a lazy import, see engine.ts).
import type { RasterFacts, TilerBandStats } from '@spatial-explorer/core'
import type { RasterRenderOptions } from '@spatial-explorer/core'

export interface RasterReader {
  /** A 256 x 256 RGBA tile (null: nothing there). */
  renderTileRGBA(z: number, x: number, y: number, options?: RasterRenderOptions): Promise<Uint8Array | Uint8ClampedArray | null>
  /** The value of each band at a WGS84 place. */
  point(lon: number, lat: number, options?: { bidx?: number[] }): Promise<{ coordinates: [number, number]; values: number[]; band_names: string[]; outside?: boolean }>
  /** Per-band statistics from the coarsest level that is at most `maxSize` wide. */
  statistics(options?: { maxSize?: number }): Promise<Record<string, TilerBandStats>>
}

/** An opened raster: the file's facts, the reader, and how to let go of it. */
export interface RasterHandle {
  /** Names the tile provider (`se-raster://<key>/...`). */
  key: string
  facts: RasterFacts
  reader: RasterReader
  /** Frees the reader (and the converted COG's bytes). Safe to call twice. */
  dispose(): void
}
