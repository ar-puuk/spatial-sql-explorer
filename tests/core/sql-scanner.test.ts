// T003 (spec 002): statement splitting and "statement to run" (FR-004), per
// specs/002-spatial-sql-query/contracts/statement-policy.md.
import { describe, expect, it } from 'vitest'
import { splitStatements, statementToRun } from '@spatial-explorer/core'

const texts = (src: string): string[] => splitStatements(src).map((s) => s.text)

describe('splitStatements', () => {
  it('splits on top-level semicolons and trims', () => {
    expect(texts('SELECT 1;  SELECT 2 ;\nSELECT 3')).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3'])
  })

  it('does not split inside strings, escapes, dollar quotes, identifiers or comments', () => {
    const src = [
      "SELECT 'a;b', 'it''s; fine', E'x\\';y'",
      'SELECT $tag$ ; $tag$, $$;$$',
      'SELECT 1 AS "we;ird"',
      'SELECT 1 -- trailing ; comment\n + 1',
      'SELECT /* outer /* inner ; */ still ; comment */ 2',
    ].join(';\n')
    const out = texts(src)
    expect(out).toHaveLength(5)
    expect(out[0]).toBe("SELECT 'a;b', 'it''s; fine', E'x\\';y'")
    expect(out[1]).toBe('SELECT $tag$ ; $tag$, $$;$$')
    expect(out[4]).toBe('SELECT /* outer /* inner ; */ still ; comment */ 2')
  })

  it('drops statements that are only whitespace or comments', () => {
    expect(texts('  ;; -- nothing\n; /* nope */ ; SELECT 1;')).toEqual(['SELECT 1'])
  })

  it('reports offsets into the original text', () => {
    const src = 'SELECT 1;\n  SELECT 2'
    const [a, b] = splitStatements(src)
    expect(src.slice(a.from, a.to)).toBe('SELECT 1')
    expect(src.slice(b.from, b.to)).toBe('SELECT 2')
  })

  it('handles an unterminated string without throwing', () => {
    expect(texts("SELECT 'oops; SELECT 2")).toEqual(["SELECT 'oops; SELECT 2"])
  })
})

describe('statementToRun', () => {
  const src = 'SELECT 1;\nSELECT 2;\n\nSELECT 3'
  const at = (needle: string): number => src.indexOf(needle)

  it('picks the statement containing the cursor', () => {
    expect(statementToRun(src, { from: at('2'), to: at('2') })?.text).toBe('SELECT 2')
    expect(statementToRun(src, { from: 0, to: 0 })?.text).toBe('SELECT 1')
    expect(statementToRun(src, { from: src.length, to: src.length })?.text).toBe('SELECT 3')
  })

  it('picks the statement just before the cursor when the cursor sits after its semicolon', () => {
    const pos = src.indexOf(';') + 1
    expect(statementToRun(src, { from: pos, to: pos })?.text).toBe('SELECT 1')
  })

  it('a non-empty selection wins over the cursor, with its own offsets', () => {
    const from = at('SELECT 2')
    const span = statementToRun(src, { from, to: from + 'SELECT 2'.length })
    expect(span).toEqual({ text: 'SELECT 2', from, to: from + 8 })
  })

  it('a selection covering several statements runs only its first statement', () => {
    expect(statementToRun(src, { from: 0, to: src.length })?.text).toBe('SELECT 1')
  })

  it('returns null for an empty editor or a comment-only selection', () => {
    expect(statementToRun('   ', { from: 0, to: 0 })).toBeNull()
    expect(statementToRun('-- hi', { from: 0, to: 5 })).toBeNull()
  })
})
