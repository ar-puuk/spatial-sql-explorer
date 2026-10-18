// Spec 021: covering and smoothing in the bin query (grid/binSql.ts), the estimate (grid/binEstimate.ts) and the registry.
import { describe, expect, it } from 'vitest'
import { MAX_SMOOTH_RINGS, binQuerySql, binSkippedSql, binSpecProblem, diskSize, estimateCells, featureSizeSql, getGridSystem, type BinSpec } from '@spatial-explorer/core'

const FACTS = { geom: '"geom"', srid: 4326, columns: [{ name: 'pop', type: 'DOUBLE' }] }
const base: BinSpec = { system: 'h3', resolution: 7, measure: { kind: 'count' } }
const h3 = getGridSystem('h3')!
const a5 = getGridSystem('a5')!

describe('the spec (spec 021)', () => {
  it('has no problem with covering, or with smoothing within the limits', () => {
    expect(binSpecProblem({ ...base, assign: 'cover' }, FACTS)).toBeNull()
    for (const k of [0, 1, 2, 3, 10, MAX_SMOOTH_RINGS]) expect(binSpecProblem({ ...base, smooth: k }, FACTS)).toBeNull()
  })
  it('refuses what cannot work, in words', () => {
    expect(binSpecProblem({ ...base, smooth: MAX_SMOOTH_RINGS + 1 }, FACTS)).toContain(`0 to ${MAX_SMOOTH_RINGS} rings`)
    expect(binSpecProblem({ ...base, smooth: 1.5 }, FACTS)).toContain('rings')
    expect(binSpecProblem({ ...base, smooth: -1 }, FACTS)).toContain('rings')
    expect(binSpecProblem({ ...base, assign: 'nope' as never }, FACTS)).toContain('Unknown way')
    expect(binSpecProblem({ ...base, smooth: 1, measure: { kind: 'median', column: 'pop' } }, FACTS)).toContain('median')
    expect(binSpecProblem({ ...base, smooth: 1, assign: 'cover' }, FACTS)).toContain('cannot be combined')
    expect(binSpecProblem({ ...base, system: 'a5', resolution: 8, smooth: 1 }, FACTS)).toContain('H3 only')
  })
  it('keeps a median without smoothing, and A5 without it', () => {
    expect(binSpecProblem({ ...base, measure: { kind: 'median', column: 'pop' } }, FACTS)).toBeNull()
    expect(binSpecProblem({ ...base, system: 'a5', resolution: 8 }, FACTS)).toBeNull()
  })
})

describe('the query (spec 021)', () => {
  it('is the same as before for the defaults', () => {
    const plain = binQuerySql(base, FACTS)!
    expect(binQuerySql({ ...base, assign: 'center', smooth: 0 }, FACTS)!.sql).toBe(plain.sql)
    expect(plain.sql).not.toContain('unnest')
  })
  it('covering reads the whole geometry, takes its cells with the system functions, and counts a feature per cell', () => {
    const q = binQuerySql({ ...base, assign: 'cover' }, FACTS)!
    expect(q.sql).toContain('unnest(')
    expect(q.sql).toContain('h3_polygon_wkt_to_cells_experimental')
    expect(q.sql).toContain("'overlap'")
    expect(q.sql).toContain('ST_YMax(g) <= 90')
    expect(q.valueLabel).toBe('Number of features')
    const a = binQuerySql({ ...base, system: 'a5', resolution: 9, assign: 'cover' }, FACTS)!
    expect(a.sql).toContain('a5_lonlat_to_cell')
    expect(a.sql).toContain('ST_Boundary')
  })
  it('covering carries the measure column and converts a projected layer to longitude and latitude', () => {
    const q = binQuerySql({ ...base, assign: 'cover', measure: { kind: 'sum', column: 'pop' } }, { ...FACTS, srid: 32612 })!
    expect(q.sql).toContain('TRY_CAST("pop" AS DOUBLE) AS v')
    expect(q.sql).toContain(`ST_Transform("geom", 'EPSG:32612', 'EPSG:4326', always_xy := true) AS g`)
  })
  it("smoothing groups per cell, takes each cell's disk, and combines the parts", () => {
    const count = binQuerySql({ ...base, smooth: 2 }, FACTS)!
    expect(count.sql).toContain('h3_grid_disk(cell, 2)')
    expect(count.sql).toContain('sum(n)::DOUBLE AS value')
    expect(count.valueLabel).toBe('Number of features, with neighbors within 2 rings')
    expect(binQuerySql({ ...base, smooth: 1 }, FACTS)!.valueLabel).toContain('within 1 ring')
    const avg = binQuerySql({ ...base, smooth: 1, measure: { kind: 'avg', column: 'pop' } }, FACTS)!
    expect(avg.sql).toContain('sum(v) AS s, count(v) AS c')
    expect(avg.sql).toContain('(sum(s) / nullif(sum(c), 0))::DOUBLE AS value')
    expect(binQuerySql({ ...base, smooth: 1, measure: { kind: 'min', column: 'pop' } }, FACTS)!.sql).toContain('min(mn)::DOUBLE AS value')
    expect(binQuerySql({ ...base, smooth: 1, measure: { kind: 'max', column: 'pop' } }, FACTS)!.sql).toContain('max(mx)::DOUBLE AS value')
    expect(binQuerySql({ ...base, smooth: 1, measure: { kind: 'sum', column: 'pop' } }, FACTS)!.sql).toContain('sum(s)::DOUBLE AS value')
  })
  it('gives no query for a spec that is refused', () => {
    expect(binQuerySql({ ...base, smooth: 1, assign: 'cover' }, FACTS)).toBeNull()
    expect(binQuerySql({ ...base, system: 'a5', resolution: 8, smooth: 1 }, FACTS)).toBeNull()
  })
  it("the lambda names never meet the query's own columns (g, v, cell)", () => {
    for (const system of ['h3', 'a5'] as const) {
      const sql = getGridSystem(system)!.coverSql('g', system === 'h3' ? 7 : 9)
      for (const name of ['g', 'v', 'cell', 'p', 'n']) expect(sql, `${system}: lambda ${name}`).not.toMatch(new RegExp(`(^|[^A-Za-z0-9_.])${name} ->`))
    }
  })
  it('the skipped count asks of the whole geometry when covering', () => {
    expect(binSkippedSql({ ...base, assign: 'cover' }, FACTS)).toContain('ST_XMin(g) >= -180')
    expect(binSkippedSql(base, FACTS)).toContain('ST_X(p) BETWEEN -180 AND 180')
  })
})

describe('the registry and the estimate (spec 021)', () => {
  it('H3 has a disk; A5 does not (its neighbor function is incomplete)', () => {
    expect(h3.diskSql).toBeTypeOf('function')
    expect(a5.diskSql).toBeUndefined()
  })
  it('a disk of k rings on a hex grid has 3k(k+1)+1 cells', () => {
    expect([0, 1, 2, 3].map(diskSize)).toEqual([1, 7, 19, 37])
  })
  const extent: [number, number, number, number] = [8, 47, 8.5, 47.4]
  it('covering is limited by what the features reach, not by the rows', () => {
    const rows = 10
    const plain = estimateCells(h3, 9, extent, rows)
    expect(plain).toBe(rows)
    expect(estimateCells(h3, 9, extent, rows, { cover: true })).toBeGreaterThan(plain)
    const small = estimateCells(h3, 9, extent, rows, { cover: true, featureSize: { areaKm2: 0.001, spanKm: 0.05 } })
    const big = estimateCells(h3, 9, extent, rows, { cover: true, featureSize: { areaKm2: 5, spanKm: 4 } })
    expect(small).toBeLessThan(big)
    expect(small).toBeLessThanOrEqual(rows * 2)
  })
  it('smoothing adds the margin around the data', () => {
    const none = estimateCells(h3, 6, extent, 100000)
    expect(estimateCells(h3, 6, extent, 100000, { smooth: 2 })).toBeGreaterThan(none)
    expect(estimateCells(h3, 12, extent, 3, { smooth: 1 })).toBe(3 * diskSize(1))
  })
  it('the feature size query reads boxes in kilometers (degrees by latitude, other systems as meters)', () => {
    expect(featureSizeSql('"geom"', 4326)).toContain('111.32')
    expect(featureSizeSql('"geom"', 4326)).toContain('cos(radians(')
    expect(featureSizeSql('"geom"', 32612)).toContain('/ 1000.0')
    expect(featureSizeSql('"geom"', 4326)).toContain('LIMIT 5000')
  })
})
