// T006 (spec 008): identifiers and literals built from user or file text.
import { describe, expect, it } from 'vitest'
import { quoteIdent, quoteLiteral } from '@spatial-explorer/core'

describe('quoteIdent', () => {
  it('double-quotes and doubles embedded quotes', () => {
    expect(quoteIdent('zone')).toBe('"zone"')
    expect(quoteIdent('city points')).toBe('"city points"')
    expect(quoteIdent('a"b')).toBe('"a""b"')
    expect(quoteIdent('')).toBe('""')
  })

  it('keeps unicode and backslashes as they are', () => {
    const bs = String.fromCharCode(92)
    expect(quoteIdent(`Bezirk ö${bs}n`)).toBe(`"Bezirk ö${bs}n"`)
  })
})

describe('quoteLiteral', () => {
  it('single-quotes and doubles embedded single quotes', () => {
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'")
    expect(quoteLiteral("'; DROP TABLE layer; --")).toBe("'''; DROP TABLE layer; --'")
    expect(quoteLiteral('')).toBe("''")
  })

  it('leaves backslashes, percent signs and unicode alone (DuckDB has no backslash escapes)', () => {
    const bs = String.fromCharCode(92)
    expect(quoteLiteral(`C:${bs}data${bs}x.gpkg`)).toBe(`'C:${bs}data${bs}x.gpkg'`)
    expect(quoteLiteral('50% ü')).toBe("'50% ü'")
  })
})
