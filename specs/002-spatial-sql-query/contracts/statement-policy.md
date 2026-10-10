# Contract: Statement policy (`packages/core/src/sql`), FR-013

## Scanner

```ts
export interface StatementSpan { text: string; from: number; to: number }   // offsets in the editor text

/** Splits on top-level `;`, ignoring `;` inside strings, quoted identifiers and comments. */
export function splitStatements(source: string): StatementSpan[]

/** FR-004: the selection if non-empty, else the statement containing (or immediately before) the cursor. */
export function statementToRun(source: string, selection: { from: number; to: number }): StatementSpan | null
```

The scanner understands:
- `-- line` comments and nested `/* block */` comments;
- `'string'` (with `''` escapes), `E'escaped'` and `$tag$dollar$tag$` strings;
- `"quoted identifiers"`.

A statement that is only whitespace or comments is treated as empty.

## Classifier

```ts
export type StatementClass =
  | { allowed: true; kind: 'query' }       // CTAS-able: SELECT, WITH…SELECT, FROM, VALUES, TABLE, PIVOT, UNPIVOT
  | { allowed: true; kind: 'utility' }     // DESCRIBE, SHOW, SUMMARIZE, EXPLAIN [ANALYZE]
  | { allowed: true; kind: 'tempDdl'; action: 'create' | 'drop'; object: 'table' | 'view'; name: string }
  | { allowed: false; reason: string }

export function classifyStatement(text: string, protectedNames: string[]): StatementClass
```

### Allowed

- **`query`**: the leading keyword is `SELECT`, `FROM`, `VALUES`, `TABLE`,
  `PIVOT` or `UNPIVOT`; or it is `WITH` and no top-level (depth-0) token
  after the CTE list is one of `INSERT UPDATE DELETE MERGE COPY CREATE DROP
  ALTER`.
- **`utility`**: the leading keyword is `DESCRIBE`, `SHOW`, `SUMMARIZE` or
  `EXPLAIN` (`EXPLAIN ANALYZE` included).
- **`tempDdl`**:
  - `CREATE [OR REPLACE] (TEMP|TEMPORARY) (TABLE|VIEW) [IF NOT EXISTS] <name> …`
  - `DROP (TABLE|VIEW) [IF EXISTS] <name>`

  In both forms, `<name>` must not be `layer`, the file-name alias, or start
  with `__se_` (case-insensitive, quotes stripped).

### Refused (fail closed), with the reason shown to the user

| Statement | Reason |
|---|---|
| `CREATE TABLE`/`VIEW` without `TEMP` | "Only temporary tables and views can be created; they live in this viewer only. Use CREATE TEMP TABLE …" |
| `CREATE`/`DROP` targeting a protected name | "`layer` is the opened file and can't be replaced or dropped." |
| `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `ALTER`, `TRUNCATE` | "Spatial Explorer doesn't modify data. Create a temp table from a query instead." |
| `COPY`, `EXPORT` | "Exporting results isn't available yet." |
| `INSTALL`, `LOAD`, `ATTACH`, `DETACH`, `USE` | "Extensions and other databases can't be used here." |
| `SET`, `RESET`, `PRAGMA`, `CALL`, `CHECKPOINT`, `VACUUM`, `IMPORT`, `BEGIN`/`COMMIT`/`ROLLBACK`, anything else | "This statement isn't supported in Spatial Explorer." |

## Defense in depth

The engine is locked down before any user statement can run
(research §2):
- `allowed_directories=['/se-source/']`
- `enable_external_access=false`
- `lock_configuration=true`

So anything that slips past the classifier still cannot read or write
outside the source directory, reach the network, load extensions, or change
settings.

**Tests must cover both layers**: `sql-policy.test.ts` for the classifier,
and a browser test that sends a refused statement straight through the
engine and asserts the permission error.
