// Spec 027 US2: a map tile of the raster's VALUES, for MapLibre's hillshade. `cog-tiler-wasm` draws colors; the hillshade layer
// wants numbers, in a raster-dem source: each pixel's value packed into red, green and blue (24 bits, `base + n * step`, which
// MapLibre unpacks with the "custom" encoding). The tile is made the way the tiler makes its colored one (a 16 x 16 grid of
// Web Mercator points mapped into the file's system and interpolated per pixel, the level whose cells are the coarsest still
// finer than a pixel, one window read), without the color step. Runs in the raster worker; uses cogInternals.ts.
import { encodePng } from '../../../core/src/raster/png.js'
import { DEM_TOP, type DemEncoding } from '../../../core/src/raster/relief.js'
import { internalsOf, type CogInternals } from './cogInternals.js'
import type { CogSource } from 'cog-tiler-wasm'

export const DEM_TILE_SIZE = 256
const GRID = 16
/** The tiler's own ceiling on one read. */
const MAX_WINDOW = 1 << 24
const HALF_WORLD = Math.PI * 6378137

/** The Web Mercator box of an XYZ tile. */
export function tileBounds3857(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * HALF_WORLD) / 2 ** z
  return [-HALF_WORLD + x * size, HALF_WORLD - (y + 1) * size, -HALF_WORLD + (x + 1) * size, HALF_WORLD - y * size]
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Interpolates a window at fractional cell coordinates; a void neighbor falls back to the cell itself, a void cell is NaN. */
function sample(buf: ArrayLike<number>, w: number, h: number, fc: number, fr: number, nodata: number | null): number {
  const c0 = Math.floor(fc)
  const r0 = Math.floor(fr)
  if (c0 < 0 || c0 >= w || r0 < 0 || r0 >= h) return NaN
  const c1 = Math.min(c0 + 1, w - 1)
  const r1 = Math.min(r0 + 1, h - 1)
  const isVoid = (v: number): boolean => Number.isNaN(v) || (nodata !== null && v === nodata)
  const v00 = buf[r0 * w + c0]
  if (isVoid(v00)) return NaN
  const v10 = buf[r0 * w + c1]
  const v01 = buf[r1 * w + c0]
  const v11 = buf[r1 * w + c1]
  if (isVoid(v10) || isVoid(v01) || isVoid(v11)) return v00
  const tx = fc - c0
  const ty = fr - r0
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty)
}

/**
 * The values of an XYZ tile of band `band` (1-based), `DEM_TILE_SIZE` square, NaN where the raster has no value. Null when the
 * tile is off the raster, or would need more cells than one read allows (a big file with no overviews, zoomed out).
 */
export async function valueTile(cog: CogSource, z: number, x: number, y: number, band: number, nodataOverride?: number | null): Promise<Float64Array | null> {
  const raster = internalsOf(cog)
  return valuesFor(raster, tileBounds3857(z, x, y), band - 1, nodataOverride === undefined ? raster.nodata : nodataOverride)
}

async function valuesFor(raster: CogInternals, merc: [number, number, number, number], band: number, nodata: number | null): Promise<Float64Array | null> {
  const [minx, miny, maxx, maxy] = merc
  const n = DEM_TILE_SIZE
  const nx = new Float64Array((GRID + 1) * (GRID + 1))
  const ny = new Float64Array((GRID + 1) * (GRID + 1))
  let sminx = Infinity
  let sminy = Infinity
  let smaxx = -Infinity
  let smaxy = -Infinity
  let any = false
  for (let gy = 0; gy <= GRID; gy++) {
    const my = maxy - (gy / GRID) * (maxy - miny)
    for (let gx = 0; gx <= GRID; gx++) {
      const mx = minx + (gx / GRID) * (maxx - minx)
      let s: [number, number]
      try {
        s = raster.forward([mx, my])
      } catch {
        s = [NaN, NaN]
      }
      const i = gy * (GRID + 1) + gx
      nx[i] = s[0]
      ny[i] = s[1]
      if (Number.isFinite(s[0]) && Number.isFinite(s[1])) {
        any = true
        sminx = Math.min(sminx, s[0])
        smaxx = Math.max(smaxx, s[0])
        sminy = Math.min(sminy, s[1])
        smaxy = Math.max(smaxy, s[1])
      }
    }
  }
  if (!any) return null
  const level = raster.chooseLevel((smaxx - sminx) / n)
  const lv = raster.levels[level]
  const [lpw, lph] = raster.levelPixelSize(level)
  const ox = raster.gt[0]
  const oy = raster.gt[3]
  const c0 = Math.max(0, Math.min(lv.width, Math.floor((sminx - ox) / lpw)))
  const c1 = Math.max(0, Math.min(lv.width, Math.ceil((smaxx - ox) / lpw)))
  const r0 = Math.max(0, Math.min(lv.height, Math.floor((oy - smaxy) / lph)))
  const r1 = Math.max(0, Math.min(lv.height, Math.ceil((oy - sminy) / lph)))
  const ww = c1 - c0
  const hh = r1 - r0
  if (ww <= 0 || hh <= 0 || ww * hh > MAX_WINDOW) return null
  const buf = await raster.window(level, c0, r0, ww, hh, band)
  const out = new Float64Array(n * n).fill(NaN)
  const lerpGrid = (g: Float64Array, i00: number, tx: number, ty: number): number => {
    const a = g[i00]
    const b = g[i00 + 1]
    const c = g[i00 + GRID + 1]
    const d = g[i00 + GRID + 2]
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) return Number.isFinite(a) ? a : NaN
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty)
  }
  let seen = false
  for (let py = 0; py < n; py++) {
    const fy = (py / n) * GRID
    const gy0 = Math.min(GRID - 1, Math.floor(fy))
    const ty = fy - gy0
    for (let px = 0; px < n; px++) {
      const fx = (px / n) * GRID
      const gx0 = Math.min(GRID - 1, Math.floor(fx))
      const tx = fx - gx0
      const i00 = gy0 * (GRID + 1) + gx0
      const sx = lerpGrid(nx, i00, tx, ty)
      const sy = lerpGrid(ny, i00, tx, ty)
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue
      const v = sample(buf, ww, hh, (sx - ox) / lpw - c0, (oy - sy) / lph - r0, nodata)
      if (!Number.isNaN(v)) {
        out[py * n + px] = v
        seen = true
      }
    }
  }
  return seen ? out : null
}

/**
 * The PNG of a tile of values: three bytes of the packed number per pixel, opaque. Cells with no value take `fill`, the same
 * number in every tile (the band's mean), so there is no step where two tiles meet; the edge of the data, and of a hole in it,
 * still shows as a step.
 */
export function encodeValueTile(values: Float64Array, e: DemEncoding, fill: number): Uint8Array {
  const n = DEM_TILE_SIZE
  const rgba = new Uint8Array(n * n * 4)
  for (let i = 0; i < values.length; i++) {
    const v = Number.isNaN(values[i]) ? fill : values[i]
    const k = Math.max(0, Math.min(DEM_TOP, Math.round((v - e.base) / e.step)))
    rgba[i * 4] = k >> 16
    rgba[i * 4 + 1] = (k >> 8) & 255
    rgba[i * 4 + 2] = k & 255
    rgba[i * 4 + 3] = 255
  }
  return encodePng(rgba, n, n)
}

