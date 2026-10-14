// The names a query uses for the opened file (user decision 2026-10-14):
// `us_counties`, quoted when it can't be typed bare, and `<file>.<layer>` for
// the layers of a file holding several.
import { describe, expect, it } from 'vitest'
import { cleanSqlName, defaultQueryFor, fileSqlNames, isDefaultQuery } from '@spatial-explorer/core'

const reserved = new Set(['select', 'from', 'order', 'left'])

describe('file names in SQL', () => {
  it('lower case, other characters as one underscore', () => {
    expect(cleanSqlName('us-counties')).toBe('us_counties')
    expect(cleanSqlName('2020 Tracts (final)')).toBe('2020_tracts_final')
    expect(cleanSqlName('cubedb__BY__node')).toBe('cubedb__by__node')
    expect(cleanSqlName('__se_layer')).toBe('se_layer')
    expect(cleanSqlName('---')).toBeNull()
  })

  it('a single-layer file: its name, quoted when it starts with a digit or is reserved', () => {
    expect(fileSqlNames('us-counties.parquet', null, null, reserved)).toEqual({ alias: 'us_counties', schema: null, layers: new Map() })
    expect(fileSqlNames('C:/data/2020 Tracts.gpkg', null, null, reserved).alias).toBe('"2020_tracts"')
    expect(fileSqlNames('select.csv', null, null, reserved).alias).toBe('"select"')
    expect(fileSqlNames('name.csv', null, null, reserved).alias).toBe('name')
    expect(fileSqlNames('layer.geojson', null, null, reserved).alias).toBeNull()
    expect(fileSqlNames('???.geojson', null, null, reserved).alias).toBeNull()
  })

  it('a multi-layer file: a schema named after it, each layer inside it', () => {
    const n = fileSqlNames('us_boundaries.gpkg', ['counties', 'states', 'city points', 'City-Points', 'order'], 'counties', reserved)
    expect(n.schema).toBe('us_boundaries')
    expect(n.alias).toBe('us_boundaries.counties')
    expect([...n.layers.values()]).toEqual(['us_boundaries.counties', 'us_boundaries.states', 'us_boundaries.city_points', 'us_boundaries.city_points_2', 'us_boundaries."order"'])
    expect(fileSqlNames('2020.sqlite', ['a', 'b'], 'b', reserved).alias).toBe('"2020".b')
    // Schemas DuckDB already has can't be taken.
    expect(fileSqlNames('main.gpkg', ['a', 'b'], 'a', reserved).alias).toBe('main_file.a')
  })

  it('the default query names the file; `SELECT * FROM layer` stays the same view', () => {
    expect(defaultQueryFor('us_counties')).toBe('SELECT * FROM us_counties')
    expect(defaultQueryFor(null)).toBe('SELECT * FROM layer')
    expect(isDefaultQuery('select *  from US_COUNTIES;', defaultQueryFor('us_counties'))).toBe(true)
  })
})
