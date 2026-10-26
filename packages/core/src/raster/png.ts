// Spec 026: a 256 x 256 RGBA tile as PNG bytes, for MapLibre's raster source. Pure JavaScript (fflate's zlib, our
// own CRC), so it runs anywhere without a canvas: measured 2.75 ms per tile, where OffscreenCanvas.convertToBlob took
// up to a second in one VS Code webview run (specs/026-raster-view/research.md §5).
import { zlibSync } from 'fflate'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

/** `rgba` is row-major, `width * height * 4` bytes, straight (not premultiplied) alpha. */
export function encodePng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error(`encodePng: ${rgba.length} bytes is not ${width} x ${height} RGBA`)
  const stride = width * 4
  // Each row is a filter byte (0: none) and the row. Level 1: fast, and tiles are small.
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  const parts = [SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlibSync(raw, { level: 1 })), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

let blank: Uint8Array | null = null
/** A fully transparent 256 x 256 tile (nothing of the raster is there). */
export function transparentTilePng(): Uint8Array {
  return (blank ??= encodePng(new Uint8Array(256 * 256 * 4), 256, 256))
}
