// Spec 017: the query "Bin into cells" writes (grid/binSql.ts), as text; the engine tests are in tests/web.
import { describe, expect, it } from 'vitest'
import { QuerySession, SELECTED_ROWS_TABLE, binQuerySql, binSkippedSql, binSpecProblem, measureLabel, type BinLayerFacts, type BinSpec, type QueryableTable } from '@spatial-explorer/core'

const facts: BinLayerFacts = {
  geom: '"geom"',
  srid: 4326,
  columns: [
    { name: 'name', type: 'VARCHAR' },
    { name: 'pop', type: 'INTEGER' },
    { name: 'area', type: 'DOUBLE' },
    { name: 'geom', type: 'GEOMETRY' },
  ],
}
const count = (over: Partial<BinSpec> = {}): BinSpec => ({ system: 'h3', resolution: 7, measure: { kind: 'count' }, ...over })

describe('binQuerySql (spec 017)', () => {
  it('writes the H3 count query for a WGS84 layer', () => {
    const q = binQuerySql(count(), facts)!
    expect(q.valueLabel).toBe('Number of features')
    expect(q.sql).toMatchSnapshot()
  })

  it('writes the A5 count query for a projected polygon layer', () => {
    expect(binQuerySql(count({ system: 'a5', resolution: 9 }), { ...facts, srid: 26912 })!.sql).toMatchSnapshot()
  })

  it('has the five output columns in the data model order, cells tagged EPSG:4326', () => {
    for (const system of ['h3', 'a5'] as const) {
      const sql = binQuerySql(count({ system }), facts)!.sql
      expect(sql.split('\n')[0]).toBe('SELECT cell_id, resolution, value, n,')
      expect(sql).toContain('ST_SetCRS(')
      expect(sql).toContain("'EPSG:4326') AS geom")
    }
  })

  it("takes coordinates in each system's own order", () => {
    expect(binQuerySql(count({ system: 'h3' }), facts)!.sql).toContain('h3_latlng_to_cell(ST_Y(p), ST_X(p), 7)')
    const a5 = binQuerySql(count({ system: 'a5', resolution: 9 }), facts)!.sql
    expect(a5).toContain('a5_lonlat_to_cell(ST_X(p), ST_Y(p), 9)')
    expect(a5).toContain('a5_u64_to_hex(cell)')
    expect(a5).toContain('a5_cell_to_geometry(cell)')
  })

  it('assigns by the centroid, so a line or polygon layer works, and leaves a WGS84 layer untransformed', () => {
    const sql = binQuerySql(count(), facts)!.sql
    expect(sql).toContain('ST_Centroid("geom") AS p')
    expect(sql).not.toContain('ST_Transform')
  })

  it('converts a projected layer to longitude/latitude before assigning', () => {
    const sql = binQuerySql(count(), { ...facts, srid: 26912 })!.sql
    expect(sql).toContain(`ST_Transform(ST_Centroid("geom"), 'EPSG:26912', 'EPSG:4326', always_xy := true) AS p`)
  })

  it('reads an unknown CRS as WGS84', () => {
    expect(binQuerySql(count(), { ...facts, srid: null })!.sql).not.toContain('ST_Transform')
  })

  it('leaves out rows without a usable location', () => {
    expect(binQuerySql(count(), facts)!.sql).toContain('WHERE p IS NOT NULL AND NOT ST_IsEmpty(p) AND ST_X(p) BETWEEN -180 AND 180 AND ST_Y(p) BETWEEN -90 AND 90')
  })

  it("uses the layer's geometry column as given, and quotes the measure column", () => {
    const q = binQuerySql(count({ measure: { kind: 'avg', column: 'pop' } }), { ...facts, geom: '"the geom"' })!
    expect(q.sql).toContain('ST_Centroid("the geom")')
    expect(q.sql).toContain('TRY_CAST("pop" AS DOUBLE) AS v')
    expect(q.sql).toContain('avg(v)::DOUBLE AS value')
    expect(q.valueLabel).toBe('Average of pop')
  })

  it('has the other measures', () => {
    for (const kind of ['sum', 'min', 'max', 'median'] as const) {
      expect(binQuerySql(count({ measure: { kind, column: 'area' } }), facts)!.sql).toContain(`${kind}(v)::DOUBLE AS value`)
    }
    expect(measureLabel({ kind: 'median', column: 'area' })).toBe('Median of area')
  })

  it('inlines the rows the layer currently shows (the filters)', () => {
    const where = `("pop" > 10) AND (CAST("name" AS VARCHAR) ILIKE '%a%')`
    const sql = binQuerySql(count(), { ...facts, where })!.sql
    expect(sql).toContain(`FROM layer\n      WHERE (${where})`)
    expect(binQuerySql(count(), facts)!.sql).not.toContain('WHERE ((')
    expect(binQuerySql(count(), facts)!.sql).toContain('FROM layer\n    )')
  })

  it('reads the selected rows from their own table when asked, with the filters on top', () => {
    const f = { ...facts, where: '"pop" > 10', selectedSource: SELECTED_ROWS_TABLE }
    expect(binQuerySql(count({ selectedOnly: true }), f)!.sql).toContain('FROM selected_rows\n      WHERE ("pop" > 10)')
    // Not asked for: the layer, even when a selection table exists.
    expect(binQuerySql(count(), f)!.sql).toContain('FROM layer')
    // Asked for but no table named: the layer (the caller says there is no selection).
    expect(binQuerySql(count({ selectedOnly: true }), facts)!.sql).toContain('FROM layer')
  })

  it('counts the rows with no usable location, over the same rows', () => {
    const sql = binSkippedSql(count(), { ...facts, where: '"pop" > 10' })!
    expect(sql).toBe(
      'SELECT count(*) AS skipped FROM (SELECT ST_Centroid("geom") AS p FROM layer\n      WHERE ("pop" > 10)) WHERE NOT coalesce(p IS NOT NULL AND NOT ST_IsEmpty(p) AND ST_X(p) BETWEEN -180 AND 180 AND ST_Y(p) BETWEEN -90 AND 90, false)'
    )
    expect(binSkippedSql(count({ resolution: 99 }), facts)).toBeNull()
    expect(binSkippedSql(count({ selectedOnly: true }), { ...facts, selectedSource: SELECTED_ROWS_TABLE })).toContain('FROM selected_rows')
  })

  it('refuses a spec that is not valid for the layer', () => {
    expect(binQuerySql(count({ resolution: 16 }), facts)).toBeNull()
    expect(binQuerySql(count({ resolution: -1 }), facts)).toBeNull()
    expect(binQuerySql(count({ resolution: 7.5 }), facts)).toBeNull()
    expect(binQuerySql(count({ system: 'a5', resolution: 0 }), facts)).toBeNull()
    expect(binQuerySql(count({ system: 'a5', resolution: 31 }), facts)).toBeNull()
    expect(binQuerySql(count({ measure: { kind: 'sum', column: 'name' } }), facts)).toBeNull()
    expect(binQuerySql(count({ measure: { kind: 'sum', column: 'missing' } }), facts)).toBeNull()
    expect(binQuerySql({ ...count(), system: 'x' as never }, facts)).toBeNull()
  })

  it('says why', () => {
    expect(binSpecProblem(count({ resolution: 16 }), facts)).toMatch(/H3 resolutions go from 0 to 15/)
    expect(binSpecProblem(count({ measure: { kind: 'sum', column: 'name' } }), facts)).toMatch(/not a number column/)
    expect(binSpecProblem(count(), facts)).toBeNull()
  })
})

describe('QuerySession bin methods (spec 017)', () => {
  const table = {
    name: 'layer',
    alias: null,
    columns: [
      { name: 'name', type: 'VARCHAR' },
      { name: 'pop', type: 'BIGINT' },
      { name: 'geom', type: 'GEOMETRY' },
    ],
    crs: { label: 'EPSG:26912' },
    crsAssumed: false,
    srid: 26912,
    backing: 'materialized',
    totals: { rows: 1234, features: 1234, invalid: 0 },
    extent: [-112, 40, -111, 41],
    sourceExtent: null,
    geometryType: 'Point',
  } as unknown as QueryableTable
  // The bin methods read the layer's facts only; the engine is not touched.
  const session = () => new QuerySession(null as never, null as never, table, [])

  it('is unavailable until a layer is open', () => {
    const qs = session()
    expect(qs.binQuerySql(count())).toBeNull()
    expect(qs.layerFactsForBin()).toBeNull()
  })

  it("builds the query from the layer's geometry column, CRS and columns", () => {
    const qs = session()
    qs.setLayerView({ index: 'columns', geom: '"geom"', attrs: ['name', 'pop'] })
    const q = qs.binQuerySql(count({ measure: { kind: 'sum', column: 'pop' } }))!
    expect(q.sql).toContain(`ST_Transform(ST_Centroid("geom"), 'EPSG:26912', 'EPSG:4326', always_xy := true)`)
    expect(q.valueLabel).toBe('Sum of pop')
    expect(qs.binQuerySql(count({ measure: { kind: 'sum', column: 'name' } }))).toBeNull()
  })

  it('tells the dialog what the layer holds', () => {
    const qs = session()
    qs.setLayerView({ index: 'columns', geom: '"geom"', attrs: ['name', 'pop'] })
    expect(qs.layerFactsForBin()).toEqual({ geometryType: 'Point', extent: [-112, 40, -111, 41], rows: 1234, numericColumns: ['pop'], filtersIgnored: false })
  })
})
