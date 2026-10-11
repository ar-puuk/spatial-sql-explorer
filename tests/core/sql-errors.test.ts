// T029 (spec 002, FR-008; research §8): engine error messages -> kind,
// message, useful hints, and an editor position. The samples are the exact
// shapes DuckDB v1.4.3 produced in the Phase 0 spike.
import { describe, expect, it } from 'vitest'
import { parseEngineError } from '@spatial-explorer/core'

describe('parseEngineError', () => {
  it('parser error: de-duplicates the LINE block and maps the caret through the CTAS line', () => {
    // The statement ran as "CREATE … AS\n" + "SELECT *\nFORM layer", so the
    // engine's LINE 3 is the statement's line 2.
    const editorText = '-- first\nSELECT *\nFORM layer'
    const statementOffset = editorText.indexOf('SELECT')
    const msg = 'Parser Error: syntax error at or near "layer"\n\nLINE 3: FORM layer\n             ^\n\nLINE 3: FORM layer\n             ^'
    const e = parseEngineError(msg, { editorText, statementOffset, ctasLineOffset: 1 })
    expect(e.kind).toBe('Parser')
    expect(e.message).toBe('syntax error at or near "layer"')
    expect(e.hints).toEqual([])
    expect(e.position).toEqual({ line: 3, column: 6, offset: editorText.indexOf('layer') })
  })

  it('binder error: keeps "Candidate bindings"', () => {
    const editorText = 'SELECT nope FROM layer'
    const msg = 'Binder Error: Referenced column "nope" not found in FROM clause!\nCandidate bindings: "name", "geom"\n\nLINE 1: SELECT nope FROM layer\n               ^'
    const e = parseEngineError(msg, { editorText, statementOffset: 0, ctasLineOffset: 0 })
    expect(e.kind).toBe('Binder')
    expect(e.message).toBe('Referenced column "nope" not found in FROM clause!')
    expect(e.hints).toEqual(['Candidate bindings: "name", "geom"'])
    expect(e.position).toEqual({ line: 1, column: 8, offset: 7 })
  })

  it('drops engine-internal "Did you mean" suggestions but keeps real ones', () => {
    const table = parseEngineError('Catalog Error: Table with name nope does not exist!\nDid you mean "pg_enum"?\n\nLINE 1: SELECT * FROM nope\n                      ^', {
      editorText: 'SELECT * FROM nope',
      statementOffset: 0,
      ctasLineOffset: 0,
    })
    expect(table.hints).toEqual([])
    expect(table.position?.offset).toBe(14)

    const fn = parseEngineError('Catalog Error: Scalar Function with name st_aera does not exist!\nDid you mean "list_aggregate"?', {
      editorText: 'SELECT ST_Aera(geom) FROM layer',
      statementOffset: 0,
      ctasLineOffset: 0,
    })
    expect(fn.hints).toEqual([])

    const real = parseEngineError('Catalog Error: Scalar Function with name st_aera does not exist!\nDid you mean "st_area"?', {
      editorText: 'SELECT ST_Aera(geom) FROM layer',
      statementOffset: 0,
      ctasLineOffset: 0,
    })
    expect(real.hints).toEqual(['Did you mean "st_area"?'])
  })

  it('a statement later in the editor maps to absolute editor coordinates', () => {
    const editorText = 'SELECT 1;\n\nSELECT nope\nFROM layer'
    const statementOffset = editorText.indexOf('SELECT nope')
    const msg = 'Binder Error: Referenced column "nope" not found in FROM clause!\n\nLINE 2: SELECT nope\n               ^'
    const e = parseEngineError(msg, { editorText, statementOffset, ctasLineOffset: 1 })
    expect(e.position).toEqual({ line: 3, column: 8, offset: editorText.indexOf('nope') })
  })

  it('handles an engine-truncated echo ("...")', () => {
    const long = 'SELECT ' + 'a, '.repeat(60) + 'nope FROM layer'
    const tail = long.slice(long.indexOf('nope') - 20)
    const caret = ' '.repeat('LINE 1: ...'.length + 20) + '^'
    const e = parseEngineError(`Binder Error: Referenced column "nope" not found!\n\nLINE 1: ...${tail}\n${caret}`, {
      editorText: long,
      statementOffset: 0,
      ctasLineOffset: 0,
    })
    expect(e.position?.offset).toBe(long.indexOf('nope'))
  })

  it('messages without a LINE block, or without a kind, still parse', () => {
    expect(parseEngineError('Conversion Error: Could not convert string "x" to INT32', { editorText: '', statementOffset: 0, ctasLineOffset: 0 })).toEqual({
      kind: 'Conversion',
      message: 'Could not convert string "x" to INT32',
      hints: [],
    })
    expect(parseEngineError('Invalid Input Error: something odd', { editorText: '', statementOffset: 0, ctasLineOffset: 0 }).kind).toBe('Invalid Input')
    expect(parseEngineError('worker crashed', { editorText: '', statementOffset: 0, ctasLineOffset: 0 })).toEqual({ kind: 'Error', message: 'worker crashed', hints: [] })
  })
})

describe('parseEngineError: streaming-API JSON errors', () => {
  it('unwraps the JSON form and prefers its exact character position', () => {
    // As observed from send(): the error is JSON, with `position` counting
    // from the start of the SQL actually sent (CTAS prefix included).
    const prefix = 'CREATE OR REPLACE TEMP TABLE __se_result AS\n'
    const editorText = 'SELECT *\nFORM layer'
    const position = prefix.length + editorText.indexOf('layer')
    const raw = `Error: ${JSON.stringify({
      exception_type: 'Parser',
      exception_message: 'syntax error at or near "layer"\n\nLINE 3: FORM layer\n             ^',
      error_subtype: 'SYNTAX_ERROR',
      position: String(position),
    })}`
    const e = parseEngineError(raw, { editorText, statementOffset: 0, ctasLineOffset: 1, ctasPrefixLength: prefix.length })
    expect(e.kind).toBe('Parser')
    expect(e.message).toBe('syntax error at or near "layer"')
    expect(e.position).toEqual({ line: 2, column: 6, offset: editorText.indexOf('layer') })
  })

  it('JSON binder errors keep their hints', () => {
    const raw = JSON.stringify({ exception_type: 'Binder', exception_message: 'Referenced column "nope" not found in FROM clause!\nCandidate bindings: "name", "geom"' })
    const e = parseEngineError(raw, { editorText: 'SELECT nope FROM layer', statementOffset: 0, ctasLineOffset: 0 })
    expect(e).toEqual({ kind: 'Binder', message: 'Referenced column "nope" not found in FROM clause!', hints: ['Candidate bindings: "name", "geom"'] })
  })
})
