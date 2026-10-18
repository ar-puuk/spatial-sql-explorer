// Spec 018: the SQL of the word search (view/textSearch.ts).
import { describe, expect, it } from 'vitest'
import { FTS_MAX_COLUMNS, FTS_TABLE, ftsBuildSql, ftsColumns, ftsSearchSql, ftsWords } from '@spatial-explorer/core'

describe('ftsColumns', () => {
  it('keeps free text and leaves out numbers, enums, booleans and geometry', () => {
    const cols = [
      { name: 'name', type: 'VARCHAR' },
      { name: 'pop', type: 'BIGINT' },
      { name: 'kind', type: "ENUM('a','b')" },
      { name: 'ok', type: 'BOOLEAN' },
      { name: 'notes', type: 'TEXT' },
      { name: 'geom', type: 'GEOMETRY' },
    ]
    expect(ftsColumns(cols)).toEqual(['name', 'notes'])
  })

  it('stops at the column cap', () => {
    const many = Array.from({ length: FTS_MAX_COLUMNS + 5 }, (_, i) => ({ name: `c${i}`, type: 'VARCHAR' }))
    expect(ftsColumns(many)).toHaveLength(FTS_MAX_COLUMNS)
  })
})

describe('ftsWords', () => {
  it('splits on anything that is not a letter or digit, in any script', () => {
    expect(ftsWords("Parc-des-Princes, O'Brien  Zürich 2020")).toEqual(['parc', 'des', 'princes', 'o', 'brien', 'zürich', '2020'])
  })
})

describe('ftsBuildSql', () => {
  it('copies the text and the row id, then indexes with stemming', () => {
    const sql = ftsBuildSql('(SELECT * FROM layer)', ['name', 'My "col"'])
    expect(sql[0]).toBe(`CREATE OR REPLACE TEMP TABLE ${FTS_TABLE} AS SELECT __se_rowid AS rid, "name", "My ""col""" FROM (SELECT * FROM layer)`)
    expect(sql[1]).toContain(`create_fts_index('${FTS_TABLE}', 'rid', 'name', 'My "col"'`)
    expect(sql[1]).toContain("stemmer = 'porter'")
  })
})

describe('ftsSearchSql', () => {
  it('needs words and columns', () => {
    expect(ftsSearchSql('', ['a'], null)).toBeNull()
    expect(ftsSearchSql('x', ['a'], null)).toBeNull()
    expect(ftsSearchSql('abc', [], null)).toBeNull()
  })

  it('matches every word, best first, and quotes the query as a literal', () => {
    const sql = ftsSearchSql("it's a bridge", ['name'], null)!
    expect(sql).toContain(`match_bm25(rid, 'it s a bridge', conjunctive := 1)`)
    expect(sql).toContain('ORDER BY score DESC, rid LIMIT 8')
    expect(sql).not.toContain('rid IN')
  })

  it('stays inside the rows the filters leave', () => {
    const sql = ftsSearchSql('bridge', ['name'], 'SELECT __se_rowid FROM layer WHERE x')!
    expect(sql).toContain('AND rid IN (SELECT __se_rowid FROM layer WHERE x)')
  })

  it('escapes LIKE characters in the snippet choice', () => {
    expect(ftsSearchSql('50%', ['a'], null)).toContain("'%50%'")
  })
})
