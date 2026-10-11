// The result model (spec 007 research §9, contracts/core-data-access.md):
// a query runs ONCE into a staging temp table capped at MATERIALIZE_CAP + 1
// rows. Up to the cap, that table becomes the result (exact count, fast pages,
// views and styles). Over it, the table is dropped and the result becomes a
// view, so a 3M-row filter isn't copied into memory; only such big results run
// twice. The previous result is replaced only once the query has succeeded: a
// failed query keeps it (spec 002), whether it was a table or a view.
// Pure builders, tested in tests/core/result-model.test.ts.

export const RESULT_TABLE = '__se_result'
/** Where a query materializes before it replaces the result. */
export const RESULT_STAGING = '__se_result_next'

/**
 * Prepended to every query. The user's statement starts on the next line, at
 * column 1, so engine error positions stay mappable exactly as before
 * (spec 002 research §8).
 */
export const CTAS_PREFIX = `CREATE OR REPLACE TEMP TABLE ${RESULT_STAGING} AS SELECT * FROM (\n`

/** Closes the capped CTAS: one row more than the cap tells "over the cap" apart. */
export function ctasSuffix(cap: number): string {
  return `\n) LIMIT ${Math.max(1, Math.floor(cap)) + 1}`
}

export function materializeSql(statement: string, cap: number): string {
  return CTAS_PREFIX + statement + ctasSuffix(cap)
}

/** Puts the staged table in place of the result (after `dropResultSql`). */
export function promoteStagingSql(): string {
  return `ALTER TABLE ${RESULT_STAGING} RENAME TO ${RESULT_TABLE}`
}

/**
 * Drops the current result, a table or a view. DuckDB refuses `DROP TABLE`
 * on a view (even with IF EXISTS), and after `ALTER TABLE ... RENAME` this
 * build's `duckdb_tables()` no longer lists the table under its new name
 * (research.md, US3 outcomes), so the caller tries a table, then a view.
 */
export function dropResultSql(kind: 'table' | 'view'): string {
  return `DROP ${kind === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS ${RESULT_TABLE}`
}

/** A big result is a view over the user's statement (re-run by each page, view and style). */
export function resultViewSql(statement: string): string {
  return `CREATE OR REPLACE TEMP VIEW ${RESULT_TABLE} AS\n${statement}`
}

/**
 * Whether reading a big result re-runs expensive work (a whole-file sort, a
 * join, an aggregate or a window), from its EXPLAIN text. Plain scans and
 * filters over a file read in parts stay cheap (research §2), so they get no
 * "re-runs the query" notice.
 */
export function reRunsFromPlan(plan: string): boolean {
  return /\b(ORDER_BY|TOP_N|HASH_JOIN|NESTED_LOOP_JOIN|PIECEWISE_MERGE_JOIN|CROSS_PRODUCT|HASH_GROUP_BY|PERFECT_HASH_GROUP_BY|UNGROUPED_AGGREGATE|WINDOW|STREAMING_WINDOW)\b/.test(plan)
}

/** The statement is the untouched default query (it reads `layer` directly; no copy). */
export function isDefaultQuery(statement: string, defaultQuery: string): boolean {
  const norm = (s: string): string => s.replace(/;\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase()
  return norm(statement) === norm(defaultQuery)
}
