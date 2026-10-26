// Spec 026: opening a GeoTIFF or COG as the raster layer. Reads the file's header (geotiff.js, a few small range
// reads), opens it with the tiler (cog-tiler-wasm) by byte ranges (a File's slices on the web, the loopback range URL
// in VS Code), reads statistics from a level of the file itself, and returns the handle the store and the map use.
// Adapted from GeoLibre (MIT): packages/map/src/cog-imagery.ts (opening a COG once and keeping the source).
import { RasterOpenError, convertedNote, describeRasterError, encodePng, factsFromTiler, statsMaxSize, transparentTilePng, type EngineSource, type FileSource, type GeoHeader, type RasterRenderOptions, type TilerBandStats, type TilerInfo, type TilerLevel } from '@spatial-explorer/core'
import { convertToCog, type StripedHeader } from './convert.js'
import { getRasterEngine } from './engine.js'
import type { RasterHandle, RasterReader } from './handle.js'
import type { RasterTileProvider } from './rasterTiles.js'

export type RasterPhase = 'engine' | 'reading' | 'converting'

export interface OpenRasterHooks {
  onPhase?: (phase: RasterPhase) => void
  /** What a long step is doing, in words (the open progress shows it). */
  onNote?: (text: string) => void
  signal?: AbortSignal
}

export interface OpenedRaster {
  handle: RasterHandle
  styleSidecar: FileSource['styleSidecar']
}

let nextKey = 0

/**
 * The file's own header: the GeoKeys, the extent in its system and the pixel size. A file with no georeferencing is
 * refused here with a plain message, before the tiler (which would only say it is not tiled) is asked.
 */
interface RasterHeader extends GeoHeader {
  /** Stored in tiles (a COG is). A striped file is converted before the tiler is asked to read it. */
  tiled: boolean
  striped: StripedHeader
}

async function readHeader(input: string | Blob, source: FileSource): Promise<RasterHeader> {
  let image
  try {
    // Lazy: geotiff.js is only needed when a raster is opened.
    const { fromBlob, fromUrl } = await import('geotiff')
    const tiff = typeof input === 'string' ? await fromUrl(input, { allowFullFile: false }) : await fromBlob(input)
    image = await tiff.getImage(0)
  } catch (e) {
    throw describeRasterError(e, source.name)
  }
  const geoKeys = ((image.getGeoKeys() as Record<string, unknown> | null) ?? {}) as Record<string, unknown>
  // `getOrigin` throws exactly when the file has no affine transformation (no tie points, no model transformation).
  // (The tags themselves are deferred in geotiff.js 3: `fileDirectory.ModelTiepoint` reads as nothing.)
  try {
    image.getOrigin()
  } catch {
    if (source.sidecars.some((s) => /\.(tfw|wld)$/i.test(s.name))) {
      throw new RasterOpenError('world-file', `${source.name} is placed by a world file (.tfw), which Spatial Explorer does not read yet. Save it as a GeoTIFF with the coordinates inside (gdal_translate) to open it.`)
    }
    throw new RasterOpenError('not-georeferenced', `${source.name} has no georeferencing, so it cannot be placed on the map.`)
  }
  if (Object.keys(geoKeys).length === 0) {
    throw new RasterOpenError('no-crs', `${source.name} records no coordinate system, so it cannot be placed on the map. Give it one (gdal_edit -a_srs EPSG:xxxx) and open it again.`)
  }
  let bbox: number[] | null = null
  let resolution: number[] | null = null
  try {
    bbox = image.getBoundingBox()
    resolution = image.getResolution()
  } catch {
    // A rotated or sheared grid has no plain bounding box: the tiler's WGS84 bounds are used.
  }
  let palette = false
  try {
    palette = (await (image.fileDirectory as unknown as { loadValue(tag: string): Promise<unknown> }).loadValue('PhotometricInterpretation')) === 3
  } catch {
    // Not recorded: no colour table.
  }
  const striped: StripedHeader = { width: image.getWidth(), height: image.getHeight(), bands: image.getSamplesPerPixel(), bitsPerSample: image.getBitsPerSample(0), sampleFormat: image.getSampleFormat(0), palette }
  return { geoKeys, bbox, resolution, tiled: image.isTiled, striped }
}

/**
 * Opens a raster. The source must be readable in parts (`handle` or `url`); a whole-file `bytes` source is
 * refused, because a raster can be many gigabytes and the reader asks only for what it draws.
 */
export async function openRaster(source: FileSource, engineSource: EngineSource = {}, hooks: OpenRasterHooks = {}): Promise<OpenedRaster> {
  if (source.kind === 'bytes') {
    throw new RasterOpenError('rangeless', `${source.name} cannot be read in parts here, and a raster is too large to read whole.`)
  }
  hooks.onPhase?.('engine')
  const engine = await getRasterEngine(engineSource)
  hooks.signal?.throwIfAborted()
  hooks.onPhase?.('reading')
  const input: string | Blob = source.kind === 'handle' ? (source.handle as Blob) : source.url
  const header = await readHeader(input, source)
  hooks.signal?.throwIfAborted()

  let cog
  let origin: 'file' | 'converted' = 'file'
  const warnings: string[] = []
  if (!header.tiled) {
    // A striped GeoTIFF cannot be read in parts (the tiler would read all of it just to refuse it): decided from the
    // header, converted in memory when it is small enough, else a plain message.
    hooks.onPhase?.('converting')
    const converted = await convertToCog(source, header.striped, engineSource, { signal: hooks.signal, note: hooks.onNote })
    hooks.signal?.throwIfAborted()
    try {
      cog = await engine.openCog(converted.bytes)
    } catch (e) {
      throw describeRasterError(e, source.name)
    }
    origin = 'converted'
    warnings.push(convertedNote(converted.sourceType, converted.hadPalette))
  } else {
    try {
      cog = await engine.openCog(input)
    } catch (e) {
      throw describeRasterError(e, source.name)
    }
  }
  hooks.signal?.throwIfAborted()

  const info = cog.info() as unknown as TilerInfo
  const levels = cog.levels as unknown as TilerLevel[]
  let stats: Record<string, TilerBandStats> | null = null
  try {
    stats = (await cog.statistics({ maxSize: statsMaxSize(levels) })) as unknown as Record<string, TilerBandStats>
  } catch {
    // A big file with no overviews has no level to estimate from; the card says so (facts) and the style starts from the type's range.
    if (levels.length > 1) warnings.push('The range of values could not be estimated from the file.')
  }
  const facts = factsFromTiler({ info, levels, mode: cog.mode, hasPalette: cog.hasPalette, header, stats, origin, warnings })

  const reader: RasterReader = {
    renderTileRGBA: (z, x, y, options) => cog.renderTileRGBA(z, x, y, options),
    point: (lon, lat, options) => cog.point(lon, lat, options),
    statistics: (options) => cog.statistics(options) as unknown as Promise<Record<string, TilerBandStats>>,
  }
  const handle: RasterHandle = {
    key: `raster-${++nextKey}`,
    facts,
    reader,
    dispose() {
      // The tiler holds nothing that needs freeing from here: its references go with the handle.
    },
  }
  return { handle, styleSidecar: source.styleSidecar }
}

/** A tile provider for the map: renders with the options in force when the tile is asked for, encodes PNG. */
export function rasterTileProvider(handle: RasterHandle, options: () => RasterRenderOptions): RasterTileProvider {
  return async (z, x, y) => {
    const rgba = await handle.reader.renderTileRGBA(z, x, y, options())
    if (!rgba) return transparentTilePng()
    const side = Math.round(Math.sqrt(rgba.length / 4))
    if (side * side * 4 !== rgba.length) return transparentTilePng()
    return encodePng(rgba, side, side)
  }
}
