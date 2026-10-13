// Spec 010 phase 9 (T063): workspace file paths in SQL, their rewrite to the
// engine paths, and error offsets mapped back (research.md S4: relative paths
// can't reach the engine as they are).
import { describe, expect, it } from 'vitest'
import { isWorkspacePath, pathLiterals, referencedPaths, rewritePaths } from '@spatial-explorer/core'

describe('referencedPaths', () => {
  it('finds a relative data file in a reader call', () => {
    expect(referencedPaths("SELECT * FROM ST_Read('data/a.shp')")).toEqual(['data/a.shp'])
  })
  it("returns a file-like literal in a comparison too (it's only resolved, never refused)", () => {
    expect(referencedPaths("SELECT * FROM layer WHERE name = 'x.csv'")).toEqual(['x.csv'])
    expect(pathLiterals("SELECT * FROM layer WHERE name = 'x.csv'")[0].asFile).toBe(false)
  })
  it('marks reader arguments and FROM/JOIN file tables as files', () => {
    const l = pathLiterals("SELECT * FROM 'b.parquet' JOIN read_csv_auto('c.csv') USING (id)")
    expect(l.map((x) => [x.path, x.asFile])).toEqual([
      ['b.parquet', true],
      ['c.csv', true],
    ])
  })
  it('ignores absolute paths, parent folders, URLs and drive letters', () => {
    for (const p of ['/etc/passwd.csv', '../x.shp', 'a/../../x.shp', 'https://x.org/a.parquet', 'C:/data/a.csv', 's3://b/a.parquet', 'se-source/a.csv'])
      expect(isWorkspacePath(p), p).toBe(false)
    expect(referencedPaths("SELECT * FROM ST_Read('/etc/passwd.csv')")).toEqual([])
    expect(referencedPaths("SELECT * FROM ST_Read('../x.shp')")).toEqual([])
  })
  it('ignores literals in comments and non-data names', () => {
    expect(referencedPaths("-- ST_Read('a.shp')\nSELECT 'readme.md', /* 'b.gpkg' */ 1")).toEqual([])
  })
  it("unescapes '' in a path", () => {
    expect(referencedPaths("SELECT * FROM ST_Read('it''s.geojson')")).toEqual(["it's.geojson"])
  })
})

describe('rewritePaths', () => {
  const sql = "SELECT * FROM ST_Read('data/a.shp') WHERE x = 1 AND bogus"
  const r = rewritePaths(sql, new Set(['data/a.shp']))
  it('rewrites registered paths to /se-source/ws/', () => {
    expect(r.text).toBe("SELECT * FROM ST_Read('/se-source/ws/data/a.shp') WHERE x = 1 AND bogus")
  })
  it('maps offsets after a rewritten literal back to the original', () => {
    expect(sql.slice(r.toOriginal(r.text.indexOf('bogus')))).toBe('bogus')
    expect(r.toOriginal(r.text.indexOf('SELECT'))).toBe(0)
    // Inside the rewritten literal: its start.
    expect(r.toOriginal(r.text.indexOf('se-source'))).toBe(sql.indexOf("'data"))
  })
  it('leaves unregistered literals as they are', () => {
    expect(rewritePaths(sql, new Set()).text).toBe(sql)
  })
})
