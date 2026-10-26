// Spec 026: a GeoTIFF that is not stored in tiles is made into a COG in memory with geolibre-wasm's CogBuilder, so the
// tiler can read it in parts. Under a sample limit (core convert.ts); the whole file is read here, which is why the
// limit exists and why it is checked from the header first. The window is busy while it works (the wasm runs on the
// main thread; measured 17 s for 100 million cells): the note says so, and a worker is a later improvement.
// Adapted from GeoLibre (MIT): packages/processing/src/cog-convert.ts (the builder calls; GeoLibre's overview list
// is not used: it is wrong, see research.md §4b).
import { RasterOpenError, convertVerdict, overviewSteps, tooLargeToConvert, type EngineSource, type FileSource } from '@spatial-explorer/core'
import { getConverterEngine } from './engine.js'

/** What the header of a striped file says (read with geotiff.js before anything is converted). */
export interface StripedHeader {
  width: number
  height: number
  bands: number
  /** 8 for the sample types that stay 8 bit, else the converted file is 32-bit floating point. */
  bitsPerSample: number
  sampleFormat: number
  palette: boolean
}

export interface ConvertedCog {
  bytes: Uint8Array
  /** The sample type the original had ('uint8' stays; anything else became float32). */
  sourceType: string
  hadPalette: boolean
}

const typeName = (bits: number, format: number): string => (format === 3 ? `float${bits}` : `${format === 2 ? 'int' : 'uint'}${bits}`)

/** Reads the file whole (a `File`'s bytes, or the loopback URL): bounded by the sample limit, so by a few hundred MB. */
async function readWhole(source: Exclude<FileSource, { kind: 'bytes' }>): Promise<Uint8Array> {
  if (source.kind === 'handle') return new Uint8Array(await (source.handle as Blob).arrayBuffer())
  const res = await fetch(source.url)
  if (!res.ok) throw new RasterOpenError('unreadable', `${source.name} could not be read (HTTP ${res.status}).`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function convertToCog(
  source: Exclude<FileSource, { kind: 'bytes' }>,
  header: StripedHeader,
  engineSource: EngineSource,
  hooks: { signal?: AbortSignal; note?: (text: string) => void } = {},
): Promise<ConvertedCog> {
  const verdict = convertVerdict(header.width, header.height, header.bands)
  if (verdict.kind === 'refuse') throw tooLargeToConvert(source.name, verdict.samples)
  const million = (verdict.samples / 1e6).toFixed(verdict.samples >= 10e6 ? 0 : 1)
  hooks.note?.('Loading the GeoTIFF converter (the first time only)…')
  const { GeoTiffReader, CogBuilder } = await getConverterEngine(engineSource)
  hooks.signal?.throwIfAborted()
  hooks.note?.(`Reading ${source.name}…`)
  const bytes = await readWhole(source)
  hooks.signal?.throwIfAborted()
  hooks.note?.(`Preparing ${million} million cells as a COG${verdict.large ? ' (large: the window may pause, and it needs a gigabyte or more of memory)' : ''}…`)
  // Let the note paint: the wasm below holds the main thread.
  await new Promise((resolve) => setTimeout(resolve, 50))
  const reader = new GeoTiffReader(bytes)
  try {
    const { width, height, bands } = reader
    const builder = new CogBuilder(width, height, bands)
    try {
      const epsg = reader.epsg
      if (typeof epsg === 'number' && Number.isFinite(epsg)) builder.set_epsg(epsg)
      const geoTransform = reader.geo_transform()
      if (geoTransform.length >= 6) builder.set_geo_transform(geoTransform)
      const nodata = reader.nodata
      if (typeof nodata === 'number' && Number.isFinite(nodata)) builder.set_nodata(nodata)
      builder.set_tile_size(512)
      builder.set_compression('deflate')
      // A chain of reductions, not absolute factors (core convert.ts).
      builder.set_overview_levels(new Uint32Array(overviewSteps(width, height)))
      // read_all_f64 decodes any sample type to one; then narrowed to what the COG holds (8 bit stays 8 bit).
      const pixels = reader.read_all_f64()
      const keepsBytes = header.sampleFormat === 1 && header.bitsPerSample <= 8
      const cog = keepsBytes ? builder.write_u8(Uint8Array.from(pixels)) : builder.write_f32(Float32Array.from(pixels))
      return { bytes: cog, sourceType: typeName(header.bitsPerSample, header.sampleFormat), hadPalette: header.palette }
    } finally {
      builder.free()
    }
  } finally {
    reader.free()
  }
}
