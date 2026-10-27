// Spec 027: the profile chart and the histograms as standalone SVG, and the self-contained CSVs.
import { describe, expect, it } from 'vitest'
import { areaCsv, histogramCsv, histogramSvg, profileBands, profileSamples, profileSvg, type AreaResult, type BandAreaStats } from '@spatial-explorer/core'

const samples = profileSamples([[-112, 40], [-111.9, 40.05], [-111.8, 40]], 100)
const one = profileBands(Array.from({ length: samples.points.length }, (_, i) => (i === 3 ? NaN : 1000 + Math.sin(i / 10) * 100)), samples.points.length, [{ index: 1, name: 'Elevation' }], null)
const stat = (name: string, over: Partial<BandAreaStats> = {}): BandAreaStats => ({ band: 1, name, count: 100, excluded: 5, min: 10, max: 20, mean: 14, sum: 1400, std: 2.5, histogram: Array.from({ length: 64 }, (_, i) => (i < 32 ? i : 64 - i)), ...over })
const area: AreaResult = { areaM2: 1234567.891, approximate: false, cellMeters: 19.94, bands: [stat('Elevation')] }

function wellFormed(svg: string): void {
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
  expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  // Every tag closes: a crude but real check that what we wrote parses as XML.
  const tags = [...svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)]
  const stack: string[] = []
  for (const [, close, name, , self] of tags) {
    if (self) continue
    if (close) expect(stack.pop()).toBe(name)
    else stack.push(name)
  }
  expect(stack).toEqual([])
}

describe('the profile as SVG', () => {
  it('is a complete, standalone picture with the size it says', () => {
    const r = profileSvg(samples, one, { title: 'dem.tif' })
    wellFormed(r.svg)
    expect([r.width, r.height]).toEqual([960, 420])
    expect(r.svg).toContain('viewBox="0 0 960 420"')
    expect(r.svg).toContain('dem.tif')
    expect(r.svg).toContain('fill="#ffffff"')
  })
  it('draws the line in runs, with the gap left out, and says the figures in text', () => {
    const r = profileSvg(samples, one)
    expect((r.svg.match(/<path /g) ?? []).length).toBe(2)
    expect(r.svg).toMatch(/Min [\d,.]+/)
    expect(r.svg).toContain('Distance (km)')
  })
  it('uses the units asked for, and escapes the title', () => {
    expect(profileSvg(samples, one, { imperial: true }).svg).toContain('Distance (mi)')
    const r = profileSvg(samples, one, { title: 'a <b> & "c"' })
    wellFormed(r.svg)
    expect(r.svg).toContain('a &lt;b&gt; &amp; &quot;c&quot;')
  })
  it('three bands get a legend and their own colors', () => {
    const rgb = profileBands(Array.from({ length: samples.points.length * 3 }, (_, i) => i % 255), samples.points.length, [{ index: 1, name: 'Red' }, { index: 2, name: 'Green' }, { index: 3, name: 'Blue' }], null)
    const r = profileSvg(samples, rgb)
    wellFormed(r.svg)
    for (const c of ['#d9382f', '#2f9e44', '#2563eb']) expect(r.svg).toContain(c)
    expect(r.svg).toContain('>Green<')
  })
  it('a line with no values still makes a picture', () => {
    wellFormed(profileSvg(samples, profileBands(Array(samples.points.length).fill(NaN), samples.points.length, [{ index: 1, name: 'x' }], null)).svg)
  })
})

describe('the histograms as SVG', () => {
  it('one block per band, the bars, the ends and the mean', () => {
    const r = histogramSvg([stat('Elevation')])
    wellFormed(r.svg)
    expect((r.svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(64)
    expect(r.svg).toContain('mean 14')
  })
  it('three bands are three blocks, taller', () => {
    const one = histogramSvg([stat('Elevation')])
    const three = histogramSvg([stat('Red', { band: 1 }), stat('Green', { band: 2 }), stat('Blue', { band: 3 })])
    expect(three.height).toBeGreaterThan(one.height)
    expect(three.svg).toContain('>Blue')
  })
  it('a band with no values is left out, and none at all says so', () => {
    const r = histogramSvg([stat('x', { histogram: [], count: 0, min: null, max: null, mean: null })])
    wellFormed(r.svg)
    expect(r.svg).toContain('No values inside the area.')
  })
})

describe('the statistics CSV', () => {
  it('says what it measured on every row', () => {
    const csv = areaCsv({ ...area, bands: [stat('Red'), stat('Green', { band: 2 })], approximate: true }, 'dem, 1.tif').trim().split('\n')
    expect(csv[0]).toBe('file,band,cells,no_data_cells,min,max,mean,sum,std_dev,area_m2,cell_size_m,approximate')
    expect(csv).toHaveLength(3)
    expect(csv[1]).toBe('"dem, 1.tif",Red,100,5,10,20,14,1400,2.5,1234567.89,19.94,yes')
    expect(csv[2].startsWith('"dem, 1.tif",Green,')).toBe(true)
  })
  it('empty figures are empty cells', () => {
    const csv = areaCsv({ ...area, cellMeters: null, bands: [stat('x', { count: 0, min: null, max: null, mean: null, sum: null, std: null, histogram: [] })] }).trim().split('\n')
    expect(csv[1]).toBe(',x,0,5,,,,,,1234567.89,,no')
  })
})

describe('the histogram CSV', () => {
  it('a row per bin: where it starts and ends and how many cells', () => {
    const rows = histogramCsv([stat('Elevation')]).trim().split('\n')
    expect(rows[0]).toBe('band,bin_start,bin_end,cells')
    expect(rows).toHaveLength(65)
    expect(rows[1]).toBe('Elevation,10,10.15625,0')
    expect(rows[64].startsWith('Elevation,19.84375,20,')).toBe(true)
    const total = rows.slice(1).reduce((s, r) => s + Number(r.split(',')[3]), 0)
    expect(total).toBe(stat('x').histogram.reduce((a, b) => a + b, 0))
  })
  it('a band with no values has no rows', () => {
    expect(histogramCsv([stat('x', { histogram: [], min: null, max: null })]).trim().split('\n')).toEqual(['band,bin_start,bin_end,cells'])
  })
})
