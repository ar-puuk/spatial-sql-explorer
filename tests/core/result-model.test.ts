// T015 (spec 007, research §9, contracts/core-data-access.md): the SQL that
// defines `layer` and its hidden columns, per read mode. Pure builders; no engine.
import { describe, expect, it } from 'vitest'
import { HIDDEN_COLUMNS, internalLayerViewSql, isHiddenColumn, publicLayerViewSql, visibleColumns } from '@spatial-explorer/core'

const attrs = ['parcel_id', 'zone', 'value']

describe('hidden columns', () => {
  it('are the row id and the bbox', () => {
    expect(HIDDEN_COLUMNS).toEqual(['__se_rowid', '__se_xmin', '__se_ymin', '__se_xmax', '__se_ymax'])
  })

  it('every __se_ name is hidden, and stripped from column lists', () => {
    expect(isHiddenColumn('__se_rowid')).toBe(true)
    expect(isHiddenColumn('__se_anything')).toBe(true)
    expect(isHiddenColumn('se_rowid')).toBe(false)
    expect(visibleColumns([{ name: 'zone', type: 'VARCHAR' }, { name: '__se_xmin', type: 'DOUBLE' }, { name: 'geom', type: 'GEOMETRY' }])).toEqual([
      { name: 'zone', type: 'VARCHAR' },
      { name: 'geom', type: 'GEOMETRY' },
    ])
  })
})

describe('the internal layer view (__se_layer)', () => {
  it('GeoParquet with a covering bbox: row ids from file_row_number, bbox from the struct', () => {
    const sql = internalLayerViewSql({ kind: 'parquet', path: '/se-source/p.parquet', attrs, geomExpr: '"geom"', geomName: 'geom', covering: 'bbox' })
    expect(sql).toMatch(/^CREATE OR REPLACE VIEW __se_layer AS SELECT /)
    expect(sql).toContain(`read_parquet('/se-source/p.parquet', file_row_number := true)`)
    expect(sql).toContain('"parcel_id", "zone", "value", "geom" AS "geom"')
    expect(sql).toContain('file_row_number AS __se_rowid')
    expect(sql).toContain('"bbox".xmin AS __se_xmin')
    expect(sql).toContain('"bbox".ymax AS __se_ymax')
    expect(sql).not.toMatch(/ST_XMin/)
  })

  it('GeoParquet without a covering bbox computes it from the geometry (views use the bbox index instead)', () => {
    const sql = internalLayerViewSql({ kind: 'parquet', path: '/se-source/p.parquet', attrs, geomExpr: 'ST_GeomFromWKB("wkb")', geomName: 'geom', covering: null })
    expect(sql).toContain('ST_GeomFromWKB("wkb") AS "geom"')
    expect(sql).toContain('ST_XMin(ST_GeomFromWKB("wkb")) AS __se_xmin')
    expect(sql).toContain('file_row_number AS __se_rowid')
  })

  it('a parsed table already holds the hidden columns', () => {
    const sql = internalLayerViewSql({ kind: 'table', table: '__se_source', attrs, geomExpr: '"geom"', geomName: 'geom' })
    expect(sql).toBe('CREATE OR REPLACE VIEW __se_layer AS SELECT "parcel_id", "zone", "value", "geom" AS "geom", __se_rowid, __se_xmin, __se_ymin, __se_xmax, __se_ymax FROM __se_source')
  })

  it('a reader without stored hidden columns numbers rows in read order', () => {
    const sql = internalLayerViewSql({ kind: 'reader', from: '__se_source', attrs, geomExpr: 'ST_Point(lon, lat)', geomName: 'geom' })
    expect(sql).toContain('row_number() OVER () - 1 AS __se_rowid')
    expect(sql).toContain('ST_XMin(ST_Point(lon, lat)) AS __se_xmin')
    expect(sql).toMatch(/FROM __se_source$/)
  })

  it('FlatGeobuf read in parts: ST_Read with computed bbox and the feature id', () => {
    const sql = internalLayerViewSql({ kind: 'st_read', path: '/se-source/p.fgb', attrs, geomExpr: '"geom"', geomName: 'geom', rowidExpr: '"fid"' })
    expect(sql).toContain(`FROM ST_Read('/se-source/p.fgb')`)
    expect(sql).toContain('"fid" AS __se_rowid')
    expect(sql).toContain('ST_YMax("geom") AS __se_ymax')
  })

  it('quotes identifiers and escapes paths', () => {
    const sql = internalLayerViewSql({ kind: 'parquet', path: "/se-source/o'brien.parquet", attrs: ['we"ird'], geomExpr: '"geom"', geomName: 'geom', covering: 'b"ox' })
    expect(sql).toContain(`'/se-source/o''brien.parquet'`)
    expect(sql).toContain('"we""ird"')
    expect(sql).toContain('"b""ox".xmin')
  })
})

describe('the public layer view', () => {
  it('reads the same source directly, without hidden columns or a row-number window', () => {
    const src = { kind: 'parquet' as const, path: '/se-source/p.parquet', attrs, geomExpr: '"geom"', geomName: 'geom', covering: 'bbox' }
    expect(publicLayerViewSql(src)).toBe(`CREATE OR REPLACE VIEW layer AS SELECT "parcel_id", "zone", "value", "geom" AS "geom" FROM read_parquet('/se-source/p.parquet', file_row_number := true)`)
    const reader = publicLayerViewSql({ kind: 'reader', from: '__se_source', attrs, geomExpr: '"geom"', geomName: 'geom' })
    expect(reader).not.toMatch(/row_number|__se_rowid|__se_xmin/)
    expect(reader).toBe('CREATE OR REPLACE VIEW layer AS SELECT "parcel_id", "zone", "value", "geom" AS "geom" FROM __se_source')
  })
})
