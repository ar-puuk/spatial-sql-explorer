// T004 (spec 002, FR-013): statement allowlist, one test per row of
// specs/002-spatial-sql-query/contracts/statement-policy.md.
import { describe, expect, it } from 'vitest'
import { classifyStatement } from '@spatial-explorer/core'

const PROTECTED = ['layer', 'parcels']
const classify = (sql: string) => classifyStatement(sql, PROTECTED)

describe('allowed: queries', () => {
  for (const sql of [
    'SELECT * FROM layer',
    'select 1',
    '  -- comment first\n SELECT 1',
    'WITH a AS (SELECT * FROM layer) SELECT * FROM a',
    'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 3) SELECT * FROM r',
    'FROM layer SELECT name',
    'FROM layer',
    'VALUES (1, 2)',
    'TABLE layer',
    'PIVOT layer ON zone USING count(*)',
    'UNPIVOT layer ON a, b INTO NAME k VALUE v',
    '(SELECT 1) UNION (SELECT 2)',
  ]) {
    it(sql.replace(/\s+/g, ' '), () => expect(classify(sql)).toEqual({ allowed: true, kind: 'query' }))
  }
})

describe('allowed: utility', () => {
  for (const sql of ['DESCRIBE layer', 'SHOW TABLES', 'SUMMARIZE layer', 'EXPLAIN SELECT 1', 'EXPLAIN ANALYZE SELECT 1']) {
    it(sql, () => expect(classify(sql)).toEqual({ allowed: true, kind: 'utility' }))
  }
})

describe('allowed: temporary DDL', () => {
  it('CREATE OR REPLACE TEMP TABLE … AS', () => {
    expect(classify('CREATE OR REPLACE TEMP TABLE buffers AS SELECT ST_Buffer(geom, 10) AS geom FROM layer')).toEqual({
      allowed: true,
      kind: 'tempDdl',
      action: 'create',
      object: 'table',
      name: 'buffers',
    })
  })
  it('CREATE TEMPORARY VIEW IF NOT EXISTS with a quoted name', () => {
    expect(classify('create temporary view if not exists "Big Ones" as select 1')).toMatchObject({ allowed: true, kind: 'tempDdl', object: 'view', name: 'Big Ones' })
  })
  it('DROP VIEW IF EXISTS', () => {
    expect(classify('DROP VIEW IF EXISTS v')).toEqual({ allowed: true, kind: 'tempDdl', action: 'drop', object: 'view', name: 'v' })
  })
  it('DROP TABLE', () => {
    expect(classify('drop table buffers')).toMatchObject({ allowed: true, kind: 'tempDdl', action: 'drop', object: 'table', name: 'buffers' })
  })
})

describe('refused, with the contract reason', () => {
  const reason = (sql: string): string => {
    const c = classify(sql)
    if (c.allowed) throw new Error(`expected refusal for: ${sql}`)
    return c.reason
  }

  it('CREATE TABLE without TEMP', () => {
    expect(reason('CREATE TABLE x AS SELECT 1')).toBe(
      'Only temporary tables and views can be created; they live in this viewer only. Use CREATE TEMP TABLE …'
    )
    expect(reason('CREATE VIEW v AS SELECT 1')).toMatch(/^Only temporary tables and views/)
  })

  it('protected names, case- and quote-insensitive', () => {
    const protectedReason = "`layer` is the opened file and can't be replaced or dropped."
    expect(reason('DROP VIEW layer')).toBe(protectedReason)
    expect(reason('CREATE OR REPLACE TEMP VIEW "Layer" AS SELECT 1')).toBe(protectedReason)
    expect(reason('drop view PARCELS')).toBe(protectedReason)
    expect(reason('DROP TABLE __se_source')).toBe(protectedReason)
    expect(reason('CREATE TEMP TABLE "__SE_result" AS SELECT 1')).toBe(protectedReason)
  })

  it('a CTE that ends in a write', () => {
    expect(reason('WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x')).toBe(
      "Spatial Explorer doesn't modify data. Create a temp table from a query instead."
    )
  })

  for (const sql of ['INSERT INTO layer VALUES (1)', 'UPDATE layer SET a = 1', 'DELETE FROM layer', 'MERGE INTO t USING s ON true WHEN MATCHED THEN DELETE', 'ALTER TABLE t ADD COLUMN c INT', 'TRUNCATE t']) {
    it(sql, () => expect(reason(sql)).toBe("Spatial Explorer doesn't modify data. Create a temp table from a query instead."))
  }

  for (const sql of ["COPY layer TO 'x.csv'", "EXPORT DATABASE 'dir'"]) {
    it(sql, () => expect(reason(sql)).toBe("Exporting results isn't available yet."))
  }

  for (const sql of ['INSTALL httpfs', 'LOAD httpfs', "ATTACH ':memory:' AS o", 'DETACH o', 'USE o']) {
    it(sql, () => expect(reason(sql)).toBe("Extensions and other databases can't be used here."))
  }

  for (const sql of ['SET threads = 2', 'RESET threads', "PRAGMA database_list", 'CALL pragma_version()', 'CHECKPOINT', 'VACUUM', "IMPORT DATABASE 'd'", 'BEGIN', 'COMMIT', 'ROLLBACK']) {
    it(sql, () => expect(reason(sql)).toBe("This statement isn't supported in Spatial Explorer."))
  }

  // SC-003: a typo in the first word names it (and is still refused).
  it('SELEC * FROM layer', () => expect(reason('SELEC * FROM layer')).toBe('"SELEC" isn\'t a SQL statement keyword. Did you mean SELECT?'))
  it('selct name from layer', () => expect(reason('selct name from layer')).toBe('"selct" isn\'t a SQL statement keyword. Did you mean SELECT?'))
  it('FORM layer', () => expect(reason('FORM layer')).toBe('"FORM" isn\'t a SQL statement keyword. Did you mean FROM?'))
  it('FROBNICATE now', () => expect(reason('FROBNICATE now')).toBe('"FROBNICATE" isn\'t a SQL statement keyword. Queries start with SELECT, FROM or WITH.'))

  it('an empty statement is refused rather than allowed', () => {
    expect(classify('   -- nothing ').allowed).toBe(false)
  })
})
