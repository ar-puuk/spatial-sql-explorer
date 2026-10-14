// Research §16: GeoPackage layers read through GDAL's SQLite driver, SQLite /
// SpatiaLite databases, and restored primary keys. Pure SQL builders here;
// the engine runs them in tests/web/specs/sqlite-sources.spec.ts.
import { describe, expect, it } from 'vitest'
import { clearGeoPackageId, formatFromFileName, gpkgGeometrySql, isSystemTable, isThreadSpawnError, layerReadSql, mayHaveLayers, readModeFor, stReadSql } from '@spatial-explorer/core'

describe('SQLite files', () => {
  it('.sqlite and .db are SQLite databases, read whole and listed by layer', () => {
    expect(formatFromFileName('WFv1000_MasterNet.sqlite')).toBe('sqlite')
    expect(formatFromFileName('network.DB')).toBe('sqlite')
    expect(readModeFor('sqlite', 10, { partialReads: true }).mode).toBe('whole')
    expect(mayHaveLayers('sqlite')).toBe(true)
  })
  it('bookkeeping tables are never layers', () => {
    for (const t of ['sqlite_sequence', 'spatial_ref_sys', 'spatial_ref_sys_aux', 'geometry_columns_statistics', 'views_geometry_columns', 'idx_cubedb__BY__node_geom_rowid', 'SpatialIndex', 'KNN2', 'gpkg_contents', 'rtree_zones_geom'])
      expect(isSystemTable(t), t).toBe(true)
    for (const t of ['cubedb__BY__node', 'cubedb__BY__transit_mode', 'zones', 'geometry']) expect(isSystemTable(t), t).toBe(false)
  })
})

describe('GeoPackage read as plain SQLite', () => {
  it('recognizes the engine failing to start a reader thread', () => {
    expect(isThreadSpawnError(new Error('Invalid Error: thread constructor failed: Resource temporarily unavailable'))).toBe(true)
    expect(isThreadSpawnError(new Error('IO Error: GDAL Error (4)'))).toBe(false)
  })
  it('clears the GeoPackage application id only', () => {
    const header = (id: string): Uint8Array => {
      const b = new Uint8Array(100)
      b.set(new TextEncoder().encode(id), 68)
      return b
    }
    for (const id of ['GPKG', 'GP10', 'GP11']) expect([...clearGeoPackageId(header(id)).subarray(68, 72)]).toEqual([0, 0, 0, 0])
    expect(new TextDecoder().decode(clearGeoPackageId(header('ABCD')).subarray(68, 72))).toBe('ABCD')
  })
  it('decodes the geometry after the header and the envelope its flags announce', () => {
    const sql = gpkgGeometrySql('r."geom"')
    expect(sql).toContain('r."geom"[4:4]')
    expect(sql).toContain('[0, 32, 48, 48, 64]')
    expect(sql).toMatch(/^TRY\(ST_GeomFromWKB\(r\."geom"\[9 \+ /)
  })
})

describe('layer readers', () => {
  const reader = stReadSql('/se-source/a.sqlite', "o'brien", ['LIST_ALL_TABLES=YES'])
  it('ST_Read with the layer and open options quoted', () => {
    expect(reader).toBe(`ST_Read('/se-source/a.sqlite', layer := 'o''brien', open_options := ['LIST_ALL_TABLES=YES'])`)
    expect(stReadSql('/se-source/a.gpkg', 'zones')).toBe(`ST_Read('/se-source/a.gpkg', layer := 'zones')`)
  })
  it('a plain read is the reader itself', () => {
    expect(layerReadSql({ reader, decodeGeometry: null })).toBe(reader)
  })
  it('a GeoPackage blob is decoded in place of the raw column', () => {
    // The engine reads the feature id itself (spec 010 S5): no key to join.
    const sql = layerReadSql({ reader, decodeGeometry: 'geom' })
    expect(sql).toContain('(SELECT r.* EXCLUDE ("geom"), TRY(ST_GeomFromWKB(')
    expect(sql).toContain(`) AS "geom" FROM ${reader} r)`)
  })
})
