// Spec 026: what the interface holds for an open raster. `RasterReader` is what the app asks of the raster worker (which owns
// the tiler, see tilerWorker.ts), so the store, the map and tests never touch the wasm.
import type { RasterFacts, RasterRenderOptions, TilerBandStats } from '@spatial-explorer/core'
import type { AreaStatsAnswer } from './tilerProtocol.js'

export interface RasterReader {
  /** A 256 x 256 PNG tile, made in the raster worker (a transparent one when nothing is there). */
  renderTilePng(z: number, x: number, y: number, options: RasterRenderOptions): Promise<Uint8Array>
  /** The value of each band at a WGS84 place. */
  point(lon: number, lat: number): Promise<{ coordinates: [number, number]; values: number[]; band_names: string[]; outside?: boolean }>
  /** Spec 027: the value of each of `bands` at each place (lon, lat pairs), NaN where off the raster. */
  profile(points: Float64Array, bands: number[]): Promise<Float64Array>
  /** Spec 027: the figures of each of `bands` over the cells inside the ring (lon, lat pairs). */
  areaStats(ring: Float64Array, bands: Array<{ index: number; name: string }>): Promise<AreaStatsAnswer>
  /** Spec 027: a PNG tile of the values of `band` packed as `base + n * step` (24 bits in red, green, blue), for the hillshade. */
  demTilePng(z: number, x: number, y: number, band: number, base: number, step: number, fill: number, nodata?: number | null): Promise<Uint8Array>
  /** Per-band statistics from the level the tiler picks for `maxSize`. */
  statistics(maxSize: number): Promise<Record<string, TilerBandStats>>
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
