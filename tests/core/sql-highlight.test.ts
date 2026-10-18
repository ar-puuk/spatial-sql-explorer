// Spec 017: the colored runs of the SQL in the Bin into cells dialog (packages/ui/src/sqlHighlight.ts).
import { describe, expect, it } from 'vitest'
import { highlightSql } from '../../packages/ui/src/sqlHighlight'

const tokens = (sql: string): Array<[string, string | null]> => highlightSql(sql).map((r) => [r.text, r.token])
const colored = (sql: string, token: string): string[] => highlightSql(sql).filter((r) => r.token === token).map((r) => r.text)

describe('highlightSql', () => {
  it('reads exactly as the query, whatever it holds', () => {
    for (const sql of ['', 'SELECT 1', "SELECT ST_Union(a, b) AS g, 'x''y' -- note\nFROM layer WHERE (n > 10) AND h3_latlng_to_cell(1, 2, 3) IN (1, 2)", 'SELECT\n  *\n']) {
      expect(highlightSql(sql).map((r) => r.text).join('')).toBe(sql)
    }
  })

  it('colors keywords, numbers, strings, operators and comments', () => {
    expect(colored("SELECT 5, 'EPSG:4326' FROM layer -- hi", 'keyword')).toEqual(['SELECT', 'FROM'])
    expect(colored("SELECT 5, 'EPSG:4326' FROM layer -- hi", 'number')).toEqual(['5'])
    expect(colored("SELECT 5, 'EPSG:4326' FROM layer -- hi", 'string')).toEqual(["'EPSG:4326'"])
    expect(colored("SELECT 5, 'EPSG:4326' FROM layer -- hi", 'comment')).toEqual(['-- hi'])
    expect(colored('SELECT (1)', 'operator')).toEqual(['(', ')'])
  })

  it('colors a function call: a name followed by a parenthesis, and function-like keywords', () => {
    expect(colored('SELECT ST_Union(a, b), h3_latlng_to_cell (1, 2, 3), count(*) FROM layer', 'function')).toEqual(['ST_Union', 'h3_latlng_to_cell', 'count'])
  })

  it('colors a function the grammar half-recognizes as a keyword (ST_XMax, ST_YMin)', () => {
    expect(colored('SELECT ST_XMax(g), ST_YMin(g) FROM t', 'function')).toEqual(['ST_XMax', 'ST_YMin'])
    expect(colored('SELECT ST_XMax(g), ST_YMin(g) FROM t', 'keyword')).toEqual(['SELECT', 'FROM'])
  })

  it('leaves column names, tables, aliases and real keywords before a parenthesis alone', () => {
    const sql = 'SELECT cell_id AS n FROM layer WHERE n IN (1, 2) AND (n > 3)'
    expect(colored(sql, 'function')).toEqual([])
    expect(tokens(sql).find(([text]) => text === 'IN')?.[1]).toBe('keyword')
    expect(tokens(sql).find(([text]) => text === 'AND')?.[1]).toBe('keyword')
    expect(tokens(sql).find(([text]) => text.trim() === 'cell_id')?.[1]).toBeNull()
  })

  it('does not color words inside strings or comments', () => {
    expect(colored("SELECT 'ST_Union(a)' -- count(b)", 'function')).toEqual([])
  })
})
