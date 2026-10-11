# Contract: Query service (`packages/core/src/query`)

This is the host-agnostic API that `packages/ui` uses for everything in spec
002. It has no DOM and no platform access (Constitution II): file bytes,
persistence and logging all go through `HostAdapter`.

```ts
/** Created by openFile() in place of tearing the connection down; one per viewer. */
export interface QuerySession {
  readonly table: QueryableTable              // data-model.md
  readonly defaultQuery: string               // 'SELECT * FROM layer LIMIT 1000'

  /** Runs one statement. Never throws for engine/policy errors: they come back as outcomes. */
  run(request: RunRequest, hooks: RunHooks): Promise<RunOutcome>

  /** Cancels the in-flight statement (research §1: streaming + cancelSent). Resolves when control is back. */
  cancel(): Promise<void>

  /** Autocomplete data (FR-015); call again after a tempDdl outcome. */
  catalog(): Promise<CatalogSnapshot>

  /** Drops temp objects and internal tables; called when the viewer reloads or closes. */
  dispose(): Promise<void>
}

export interface RunRequest {
  /** Full editor text plus selection; the session picks the statement (FR-004). */
  editorText: string
  selection: { from: number; to: number }
  /** Result CRS override from the chip; null = automatic (research §4). */
  crsOverride: number | null
}

export interface RunHooks {
  /** FR-012: called only when rowCount > LARGE_RESULT_THRESHOLD (50,000). */
  confirmLargeResult(rowCount: number): Promise<'all' | 'first' | 'cancel'>
  /** Streaming progress, for the in-panel progress text. */
  onProgress?(fetched: number, total: number): void
}

export type RunOutcome =
  | { kind: 'result'; result: QueryResult; durationMs: number; statement: ExecutedStatement }
  | { kind: 'ddl'; summary: string; durationMs: number; statement: ExecutedStatement }   // e.g. "Created temp table buffers (1,204 rows)"
  | { kind: 'refused'; reason: string; statement: ExecutedStatement }                     // statement-policy.md
  | { kind: 'error'; error: EngineError; durationMs: number; statement: ExecutedStatement }
  | { kind: 'cancelled'; durationMs: number; statement: ExecutedStatement }
  | { kind: 'empty' }                                                                       // nothing but whitespace/comments at the cursor

export interface ExecutedStatement { text: string; editorOffset: number }

export interface EngineError {
  kind: string            // 'Parser' | 'Binder' | 'Catalog' | 'Conversion' | ...
  message: string         // first line, without the "<Kind> Error: " prefix
  hints: string[]         // "Candidate bindings: …", useful "Did you mean …" (engine-internal suggestions dropped)
  /** In editor coordinates (already mapped back through CTAS + statement offset). */
  position?: { line: number; column: number; offset: number }
}

export const LARGE_RESULT_THRESHOLD = 50_000
```

## Guarantees

1. **Single flight.** A second `run()` while one is in flight rejects with a
   programming error. The UI disables Run instead.
2. **Previous result preserved.** `refused`, `error` and `cancelled` outcomes
   never touch the displayed result. Only `result` replaces it (FR-008,
   FR-009).
3. **One execution per query.** The user's statement is executed once, into
   `__se_result`; every later pass reads that table (research §5).
4. **Cancellable everywhere it matters.** The CTAS, the stats query and row
   streaming all go through `send`. `cancel()` resolves within 3 s (SC-004;
   measured at 6 ms).
5. **Logging.** Every run calls `hostAdapter.log?.(…)` once with the
   statement (collapsed to one line, truncated at 500 characters), its
   outcome, the row count and the duration (FR-010).
6. **Results in WGS84, attributes intact.**
   - `result.layer.features[i].geometry` is GeoJSON in WGS84, reprojected
     from the resolved result CRS. It is `null` for invalid or missing
     geometry.
   - Attributes are bigint-safe (spec 001's `sanitizeAttributes`).

## openFile() changes

- Source files are registered under `/se-source/` instead of `/tmp/`.
- The engine lockdown (research §2) is applied once per DuckDB instance,
  right after spatial loads (`getDuckDb`).
- `openFile()` returns `{ layer, session }`. The connection and `layer` view
  stay alive for the viewer's lifetime; the former drop-files-after-load
  behavior applies only to materialized files (≤ 64 MB).
