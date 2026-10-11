// T006 (spec 005, contracts/export-core.md planExport): what an export will
// do, decided before anything runs: rows, formats, CRS, notices, SQL, name.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { planExport, type ExportPlanContext, type ExportRequest } from '@spatial-explorer/core'

const ALL_TYPES = (JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/export/columns.json`, 'utf8')) as { columns: Array<{ name: string; type: string }> }).columns

const request = (patch: Partial<ExportRequest> = {}): ExportRequest => ({ format: 'geoparquet', rows: 'all', crs: 'result', csvGeometry: 'wkt', ...patch })

const ctx = (patch: Partial<ExportPlanContext> = {}): ExportPlanContext => ({
  sourceName: 'parcels.geojson',
  layer: { rowCount: 1000, invalidGeometryCount: 0, columns: [{ name: 'zone', type: 'VARCHAR' }, { name: 'acres', type: 'DOUBLE' }], geometryType: 'Polygon' },
  facts: {
    exportable: true,
    geometryColumn: 'geom',
    otherGeometryColumns: [],
    resultCrs: { label: 'EPSG:4326 (WGS84)', srid: 4326, assumed: false },
    totalRows: 22000,
    truncatedTo: null,
    defaultView: true,
  },
  ...patch,
})
const utm = { label: 'EPSG:26912', srid: 26912, assumed: false }

describe('which rows (FR-002)', () => {
  it('the untouched default view is display-limited; all = the whole file from layer, shown = its first 1,000', () => {
    const all = planExport(request(), ctx())
    expect(all.displayLimited).toEqual({ shown: 1000, total: 22000 })
    expect(all.rowCount).toBe(22000)
    expect(all.source).toBe('layer')
    expect(all.sql).toMatch(/FROM "?layer"?(\s|$)/)
    expect(all.sql).not.toMatch(/LIMIT/)
    const shown = planExport(request({ rows: 'shown' }), ctx())
    expect(shown.rowCount).toBe(1000)
    expect(shown.sql).toMatch(/LIMIT 1000/)
  })

  it('"Show first 50,000" is display-limited over the full result', () => {
    const c = ctx({ facts: { ...ctx().facts, defaultView: false, totalRows: 60000, truncatedTo: 50000 }, layer: { ...ctx().layer, rowCount: 50000 } })
    expect(planExport(request(), c)).toMatchObject({ displayLimited: { shown: 50000, total: 60000 }, rowCount: 60000, source: 'result' })
    expect(planExport(request(), c).sql).toMatch(/FROM __se_result/)
    expect(planExport(request({ rows: 'shown' }), c).sql).toMatch(/LIMIT 50000/)
  })

  it("a user's own LIMIT is the query: not display-limited", () => {
    const c = ctx({ facts: { ...ctx().facts, defaultView: false, totalRows: 50 }, layer: { ...ctx().layer, rowCount: 50 } })
    const p = planExport(request({ rows: 'shown' }), c)
    expect(p.displayLimited).toBeNull()
    expect(p.rowCount).toBe(50)
    expect(p.sql).not.toMatch(/LIMIT/)
  })

  it('a default view of a small file (all rows shown) is not display-limited', () => {
    expect(planExport(request(), ctx({ facts: { ...ctx().facts, totalRows: 180 }, layer: { ...ctx().layer, rowCount: 180 } })).displayLimited).toBeNull()
  })
})

describe('formats offered (FR-004, FR-008)', () => {
  it('a geometry result offers GeoParquet, GeoJSON and CSV, not Parquet', () => {
    const f = planExport(request(), ctx()).formats
    expect(f.filter((x) => x.available).map((x) => x.id).sort()).toEqual(['csv', 'geojson', 'geoparquet'])
    expect(f.find((x) => x.id === 'parquet')?.reason).toMatch(/without geometry/)
  })

  it('a table result offers CSV and Parquet only, with a reason for the others', () => {
    const c = ctx({ facts: { ...ctx().facts, geometryColumn: null, resultCrs: null, defaultView: false, totalRows: 5 }, layer: { ...ctx().layer, rowCount: 5 } })
    const f = planExport(request({ format: 'csv' }), c).formats
    expect(f.filter((x) => x.available).map((x) => x.id).sort()).toEqual(['csv', 'parquet'])
    expect(f.find((x) => x.id === 'geojson')?.reason).toMatch(/geometry/)
  })

  it('a DESCRIBE / SHOW result can not be exported, with the reason', () => {
    const p = planExport(request(), ctx({ facts: { ...ctx().facts, exportable: false } }))
    expect(p.formats.every((x) => !x.available)).toBe(true)
    expect(p.blocked).toMatch(/Run a query/)
  })
})

describe('CRS (FR-006)', () => {
  it('GeoJSON is forced to WGS84 and says why', () => {
    const p = planExport(request({ format: 'geojson', crs: 'result' }), ctx({ facts: { ...ctx().facts, resultCrs: utm } }))
    expect(p.crs).toMatchObject({ output: 'wgs84', forced: true })
    expect(p.crs.reason).toMatch(/GeoJSON/)
    expect(p.notices.join()).toMatch(/reprojected from EPSG:26912/)
    expect(p.sql).toMatch(/ST_Transform\("geom", 'EPSG:26912', 'EPSG:4326', always_xy := true\)/)
  })

  it('GeoParquet in the result CRS keeps the srid; WGS84 reprojects', () => {
    const c = ctx({ facts: { ...ctx().facts, resultCrs: utm } })
    const keep = planExport(request(), c)
    expect(keep.crs).toMatchObject({ output: 'result', srid: 26912, forced: false })
    expect(keep.sql).not.toMatch(/ST_Transform/)
    const wgs = planExport(request({ crs: 'wgs84' }), c)
    expect(wgs.crs).toMatchObject({ output: 'wgs84', srid: 4326 })
    expect(wgs.sql).toMatch(/ST_Transform/)
  })

  it('an assumed CRS is announced', () => {
    const p = planExport(request(), ctx({ facts: { ...ctx().facts, resultCrs: { label: 'EPSG:4326 (WGS84)', srid: null, assumed: true } } }))
    expect(p.notices.join()).toMatch(/assumed/)
  })
})

describe('geometry SQL per format', () => {
  it('GeoParquet writes WKB BLOB; invalid geometry becomes empty', () => {
    const sql = planExport(request(), ctx()).sql
    expect(sql).toMatch(/ST_AsWKB\(.*\)::BLOB END AS "geom"/)
    expect(sql).toMatch(/ST_IsValid\("geom"\)/)
  })

  it('CSV writes WKT, or X/Y for point layers only', () => {
    expect(planExport(request({ format: 'csv' }), ctx()).sql).toMatch(/ST_AsText\(.*\) END AS "geom"/)
    const points = ctx({ layer: { ...ctx().layer, geometryType: 'Point' } })
    const xy = planExport(request({ format: 'csv', csvGeometry: 'xy' }), points)
    expect(xy.sql).toMatch(/ST_X\(.*\) END AS "x", .*ST_Y\(.*\) END AS "y"/)
    expect(planExport(request({ format: 'csv', csvGeometry: 'xy' }), ctx()).csvGeometry).toBe('wkt') // polygons: X/Y not possible
    expect(planExport(request({ format: 'csv', csvGeometry: 'xy' }), ctx()).xyAvailable).toBe(false)
  })

  it('X/Y column names never collide with attributes', () => {
    const c = ctx({ layer: { ...ctx().layer, geometryType: 'Point', columns: [{ name: 'x', type: 'DOUBLE' }] } })
    expect(planExport(request({ format: 'csv', csvGeometry: 'xy' }), c).sql).toMatch(/END AS "geom_x", .*ST_Y\(.*\) END AS "geom_y"/)
  })

  it('GeoJSON streams ST_AsGeoJSON in WGS84', () => {
    expect(planExport(request({ format: 'geojson' }), ctx()).sql).toMatch(/ST_AsGeoJSON\(.*\) END AS "__se_geojson"/)
  })

  it('other geometry columns are written as WKT text, with a notice', () => {
    const p = planExport(request(), ctx({ facts: { ...ctx().facts, otherGeometryColumns: ['centroid'] } }))
    expect(p.sql).toMatch(/ST_AsText\("centroid"\) AS "centroid"/)
    expect(p.notices.join()).toMatch(/written as WKT text: centroid/)
  })
})

describe('notices known in advance (FR-009)', () => {
  const typed = (format: ExportRequest['format']) =>
    planExport(request({ format }), ctx({ layer: { ...ctx().layer, columns: ALL_TYPES.filter((c) => c.type !== 'GEOMETRY') } })).notices.join('\n')

  it('GeoJSON: big integers, dates, nested values and blobs', () => {
    const n = typed('geojson')
    expect(n).toMatch(/"big".*"huge".*beyond 2\^53.*text/)
    expect(n).toMatch(/"since".*"updated".*ISO/)
    expect(n).toMatch(/"tags".*"info".*JSON/)
    expect(n).toMatch(/"payload".*base64/)
  })

  it('CSV: nested values and blobs as text', () => {
    const n = typed('csv')
    expect(n).toMatch(/"tags".*"info".*text/)
    expect(n).toMatch(/"payload".*text/)
    expect(n).not.toMatch(/2\^53/)
  })

  it('GeoParquet keeps every type: no type notices', () => {
    expect(typed('geoparquet')).not.toMatch(/"tags"|"payload"|"big"/)
  })

  it('rows without valid geometry are counted when known', () => {
    const p = planExport(request({ rows: 'shown' }), ctx({ layer: { ...ctx().layer, invalidGeometryCount: 3 } }))
    expect(p.notices.join()).toMatch(/3 rows have no valid geometry/)
  })
})

describe('file names', () => {
  it('<source>-export.<ext>', () => {
    expect(planExport(request({ format: 'geojson' }), ctx()).fileName).toBe('parcels-export.geojson')
    expect(planExport(request(), ctx({ sourceName: 'world.shp' })).fileName).toBe('world-export.parquet')
    expect(planExport(request({ format: 'csv' }), ctx({ sourceName: 'data.v2.gpkg' })).fileName).toBe('data.v2-export.csv')
  })
})
