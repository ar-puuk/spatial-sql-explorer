// Spec 008 (user request): the export CRS picker's catalog, search and suggestions.
import { describe, expect, it } from 'vitest'
import { loadCrsCatalog, penalty, searchCrs, suggestCrs } from '../../packages/core/src/export/crsCatalog'

const codes = (xs: Array<{ code: number }>) => xs.map((x) => x.code)

describe('CRS catalog', () => {
  it('holds the engine-accepted EPSG CRSs, grouped as QGIS and ArcGIS group them', async () => {
    const { groups, entries } = await loadCrsCatalog()
    expect(entries.length).toBeGreaterThan(5000)
    expect(groups[0]).toBe('Geographic')
    expect(groups.at(-1)).toBe('Other projections')
    expect(groups).toEqual(expect.arrayContaining(['Universal Transverse Mercator (UTM)', 'US State Plane', 'World', 'Lambert Conformal Conic']))
    const by = (code: number) => entries.find((e) => e.code === code)
    expect(by(4326)).toMatchObject({ name: 'WGS 84', kind: 'geographic', group: 'Geographic' })
    expect(by(26912)?.group).toBe('Universal Transverse Mercator (UTM)')
    expect(by(32612)?.group).toBe('Universal Transverse Mercator (UTM)')
    expect(by(32143)?.group).toBe('US State Plane')
    expect(by(3395)?.group).toBe('World')
    expect(by(5070)?.group).toBe('Albers Equal Area')
  })

  it('search: exact code first, then code prefixes; words in any order; common names', async () => {
    const { entries } = await loadCrsCatalog()
    expect(codes(searchCrs(entries, 'EPSG:26912', 3))[0]).toBe(26912)
    expect(searchCrs(entries, '2691', 50).every((e) => String(e.code).startsWith('2691'))).toBe(true)
    expect(codes(searchCrs(entries, 'utm 12n', 2))).toEqual([26912, 32612])
    expect(codes(searchCrs(entries, 'wgs 84', 1))).toEqual([4326])
    expect(codes(searchCrs(entries, 'web mercator', 1))).toEqual([3857])
    expect(codes(searchCrs(entries, 'utah', 3)).sort()).toEqual([32142, 32143, 32144])
    expect(codes(searchCrs(entries, 'switzerland lv95', 5))).toContain(2056)
    expect(searchCrs(entries, 'no such crs anywhere')).toEqual([])
  })

  it('suggestions for the data: the usual local CRSs first', async () => {
    const { entries } = await loadCrsCatalog()
    expect(codes(suggestCrs(entries, [-112.1, 40.5, -111.7, 40.9], 3))).toEqual([32143, 26912, 32612])
    expect(codes(suggestCrs(entries, [-124, 25, -67, 49], 1))).toEqual([5070])
    expect(suggestCrs(entries, null)).toEqual([])
    expect(suggestCrs(entries, [-180, -90, 180, 90])).toEqual([])
  })

  it('penalty: feet, historic datums and realizations after the plain metre CRS', async () => {
    const { entries } = await loadCrsCatalog()
    const p = (code: number) => penalty(entries.find((e) => e.code === code)!)
    expect(p(32143)).toBe(0)
    expect(p(3566)).toBeGreaterThan(0) // ftUS
    expect(p(26712)).toBeGreaterThan(0) // NAD27
    expect(p(2850)).toBeGreaterThan(0) // HARN
  })
})
