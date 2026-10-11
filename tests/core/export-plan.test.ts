// T006 (spec 005, contracts/export-core.md planExport): what an export will
// do, decided before anything runs: rows, formats, CRS, notices, SQL, name.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { planExport, type ExportPlanContext, type ExportRequest } from '@spatial-explorer/core'

const ALL_TYPES = (JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/export/columns.json`, 'utf8')) as { columns: Array<{ name: string; type: string }> }).columns

const request = (patch: Partial<ExportRequest> = {}): ExportRequest => ({ format: 'geoparquet', crs: 'result', csvGeometry: 'wkt', ...patch })

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

describe('which rows (FR-002; spec 007 FR-009: nothing is display-limited)', () => {
  it('the default view exports the whole file from layer', () => {
    const p = planExport(request(), ctx({ layer: { ...ctx().layer, rowCount: 22000 } }))
    expect(p.rowCount).toBe(22000)
    expect(p.source).toBe('layer')
    expect(p.sql).toMatch(/FROM "?layer"?(\s|$)/)
    expect(p.sql).not.toMatch(/LIMIT/)
  })

  it('a query result exports all of its rows from __se_result', () => {
    const c = ctx({ facts: { ...ctx().facts, defaultView: false, totalRows: 60000 }, layer: { ...ctx().layer, rowCount: 60000 } })
    expect(planExport(request(), c)).toMatchObject({ rowCount: 60000, source: 'result' })
    expect(planExport(request(), c).sql).toMatch(/FROM __se_result/)
    expect(planExport(request(), c).sql).not.toMatch(/LIMIT/)
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
    const p = planExport(request(), ctx({ layer: { ...ctx().layer, invalidGeometryCount: 3 } }))
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

// T009/T024: the runner's pure parts.
import { copyOptions, exportErrorMessage, exportTarget } from '@spatial-explorer/core'

describe('runner details', () => {
  it('writes only under the allowed source directory, with protected __se_ names', () => {
    const a = exportTarget('.parquet')
    const b = exportTarget('.parquet')
    expect(a).toMatch(/^\/se-source\/__se_export-\d+\.parquet$/)
    expect(a).not.toBe(b)
  })

  it('GeoParquet turns off DuckDB metadata and carries ours, quoted for SQL', () => {
    expect(copyOptions('geoparquet', `{"a":"it's"}`)).toBe(`(FORMAT PARQUET, GEOPARQUET_VERSION 'NONE', KV_METADATA {geo: '{"a":"it''s"}'})`)
    expect(copyOptions('parquet')).toBe(`(FORMAT PARQUET, GEOPARQUET_VERSION 'NONE')`)
    expect(copyOptions('csv')).toBe('(FORMAT CSV, HEADER)')
  })

  it('out-of-memory failures get an actionable message (FR-011)', () => {
    const oom = 'The export ran out of memory. Filter the result or choose GeoParquet (smallest).'
    expect(exportErrorMessage(new Error('Out of Memory Error: failed to allocate block'))).toBe(oom)
    expect(exportErrorMessage(new RangeError('Array buffer allocation failed'))).toBe(oom)
    expect(exportErrorMessage(new Error('Binder Error: x\nLINE 1'))).toBe('Binder Error: x')
  })
})

// T016 (spec 007): hidden engine columns never leave core.
describe('hidden columns (spec 007)', () => {
  it('are never selected, whatever the format', () => {
    const c = ctx({ layer: { ...ctx().layer, columns: [...ctx().layer.columns, { name: '__se_rowid', type: 'BIGINT' }, { name: '__se_xmin', type: 'DOUBLE' }] } })
    for (const format of ['geoparquet', 'geojson', 'csv'] as const) {
      const sql = planExport(request({ format }), c).sql
      expect(sql, format).not.toMatch(/__se_(rowid|xmin)/)
    }
  })
})

// T030 (spec 008 FR-014): all rows, the filtered rows, or the selected rows.
describe('export scope', () => {
  const base = () => ctx({ layer: { ...ctx().layer, rowCount: 22000 } })

  it('offers only the scopes that apply, with their row counts', () => {
    expect(planExport(request(), base()).scopes).toEqual([{ id: 'all', rows: 22000 }])
    const p = planExport(request(), { ...base(), scopes: { filtered: 1204, selected: 3 } })
    expect(p.scopes).toEqual([
      { id: 'all', rows: 22000 },
      { id: 'filtered', rows: 1204 },
      { id: 'selected', rows: 3 },
    ])
  })

  it('a chosen scope sets the row count; the select list is kept for the session to narrow', () => {
    const p = planExport(request({ scope: 'selected' }), { ...base(), scopes: { filtered: 1204, selected: 3 } })
    expect(p.scope).toBe('selected')
    expect(p.rowCount).toBe(3)
    expect(p.sql).toBe(`SELECT ${p.select} FROM "layer"`)
  })

  it('a scope that does not apply falls back to all rows', () => {
    const p = planExport(request({ scope: 'filtered' }), base())
    expect(p.scope).toBe('all')
    expect(p.rowCount).toBe(22000)
  })
})
