// Spec 010 phase 11: the rule conditions SLD and Mapbox GL styles can carry.
import { describe, expect, it } from 'vitest'
import { hasLike, parseSimpleWhere } from '@spatial-explorer/core'

describe('parseSimpleWhere', () => {
  it('reads one comparison: bare or quoted column, number or string', () => {
    expect(parseSimpleWhere('pop_est > 100000000')).toEqual({ kind: 'cmp', column: 'pop_est', op: '>', value: 100000000 })
    expect(parseSimpleWhere(`"Sub Region" = 'Western Africa'`)).toEqual({ kind: 'cmp', column: 'Sub Region', op: '=', value: 'Western Africa' })
    expect(parseSimpleWhere(`name = 'Côte d''Ivoire'`)).toEqual({ kind: 'cmp', column: 'name', op: '=', value: "Côte d'Ivoire" })
    expect(parseSimpleWhere('t >= -1.5e3')).toEqual({ kind: 'cmp', column: 't', op: '>=', value: -1500 })
  })
  it('reads every operator', () => {
    const ops = { '=': '=', '!=': '!=', '<>': '!=', '<': '<', '<=': '<=', '>': '>', '>=': '>=' } as const
    for (const [sql, op] of Object.entries(ops)) expect(parseSimpleWhere(`a ${sql} 1`), sql).toEqual({ kind: 'cmp', column: 'a', op, value: 1 })
    expect(parseSimpleWhere(`name LIKE 'Nam%'`)).toEqual({ kind: 'cmp', column: 'name', op: 'like', value: 'Nam%' })
  })
  it('AND binds tighter than OR; parentheses group', () => {
    expect(parseSimpleWhere(`a = 1 OR b = 2 AND c = 3`)).toEqual({
      kind: 'or',
      items: [
        { kind: 'cmp', column: 'a', op: '=', value: 1 },
        { kind: 'and', items: [{ kind: 'cmp', column: 'b', op: '=', value: 2 }, { kind: 'cmp', column: 'c', op: '=', value: 3 }] },
      ],
    })
    expect(parseSimpleWhere(`(a = 1 OR b = 2) AND c = 3`)?.kind).toBe('and')
  })
  it('anything else is not simple', () => {
    for (const w of ['NOT a = 1', 'a IS NULL', 'a IN (1, 2)', 'a + 1 > 2', 'lower(a) = 1', '1 = a', 'a = b', 'a > 1 AND', "a LIKE 5", '(a = 1', 'a BETWEEN 1 AND 2', '', 'a = TRUE'])
      expect(parseSimpleWhere(w), w).toBeNull()
  })
  it('hasLike', () => {
    expect(hasLike(parseSimpleWhere(`a = 1 AND b LIKE 'x%'`)!)).toBe(true)
    expect(hasLike(parseSimpleWhere(`a = 1`)!)).toBe(false)
  })
})
