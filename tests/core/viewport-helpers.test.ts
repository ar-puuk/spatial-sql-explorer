// T025 (spec 007 research §6), reduced in spec 010 (per-pan views are gone): what
// the map's SQL still shares. Pure builders.
import { describe, expect, it } from 'vitest'
import { candidates, clampWgs84, hiddenOverlap, recordByIdSql, validGeometry, viewBoxSql, type ViewTarget } from '@spatial-explorer/core'

const box: [number, number, number, number] = [-111.92, 40.74, -111.88, 40.77]
const covering: ViewTarget = { relation: '__se_layer', index: 'columns', geom: '"geom"', srid: 4326, attrs: ['zone', 'value'], textAttrs: ['value'] }
const built: ViewTarget = { ...covering, index: 'bbox-table' }

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

describe('bbox predicates', () => {
  it('compare bbox columns with constants, so Parquet row groups can be pruned', () => {
    expect(hiddenOverlap(box)).toBe('__se_xmin <= -111.88 AND __se_xmax >= -111.92 AND __se_ymin <= 40.77 AND __se_ymax >= 40.74')
  })

  it('read the bbox index table for GeoParquet without covering columns, keeping only narrowed rows', () => {
    expect(candidates(built, box)).toContain('FROM __se_bbox WHERE xmin <= -111.88 AND xmax >= -111.92')
    expect(candidates({ ...built, narrowed: true }, box)).toContain('AND rn IN (SELECT __se_rowid FROM __se_layer)')
    expect(candidates(covering, box)).toContain('FROM __se_layer WHERE __se_xmin <= -111.88')
  })

  it('skip the validity check when every geometry is known valid', () => {
    expect(validGeometry('"geom"')).toBe('"geom" IS NOT NULL AND ST_IsValid("geom")')
    expect(validGeometry('"geom"', true)).toBe('"geom" IS NOT NULL')
  })
})

describe('one record by id (the inspector)', () => {
  it('reads every attribute, temporal ones as text, and the WGS84 geometry', () => {
    const sql = recordByIdSql({ ...covering, srid: 26912 }, 42)
    expect(sql).toContain('"zone", CAST("value" AS VARCHAR) AS "value", __se_rowid')
    expect(sql).toContain(`ST_AsGeoJSON(ST_Transform("geom", 'EPSG:26912', 'EPSG:4326', always_xy := true)) AS __se_geojson`)
    expect(sql).toContain('WHERE __se_rowid = 42 AND')
  })
})
