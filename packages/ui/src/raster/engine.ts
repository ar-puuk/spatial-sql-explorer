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

/** The tiler's colour mapper, once the engine is up (the colour bar and the colormap previews sample it). */
type Colorize = (pixels: Float64Array, width: number, height: number, min: number, max: number, colormap: string, nodata: number | null | undefined, nodataAlpha: boolean, stretch: string, gamma: number, reversed: boolean, opacity: number) => Uint8Array
let colorize: Colorize | null = null

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
      colorize = tiler.colorize as Colorize
      return { openCog: cog.openCog }
    })()
    engine = attempt
    attempt.catch(() => {
      if (engine === attempt) engine = null
    })
  }
  return engine
}

const sampled = new Map<string, string[]>()
const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

/**
 * The colors of a colormap from low to high as `#rrggbb`, `steps` of them, taken from the tiler itself so a preview, the
 * color bar and the map all show the same thing. Null until the engine is up (a raster is open when this matters).
 */
export function colormapColors(name: string, steps = 16, reversed = false): string[] | null {
  if (!colorize) return null
  const key = `${name}/${steps}/${reversed}`
  const hit = sampled.get(key)
  if (hit) return hit
  const values = new Float64Array(steps)
  for (let i = 0; i < steps; i++) values[i] = steps === 1 ? 0 : i / (steps - 1)
  let rgba: Uint8Array
  try {
    rgba = colorize(values, steps, 1, 0, 1, name, null, false, 'linear', 1, reversed, 1)
  } catch {
    return null
  }
  const colors: string[] = []
  for (let i = 0; i < steps; i++) colors.push(`#${hex2(rgba[i * 4])}${hex2(rgba[i * 4 + 1])}${hex2(rgba[i * 4 + 2])}`)
  sampled.set(key, colors)
  return colors
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
