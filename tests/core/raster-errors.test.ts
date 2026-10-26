// Spec 026: the tiler's own messages (captured from cog-tiler-wasm 0.5.0 on the fixtures) become plain sentences.
// If an upgrade rewords them, the matchers stop matching and these fail.
import { describe, expect, it } from 'vitest'
import { RasterOpenError, describeRasterError, isNoOverviewsMessage, isNotTiledMessage, statsMaxSize } from '@spatial-explorer/core'

const STRIPED = 'header: Corrupt image data at layout: image is striped, not tiled; tile range streaming requires a tiled COG'
const NO_OVERVIEWS = 'window 40000x40000 on level 0 is too large to read (limit 16777216 samples); this raster has no overviews, so add them (gdaladdo, or convert to a COG) or read a smaller area'

describe('what the tiler says', () => {
  it('a striped file', () => {
    expect(isNotTiledMessage(STRIPED)).toBe(true)
    expect(isNotTiledMessage(NO_OVERVIEWS)).toBe(false)
    const e = describeRasterError(new Error(STRIPED), 'dem.tif')
    expect(e).toBeInstanceOf(RasterOpenError)
    expect(e.code).toBe('not-tiled')
    expect(e.message).toBe('dem.tif is a GeoTIFF that is not stored in tiles, which cannot be read in parts.')
  })

  it('no overviews on a big file', () => {
    expect(isNoOverviewsMessage(NO_OVERVIEWS)).toBe(true)
    const e = describeRasterError(new Error(NO_OVERVIEWS), 'big.tif')
    expect(e.code).toBe('no-overviews')
    expect(e.message).toMatch(/big\.tif has no overviews.*zoomed in.*gdal_translate -of COG/)
  })

  it('a compression it does not know', () => {
    const e = describeRasterError(new Error('Unsupported TIFF compression: 34712 (JPEG 2000)'), 'x.tif')
    expect(e.code).toBe('compression')
    expect(e.message).toMatch(/cannot read.*34712/)
  })

  it('anything else says it could not be read, without the developer prefix', () => {
    const e = describeRasterError(new Error('header: bad magic'), 'x.tif')
    expect(e.code).toBe('unreadable')
    expect(e.message).toBe('x.tif could not be read as a GeoTIFF: bad magic')
    expect(describeRasterError('plain string').message).toMatch(/could not be read as a GeoTIFF: plain string/)
  })

  it('an error we made ourselves passes through', () => {
    const mine = new RasterOpenError('not-georeferenced', 'no')
    expect(describeRasterError(mine)).toBe(mine)
  })
})

describe('the level statistics are read from', () => {
  const square = (n: number) => ({ width: n, height: n })

  it('the finest level of at most about a million cells', () => {
    expect(statsMaxSize([3000, 1500, 750, 375].map(square))).toBe(750) // 750 x 750 = 562,500
    expect(statsMaxSize([2595, 1298, 649, 325].map(square))).toBe(649)
  })

  it('not the 7 x 7 level of a converter ladder, whatever the order of the list', () => {
    // The order cog-tiler-wasm saw in a file GeoLibre's converter wrote.
    expect(statsMaxSize([7000, 7, 110, 875, 3500].map(square))).toBe(875)
  })

  it('a file with only big levels uses the coarsest; a tiny file its only level; no levels a default', () => {
    expect(statsMaxSize([20000, 10000].map(square))).toBe(10000)
    expect(statsMaxSize([200].map(square))).toBe(200)
    expect(statsMaxSize([])).toBe(512)
  })
})
