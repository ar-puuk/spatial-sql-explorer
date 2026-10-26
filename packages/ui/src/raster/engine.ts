// Spec 026 (constitution IV and v1.2.0): the raster engine is downloaded, not bundled. core fetches the two wasm
// files from their pinned URLs and checks them against the recorded SHA-256 (or reads the shell's local copy);
// this module gives those bytes to the packages' own init functions, which makes the packages' default
// `new URL('...wasm', import.meta.url)` (replaced by an error in the build, scripts/viteNoBundledWasm.mjs) dead code.
// The packages are imported lazily: opening a vector file never loads them.
import { loadConverterBytes, loadRasterEngineBytes, type EngineSource } from '@spatial-explorer/core'
import type { CogSource } from 'cog-tiler-wasm'

export interface RasterEngine {
  /** Opens a COG from a URL (HTTP ranges), a `File`/`Blob` (slices) or bytes. */
  openCog(source: string | File | Blob | Uint8Array | ArrayBuffer): Promise<CogSource>
}

let engine: Promise<RasterEngine> | null = null

/** The raster engine, loaded once (and again after a failed attempt, so a lost connection can be retried). */
export function getRasterEngine(source: EngineSource = {}): Promise<RasterEngine> {
  if (!engine) {
    const attempt = (async (): Promise<RasterEngine> => {
      const bytes = await loadRasterEngineBytes(source)
      const [whitebox, tiler, cog] = await Promise.all([import('whitebox-wasm'), import('cog-tiler-wasm/wasm'), import('cog-tiler-wasm')])
      // wasm-bindgen inits are idempotent: the package's own init() after these does nothing.
      await whitebox.default({ module_or_path: bytes.whitebox })
      await tiler.default({ module_or_path: bytes.cogTiler })
      await cog.init()
      return { openCog: cog.openCog }
    })()
    engine = attempt
    attempt.catch(() => {
      if (engine === attempt) engine = null
    })
  }
  return engine
}

export interface ConverterEngine {
  GeoTiffReader: typeof import('geolibre-wasm').GeoTiffReader
  CogBuilder: typeof import('geolibre-wasm').CogBuilder
}

let converter: Promise<ConverterEngine> | null = null

/** The striped-GeoTIFF converter (6.7 MB), loaded only when such a file is opened. */
export function getConverterEngine(source: EngineSource = {}): Promise<ConverterEngine> {
  if (!converter) {
    const attempt = (async (): Promise<ConverterEngine> => {
      const bytes = await loadConverterBytes(source)
      const mod = await import('geolibre-wasm')
      await mod.default({ module_or_path: bytes })
      return { GeoTiffReader: mod.GeoTiffReader, CogBuilder: mod.CogBuilder }
    })()
    converter = attempt
    attempt.catch(() => {
      if (converter === attempt) converter = null
    })
  }
  return converter
}
