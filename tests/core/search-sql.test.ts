// Spec 010 phase 10: the search box's value SQL and coordinate parsing. The
// SQL runs for real in tests/web/specs/search.spec.ts.
import { describe, expect, it } from 'vitest'
import { parseCoordinates, searchValuesSql } from '@spatial-explorer/core'

const cols = [
  { name: 'name', type: 'VARCHAR' },
  { name: 'pop', type: 'BIGINT' },
  { name: 'sub"region', type: 'VARCHAR' },
]

describe('searchValuesSql', () => {
  it('reads every text column, and only those', () => {
    const sql = searchValuesSql('layer_rel', cols, 'Nam')!
    expect(sql).toContain(`CAST("name" AS VARCHAR) ILIKE '%Nam%' ESCAPE '\\'`)
    expect(sql).toContain(`CAST("sub""region" AS VARCHAR)`)
    expect(sql).not.toContain('"pop"')
    expect(sql.match(/UNION ALL/g)).toHaveLength(1)
  })
  it('ranks exact, then prefix, then shorter values, with one hit per column and value', () => {
    const sql = searchValuesSql('r', cols, 'nam', 5)!
    expect(sql).toMatch(/GROUP BY col, value ORDER BY \(value ILIKE 'nam' ESCAPE '\\'\) DESC, \(value ILIKE 'nam%' ESCAPE '\\'\) DESC, length\(value\), value, col LIMIT 5$/)
  })
  it("escapes LIKE wildcards and quotes: 50%_off's matches literally", () => {
    const sql = searchValuesSql('r', cols, "50%_off's")!
    expect(sql).toContain(`'%50\\%\\_off''s%'`)
  })
  it('nothing under two characters or without text columns', () => {
    expect(searchValuesSql('r', cols, ' a ')).toBeNull()
    expect(searchValuesSql('r', [{ name: 'pop', type: 'INTEGER' }], 'abc')).toBeNull()
  })
})

describe('parseCoordinates', () => {
  it('lon, lat by default', () => {
    expect(parseCoordinates('-111.9, 40.7')).toEqual([{ lon: -111.9, lat: 40.7 }])
    expect(parseCoordinates('-111.9 40.7')).toEqual([{ lon: -111.9, lat: 40.7 }])
  })
  it('lat, lon when only that fits (a pasted Google Maps pair)', () => {
    expect(parseCoordinates('40.7, -111.9')).toEqual([{ lon: -111.9, lat: 40.7 }])
  })
  it('both orders when both fit', () => {
    expect(parseCoordinates('10, 20')).toEqual([
      { lon: 10, lat: 20 },
      { lon: 20, lat: 10 },
    ])
  })
  it('hemisphere letters fix the order and the sign', () => {
    expect(parseCoordinates('40.7 N, 111.9 W')).toEqual([{ lon: -111.9, lat: 40.7 }])
    expect(parseCoordinates('111.9°W 40.7°N')).toEqual([{ lon: -111.9, lat: 40.7 }])
    expect(parseCoordinates('S33.9, E151.2')).toEqual([{ lon: 151.2, lat: -33.9 }])
    expect(parseCoordinates('40 N, 50 N')).toEqual([])
  })
  it('not coordinates', () => {
    for (const q of ['Namibia', '12', '200, 100', '1, 2, 3', 'N 10 S, 5']) expect(parseCoordinates(q), q).toEqual([])
  })
})
