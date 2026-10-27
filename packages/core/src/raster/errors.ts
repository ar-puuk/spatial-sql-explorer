// Spec 026: what the raster reader says, in plain words. The tiler and the TIFF reader throw developer messages;
// the person is told what is wrong with their file and what to do. The matchers are pinned to cog-tiler-wasm
// 0.5.0 by tests/core/raster-errors.test.ts (real messages), so an upgrade that rewords them fails loudly.

export type RasterErrorCode = 'not-tiled' | 'no-overviews' | 'not-georeferenced' | 'world-file' | 'no-crs' | 'compression' | 'unreadable' | 'too-large-to-convert' | 'rangeless'

export class RasterOpenError extends Error {
  constructor(
    readonly code: RasterErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'RasterOpenError'
  }
}

/** The "striped, not tiled" failure of the tiler: the file is a plain GeoTIFF the browser can convert (GeoLibre does the same). */
export const isNotTiledMessage = (message: string): boolean => /not tiled/i.test(message)
/** A tiled file with no reduced-resolution levels that is too big to draw zoomed out. */
export const isNoOverviewsMessage = (message: string): boolean => /no overviews/i.test(message)

export function describeRasterError(error: unknown, fileName = 'This file'): RasterOpenError {
  if (error instanceof RasterOpenError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (isNotTiledMessage(message)) return new RasterOpenError('not-tiled', `${fileName} is a GeoTIFF that is not stored in tiles, which cannot be read in parts.`)
  if (isNoOverviewsMessage(message)) {
    return new RasterOpenError('no-overviews', `${fileName} has no overviews, so it can only be drawn zoomed in. Add overviews (gdaladdo, or gdal_translate -of COG) to see all of it at once.`)
  }
  const compression = /unsupported (?:tiff )?compression[^:]*:?\s*(.*)/i.exec(message)
  if (compression) return new RasterOpenError('compression', `${fileName} uses a compression Spatial Explorer cannot read${compression[1] ? ` (${compression[1].trim()})` : ''}.`)
  return new RasterOpenError('unreadable', `${fileName} could not be read as a GeoTIFF: ${message.replace(/^(?:header|Error):\s*/i, '').trim()}`)
}
