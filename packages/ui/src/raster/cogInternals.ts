// Spec 027: reading raw values (not colors) from an opened COG. `cog-tiler-wasm` 0.5.0 draws tiles and answers `point()`, but
// has no public call for "the values of this window", which area statistics and the elevation tiles need. Its source has
// the pieces (`_assembleWindow`, `_levelPixelSize`, `toSource`, `gt`, `levels`), and this file is the one place that uses them.
// The package is pinned to this exact version; `internalsOf` checks that every piece is there and says so plainly when it is
// not (an upgrade), and a test over the fixture fails first. See specs/027-raster-display-and-shapes/research.md.
import type { CogSource } from 'cog-tiler-wasm'

export interface CogInternals {
  /** Origin and pixel sizes of the full-size level: [x0, width, 0, y0, 0, -height], in the file's system. */
  gt: readonly number[]
  /** The width and height of each level, finest first. */
  levels: ReadonlyArray<{ width: number; height: number }>
  /** Web Mercator meters to the file's system. */
  forward(mercator: [number, number]): [number, number]
  /** One cell of a level in the file's units: [width, height]. */
  levelPixelSize(level: number): [number, number]
  /** The values of a window of a level, row-major, north-up, NaN where a tile is empty. `band` is 0-based. */
  window(level: number, x: number, y: number, w: number, h: number, band: number): Promise<ArrayLike<number>>
  /** The level whose cells are the coarsest still finer than `metersPerPixel` (the one a tile of that scale reads). */
  chooseLevel(metersPerPixel: number): number
  /** The file's nodata value, null when none. */
  nodata: number | null
}

interface Raw {
  gt?: unknown
  levels?: unknown
  toSource?: { forward?: unknown }
  nodata?: unknown
  _assembleWindow?: unknown
  _levelPixelSize?: unknown
  _chooseLevel?: unknown
}

export const UNSUPPORTED_TILER = 'This version of the raster reader cannot read the values of an area. Update Spatial Explorer.'

export function internalsOf(cog: CogSource): CogInternals {
  const c = cog as unknown as Raw
  const ok =
    Array.isArray(c.gt) &&
    c.gt.length >= 6 &&
    Array.isArray(c.levels) &&
    c.levels.length > 0 &&
    typeof c.toSource?.forward === 'function' &&
    typeof c._assembleWindow === 'function' &&
    typeof c._levelPixelSize === 'function' &&
    typeof c._chooseLevel === 'function'
  if (!ok) throw new Error(UNSUPPORTED_TILER)
  const self = cog as unknown as {
    gt: number[]
    levels: Array<{ width: number; height: number }>
    toSource: { forward(p: [number, number]): [number, number] }
    nodata?: number | null
    _assembleWindow(level: number, x: number, y: number, w: number, h: number, band: number): Promise<ArrayLike<number>>
    _levelPixelSize(level: number): [number, number]
    _chooseLevel(res: number): number
  }
  return {
    gt: self.gt,
    levels: self.levels,
    forward: (m) => self.toSource.forward(m),
    levelPixelSize: (l) => self._levelPixelSize(l),
    window: (l, x, y, w, h, band) => self._assembleWindow(l, x, y, w, h, band),
    chooseLevel: (r) => self._chooseLevel(r),
    nodata: typeof self.nodata === 'number' && !Number.isNaN(self.nodata) ? self.nodata : null,
  }
}

/** Web Mercator meters of a longitude and latitude (spherical, as the tiler's own 4326 to 3857). */
export function toMercator(lon: number, lat: number): [number, number] {
  const R = 6378137
  const clamped = Math.max(-85.0511287798, Math.min(85.0511287798, lat))
  return [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))]
}
