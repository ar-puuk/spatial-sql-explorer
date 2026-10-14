// Spec 010 phase 11: SQL written into a style (a rule's condition, a graduated
// renderer's expression). MapLibre can't evaluate SQL, so the engine computes
// one hidden column per feature (the matching rule, or the expression's value)
// that the map's paint reads. Pure builders; QuerySession runs them.
import { tokenize } from '../sql/scanner.js'
import { EXPRESSION_VALUE_COLUMN, RULE_CLASS_COLUMN, rendererOf, type LayerStyle, type ResolvedStyle, type RuleDef } from './model.js'

export type ExpressionPurpose = 'condition' | 'value'

/** Words that make a statement, not an expression: refused outside strings. */
const STATEMENT_WORDS = new Set(['select', 'from', 'attach', 'detach', 'copy', 'install', 'load', 'pragma', 'create', 'drop', 'insert', 'update', 'delete', 'alter', 'set', 'call', 'export', 'import', 'use', 'checkpoint', 'vacuum'])

const HINT: Record<ExpressionPurpose, string> = {
  condition: "Use a condition on this layer's columns, like pop > 1000.",
  value: "Use an expression over this layer's columns, like gdp_md * 1e6 / pop_est.",
}

/**
 * Why `text` can't be a style expression, before the engine sees it, or null:
 * empty, more than one statement, unbalanced parentheses, or a statement word
 * (SELECT, FROM, ATTACH…) outside a string.
 */
export function checkExpression(text: string, purpose: ExpressionPurpose = 'condition'): string | null {
  if (!text.trim()) return purpose === 'condition' ? 'Write a condition, like pop > 1000.' : 'Write an expression, like pop / area.'
  let depth = 0
  for (const t of tokenize(text)) {
    if (t.type === 'semicolon') return HINT[purpose]
    if (t.type === 'lparen') depth++
    if (t.type === 'rparen' && --depth < 0) return 'A closing parenthesis has no opening one.'
    if (t.type === 'word' && STATEMENT_WORDS.has(t.text.toLowerCase())) return HINT[purpose]
  }
  if (depth > 0) return 'A parenthesis is not closed.'
  return null
}

/**
 * A feature's rule as SQL: the index of the first rule whose condition holds,
 * or -1. Rules not in `usable` (empty or invalid conditions) match nothing,
 * and keep their index.
 */
export function ruleCaseSql(rules: readonly RuleDef[], usable: ReadonlySet<string>): string {
  const arms = rules.flatMap((r, i) => (usable.has(r.id) ? [`WHEN (${r.where}) THEN ${i}`] : []))
  return arms.length ? `CASE ${arms.join(' ')} ELSE -1 END` : '-1'
}

/** A graduated expression's value per feature, as a number (anything else is no value). */
export function expressionValueSql(expression: string): string {
  return `TRY_CAST((${expression}) AS DOUBLE)`
}

/** Features per rule (`cls`: the rule index, -1 everything else), in one pass. */
export function ruleCountsSql(relation: string, rules: readonly RuleDef[], usable: ReadonlySet<string>): string {
  return `SELECT cls, count(*) AS n FROM (SELECT ${ruleCaseSql(rules, usable)} AS cls FROM ${relation}) GROUP BY cls`
}

/** The type the engine gives `expression` over `relation` (no rows read). */
export function expressionTypeSql(relation: string, expression: string): string {
  return `DESCRIBE SELECT (${expression}) AS v FROM ${relation}`
}

/** A column the engine computes for the map. */
export interface ComputedColumn {
  name: string
  sql: string
  /** DuckDB type (vector tiles encode by it). */
  type: string
}

/**
 * The columns the map needs computed for this style, from its resolution
 * (which knows which conditions are usable): none, the rule index, or the
 * expression's value.
 */
export function computedColumns(style: LayerStyle, resolved: ResolvedStyle | null): ComputedColumn[] {
  const r = rendererOf(style)
  if (!resolved || resolved.status !== 'ok') return []
  if (r.kind === 'rules') {
    const usable = new Set(resolved.classes.flatMap((c) => (c.kind === 'rule' && c.ruleId && !c.error ? [c.ruleId] : [])))
    return [{ name: RULE_CLASS_COLUMN, sql: ruleCaseSql(r.rules, usable), type: 'INTEGER' }]
  }
  if (r.kind === 'graduated' && r.expression) return [{ name: EXPRESSION_VALUE_COLUMN, sql: expressionValueSql(r.expression), type: 'DOUBLE' }]
  return []
}

/** `relation` with the computed columns added (the hidden row id and bbox columns are kept). */
export function withComputedSql(relation: string, computed: readonly ComputedColumn[]): string {
  return computed.length ? `(SELECT *, ${computed.map((c) => `${c.sql} AS ${c.name}`).join(', ')} FROM ${relation})` : relation
}
