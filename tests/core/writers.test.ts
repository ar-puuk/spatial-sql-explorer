// T048 (spec 008 US4, research §3): the JS export writers, read back with
// their formats' own readers in Node (flatgeobuf, sql.js, unzip). The engine
// and QGIS read-backs are in tests/web/specs/export-formats.spec.ts and
// tests/qgis/read_back.py.
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { unzipSync, strFromU8 } from 'fflate'
import { geojson as fgb } from 'flatgeobuf'
import initSqlJs from 'sql.js'
import type { Geometry } from 'geojson'
import {
  columnLetters,
  dbfFieldNames,
  dbfRenames,
  flatGeobufWriter,
  geoPackageWriter,
  gpkgGeometry,
  kmlWriter,
  shapefileWriter,
  toWkb,
  writerColumnsOf,
  xlsxWriter,
  type RowWriter,
} from '@spatial-explorer/core'

const require = createRequire(import.meta.url)
const sqlWasm = require.resolve('sql.js/dist/sql-wasm.wasm')

const columns = writerColumnsOf([
  { name: 'name', type: 'VARCHAR' },
  { name: 'population', type: 'BIGINT' },
  { name: 'area', type: 'DOUBLE' },
  { name: 'open', type: 'BOOLEAN' },
  { name: 'founded', type: 'DATE' },
  { name: 'a very long column name', type: 'INTEGER' },
])
// A CCW square (RFC 7946 orientation) with a CW hole, and a point.
const square: Geometry = {
  type: 'Polygon',
  coordinates: [
    [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
    [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]],
  ],
}
const rows = [
  { values: ['Alpha & <Co>', 12n, 1.5, true, '2020-05-01', 7], geometry: square },
  { values: ["O'Brien", 9007199254740993n, null, false, null, 8], geometry: { type: 'MultiPolygon', coordinates: [square.coordinates] } as Geometry },
  { values: [null, null, 3, null, '1999-12-31', null], geometry: null },
]
const write = async (w: RowWriter | Promise<RowWriter>): Promise<Uint8Array> => {
  const writer = await w
  for (const r of rows) writer.add(r)
  return writer.finish()
}

describe('helpers', () => {
  it('DBF names: 10 characters, unique ignoring case, ASCII', () => {
    expect(dbfFieldNames(['a very long column name', 'a very long column name 2', 'Ünïcode', 'ok'])).toEqual(['a_very_lon', 'a_very_l_1', 'Unicode', 'ok'])
    expect(dbfRenames(['short', 'a very long column name'])).toEqual([{ from: 'a very long column name', to: 'a_very_lon' }])
  })
  it('spreadsheet column letters', () => {
    expect([0, 25, 26, 701, 702].map(columnLetters)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA'])
  })
  it('WKB of a point, little endian', () => {
    const b = toWkb({ type: 'Point', coordinates: [1, 2] })
    const v = new DataView(b.buffer)
    expect([b[0], v.getUint32(1, true), v.getFloat64(5, true), v.getFloat64(13, true)]).toEqual([1, 1, 1, 2])
  })
  it('GeoPackage geometry header: GP, little endian, XY envelope, srs id', () => {
    const b = gpkgGeometry(square, 4326)
    const v = new DataView(b.buffer)
    expect([b[0], b[1], b[3] & 0b1110, v.getInt32(4, true)]).toEqual([0x47, 0x50, 0b10, 4326])
    expect([v.getFloat64(8, true), v.getFloat64(16, true), v.getFloat64(24, true), v.getFloat64(32, true)]).toEqual([0, 4, 0, 4])
  })
})

describe('KML', () => {
  it('placemarks with names, escaped data and boundaries', async () => {
    const kml = strFromU8(await write(kmlWriter(columns, 'cities')))
    expect(kml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<kml xmlns="http:\/\/www.opengis.net\/kml\/2.2"><Document><name>cities<\/name>/)
    expect(kml.match(/<Placemark>/g)).toHaveLength(3)
    expect(kml).toContain('<name>Alpha &amp; &lt;Co&gt;</name>')
    expect(kml).toContain('<Data name="name"><value>O&apos;Brien</value></Data>')
    expect(kml).toContain('<outerBoundaryIs><LinearRing><coordinates>0,0 4,0 4,4 0,4 0,0</coordinates></LinearRing></outerBoundaryIs><innerBoundaryIs>')
    expect(kml).toContain('<MultiGeometry><Polygon>')
    expect(kml.trim().endsWith('</Document></kml>')).toBe(true)
  })
})

describe('FlatGeobuf', () => {
  it('reads back with the flatgeobuf library: count, properties, geometry, CRS', async () => {
    const bytes = await write(flatGeobufWriter(columns, 26912))
    expect([...bytes.slice(0, 3)]).toEqual([0x66, 0x67, 0x62])
    let header: { crs: { code: number } | null; featuresCount: number } | null = null
    const features = []
    for await (const f of fgb.deserialize(bytes, { headerMetaFn: (h) => (header = h as unknown as typeof header) })) features.push(f)
    expect(features).toHaveLength(3)
    expect(header!.featuresCount).toBe(3)
    expect(header!.crs?.code).toBe(26912)
    expect(features[0].properties).toMatchObject({ name: 'Alpha & <Co>', area: 1.5, open: true, founded: '2020-05-01' })
    expect(features[0].geometry.type).toBe('Polygon')
    expect((features[0].geometry as { coordinates: number[][][] }).coordinates).toHaveLength(2)
    expect(features[1].geometry.type).toBe('MultiPolygon')
  })
})

describe('Shapefile (zip)', () => {
  it('one polygon set, with .shp/.shx/.dbf/.prj/.cpg and outer rings clockwise', async () => {
    const files = unzipSync(await write(shapefileWriter(columns, 'cities', 'GEOGCS["WGS 84"]')))
    expect(Object.keys(files).sort()).toEqual(['cities.cpg', 'cities.dbf', 'cities.prj', 'cities.shp', 'cities.shx'])
    const shp = new DataView(files['cities.shp'].buffer, files['cities.shp'].byteOffset)
    expect(shp.getInt32(0, false)).toBe(9994)
    expect(shp.getInt32(24, false) * 2).toBe(files['cities.shp'].length)
    expect(shp.getInt32(32, true)).toBe(5) // polygon
    // .shx: one record per row (the row without geometry is a null shape).
    expect((files['cities.shx'].length - 100) / 8).toBe(3)
    // The first record's outer ring was CCW in GeoJSON: now clockwise (0,0 -> 0,4 ...).
    const first = 100 + 8
    const numParts = shp.getInt32(first + 36, true)
    expect(numParts).toBe(2)
    const pointsAt = first + 44 + 4 * numParts
    expect([shp.getFloat64(pointsAt + 16, true), shp.getFloat64(pointsAt + 24, true)]).toEqual([0, 4])
    // .dbf: 3 records, 6 fields, names cut to 10 characters.
    const dbf = files['cities.dbf']
    const dv = new DataView(dbf.buffer, dbf.byteOffset)
    expect(dv.getUint32(4, true)).toBe(3)
    expect((dv.getUint16(8, true) - 33) / 32).toBe(6)
    const names = Array.from({ length: 6 }, (_, i) => strFromU8(dbf.slice(32 + i * 32, 32 + i * 32 + 11)).replace(/\0+$/, ''))
    expect(names).toEqual(['name', 'population', 'area', 'open', 'founded', 'a_very_lon'])
    expect(String.fromCharCode(...[1, 3, 4].map((i) => dbf[32 + i * 32 + 11]))).toBe('NLD')
    expect(strFromU8(files['cities.cpg'])).toBe('UTF-8')
  })

  it('a mixed result becomes one set per geometry type', async () => {
    const w = shapefileWriter(columns, 'mixed', null)
    w.add({ values: rows[0].values, geometry: { type: 'Point', coordinates: [1, 2] } })
    w.add({ values: rows[0].values, geometry: square })
    const files = unzipSync(await w.finish())
    expect(Object.keys(files).filter((n) => n.endsWith('.shp')).sort()).toEqual(['mixed_points.shp', 'mixed_polygons.shp'])
  })
})

describe('Excel workbook', () => {
  it('a valid package: header row, inline strings, numbers, booleans', async () => {
    const files = unzipSync(await write(xlsxWriter(columns)))
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'])
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml'])
    expect(sheet.match(/<row /g)).toHaveLength(4)
    expect(sheet).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">name</t></is></c>')
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Alpha &amp; &lt;Co&gt;</t></is></c>')
    expect(sheet).toContain('<c r="B2"><v>12</v></c>')
    expect(sheet).toContain('<c r="D2" t="b"><v>1</v></c>')
    // A big integer beyond 2^53 stays exact, as text.
    expect(sheet).toContain('<c r="B3" t="inlineStr"><is><t xml:space="preserve">9007199254740993</t></is></c>')
  })
})

describe('GeoPackage', () => {
  it('reads back with sql.js: the required tables, the features, the geometry blobs', async () => {
    const bytes = await write(geoPackageWriter(columns, { table: 'cities', geometryColumn: 'geom', srid: 4326, wkt: 'GEOGCS["WGS 84"]', sqlWasmUrl: sqlWasm }))
    const SQL = await initSqlJs({ locateFile: () => sqlWasm })
    const db = new SQL.Database(bytes)
    const one = (sql: string) => db.exec(sql)[0]?.values ?? []
    expect(one('PRAGMA application_id')[0][0]).toBe(1196444487)
    expect(one("SELECT table_name, data_type, srs_id FROM gpkg_contents")).toEqual([['cities', 'features', 4326]])
    expect(one('SELECT column_name, geometry_type_name, srs_id FROM gpkg_geometry_columns')).toEqual([['geom', 'GEOMETRY', 4326]])
    expect(one('SELECT count(*) FROM cities')[0][0]).toBe(3)
    // GDAL's feature count: without it the WASM build can't reopen the file.
    expect(one('SELECT table_name, feature_count FROM gpkg_ogr_contents')).toEqual([['cities', 3]])
    // Integers beyond 2^53 are stored exactly (read as text: sql.js returns JS numbers).
    expect(one('SELECT name, CAST(population AS TEXT), area, open FROM cities ORDER BY fid')).toEqual([
      ['Alpha & <Co>', '12', 1.5, 1],
      ["O'Brien", '9007199254740993', null, 0],
      [null, null, 3, null],
    ])
    expect(one('SELECT typeof(population) FROM cities WHERE fid = 2')[0][0]).toBe('integer')
    const blob = one('SELECT geom FROM cities WHERE fid = 1')[0][0] as Uint8Array
    expect(String.fromCharCode(blob[0], blob[1])).toBe('GP')
    expect(one('SELECT geom IS NULL FROM cities WHERE fid = 3')[0][0]).toBe(1)
    expect(one('PRAGMA integrity_check')[0][0]).toBe('ok')
    db.close()
  })
})
