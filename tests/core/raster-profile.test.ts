// Spec 027 US3: where a profile asks, and what its answers say.
import { describe, expect, it } from 'vitest'
import { MAX_PROFILE_POINTS, cellMeters, distanceMeters, flattenPoints, interpolateGreatCircle, profileBands, profileCsv, profileSamples, summarizeProfile } from '@spatial-explorer/core'

const line: Array<[number, number]> = [[-112, 40], [-111, 40]]

describe('along the great circle', () => {
  it('the ends are the ends and the middle is half way', () => {
    expect(interpolateGreatCircle(line[0], line[1], 0)[0]).toBeCloseTo(-112, 9)
    expect(interpolateGreatCircle(line[0], line[1], 1)[0]).toBeCloseTo(-111, 9)
    const mid = interpolateGreatCircle(line[0], line[1], 0.5)
    expect(distanceMeters(line[0], mid)).toBeCloseTo(distanceMeters(mid, line[1]), 3)
    // A great circle between two places on a parallel bulges poleward.
    expect(mid[1]).toBeGreaterThan(40)
  })
  it('the same place twice stays put', () => {
    expect(interpolateGreatCircle([5, 5], [5, 5], 0.5)).toEqual([5, 5])
  })
})

describe('the places a profile asks about', () => {
  it('about one per cell, evenly spaced, first and last on the line', () => {
    const s = profileSamples(line, 100)
    const total = distanceMeters(line[0], line[1])
    expect(s.totalMeters).toBeCloseTo(total, 3)
    expect(s.points.length).toBe(Math.ceil(total / 100) + 1)
    expect(s.distances[0]).toBe(0)
    expect(s.distances.at(-1)).toBeCloseTo(total, 3)
    expect(s.points[0][0]).toBeCloseTo(-112, 9)
    expect(s.points.at(-1)![0]).toBeCloseTo(-111, 9)
    const steps = s.distances.slice(1).map((d, i) => d - s.distances[i])
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-6)
    expect(s.coarse).toBe(false)
  })
  it('never more than the limit, and says so', () => {
    const s = profileSamples(line, 1)
    expect(s.points.length).toBe(MAX_PROFILE_POINTS)
    expect(s.coarse).toBe(true)
  })
  it('with no cell size, the limit; with a short line, at least two', () => {
    expect(profileSamples(line, null).points.length).toBe(MAX_PROFILE_POINTS)
    expect(profileSamples([[0, 0], [0, 0.000001]], 1000).points.length).toBe(2)
  })
  it('follows the vertices of a bent line', () => {
    const s = profileSamples([[0, 0], [1, 0], [1, 1]], 1000)
    const corner = s.distances.findIndex((d) => d >= distanceMeters([0, 0], [1, 0]) - 1)
    expect(s.points[corner][0]).toBeCloseTo(1, 2)
    expect(s.totalMeters).toBeCloseTo(distanceMeters([0, 0], [1, 0]) + distanceMeters([1, 0], [1, 1]), 3)
  })
  it('a line of fewer than two vertices asks about nothing', () => {
    expect(profileSamples([[0, 0]], 10).points).toEqual([])
  })
  it('flattens for the worker', () => {
    expect(Array.from(flattenPoints([[1, 2], [3, 4]]))).toEqual([1, 2, 3, 4])
  })
})

describe('one cell in meters', () => {
  const base = { extentWgs84: [0, 40, 1, 50] as [number, number, number, number] }
  it('meters stay, feet shrink, degrees follow the latitude', () => {
    expect(cellMeters({ ...base, pixelSize: [30, 30], crs: { label: 'x', isWgs84: false, units: 'metres' } })).toBe(30)
    expect(cellMeters({ ...base, pixelSize: [100, 100], crs: { label: 'x', isWgs84: false, units: 'feet' } })).toBeCloseTo(30.48)
    const deg = cellMeters({ ...base, pixelSize: [0.001, 0.001], crs: { label: 'x', isWgs84: true, units: 'degrees' } })!
    expect(deg).toBeGreaterThan(70)
    expect(deg).toBeLessThan(90)
  })
  it('unknown size is null', () => {
    expect(cellMeters({ ...base, pixelSize: null, crs: { label: 'x', isWgs84: false } })).toBeNull()
  })
})

describe('the answers', () => {
  const bands = [{ index: 1, name: 'Elevation' }]
  it('NaN and the file\'s no-data number are gaps', () => {
    const [b] = profileBands([1, NaN, -9999, 4], 4, bands, -9999)
    expect(b.values).toEqual([1, null, null, 4])
  })
  it('several bands are interleaved per place', () => {
    const two = [{ index: 1, name: 'R' }, { index: 2, name: 'G' }]
    const [r, g] = profileBands([1, 10, 2, 20, 3, 30], 3, two, null)
    expect(r.values).toEqual([1, 2, 3])
    expect(g.values).toEqual([10, 20, 30])
  })
  it('summarizes: min, max, mean, and the climb and descent between neighbors that both have a value', () => {
    const s = summarizeProfile([1, 3, 2, null, 10, 12, 5])
    expect(s).toMatchObject({ valid: 6, total: 7, gaps: 1, min: 1, max: 12, rise: 2 + 2, fall: 1 + 7 })
    expect(s.mean).toBeCloseTo((1 + 3 + 2 + 10 + 12 + 5) / 6)
  })
  it('all gaps has no figures', () => {
    expect(summarizeProfile([null, null])).toMatchObject({ valid: 0, min: null, max: null, mean: null, rise: 0, fall: 0 })
  })
  it('writes a CSV with empty cells for gaps, quoting names', () => {
    const samples = profileSamples([[0, 0], [0, 0.001]], 50)
    const [b] = profileBands(Array(samples.points.length).fill(2), samples.points.length, [{ index: 1, name: 'Height, m' }], null)
    b.values[1] = null
    const csv = profileCsv(samples, [b])
    const rows = csv.trim().split('\n')
    expect(rows[0]).toBe('distance_m,longitude,latitude,"Height, m"')
    expect(rows).toHaveLength(samples.points.length + 1)
    expect(rows[1].endsWith(',2')).toBe(true)
    expect(rows[2].endsWith(',')).toBe(true)
  })
})
