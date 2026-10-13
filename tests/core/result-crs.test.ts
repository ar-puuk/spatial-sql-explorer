// T013 (spec 002, FR-014; research §4): which CRS a query result's geometry
// is in. DuckDB v1.4.3 types carry no CRS, so the app resolves it:
// override > engine-typed GEOMETRY('EPSG:x') > extent detection > layer.
import { describe, expect, it } from 'vitest'
import { resolveResultCrs, type Bbox } from '@spatial-explorer/core'

const UTM_USA: Bbox = [-1_200_000, 2_100_000, 4_900_000, 8_000_000] // projected meters
const LONLAT_USA: Bbox = [-171.8, 18.9, -66.9, 71.4]

const base = { override: null, engineType: 'GEOMETRY', layerSrid: 26912, layerExtent: UTM_USA }

describe('resolveResultCrs', () => {
  it('a user override wins over everything', () => {
    const r = resolveResultCrs({ ...base, override: 3857, engineType: "GEOMETRY('EPSG:4326')", resultExtent: LONLAT_USA })
    expect(r).toMatchObject({ srid: 3857, source: 'override' })
    expect(r.crs.label).toBe('EPSG:3857')
  })

  it('an engine-typed CRS is used when the runtime reports one', () => {
    expect(resolveResultCrs({ ...base, engineType: "GEOMETRY('EPSG:3857')", resultExtent: UTM_USA })).toMatchObject({ srid: 3857, source: 'engine' })
  })

  it('detects a transform to lon/lat from a projected layer', () => {
    const r = resolveResultCrs({ ...base, resultExtent: LONLAT_USA })
    expect(r).toMatchObject({ srid: 4326, source: 'detected' })
    expect(r.crs.label).toBe('EPSG:4326 (WGS84)')
  })

  it('keeps the layer CRS when the result extent is still projected', () => {
    expect(resolveResultCrs({ ...base, resultExtent: [100_000, 4_000_000, 600_000, 4_500_000] })).toMatchObject({ srid: 26912, source: 'layer' })
  })

  it('no detection when the projected layer itself has a lon/lat-sized extent (tiny local data)', () => {
    const tiny: Bbox = [10, 20, 30, 40]
    expect(resolveResultCrs({ ...base, layerExtent: tiny, resultExtent: tiny })).toMatchObject({ srid: 26912, source: 'layer' })
  })

  it('a WGS84 layer stays WGS84 with source "layer"', () => {
    expect(resolveResultCrs({ ...base, layerSrid: 4326, layerExtent: LONLAT_USA, resultExtent: LONLAT_USA })).toMatchObject({ srid: 4326, source: 'layer' })
  })

  it('a layer with no CRS falls back to the WGS84 assumption', () => {
    const r = resolveResultCrs({ ...base, layerSrid: null, layerExtent: LONLAT_USA, resultExtent: LONLAT_USA })
    expect(r).toMatchObject({ srid: null, source: 'layer' })
    expect(r.crs.label).toBe('EPSG:4326 (WGS84)')
  })

  it('an empty result keeps the layer CRS', () => {
    expect(resolveResultCrs({ ...base, resultExtent: null })).toMatchObject({ srid: 26912, source: 'layer' })
  })
})

describe('DuckDB 1.5 CRS-typed geometry (spec 010)', () => {
  it('reads OGC:CRS84 (the GeoParquet default) as EPSG:4326', () => {
    expect(resolveResultCrs({ override: null, engineType: "GEOMETRY('OGC:CRS84')", resultExtent: null, layerSrid: 26912, layerExtent: null })).toMatchObject({ srid: 4326, source: 'engine' })
  })
})
