// Spec 014: measuring and using drawn shapes. The engine runs the SQL in tests/web/specs/draw-014.spec.ts.
import { describe, expect, it } from 'vitest'
import {
  DRAWN_QUERY,
  distanceMeters,
  drawnTableSql,
  formatArea,
  formatLength,
  lineLengthMeters,
  measureShape,
  polygonAreaSquareMeters,
  ringAreaSquareMeters,
  shapeLabel,
  shapesGeoJson,
  shapesInCrsSql,
  shapesUnionSql,
  spatialPredicateSql,
  type DrawnShape,
} from '@spatial-explorer/core'

const square = (lon: number, lat: number, size: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]],
})
const shape = (id: string, geometry: DrawnShape['geometry'], kind: DrawnShape['kind'] = 'polygon'): DrawnShape => ({ id, kind, purpose: 'draw', geometry })

describe('geodesy', () => {
  it('a degree of longitude on the equator is about 111.2 km', () => {
    expect(distanceMeters([0, 0], [1, 0])).toBeCloseTo(111_195, -1)
  })
  it('a line is the sum of its legs', () => {
    expect(lineLengthMeters([[0, 0], [1, 0], [1, 1]])).toBeCloseTo(111_195 * 2, -1)
    expect(lineLengthMeters([[0, 0]])).toBe(0)
  })
  it('a 1° square on the equator is about 12,364 km² (spherical; the spheroid gives 12,308)', () => {
    const a = ringAreaSquareMeters(square(0, 0, 1).coordinates[0])
    expect(a / 1e6).toBeGreaterThan(12_300)
    expect(a / 1e6).toBeLessThan(12_400)
  })
  it('the area does not depend on the winding, and holes are subtracted', () => {
    const outer = square(0, 0, 2).coordinates[0]
    const hole = square(0.5, 0.5, 1).coordinates[0]
    expect(ringAreaSquareMeters([...outer].reverse())).toBeCloseTo(ringAreaSquareMeters(outer), 0)
    expect(polygonAreaSquareMeters([outer, hole])).toBeCloseTo(ringAreaSquareMeters(outer) - ringAreaSquareMeters(hole), 0)
  })
  it('a ring that is not closed or has too few positions has no area', () => {
    expect(ringAreaSquareMeters([[0, 0], [1, 1]])).toBe(0)
  })
})

describe('formatting', () => {
  it('metric lengths: meters under a kilometer, kilometers above', () => {
    expect(formatLength(7.25, 'metric')).toBe('7.3 m')
    expect(formatLength(950, 'metric')).toBe('950 m')
    expect(formatLength(1234, 'metric')).toBe('1.23 km')
    expect(formatLength(48_000, 'metric')).toBe('48 km')
  })
  it('imperial lengths: feet, then miles', () => {
    expect(formatLength(100, 'imperial')).toBe('328 ft')
    expect(formatLength(16_093.44, 'imperial')).toBe('10 mi')
  })
  it('areas pick a unit that reads well', () => {
    expect(formatArea(500, 'metric')).toBe('500 m²')
    expect(formatArea(250_000, 'metric')).toBe('25 ha')
    expect(formatArea(12_308_000_000, 'metric')).toBe('12,308 km²')
    expect(formatArea(2000, 'imperial')).toBe('21,528 ft²')
    expect(formatArea(20_000, 'imperial')).toBe('4.94 ac')
    expect(formatArea(40.47, 'imperial')).toBe('436 ft²')
    expect(formatArea(12_308_000_000, 'imperial')).toBe('4,752.1 mi²')
  })
})

describe('labels', () => {
  it('a line shows its length, a polygon its area and perimeter, a point nothing', () => {
    expect(shapeLabel({ geometry: { type: 'LineString', coordinates: [[0, 0], [0, 1]] } }, 'metric')).toBe('111.2 km')
    expect(shapeLabel({ geometry: square(0, 0, 0.01) }, 'metric')).toMatch(/^1\.2\d km² · 4\.\d+ km$/)
    expect(shapeLabel({ geometry: { type: 'Point', coordinates: [0, 0] } }, 'metric')).toBeNull()
  })
  it('measureShape fills only what applies', () => {
    expect(measureShape({ geometry: { type: 'Point', coordinates: [0, 0] } })).toEqual({ lengthM: null, areaM2: null, perimeterM: null })
    expect(measureShape({ geometry: square(0, 0, 1) }).lengthM).toBeNull()
  })
})

describe('SQL', () => {
  it('one shape is its geometry; several are their union, evaluated once', () => {
    const a = shape('a', square(0, 0, 1))
    expect(shapesUnionSql([a])).toMatch(/^ST_GeomFromGeoJSON\('\{"type":"Polygon"/)
    const two = shapesUnionSql([a, shape('b', square(2, 2, 1))])
    expect(two).toMatch(/^\(SELECT ST_Union_Agg\(g\) FROM \(VALUES \(ST_GeomFromGeoJSON/)
    expect(two.match(/ST_GeomFromGeoJSON/g)).toHaveLength(2)
  })
  it('the shape is transformed to the layer CRS unless that is WGS84', () => {
    const a = shape('a', square(0, 0, 1))
    expect(shapesInCrsSql([a], null)).toBe(shapesInCrsSql([a], 4326))
    expect(shapesInCrsSql([a], 32612)).toMatch(/^ST_Transform\(ST_GeomFromGeoJSON\(.*, 'EPSG:4326', 'EPSG:32612', always_xy := true\)$/)
  })
  it('predicates', () => {
    expect(spatialPredicateSql('intersects', '"geom"', 'S')).toBe('ST_Intersects("geom", S)')
    expect(spatialPredicateSql('within', '"geom"', 'S')).toBe('ST_Within("geom", S)')
    expect(spatialPredicateSql('contains', '"geom"', 'S')).toBe('ST_Contains("geom", S)')
    expect(spatialPredicateSql('centroid', '"geom"', 'S')).toBe('ST_Within(ST_Centroid("geom"), S)')
  })
  it('the drawn table is created empty, then filled with the shapes and their measurements', () => {
    expect(drawnTableSql([])).toHaveLength(1)
    const sql = drawnTableSql([shape("it's", square(0, 0, 1)), shape('b', { type: 'Point', coordinates: [1, 2] }, 'point')])
    expect(sql).toHaveLength(2)
    expect(sql[0]).toMatch(/^CREATE OR REPLACE TEMP TABLE "drawn" \(id VARCHAR, kind VARCHAR, purpose VARCHAR, geom GEOMETRY/)
    // A quote in an id doubles; a point has no area.
    expect(sql[1]).toContain("'it''s'")
    expect(sql[1]).toContain('NULL, NULL, NULL')
    expect(DRAWN_QUERY).toBe('SELECT * FROM drawn')
  })
})

describe('GeoJSON export', () => {
  it('is a FeatureCollection with the measurements as properties', () => {
    const fc = shapesGeoJson([shape('a', square(0, 0, 1))])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties).toMatchObject({ id: 'a', kind: 'polygon', purpose: 'draw' })
    expect((fc.features[0].properties as { area_m2: number }).area_m2).toBeGreaterThan(1e10)
  })
})
