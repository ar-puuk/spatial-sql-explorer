// Spec 023: the snippet library's queries (snippets/snippets.ts): what each is made of, which layers get which, and that
// every one is a query the statement policy lets through.
import { describe, expect, it } from 'vitest'
import { SNIPPETS, SNIPPET_CATEGORIES, classifyStatement, plainSql, snippetContextFor, snippetTemplate, snippetsFor, type SnippetContext } from '@spatial-explorer/core'

const columns = [
  { name: 'pop', type: 'BIGINT' },
  { name: 'rate', type: 'DOUBLE' },
  { name: 'name', type: 'VARCHAR' },
]
const make = (over: Partial<Parameters<typeof snippetContextFor>[0]> = {}): SnippetContext =>
  snippetContextFor({ table: 'us_counties', geom: '"geom"', srid: 4326, geometryType: 'Polygon', extent: [-100, 30, -80, 40], columns, files: ['data/other.geojson'], ...over })

describe('the library', () => {
  it('has unique ids, titles and descriptions, in known categories', () => {
    expect(new Set(SNIPPETS.map((s) => s.id)).size).toBe(SNIPPETS.length)
    expect(new Set(SNIPPETS.map((s) => s.title)).size).toBe(SNIPPETS.length)
    for (const s of SNIPPETS) {
      expect(SNIPPET_CATEGORIES, s.id).toContain(s.category)
      expect(s.description.length, s.id).toBeGreaterThan(10)
    }
    for (const category of SNIPPET_CATEGORIES) expect(SNIPPETS.some((s) => s.category === category), category).toBe(true)
  })
})

describe('the context', () => {
  it('names the number and text columns, and the first other file', () => {
    const c = make()
    expect(c.numeric).toEqual(['pop', 'rate'])
    expect(c.text).toEqual(['name'])
    expect(c.file).toBe('data/other.geojson')
    expect(make({ files: [] }).file).toBe('other_file.geojson')
  })
  it('reads a projected layer in longitude and latitude, and takes distances in its own units', () => {
    const c = make({ srid: 32612 })
    expect(c.geographic).toBe(false)
    expect(c.geom4326).toBe(`ST_Transform("geom", 'EPSG:32612', 'EPSG:4326', always_xy := true)`)
    expect(make().geom4326).toBe('"geom"')
    expect(plainSql(snippetTemplate(SNIPPETS.find((s) => s.id === 'buffer')!, c))).toContain('ST_Buffer("geom", 1000)')
    expect(plainSql(snippetTemplate(SNIPPETS.find((s) => s.id === 'buffer')!, make()))).toContain('ST_Buffer("geom", 0.01)')
  })
})

describe('which snippets a layer is offered', () => {
  const ids = (c: SnippetContext): string[] => snippetsFor(c).map((s) => s.id)
  it('polygons get areas and outlines, lines get lengths, points get neither', () => {
    expect(ids(make())).toEqual(expect.arrayContaining(['area', 'boundaries', 'density']))
    expect(ids(make())).not.toContain('length')
    expect(ids(make({ geometryType: 'LineString' }))).toEqual(expect.arrayContaining(['length', 'simplify']))
    expect(ids(make({ geometryType: 'LineString' }))).not.toContain('area')
    const points = ids(make({ geometryType: 'Point' }))
    expect(points).toEqual(expect.arrayContaining(['buffer', 'sample', 'distance-from-point', 'nearest']))
    for (const none of ['area', 'length', 'centroids', 'simplify', 'boundaries', 'convex-hull']) expect(points, none).not.toContain(none)
  })
  it('a mixed layer is offered every geometry', () => {
    expect(ids(make({ geometryType: 'Mixed' }))).toEqual(expect.arrayContaining(['area', 'length']))
  })
  it('leaves out what needs a column the layer has not', () => {
    const noNumbers = make({ columns: [{ name: 'name', type: 'VARCHAR' }] })
    expect(ids(noNumbers)).not.toContain('top-n')
    expect(ids(noNumbers)).not.toContain('statistics')
    expect(ids(noNumbers)).toContain('text-contains')
    const noText = make({ columns: [{ name: 'pop', type: 'INTEGER' }] })
    expect(ids(noText)).not.toContain('text-contains')
    expect(ids(noText)).toContain('count-by')
    expect(ids(make({ columns: [] }))).not.toContain('count-by')
  })
})

describe('names the editor syntax cannot hold', () => {
  it('keeps a column name with a brace exactly, as plain text', () => {
    const c = make({ columns: [{ name: 'we"ird }col', type: 'DOUBLE' }] })
    const top = snippetTemplate(SNIPPETS.find((s) => s.id === 'top-n')!, c)
    expect(plainSql(top)).toContain('ORDER BY "we""ird }col" DESC')
    expect(top).not.toContain('${1:"we')
  })
})

describe('every snippet', () => {
  const contexts: Array<[string, SnippetContext]> = [
    ['polygons', make()],
    ['lines', make({ geometryType: 'LineString' })],
    ['points', make({ geometryType: 'Point' })],
    ['a projected layer', make({ srid: 3857 })],
    ['a layer with no extent and odd column names', make({ extent: null, columns: [{ name: `we"ird }col`, type: 'DOUBLE' }, { name: 'it\'s', type: 'VARCHAR' }] })],
  ]
  for (const [label, ctx] of contexts) {
    it(`is one query the statement policy allows, with fields numbered from 1 (${label})`, () => {
      for (const def of snippetsFor(ctx)) {
        const template = snippetTemplate(def, ctx)
        const sql = plainSql(template)
        expect(sql, def.id).not.toContain('${')
        expect(classifyStatement(sql, ['layer']), def.id).toEqual({ allowed: true, kind: 'query' })
        const opens = (sql.match(/\(/g) ?? []).length
        expect(opens, `${def.id} parentheses`).toBe((sql.match(/\)/g) ?? []).length)
        // Fields are numbered one after the other without gaps (a name with a brace is plain text, not a field); a number used twice is one field written twice.
        const numbers = [...new Set([...template.matchAll(/\$\{(\d+):/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
        expect(
          numbers.every((n, i) => i === 0 || n === (numbers[i - 1] ?? 0) + 1),
          `${def.id} fields`
        ).toBe(true)
        // The geometry column is the layer's own, and the table is its name.
        expect(sql, def.id).toContain(ctx.table)
      }
    })
  }
  it('says in a first comment what the numbers mean when it has distances, coordinates or another file', () => {
    const c = make()
    for (const id of ['buffer', 'simplify', 'distance-from-point', 'in-box', 'join-by-location', 'count-in-polygons', 'nearest', 'clip']) {
      expect(plainSql(snippetTemplate(SNIPPETS.find((s) => s.id === id)!, c)).split('\n')[0], id).toMatch(/^--/)
    }
  })
})
