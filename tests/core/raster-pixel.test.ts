// Spec 026 T022: what is shown for the place under the cursor. The tiler returns nodata as the file's own number
// (measured: -9999 in the hole of the DEM fixture); the person sees "no data".
import { describe, expect, it } from 'vitest'
import { insideExtent, isNodata, pixelCopyText, pixelLines, pixelText, readingFromPoint } from '@spatial-explorer/core'

const dem = { bands: [{ index: 1, name: 'Elevation' }], nodata: -9999 as number | 'nan' | null }
const rgb = { bands: [{ index: 1, name: 'Red' }, { index: 2, name: 'Green' }, { index: 3, name: 'Blue' }], nodata: null as number | 'nan' | null }

describe('a reading from the tiler\'s answer', () => {
  it('the stored value of each band, with the band\'s name', () => {
    const r = readingFromPoint(dem, -111.9, 40.7, { values: [1990.2379150390625] })
    expect(r).toEqual({ lon: -111.9, lat: 40.7, outside: false, values: [{ band: 1, name: 'Elevation', value: 1990.2379150390625 }] })
  })
  it('nodata is no data, not a number', () => {
    expect(readingFromPoint(dem, 0, 0, { values: [-9999] }).values[0].value).toBeNull()
    expect(readingFromPoint(rgb, 0, 0, { values: [0, 0, 0] }).values.map((v) => v.value)).toEqual([0, 0, 0])
  })
  it('a NaN sample is no data whatever the file records', () => {
    expect(readingFromPoint(dem, 0, 0, { values: [NaN] }).values[0].value).toBeNull()
    expect(readingFromPoint({ ...dem, nodata: 'nan' }, 0, 0, { values: [NaN, 5] }).values.map((v) => v.value)).toEqual([null, 5])
    expect(isNodata(NaN, null)).toBe(true)
    expect(isNodata(3, 'nan')).toBe(false)
    expect(isNodata(-9999, -9999)).toBe(true)
    expect(isNodata(-9998, -9999)).toBe(false)
  })
  it('a band the file gave no name gets "Band n"', () => {
    expect(readingFromPoint({ bands: [], nodata: null }, 0, 0, { values: [1, 2] }).values.map((v) => v.name)).toEqual(['Band 1', 'Band 2'])
  })
  it('off the raster: nothing', () => {
    expect(readingFromPoint(dem, 1, 2, { values: [], outside: true })).toEqual({ lon: 1, lat: 2, outside: true, values: [] })
    expect(readingFromPoint(dem, 1, 2, { values: [] }).outside).toBe(true)
  })
})

describe('the words', () => {
  const at = (f: typeof dem, values: number[]) => readingFromPoint(f, -111.9, 40.7, { values })
  it('one band: the value alone; no data in words', () => {
    expect(pixelText(at(dem, [412.3456]))).toBe('412.35')
    expect(pixelText(at(dem, [-9999]))).toBe('no data')
  })
  it('several bands: each with its name', () => {
    expect(pixelText(at(rgb, [12, 200, 255]))).toBe('Red 12, Green 200, Blue 255')
  })
  it('many bands: the first few and how many more; the lines have all of them', () => {
    const many = { bands: Array.from({ length: 7 }, (_, i) => ({ index: i + 1, name: `Band ${i + 1}` })), nodata: null as number | null }
    const r = readingFromPoint(many, 0, 0, { values: [1, 2, 3, 4, 5, 6, 7] })
    expect(pixelText(r)).toBe('Band 1 1, Band 2 2, Band 3 3, Band 4 4 and 3 more')
    expect(pixelLines(r)).toHaveLength(7)
  })
  it('nothing off the raster or without a reading', () => {
    expect(pixelText(null)).toBe('')
    expect(pixelText({ lon: 0, lat: 0, outside: true, values: [] })).toBe('')
    expect(pixelLines(null)).toEqual([])
    expect(pixelCopyText(null)).toBe('')
  })
  it('the copy: the place, then one band per line', () => {
    expect(pixelCopyText(at(rgb, [12, 200, 255]))).toBe('40.70000, -111.90000\nRed: 12\nGreen: 200\nBlue: 255')
    expect(pixelCopyText(at(dem, [-9999]))).toBe('40.70000, -111.90000\nElevation: no data')
  })
})

describe('inside the raster\'s box', () => {
  it('edges count; a place outside does not', () => {
    const box = [-112, 40, -111, 41]
    expect(insideExtent(box, -111.5, 40.5)).toBe(true)
    expect(insideExtent(box, -112, 40)).toBe(true)
    expect(insideExtent(box, -110.9, 40.5)).toBe(false)
    expect(insideExtent(box, -111.5, 41.1)).toBe(false)
  })
})
