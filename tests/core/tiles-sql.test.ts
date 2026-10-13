// Spec 010 T012: the SQL building one engine vector tile (ST_AsMVT). Pure builders.
import { describe, expect, it } from 'vitest'
import { tileBoundsWgs84, tileSql, TILE_LAYER, type ViewTarget } from '@spatial-explorer/core'

const covering: ViewTarget = { relation: '__se_layer', index: 'columns', geom: '"geom"', srid: 4326, attrs: ['zone', 'pop'] }
const box: [number, number, number, number] = [-112.5, 39.9, -111.1, 41.01]

describe('tile bounds', () => {
  const near = (a: number[], b: number[]): void => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 4))

  it('z0 is the whole Web Mercator world', () => {
    near(tileBoundsWgs84(0, 0, 0), [-180, -85.0511, 180, 85.0511])
  })

  it('z1 x1 y0 is the north-east quarter', () => {
    near(tileBoundsWgs84(1, 1, 0), [0, 0, 180, 85.0511])
  })
})

describe('tileSql', () => {
  const sql = tileSql(covering, 8, 48, 97, box, [
    { name: 'zone', type: 'VARCHAR' },
    { name: 'pop', type: 'INTEGER' },
  ])
  // 2 px of a 512 px tile: the tile's width / 256.
  const span = (box[2] - box[0]) / 256
  const small = `(ST_Dimension("geom") > 0 AND __se_xmax - __se_xmin < ${span} AND __se_ymax - __se_ymin < ${span})`

  it('builds one MVT layer with the row id, typed properties and the tile geometry', () => {
    expect(TILE_LAYER).toBe('data')
    expect(sql).toContain('ST_AsMVT(')
    expect(sql).toContain(`'data') AS tile`)
    expect(sql).toContain(`'__id': __se_rowid`)
    expect(sql).toContain(`'pop': CAST("pop" AS DOUBLE)`)
    expect(sql).toContain(`'zone': CAST("zone" AS VARCHAR)`)
    expect(sql).toContain(`ST_AsMVTGeom(ST_Transform(CASE WHEN ${small} THEN ST_Centroid("geom") ELSE "geom" END, 'EPSG:4326', 'EPSG:3857', always_xy := true), ST_Extent(ST_TileEnvelope(8, 48, 97)))`)
  })

  it('sends lines and polygons under ~2 px of the tile as their center, marked as dots (option C)', () => {
    expect(sql).toContain(`'__se_dot': ${small}`)
  })

  it('prunes rows by bbox constants and caps the tile', () => {
    expect(sql).toContain('__se_xmin <= -111.1 AND __se_xmax >= -112.5 AND __se_ymin <= 41.01 AND __se_ymax >= 39.9')
    expect(sql).toContain('LIMIT 50000')
    expect(sql).toContain('"geom" IS NOT NULL AND ST_IsValid("geom")')
  })

  it('quotes awkward names: a string key with doubled quotes, an identifier for the column', () => {
    const s = tileSql(covering, 1, 0, 0, box, [{ name: "it's", type: 'BOOLEAN' }])
    expect(s).toContain(`'it''s': "it's"`)
  })

  it('sends lists and structs as text, not numbers', () => {
    const s = tileSql(covering, 1, 0, 0, box, [
      { name: 'ids', type: 'INTEGER[]' },
      { name: 'meta', type: 'STRUCT(a INTEGER)' },
      { name: 'price', type: 'DECIMAL(10,2)' },
      { name: 'gap', type: 'INTERVAL' },
    ])
    expect(s).toContain(`'ids': CAST("ids" AS VARCHAR)`)
    expect(s).toContain(`'meta': CAST("meta" AS VARCHAR)`)
    expect(s).toContain(`'price': CAST("price" AS DOUBLE)`)
    expect(s).toContain(`'gap': CAST("gap" AS VARCHAR)`)
  })

  it('reads a bbox index table when the relation has no bbox columns, and transforms a projected layer', () => {
    const s = tileSql({ ...covering, index: 'bbox-table', srid: 26912 }, 10, 196, 388, box, [])
    expect(s).toContain('__se_rowid IN (SELECT rn FROM (SELECT rn, xmin, ymin, xmax, ymax FROM __se_bbox WHERE')
    expect(s).toContain(`ST_XMax("geom") - ST_XMin("geom") <`)
    expect(s).toContain(`ELSE "geom" END, 'EPSG:26912', 'EPSG:3857', always_xy := true)`)
  })
})
