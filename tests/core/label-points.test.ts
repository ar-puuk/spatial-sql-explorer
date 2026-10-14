// Labels: one per polygon, at the representative point of its largest part
// (labelPoint.ts). GeoJSON mode reads the points only while labels are on.
import { describe, expect, it } from 'vitest'
import { labelFeatures, labelPointsSql, type ViewTarget } from '@spatial-explorer/core'

const target: ViewTarget = { relation: '__se_layer', index: 'columns', geom: '"geom"', srid: 26912, attrs: ['zone'] }

describe('label points', () => {
  it("reads each polygon's representative point of its largest part, in WGS84, with its dot zoom", () => {
    const sql = labelPointsSql(target)
    expect(sql).toContain(`ST_PointOnSurface(CASE WHEN ST_Dimension(__se_w) <> 2 THEN NULL WHEN ST_NumGeometries(__se_w) > 1 THEN list_sort([{a: ST_Area(p.geom), g: p.geom} FOR p IN ST_Dump(__se_w)], 'DESC')[1].g ELSE __se_w END) AS __se_lp`)
    expect(sql).toContain(`ST_Transform("geom", 'EPSG:26912', 'EPSG:4326', always_xy := true) AS __se_w`)
    expect(sql).toContain('AND ST_Dimension("geom") = 2')
    expect(sql).toContain('log2(1.40625 / greatest(')
  })

  it("become features with their polygon's id and properties, hidden while it is a dot; unknown ids are dropped", () => {
    const features: GeoJSON.Feature[] = [
      { type: 'Feature', id: 1, properties: { zone: 'A', __id: 1 }, geometry: { type: 'Point', coordinates: [1, 2] } },
      { type: 'Feature', id: 2, properties: { zone: 'B', __id: 2 }, geometry: { type: 'Polygon', coordinates: [] } },
      { type: 'Feature', id: 3, properties: { zone: 'C', __id: 3 }, geometry: { type: 'Polygon', coordinates: [] } },
    ]
    expect(
      labelFeatures(features, [
        [2, 1.5, 0.5, 3],
        [3, 1.4, 0.4, -1],
        [9, 0, 0, 0],
      ])
    ).toEqual([
      { type: 'Feature', id: 2, properties: { zone: 'B', __id: 2, __se_dotz: 3 }, geometry: { type: 'Point', coordinates: [1.5, 0.5] } },
      { type: 'Feature', id: 3, properties: { zone: 'C', __id: 3 }, geometry: { type: 'Point', coordinates: [1.4, 0.4] } },
    ])
  })
})
