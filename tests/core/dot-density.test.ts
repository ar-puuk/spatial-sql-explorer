// Spec 022: the dot density query (dots/dotSql.ts), its amounts and its style.
import { describe, expect, it } from 'vitest'
import { DOT_ATTRIBUTES, MAX_DOTS, MAX_DOT_COLUMNS, SUGGESTED_DOTS, dotLabel, dotQuerySql, dotSpecProblem, dotStyle, dotTotalsSql, estimateDots, isDotResult, perDotLadder, suggestPerDot, type DotSpec } from '@spatial-explorer/core'

const FACTS = {
  geom: '"geom"',
  srid: 4326,
  columns: [
    { name: 'pop', type: 'BIGINT' },
    { name: 'farms', type: 'DOUBLE' },
    { name: 'name', type: 'VARCHAR' },
  ],
}
const base: DotSpec = { columns: ['pop'], perDot: 500 }

describe('the spec', () => {
  it('has no problem for number columns and a positive amount', () => {
    expect(dotSpecProblem(base, FACTS)).toBeNull()
    expect(dotSpecProblem({ columns: ['pop', 'farms'], perDot: 0.5 }, FACTS)).toBeNull()
  })
  it('refuses what cannot work, in words', () => {
    expect(dotSpecProblem({ ...base, columns: [] }, FACTS)).toContain('Choose a column')
    expect(dotSpecProblem({ ...base, columns: ['name'] }, FACTS)).toContain('not a number column')
    expect(dotSpecProblem({ ...base, columns: ['nope'] }, FACTS)).toContain('no column nope')
    expect(dotSpecProblem({ ...base, columns: ['pop', 'pop'] }, FACTS)).toContain('once')
    expect(dotSpecProblem({ ...base, columns: Array.from({ length: MAX_DOT_COLUMNS + 1 }, (_, i) => `c${i}`) }, FACTS)).toContain(`at most ${MAX_DOT_COLUMNS}`)
    for (const perDot of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 1e13]) expect(dotSpecProblem({ ...base, perDot }, FACTS), String(perDot)).toContain('positive amount')
  })
})

describe('the query', () => {
  it('samples each polygon box with a hash, keeps what is inside, and takes as many as the polygon needs', () => {
    const q = dotQuerySql(base, FACTS)!
    expect(q.sql).toContain('ST_Within(ST_Point(x, y), g)')
    expect(q.sql).toContain('hash(feature, gi, k)')
    expect(q.sql).toContain('WHERE rn <= n')
    expect(q.sql).toContain("'pop' AS category")
    expect(q.sql).toContain('v0 / 500 AS want')
    expect(q.sql).toContain(`ST_SetCRS(ST_Point(x, y), 'EPSG:4326') AS geom`)
    expect(q.sql).not.toContain('random()')
    expect(q.label).toBe('One dot = 500')
  })
  it('gives each column its own category, joined by UNION ALL', () => {
    const q = dotQuerySql({ columns: ['pop', 'farms'], perDot: 10 }, FACTS)!
    expect(q.sql).toContain("'pop' AS category, 0 AS gi")
    expect(q.sql).toContain("'farms' AS category, 1 AS gi")
    expect(q.sql).toContain('UNION ALL')
    expect(q.sql).toContain('TRY_CAST("farms" AS DOUBLE) AS v1')
  })
  it("reads the layer's rows as it shows them, and a projected layer in longitude and latitude", () => {
    const q = dotQuerySql(base, { ...FACTS, srid: 32612, where: '"pop" > 10' })!
    expect(q.sql).toContain('WHERE ("pop" > 10)')
    expect(q.sql).toContain(`ST_Transform("geom", 'EPSG:32612', 'EPSG:4326', always_xy := true) AS g`)
  })
  it('quotes column names (and the literal that names the category)', () => {
    const facts = { ...FACTS, columns: [{ name: `it's "x"`, type: 'INTEGER' }] }
    const q = dotQuerySql({ columns: [`it's "x"`], perDot: 1 }, facts)!
    expect(q.sql).toContain(`"it's ""x"""`)
    expect(q.sql).toContain(`'it''s "x"' AS category`)
  })
  it('writes the amount as a plain number, and gives no query for a spec that is refused', () => {
    expect(dotQuerySql({ ...base, perDot: 2.5 }, FACTS)!.sql).toContain('v0 / 2.5 AS want')
    expect(dotQuerySql({ ...base, perDot: 1e11 }, FACTS)!.sql).toContain('v0 / 100000000000 AS want')
    expect(dotQuerySql({ ...base, columns: [] }, FACTS)).toBeNull()
  })
  it('leaves out polygons with no usable shape, and values that are not above zero', () => {
    const sql = dotQuerySql(base, FACTS)!.sql
    expect(sql).toContain('NOT ST_IsEmpty(g)')
    expect(sql).toContain('ST_Area(g) > 0')
    expect(sql).toContain('WHERE v0 > 0')
  })
})

describe('the amounts', () => {
  it('offers 1, 2, 5, 10, … up to the total', () => {
    expect(perDotLadder(100)).toEqual([1, 2, 5, 10, 20, 50, 100])
    expect(perDotLadder(0.5)).toEqual([1])
  })
  it('suggests an amount that gives about the suggested number of dots, at least 1', () => {
    expect(suggestPerDot(0)).toBe(1)
    expect(suggestPerDot(3)).toBe(1)
    for (const total of [12_345, 3_300_000, 331_000_000]) {
      const per = suggestPerDot(total)
      expect(total / per, String(total)).toBeLessThanOrEqual(SUGGESTED_DOTS)
      expect(total / per, String(total)).toBeGreaterThan(SUGGESTED_DOTS / 5)
    }
  })
  it('estimates the dots', () => {
    expect(estimateDots(12_000, 500)).toBe(24)
    expect(estimateDots(Number.NaN, 5)).toBe(0)
    expect(MAX_DOTS).toBe(1_000_000)
  })
  it('sums the number columns over the rows shown', () => {
    expect(dotTotalsSql(['pop', 'farms'], { where: null })).toBe('SELECT coalesce(sum(greatest(TRY_CAST("pop" AS DOUBLE), 0)), 0)::DOUBLE AS t0, coalesce(sum(greatest(TRY_CAST("farms" AS DOUBLE), 0)), 0)::DOUBLE AS t1 FROM layer')
    expect(dotTotalsSql(['pop'], { where: '"a" = 1' })).toContain('WHERE ("a" = 1)')
    expect(dotTotalsSql([], { where: null })).toBeNull()
  })
  it('titles the legend with the amount', () => {
    expect(dotLabel(1500)).toBe('One dot = 1,500')
  })
})

describe('the result and its style', () => {
  it('is recognised by its columns', () => {
    expect(isDotResult(DOT_ATTRIBUTES.map((name) => ({ name })))).toBe(true)
    expect(isDotResult([{ name: 'feature' }, { name: 'category' }])).toBe(false)
  })
  it('colors the dots by category, small, with the amount as the legend title', () => {
    const s = dotStyle('One dot = 500')
    expect(s.pointRadius).toBeLessThan(5)
    expect(s.channels?.color?.source).toEqual({ kind: 'column', column: 'category' })
    expect(s.channels?.color?.legend?.title).toBe('One dot = 500')
  })
})
