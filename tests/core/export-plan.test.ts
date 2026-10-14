// T006 (spec 005, contracts/export-core.md planExport): what an export will
// do, decided before anything runs: rows, formats, CRS, notices, SQL, name.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { exportFileBase, planExport, type ExportPlanContext, type ExportRequest } from '@spatial-explorer/core'

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
  it('a geometry result offers the spatial formats (spec 008), not the attribute ones', () => {
    const f = planExport(request(), ctx()).formats
    expect(f.filter((x) => x.available).map((x) => x.id).sort()).toEqual(['csv', 'flatgeobuf', 'geojson', 'geojsonseq', 'geopackage', 'geoparquet', 'kml', 'shapefile'])
    expect(f.find((x) => x.id === 'parquet')?.reason).toMatch(/listed under "Attributes only"/)
  })

  it('an attribute-only format asked for without a geometry choice leaves the geometry out', () => {
    const p = planExport(request({ format: 'xlsx' }), ctx())
    expect(p.format).toBe('xlsx')
    expect(p.includeGeometry).toBe(false)
  })

  it('"Include geometry" off offers the attribute formats, and the SQL has no geometry (spec 008 FR-019)', () => {
    const p = planExport(request({ format: 'xlsx', includeGeometry: false }), ctx())
    expect(p.includeGeometry).toBe(false)
    expect(p.formats.filter((x) => x.available).map((x) => x.id).sort()).toEqual(['csv', 'json', 'parquet', 'xlsx'])
    expect(p.format).toBe('xlsx')
    expect(p.sql).not.toMatch(/geom/)
    expect(p.notices.join()).toMatch(/geometry is left out/)
  })

  it('a format that does not fit the geometry choice is replaced by the first that does', () => {
    expect(planExport(request({ format: 'shapefile', includeGeometry: false }), ctx()).format).toBe('csv')
    expect(planExport(request({ format: 'xlsx', includeGeometry: true }), ctx()).format).toBe('geoparquet')
  })

  it('a table result offers the attribute formats only, with a reason for the others', () => {
    const c = ctx({ facts: { ...ctx().facts, geometryColumn: null, resultCrs: null, defaultView: false, totalRows: 5 }, layer: { ...ctx().layer, rowCount: 5 } })
    const p = planExport(request({ format: 'csv' }), c)
    expect(p.includeGeometry).toBe(false)
    expect(p.formats.filter((x) => x.available).map((x) => x.id).sort()).toEqual(['csv', 'json', 'parquet', 'xlsx'])
    expect(p.formats.find((x) => x.id === 'geojson')?.reason).toMatch(/geometry/)
  })

  it('a DESCRIBE / SHOW result can not be exported, with the reason', () => {
    const p = planExport(request(), ctx({ facts: { ...ctx().facts, exportable: false } }))
    expect(p.formats.every((x) => !x.available)).toBe(true)
    expect(p.blocked).toMatch(/Run a query/)
  })
})

describe('CRS (FR-006)', () => {
  // User request 2026-10-13: the dialog just disables the CRS picker; no notice explains it.
  it('GeoJSON is forced to WGS84, without a notice', () => {
    const p = planExport(request({ format: 'geojson', crs: 'result' }), ctx({ facts: { ...ctx().facts, resultCrs: utm } }))
    expect(p.crs).toMatchObject({ output: 'wgs84', forced: true })
    expect(p.notices.join()).not.toMatch(/WGS84|reprojected/)
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

  it('FlatGeobuf (GDAL, spec 010) gets the geometry itself and converts what GDAL refuses', () => {
    const c = ctx({ layer: { ...ctx().layer, columns: [{ name: 'huge', type: 'HUGEINT' }, { name: 'gap', type: 'INTERVAL' }, { name: 'info', type: 'STRUCT(a INTEGER)' }, { name: 'payload', type: 'BLOB' }, { name: 'geom', type: 'GEOMETRY' }] } })
    const sql = planExport(request({ format: 'flatgeobuf' }), c).sql
    expect(sql).not.toMatch(/ST_AsGeoJSON/)
    expect(sql).toMatch(/THEN "geom" END AS "geom"/)
    expect(sql).toMatch(/CAST\("huge" AS VARCHAR\) AS "huge"/)
    expect(sql).toMatch(/CAST\("gap" AS VARCHAR\) AS "gap"/)
    expect(sql).toMatch(/CAST\(to_json\("info"\) AS VARCHAR\) AS "info"/)
    expect(sql).toMatch(/base64\("payload"\) AS "payload"/)
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

// Spec 008 (user request): export to an EPSG code the user chooses.
describe('custom CRS', () => {
  it('reprojects from the result CRS to the chosen code, and says so', () => {
    const p = planExport(request({ crs: 'custom', crsCode: 3857 }), ctx({ facts: { ...ctx().facts, resultCrs: utm } }))
    expect(p.crs).toMatchObject({ output: 'custom', srid: 3857, label: 'EPSG:3857', forced: false })
    expect(p.sql).toContain(`ST_Transform("geom", 'EPSG:26912', 'EPSG:3857', always_xy := true)`)
    expect(p.notices.join()).toMatch(/reprojected from EPSG:26912 to EPSG:3857/)
  })
  it('a WGS84-only format still wins, and a missing code falls back to the result CRS', () => {
    expect(planExport(request({ format: 'geojson', crs: 'custom', crsCode: 3857 }), ctx()).crs.output).toBe('wgs84')
    expect(planExport(request({ crs: 'custom' }), ctx()).crs.output).toBe('result')
  })
  it('the same code as the result needs no transform', () => {
    const p = planExport(request({ crs: 'custom', crsCode: 26912 }), ctx({ facts: { ...ctx().facts, resultCrs: utm } }))
    expect(p.sql).not.toContain('ST_Transform')
  })
})

// Spec 008 (user request): the output file name.
describe('output file name', () => {
  it('defaults to <source>-export, takes a typed name, and keeps the dataset name inside', () => {
    expect(planExport(request(), ctx())).toMatchObject({ fileBase: expect.stringMatching(/-export$/) })
    const p = planExport(request({ format: 'shapefile', fileName: 'Utah parcels 2026' }), ctx())
    expect(p.fileName).toBe('Utah parcels 2026.shp.zip')
    expect(p.layerName).not.toBe('Utah parcels 2026')
  })
  it('is made safe: no folders, no reserved characters, the extension added once', () => {
    expect(exportFileBase('a/b\\c.parquet', '.parquet')).toBe('c')
    expect(exportFileBase('x.shp.zip', '.shp.zip')).toBe('x')
    expect(exportFileBase('x.zip', '.shp.zip')).toBe('x')
    expect(exportFileBase('what? <now>: "yes"|*', '.csv')).toBe('what_ _now__ _yes___')
    expect(exportFileBase('  trailing. ', '.csv')).toBe('trailing')
    expect(exportFileBase('   ', '.csv')).toBe('')
    expect(planExport(request({ fileName: '  ' }), ctx()).fileBase).toMatch(/-export$/)
  })
})
