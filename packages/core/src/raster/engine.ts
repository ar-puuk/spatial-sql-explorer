// Spec 026 (constitution IV): the raster engine is downloaded, not bundled. The tiler needs two wasm files
// (whitebox_wasm_bg.wasm, 4.46 MB, and cog_tiler_wasm_bg.wasm, 133 KB), fetched when the first raster is
// opened; the converter (geolibre_wasm_bg.wasm, 6.7 MB) only for a striped GeoTIFF. Each is checked against
// the SHA-256 recorded by scripts/engine-assets.mjs before it is used, and kept by the host (engineFile).
// The bytes are handed to the packages' init functions in packages/ui/src/raster/engine.ts.
import { type EngineSource, loadRasterFile } from '../engineAssets.js'

export interface RasterEngineBytes {
  whitebox: ArrayBuffer
  cogTiler: ArrayBuffer
}

/** The two tiler wasm files, verified. */
export async function loadRasterEngineBytes(source: EngineSource = {}): Promise<RasterEngineBytes> {
  const [whitebox, cogTiler] = await Promise.all([loadRasterFile('whitebox', source), loadRasterFile('cogTiler', source)])
  return { whitebox, cogTiler }
}

/** The striped-GeoTIFF converter's wasm, verified. */
export function loadConverterBytes(source: EngineSource = {}): Promise<ArrayBuffer> {
  return loadRasterFile('converter', source)
}
