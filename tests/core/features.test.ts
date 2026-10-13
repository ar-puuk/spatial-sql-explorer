// Spec 010 T013: the one-time GeoJSON load: its SQL and the batched row conversion.
import { describe, expect, it } from 'vitest'
import { allFeaturesSql, featureCollector, rowToFeature, type ViewTarget } from '@spatial-explorer/core'

const target: ViewTarget = { relation: '__se_layer', index: 'columns', geom: '"geom"', srid: 26912, attrs: ['zone', 'built'] }

describe('allFeaturesSql', () => {
  const sql = allFeaturesSql(target, ['zone', 'built'], ['built'])

  it('reads every mappable row once, in row order, as WGS84 GeoJSON', () => {
    expect(sql).toMatch(/^SELECT "zone", CAST\("built" AS VARCHAR\) AS "built", __se_rowid, ST_AsGeoJSON\(ST_Transform\("geom", 'EPSG:26912', 'EPSG:4326', always_xy := true\)\) AS __se_geojson FROM __se_layer/)
    expect(sql).toContain('WHERE "geom" IS NOT NULL AND ST_IsValid("geom")')
    expect(sql).toMatch(/ORDER BY __se_rowid$/)
  })

  it('reads a narrowed relation as given (filters apply) and skips the validity check when known', () => {
    const s = allFeaturesSql({ ...target, relation: '(SELECT * FROM __se_layer WHERE (zone = 1))', srid: null, allValid: true }, [], [])
    expect(s).toContain('FROM (SELECT * FROM __se_layer WHERE (zone = 1)) WHERE "geom" IS NOT NULL ORDER BY')
    expect(s).toContain('ST_AsGeoJSON("geom")')
  })
})

describe('row conversion', () => {
  const row = (i: number, geom: string | null = '{"type":"Point","coordinates":[1,2]}') => ({ zone: 'R1', big: 7n, __se_rowid: BigInt(i), __se_geojson: geom })

  it('makes a feature with the row id as id and __id, and JSON-safe properties', () => {
    expect(rowToFeature(row(3))).toEqual({ type: 'Feature', id: 3, properties: { zone: 'R1', big: 7, __id: 3 }, geometry: { type: 'Point', coordinates: [1, 2] } })
    expect(rowToFeature(row(4, null))).toBeNull()
  })

  it('keeps order, skips rows without geometry, and yields once a slice runs past the budget', async () => {
    let clock = 0
    let yields = 0
    // The clock is read every 256 rows; each read advances 10 ms, so the second check is past 12 ms.
    const c = featureCollector({ now: () => (clock += 10), yieldFn: async () => void yields++ })
    await c.add(Array.from({ length: 600 }, (_, i) => row(i, i === 5 ? null : undefined)))
    expect(c.features).toHaveLength(599)
    expect(c.features.slice(0, 6).map((f) => f.id)).toEqual([0, 1, 2, 3, 4, 6])
    expect(yields).toBeGreaterThan(0)
  })

  it('does not yield when the work is fast', async () => {
    let yields = 0
    const c = featureCollector({ now: () => 0, yieldFn: async () => void yields++ })
    await c.add(Array.from({ length: 1000 }, (_, i) => row(i)))
    expect(yields).toBe(0)
  })
})
