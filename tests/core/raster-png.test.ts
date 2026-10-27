// Spec 026: the tile encoder is checked by decoding what it wrote, byte for byte.
import { describe, expect, it } from 'vitest'
import { unzlibSync } from 'fflate'
import { encodePng, transparentTilePng } from '@spatial-explorer/core'

function decode(png: Uint8Array): { width: number; height: number; rgba: Uint8Array; chunks: string[] } {
  expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  const view = new DataView(png.buffer, png.byteOffset)
  let at = 8
  const chunks: string[] = []
  let width = 0
  let height = 0
  const idat: Uint8Array[] = []
  while (at < png.length) {
    const len = view.getUint32(at)
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
    chunks.push(type)
    const data = png.subarray(at + 8, at + 8 + len)
    // The CRC covers the type and the data.
    let c = 0xffffffff
    for (const b of png.subarray(at + 4, at + 8 + len)) {
      c ^= b
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    expect(view.getUint32(at + 8 + len), `CRC of ${type}`).toBe((c ^ 0xffffffff) >>> 0)
    if (type === 'IHDR') {
      width = new DataView(data.buffer, data.byteOffset).getUint32(0)
      height = new DataView(data.buffer, data.byteOffset).getUint32(4)
      expect(Array.from(data.subarray(8))).toEqual([8, 6, 0, 0, 0])
    }
    if (type === 'IDAT') idat.push(data)
    at += 12 + len
  }
  const raw = unzlibSync(idat[0])
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)], 'filter byte').toBe(0)
    rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  return { width, height, rgba, chunks }
}

describe('encodePng', () => {
  it('round trips a tile exactly', () => {
    const rgba = new Uint8Array(256 * 256 * 4)
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7 + (i >> 8)) & 255
    const d = decode(encodePng(rgba, 256, 256))
    expect([d.width, d.height]).toEqual([256, 256])
    expect(d.rgba).toEqual(rgba)
    expect(d.chunks).toEqual(['IHDR', 'IDAT', 'IEND'])
  })

  it('keeps straight alpha as given', () => {
    const rgba = new Uint8Array([10, 20, 30, 0, 200, 100, 50, 128])
    expect(decode(encodePng(rgba, 2, 1)).rgba).toEqual(rgba)
  })

  it('takes the clamped arrays the tiler returns', () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 255])
    expect(decode(encodePng(rgba, 1, 1)).rgba).toEqual(new Uint8Array([1, 2, 3, 255]))
  })

  it('refuses a buffer of the wrong size', () => {
    expect(() => encodePng(new Uint8Array(10), 2, 2)).toThrow(/not 2 x 2 RGBA/)
  })

  it('a transparent tile is small, fully transparent, 256 x 256 and the same object every time', () => {
    const png = transparentTilePng()
    const d = decode(png)
    expect([d.width, d.height]).toEqual([256, 256])
    expect(d.rgba.every((b) => b === 0)).toBe(true)
    expect(png.length).toBeLessThan(1000)
    expect(transparentTilePng()).toBe(png)
  })
})
