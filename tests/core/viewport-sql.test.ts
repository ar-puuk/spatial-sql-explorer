// T025 (spec 007 research §6, FR-005): the SQL behind a map view. Pure builders.
import { describe, expect, it } from 'vitest'
import {
  clampWgs84,
  fgbTileSql,
  featuresByIdsSql,
  thinnedIdsSql,
  thinnedRowsSql,
  viewBoxSql,
  viewCountSql,
  viewFeaturesSql,
  viewTiles,
  type ViewTarget,
} from '@spatial-explorer/core'

const box: [number, number, number, number] = [-111.92, 40.74, -111.88, 40.77]
const covering: ViewTarget = { relation: '__se_layer', index: 'columns', geom: '"geom"', srid: 4326, attrs: ['zone', 'value'] }
const built: ViewTarget = { ...covering, index: 'bbox-table' }
const fgb: ViewTarget = { ...covering, index: 'fgb', path: '/se-source/p.fgb' }

describe('the view bbox', () => {
  it('is used as-is for WGS84 layers, and transformed (not the features) for projected ones', () => {
    expect(viewBoxSql(box, 4326)).toBeNull()
    expect(viewBoxSql(box, null)).toBeNull()
    const sql = viewBoxSql(box, 26912)!
    expect(sql).toContain(`ST_Transform(ST_MakeEnvelope(-111.92, 40.74, -111.88, 40.77), 'EPSG:4326', 'EPSG:26912', always_xy := true)`)
    expect(sql).toMatch(/ST_XMin\(e\) AS x0/)
  })

  it('is clamped to valid lon/lat (a world view at zoom 0 spans beyond ±180)', () => {
    expect(clampWgs84([-540, -89, 540, 89])).toEqual([-180, -85.0511, 180, 85.0511])
  })
})

describe('counting and loading a view', () => {
  it('compares bbox columns with constants, so Parquet row groups can be pruned', () => {
    const sql = viewCountSql(covering, box)
    expect(sql).toContain('__se_xmin <= -111.88 AND __se_xmax >= -111.92 AND __se_ymin <= 40.77 AND __se_ymax >= 40.74')
    expect(sql).toMatch(/^SELECT count\(\*\) AS n FROM/)
  })

  it('uses the bbox index table for GeoParquet without covering columns', () => {
    expect(viewCountSql(built, box)).toContain('FROM __se_bbox WHERE xmin <= -111.88 AND xmax >= -111.92')
    const features = viewFeaturesSql(built, box, 1000)
    expect(features).toContain('WHERE __se_rowid IN (SELECT rn FROM (SELECT rn, xmin, ymin, xmax, ymax FROM __se_bbox WHERE')
  })

  it('loads every feature in view as WGS84 GeoJSON, with ids, excluding invalid geometry', () => {
    const sql = viewFeaturesSql(covering, box, 25000)
    expect(sql).toMatch(/^SELECT "zone", "value", __se_rowid, ST_AsGeoJSON\("geom"\) AS __se_geojson FROM __se_layer WHERE /)
    expect(sql).toContain('"geom" IS NOT NULL AND ST_IsValid("geom")')
    expect(sql).toMatch(/ORDER BY __se_rowid LIMIT 25000$/)
  })

  it('sends features under ~2 px as their centroid, so an overview of tiny polygons stays visible', () => {
    const sql = viewFeaturesSql(covering, box, 10, 0.0001)
    expect(sql).toContain('CASE WHEN ST_XMax("geom") - ST_XMin("geom") < 0.0001 AND ST_YMax("geom") - ST_YMin("geom") < 0.0001 THEN ST_Centroid("geom") ELSE "geom" END')
    expect(viewFeaturesSql(covering, box, 10)).not.toContain('ST_Centroid')
  })

  it('reprojects only the features it returns', () => {
    const sql = viewFeaturesSql({ ...covering, srid: 26912 }, box, 10)
    expect(sql).toContain(`ST_AsGeoJSON(ST_Transform("geom", 'EPSG:26912', 'EPSG:4326', always_xy := true))`)
  })
})

describe('thinning over the cap (FR-005)', () => {
  it('keeps a proportional, deterministic sample: ~cap / inView of the rows, by a hash of their id', () => {
    const sql = thinnedIdsSql(covering, box, 1000, 100000)
    // 1,000 x 1.1 / 100,000 of 1,000,003 buckets.
    expect(sql).toContain('hash(rn) % 1000003 < 11001')
    expect(sql).toMatch(/ORDER BY hash\(rn\), rn LIMIT 1000$/)
    expect(thinnedIdsSql(covering, box, 1000, 500)).toContain('hash(rn) % 1000003 < 1000003')
  })

  it('a thinned overview reads bbox and attribute columns only, with a dot at each bbox center', () => {
    const sql = thinnedRowsSql(covering, box, 1000, 100000)
    expect(sql).not.toMatch(/"geom"/)
    expect(sql).toContain('ST_AsGeoJSON(ST_Point((__se_xmin + __se_xmax) / 2, (__se_ymin + __se_ymax) / 2)) AS __se_dotjson')
    expect(sql).toContain('hash(__se_rowid) % 1000003 < 11001')
    expect(sql).toMatch(/ORDER BY hash\(__se_rowid\), __se_rowid LIMIT 1000$/)
    expect(() => thinnedRowsSql(built, box, 10, 100)).toThrow()
  })

  it('fetches the chosen ids', () => {
    const ids = thinnedIdsSql(built, box, 100, 1000)
    const sql = featuresByIdsSql(covering, ids)
    expect(sql).toContain(`WHERE __se_rowid IN (${ids})`)
  })
})

describe('FlatGeobuf read in parts', () => {
  it('loads a view as a grid of capped tiles through its spatial index', () => {
    const tiles = viewTiles([0, 0, 6, 6])
    expect(tiles).toHaveLength(36)
    expect(tiles[0]).toEqual([0, 0, 1, 1])
    expect(tiles[35]).toEqual([5, 5, 6, 6])
    const sql = fgbTileSql(fgb, tiles[7], 70)
    expect(sql).toContain(`FROM ST_Read('/se-source/p.fgb', spatial_filter_box := ST_MakeBox2D(ST_Point(1, 1), ST_Point(2, 2)))`)
    expect(sql).toContain('"OGC_FID" AS __se_rowid')
    // Rows are re-checked against the tile: the engine returns stale rows for an empty filter.
    expect(sql).toContain('ST_XMin("geom") <= 2 AND ST_XMax("geom") >= 1 AND ST_YMin("geom") <= 2 AND ST_YMax("geom") >= 1')
    expect(sql).toMatch(/LIMIT 70$/)
  })

  it('skips tiles outside the file envelope', async () => {
    const { tileMeetsExtent } = await import('@spatial-explorer/core')
    expect(tileMeetsExtent([0, 0, 1, 1], [2, 2, 3, 3])).toBe(false)
    expect(tileMeetsExtent([0, 0, 2, 2], [2, 2, 3, 3])).toBe(true)
    expect(tileMeetsExtent([0, 0, 1, 1], null)).toBe(true)
  })

  it('is never counted or thinned like a table (each feature is a separate read)', () => {
    expect(() => viewCountSql(fgb, box)).toThrow(/per tile/)
    expect(() => viewFeaturesSql(fgb, box, 10)).toThrow(/per tile/)
  })
})
