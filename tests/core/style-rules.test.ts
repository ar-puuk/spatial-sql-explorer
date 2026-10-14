// Spec 010 phase 11: rule-based styling and graduated by expression — the
// condition check, the SQL the engine computes, resolution, paint and edits.
// The engine side runs for real in tests/web/specs/style-rules.spec.ts.
import { describe, expect, it } from 'vitest'
import { expression } from '@maplibre/maplibre-gl-style-spec'
import {
  addRule,
  checkExpression,
  computedColumns,
  DEFAULT_LAYER_STYLE,
  EXPRESSION_VALUE_COLUMN,
  moveRule,
  paintFor,
  removeRule,
  resolveStyle,
  RULE_CLASS_COLUMN,
  ruleCaseSql,
  ruleCountsSql,
  ruleLabel,
  sanitizeStyle,
  setClassColor,
  setClassVisible,
  startStyle,
  styleDataColumns,
  suggestedRules,
  updateRule,
  visibilityFilter,
  withComputedSql,
  type LayerStyle,
  type RulesRenderer,
} from '@spatial-explorer/core'

function evaluate(expr: unknown, properties: Record<string, unknown>, key: string, type = 'Polygon'): unknown {
  const parsed = expression.createExpression(expr, key)
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value))
  return parsed.value.evaluate({ zoom: 0 }, { type, properties } as never, {} as never)
}

const rules: RulesRenderer = {
  kind: 'rules',
  rules: [
    { id: 'a', label: 'Africa', where: "continent = 'Africa'", color: '#ff0000', visible: true },
    { id: 'b', label: '', where: 'pop_est > 100000000', color: '#00ff00', visible: true },
  ],
  elseColor: '#cccccc',
  elseVisible: true,
  elseLabel: 'Everything else',
}
const style: LayerStyle = { ...DEFAULT_LAYER_STYLE, renderer: rules }
const columns = [
  { name: 'continent', type: 'VARCHAR' },
  { name: 'pop_est', type: 'BIGINT' },
]

describe('checkExpression', () => {
  it('accepts conditions and values over columns', () => {
    expect(checkExpression("continent = 'Africa' AND pop_est > 1e8")).toBeNull()
    expect(checkExpression('gdp_md * 1e6 / pop_est', 'value')).toBeNull()
    expect(checkExpression("name LIKE '%select%'")).toBeNull() // words inside strings are text
  })
  it('refuses statements, a second statement and unbalanced parentheses, with a plain message', () => {
    expect(checkExpression('1; DROP TABLE x')).toMatch(/condition on this layer's columns/)
    expect(checkExpression('pop > (SELECT 1)')).toMatch(/like pop > 1000/)
    expect(checkExpression("x IN (FROM read_csv('a.csv'))")).not.toBeNull()
    expect(checkExpression('ATTACH something')).not.toBeNull()
    expect(checkExpression('(a > 1')).toBe('A parenthesis is not closed.')
    expect(checkExpression('a > 1)')).toBe('A closing parenthesis has no opening one.')
    expect(checkExpression('  ')).toMatch(/Write a condition/)
    expect(checkExpression('', 'value')).toMatch(/Write an expression/)
  })
})

describe('the SQL the engine computes', () => {
  it('a CASE in rule order (first match wins); unusable rules keep their index and match nothing', () => {
    expect(ruleCaseSql(rules.rules, new Set(['a', 'b']))).toBe("CASE WHEN (continent = 'Africa') THEN 0 WHEN (pop_est > 100000000) THEN 1 ELSE -1 END")
    expect(ruleCaseSql(rules.rules, new Set(['b']))).toBe('CASE WHEN (pop_est > 100000000) THEN 1 ELSE -1 END')
    expect(ruleCaseSql(rules.rules, new Set())).toBe('-1')
  })
  it('counts per rule in one pass', () => {
    expect(ruleCountsSql('layer', rules.rules, new Set(['a', 'b']))).toBe(
      "SELECT cls, count(*) AS n FROM (SELECT CASE WHEN (continent = 'Africa') THEN 0 WHEN (pop_est > 100000000) THEN 1 ELSE -1 END AS cls FROM layer) GROUP BY cls"
    )
  })
  it('computed columns follow the resolution: rules without errors, or the expression value', () => {
    const resolved = resolveStyle(style, { columns, rowCount: 10, ruleCounts: new Map([[0, 3], [1, 2], [-1, 5]]), ruleErrors: { b: 'Referenced column "pop_est" not found' } })
    expect(computedColumns(style, resolved)).toEqual([{ name: RULE_CLASS_COLUMN, sql: "CASE WHEN (continent = 'Africa') THEN 0 ELSE -1 END", type: 'INTEGER' }])
    const g = sanitizeStyle({ ...DEFAULT_LAYER_STYLE, renderer: { kind: 'graduated', column: '', expression: 'gdp_md * 1e6 / pop_est', method: 'quantile', classCount: 3, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} } })
    const values = [1, 2, 3, 4, 5, 6]
    const gr = resolveStyle(g, { columns: [...columns, { name: EXPRESSION_VALUE_COLUMN, type: 'DOUBLE' }], dataByColumn: { [EXPRESSION_VALUE_COLUMN]: { kind: 'values', column: EXPRESSION_VALUE_COLUMN, values } } })
    expect(computedColumns(g, gr)).toEqual([{ name: EXPRESSION_VALUE_COLUMN, sql: 'TRY_CAST((gdp_md * 1e6 / pop_est) AS DOUBLE)', type: 'DOUBLE' }])
    expect(withComputedSql('t', computedColumns(g, gr))).toBe('(SELECT *, TRY_CAST((gdp_md * 1e6 / pop_est) AS DOUBLE) AS __se_val FROM t)')
    expect(styleDataColumns(style)).toEqual([RULE_CLASS_COLUMN])
    expect(styleDataColumns(g)).toEqual([EXPRESSION_VALUE_COLUMN])
  })
})

describe('resolution', () => {
  it('one class per rule in order with its count, then everything else; errors kept on their rule', () => {
    const r = resolveStyle(style, { columns, rowCount: 10, ruleCounts: new Map([[0, 3], [1, 2], [-1, 5]]), ruleErrors: {} })
    expect(r.status).toBe('ok')
    expect(r.caption).toBe('Rules · 2 rules')
    expect(r.classes.map((c) => [c.key, c.kind, c.label, c.count])).toEqual([
      ['rule:a', 'rule', 'Africa', 3],
      ['rule:b', 'rule', 'pop_est > 100000000', 2],
      ['__else', 'other', 'Everything else', 5],
    ])
    const bad = resolveStyle(updateRule(style, 'b', { where: '(pop_est > 1' }), { columns, rowCount: 10, ruleCounts: new Map([[0, 3], [-1, 7]]) })
    expect(bad.classes[1].error).toBeTruthy()
    expect(bad.classes[1].count).toBe(0)
  })
  it('long conditions are shortened for the legend', () => {
    expect(ruleLabel({ label: '', where: 'a_really_long_column_name > 1 AND another_long_column = 2' })).toBe('a_really_long_column_name > 1 AND anoth…')
  })
  it('graduated by expression: a fallback with the reason when the engine refuses it', () => {
    const g = sanitizeStyle({ ...DEFAULT_LAYER_STYLE, renderer: { kind: 'graduated', column: '', expression: 'nope * 2', method: 'quantile', classCount: 3, ramp: { id: 'viridis', reversed: false }, classes: [], noValue: {} } })
    const r = resolveStyle(g, { columns, expressionError: 'Referenced column "nope" not found' })
    expect(r.status).toBe('fallback')
    expect(r.reason).toMatch(/nope/)
  })
})

describe('paint', () => {
  const resolved = resolveStyle(style, { columns, rowCount: 10, ruleCounts: new Map([[0, 3], [1, 2], [-1, 5]]) })
  it('colors each feature by the engine-computed rule index; missing or -1 is everything else', () => {
    const fill = (paintFor(style, resolved, '#ffff00').fill as Record<string, unknown>)['fill-color']
    expect(evaluate(fill, { [RULE_CLASS_COLUMN]: 0 }, 'fill-color')).toBe('#ff0000')
    // Tiles carry numbers as doubles.
    expect(evaluate(fill, { [RULE_CLASS_COLUMN]: 1.0 }, 'fill-color')).toBe('#00ff00')
    for (const p of [{ [RULE_CLASS_COLUMN]: -1 }, {}, { [RULE_CLASS_COLUMN]: 7 }]) expect(evaluate(fill, p, 'fill-color')).toBe('#cccccc')
  })
  it('hidden rules and a hidden else are filtered out', () => {
    const hidden = setClassVisible(setClassVisible(style, 'rule:b', false), '__else', false)
    const r = resolveStyle(hidden, { columns, rowCount: 10, ruleCounts: new Map([[0, 3], [1, 2], [-1, 5]]) })
    const filter = visibilityFilter(hidden, r)
    expect(evaluate(filter, { [RULE_CLASS_COLUMN]: 0 }, 'filter')).toBe(true)
    expect(evaluate(filter, { [RULE_CLASS_COLUMN]: 1 }, 'filter')).toBe(false)
    expect(evaluate(filter, { [RULE_CLASS_COLUMN]: -1 }, 'filter')).toBe(false)
  })
})

describe('edits', () => {
  it('start empty; suggestions from the data; add, update, move, remove; class edits by key', () => {
    const started = startStyle(DEFAULT_LAYER_STYLE, 'rules', { columns })
    expect(started.renderer).toMatchObject({ kind: 'rules', rules: [], elseLabel: 'Everything else' })
    const s = suggestedRules({ numeric: { column: 'pop_est', median: 12345678.9 }, text: { column: 'Continent Name', value: "Côte d'Ivoire" } })
    expect(s.map((r) => r.where)).toEqual(['pop_est > 12300000', `"Continent Name" = 'Côte d''Ivoire'`])
    let x = addRule(addRule(started, 'a > 1'), 'b = 2')
    const [r1, r2] = (x.renderer as RulesRenderer).rules
    expect(r1.id).not.toBe(r2.id)
    x = moveRule(x, r2.id, -1)
    expect((x.renderer as RulesRenderer).rules.map((r) => r.where)).toEqual(['b = 2', 'a > 1'])
    x = setClassColor(x, `rule:${r1.id}`, '#123456')
    expect((x.renderer as RulesRenderer).rules.find((r) => r.id === r1.id)?.color).toBe('#123456')
    x = setClassColor(x, '__else', '#abcdef')
    expect((x.renderer as RulesRenderer).elseColor).toBe('#abcdef')
    x = removeRule(x, r2.id)
    expect((x.renderer as RulesRenderer).rules).toHaveLength(1)
  })
  it('sanitize keeps rules, makes ids unique, and drops bad colors', () => {
    const s = sanitizeStyle({ renderer: { kind: 'rules', rules: [{ id: 'x', where: 'a > 1', color: 'nope' }, { id: 'x', where: 'b' }], elseColor: '#00f' } as never })
    const r = s.renderer as RulesRenderer
    expect(r.rules.map((k) => k.id)).toEqual(['x', 'x_'])
    expect(r.rules[0].color).toBe(DEFAULT_LAYER_STYLE.fillColor)
    expect(r.elseColor).toBe('#0000ff')
    expect(r.rules[1]).toMatchObject({ label: '', visible: true })
  })
})
