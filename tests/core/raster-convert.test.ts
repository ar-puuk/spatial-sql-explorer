// Spec 026 T017: when a striped GeoTIFF is converted here, how big, with which overviews, and what the person is told.
import { describe, expect, it } from 'vitest'
import { LARGE_CONVERT_SAMPLES, MAX_CONVERT_SAMPLES, RasterOpenError, convertVerdict, convertedNote, overviewSizes, overviewSteps, sampleCount, tooLargeToConvert } from '@spatial-explorer/core'

describe('the sample limit', () => {
  it('counts cells over all bands', () => {
    expect(sampleCount(3000, 3000, 1)).toBe(9_000_000)
    expect(sampleCount(1000, 1000, 3)).toBe(3_000_000)
    expect(sampleCount(10, 10, 0)).toBe(100)
  })
  it('converts up to 100 million, marks 40 million and over as large, refuses more (measured: 100 M cells = 17 s and 2 GB)', () => {
    expect(MAX_CONVERT_SAMPLES).toBe(100_000_000)
    expect(convertVerdict(3000, 3000, 1)).toEqual({ kind: 'convert', samples: 9_000_000, large: false })
    expect(convertVerdict(7000, 7000, 1)).toMatchObject({ kind: 'convert', large: true })
    expect(LARGE_CONVERT_SAMPLES).toBe(40_000_000)
    expect(convertVerdict(10000, 10000, 1)).toMatchObject({ kind: 'convert', samples: 100_000_000 })
    expect(convertVerdict(10001, 10000, 1).kind).toBe('refuse')
    expect(convertVerdict(5000, 5000, 4).kind).toBe('convert')
    expect(convertVerdict(5001, 5000, 4).kind).toBe('refuse')
    expect(convertVerdict(Number.MAX_SAFE_INTEGER, 4, 1).kind).toBe('refuse')
  })
  it('the refusal says how big it is, the limit, and how to convert', () => {
    const e = tooLargeToConvert('big.tif', 250_000_000)
    expect(e).toBeInstanceOf(RasterOpenError)
    expect(e.code).toBe('too-large-to-convert')
    expect(e.message).toMatch(/big\.tif.*250 million cells.*limit is 100 million.*gdal_translate -of COG/)
  })
})

describe('the overview list (the builder takes a chain of reductions, not absolute factors)', () => {
  it('halves each time and stops before a level under 256 px: 7000 px gives 3500, 1750, 875, 438', () => {
    expect(overviewSteps(7000, 7000)).toEqual([2, 2, 2, 2])
    expect(overviewSizes(7000, 7000)).toEqual([[3500, 3500], [1750, 1750], [875, 875], [438, 438]])
  })
  it('follows the long side', () => {
    expect(overviewSizes(4000, 1000).map(([w]) => w)).toEqual([2000, 1000, 500])
    expect(overviewSteps(1000, 4000)).toHaveLength(3)
  })
  it('a small raster has none', () => {
    expect(overviewSteps(512, 512)).toEqual([])
    expect(overviewSteps(100, 100)).toEqual([])
    expect(overviewSteps(513, 100)).toEqual([2])
  })
  it('every level is strictly smaller than the last, whatever the size, and never under 256', () => {
    for (const side of [513, 1000, 3000, 12345, 40000]) {
      const sizes = overviewSizes(side, side).map(([w]) => w)
      let prev = side
      for (const w of sizes) {
        expect(w).toBeLessThan(prev)
        expect(w).toBeGreaterThanOrEqual(256)
        prev = w
      }
    }
  })
})

describe('what the card says about a converted file', () => {
  it('nothing is lost for 8 bit data without a colour table', () => {
    expect(convertedNote('uint8', false)).toBe('Prepared in memory from a GeoTIFF that is not stored in tiles. The file on disk is unchanged.')
  })
  it('names what is not kept', () => {
    expect(convertedNote('int16', false)).toMatch(/not kept: its int16 sample type \(values are kept as 32-bit floating point\)/)
    expect(convertedNote('uint8', true)).toMatch(/not kept: its colour table\./)
    expect(convertedNote('uint16', true)).toMatch(/its colour table and its uint16 sample type/)
  })
})
