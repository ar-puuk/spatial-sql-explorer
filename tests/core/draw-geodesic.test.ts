// Spec 014 follow-up: a drawn line follows its great circle, on the map, in SQL and in exports.
import { describe, expect, it } from 'vitest'
import { distanceMeters, geodesicGeometry, greatCirclePath, lineLengthMeters, shapesGeoJson, shapesUnionSql } from '@spatial-explorer/core'

const NEW_YORK: [number, number] = [-74.006, 40.7128]
const LONDON: [number, number] = [-0.1276, 51.5072]

describe('great-circle paths', () => {
  it('bends a long line north of the straight one, and keeps its length', () => {
    const path = greatCirclePath([NEW_YORK, LONDON])
    expect(path.length).toBeGreaterThan(20)
    expect(path[0]).toEqual(NEW_YORK)
    expect(path[path.length - 1]).toEqual(LONDON)
    // On a flat map the great circle between them bulges toward the pole: its middle is north of the straight line's.
    const middle = path[Math.floor(path.length / 2)]
    const straightLat = (NEW_YORK[1] + LONDON[1]) / 2
    expect(middle[1]).toBeGreaterThan(straightLat + 2)
    // Walking the path is the same distance as the direct great-circle distance.
    expect(lineLengthMeters(path)).toBeCloseTo(distanceMeters(NEW_YORK, LONDON), -2)
  })

  it('leaves a short line alone', () => {
    expect(greatCirclePath([[8, 47], [8.2, 47.1]])).toEqual([[8, 47], [8.2, 47.1]])
  })

  it('stays continuous across the date line on the map, and is cut there for GeoJSON and SQL', () => {
    const path = greatCirclePath([[170, 10], [-170, 20]])
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i][0] - path[i - 1][0])).toBeLessThan(5)
    const g = geodesicGeometry({ type: 'LineString', coordinates: [[170, 10], [-170, 20]] })
    expect(g.type).toBe('MultiLineString')
    for (const part of (g as { coordinates: number[][][] }).coordinates) for (const [lon] of part) expect(Math.abs(lon)).toBeLessThanOrEqual(180)
  })

  it('is used by exports and SQL for lines only', () => {
    const line = { id: 'a', kind: 'line' as const, purpose: 'measure' as const, geometry: { type: 'LineString' as const, coordinates: [NEW_YORK, LONDON] } }
    const fc = shapesGeoJson([line])
    expect((fc.features[0].geometry as { coordinates: unknown[] }).coordinates.length).toBeGreaterThan(20)
    expect(shapesUnionSql([line])).toContain('ST_GeomFromGeoJSON')
    const polygon = { id: 'b', kind: 'polygon' as const, purpose: 'draw' as const, geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] } }
    expect(shapesGeoJson([polygon]).features[0].geometry).toEqual(polygon.geometry)
  })
})
