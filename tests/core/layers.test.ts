// T038 (spec 008 US3, FR-015–FR-018): which layer opens, how layers are read
// and named, and File Geodatabase detection. Listing runs in the real engine
// in tests/web/specs/layers.spec.ts.
import { describe, expect, it } from 'vitest'
import { activeLayerOf, GDB_UNSUPPORTED, isFileGeodatabase, mayHaveLayers, readLayerSql, type FileLayer } from '@spatial-explorer/core'

const L = (name: string, geometryType: FileLayer['geometryType']): FileLayer => ({ name, geometryType, geometryColumn: geometryType ? 'geom' : null, featureCount: 1, srid: 4326 })
const layers = [L('lookup', null), L('roads', 'LineString'), L('parcels', 'Polygon')]

describe('activeLayerOf', () => {
  it('the requested layer, else the first with geometry, else the first', () => {
    expect(activeLayerOf(layers, 'parcels')?.name).toBe('parcels')
    expect(activeLayerOf(layers)?.name).toBe('roads')
    expect(activeLayerOf(layers, 'missing')?.name).toBe('roads')
    expect(activeLayerOf([L('a', null), L('b', null)])?.name).toBe('a')
    expect(activeLayerOf([])).toBeNull()
  })
})

describe('reading a layer', () => {
  it('quotes the path and the layer name as literals', () => {
    expect(readLayerSql('/se-source/a.gpkg', "city's points")).toBe(`ST_Read('/se-source/a.gpkg', layer = 'city''s points')`)
    expect(readLayerSql('/se-source/a.gpkg', null)).toBe(`ST_Read('/se-source/a.gpkg')`)
  })
  it('only GeoPackage, SQLite and GML are listed (their catalog is cheap to read)', () => {
    expect(mayHaveLayers('geopackage')).toBe(true)
    expect(mayHaveLayers('sqlite')).toBe(true)
    expect(mayHaveLayers('geojson')).toBe(false)
  })
})

describe('File Geodatabase', () => {
  it('is recognized as a folder, a file inside one, or a zip of one', () => {
    for (const n of ['two.gdb', 'C:/data/two.gdb', 'two.gdb/a00000001.gdbtable', 'two.gdb.zip', 'a00000004.gdbtable']) expect(isFileGeodatabase(n)).toBe(true)
    for (const n of ['two.gpkg', 'gdb.geojson', 'gdbx.zip']) expect(isFileGeodatabase(n)).toBe(false)
  })
  it('the message says why and how to convert', () => {
    expect(GDB_UNSUPPORTED).toMatch(/isn't supported yet/)
    expect(GDB_UNSUPPORTED).toContain('ogr2ogr -f GPKG')
  })
})
