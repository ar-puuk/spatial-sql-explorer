---

description: "Task list for spec 002: Spatial SQL Query"
---

# Tasks: Spatial SQL Query

**Input**: Design documents from `specs/002-spatial-sql-query/`

**Prerequisites**:
- `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`.
- `contracts/`: `query-service.md`, `statement-policy.md`,
  `host-adapter-delta.md`, `host-webview-protocol-delta.md`,
  `ui-query-panel.md`.

**Tests**: REQUIRED. Constitution IX requires unit tests (`tests/core`, Vitest),
browser tests (`tests/web`, Playwright) and extension tests (`tests/vscode-ext`,
`@vscode/test-electron`) for every layer a story touches. Within each story,
test tasks come first and must fail before implementation.

**Organization**: tasks are grouped by user story, so each story can be built
and verified on its own. Commit after each task (constitution, Development
Workflow).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete tasks).
- **[Story]**: US1–US5 from spec.md.
- Paths are repository-relative. The monorepo layout is spec 001's
  (`packages/core`, `packages/ui`, `apps/web`, `apps/vscode-ext`, `tests/*`).

## Ground rules for every task

- **Host-agnostic.** No `vscode`, File API, IndexedDB, `localStorage` or
  `sessionStorage` in `packages/core` or `packages/ui`. `npm run lint` must
  stay at 0 problems.
- **Never post Svelte `$state` proxies.** All webview → host messages go
  through the existing JSON-normalizing `post()` in
  `apps/vscode-ext/src/webview/hostAdapter.ts`.
- **Theming.** UI colors come only from `--se-*` tokens, defined in **both**
  `apps/vscode-ext/src/webview/theme.css` and `apps/web/src/theme.css`.
- **Run queries through `send`.** Every user statement runs through
  `AsyncDuckDBConnection.send(sql, true)`, never `query()`, so it can be
  cancelled (research §1).
- **Verify before checking off.** Run the relevant suite(s), then mark the
  task `[X]` with a one-line verification note, as spec 001's `tasks.md`
  does.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and theme tokens that every story's UI needs.

- [X] T001 Add the CodeMirror 6 dependencies to `packages/ui/package.json`, pinned to the versions `npm install` resolves:
  - `@codemirror/view`, `@codemirror/state`, `@codemirror/commands`
  - `@codemirror/language`, `@codemirror/autocomplete`, `@codemirror/lang-sql`
  - `@lezer/highlight`

  Run `npm install` at the root. Confirm that `npm run build --workspace=apps/vscode-ext` still succeeds, and record the new `dist-webview/main.js` size in `specs/002-spatial-sql-query/research.md` §6 (expected: about +380 KB minified).
  Done: pinned exactly; `@codemirror/lint` (needed by T034) is included. Baseline `main.js` is 1,331,711 bytes; the size with the editor imported is recorded at T021.
- [X] T002 [P] Add the `--se-sql-*` tokens from `contracts/ui-query-panel.md` to both theme files:
  - **Tokens**: `bg`, `fg`, `selection`, `cursor`, `gutter-fg`, `gutter-bg`, `active-line`, `keyword`, `string`, `number`, `function`, `operator`, `comment`, `error`.
  - **`apps/vscode-ext/src/webview/theme.css`**: map them to `--vscode-editor-*` and `--vscode-symbolIcon-*Foreground` (research §6), with a high-contrast override for `--se-sql-active-line` (transparent) and borders.
  - **`apps/web/src/theme.css`**: map them to brand values in both the light block and the dark block. Every value must pass AA contrast on `--se-sql-bg`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the engine lockdown, the `layer` view, the query session, the
statement scanner and policy, and the HostAdapter additions. Every story
depends on these.

**⚠️ CRITICAL**: no user-story work starts until this phase passes its
checkpoint.

- [X] T003 [P] Write `tests/core/sql-scanner.test.ts` (Vitest), covering `splitStatements` and `statementToRun` per `contracts/statement-policy.md`:
  - `;` inside `'…'`, `''` escapes, `E'…'`, `$tag$…$tag$`, `"ident;"`, `-- ;` and nested `/* /* ; */ */` does not split;
  - empty and comment-only statements are treated as empty;
  - cursor at the start, middle, end and between statements;
  - a non-empty selection wins over the cursor;
  - returned `from`/`to` offsets are correct.

  Must fail until T005.
- [X] T004 [P] Write `tests/core/sql-policy.test.ts`, with one test per row of `contracts/statement-policy.md`:
  - **Allowed**: `SELECT`; `WITH … SELECT`; FROM-first; `VALUES`; `TABLE t`; `PIVOT`; `DESCRIBE`; `SHOW`; `SUMMARIZE`; `EXPLAIN ANALYZE`; `CREATE OR REPLACE TEMP TABLE x AS …`; `CREATE TEMPORARY VIEW`; `DROP VIEW IF EXISTS x`.
  - **Refused, each asserting its exact reason text**:
    - `CREATE TABLE` without `TEMP`;
    - `DROP VIEW layer`, `CREATE TEMP VIEW "Layer"` and `DROP TABLE __se_source` (protected names, case- and quote-insensitive);
    - `WITH x AS (…) INSERT INTO …`;
    - `INSERT`, `UPDATE`, `DELETE`, `COPY`, `EXPORT`, `INSTALL`, `LOAD`, `ATTACH`, `SET`, `PRAGMA`, `CALL`;
    - an unknown leading keyword.

  Must fail until T006.
- [X] T005 [P] Implement `packages/core/src/sql/scanner.ts`:
  - A tokenizer that understands strings, quoted identifiers, dollar quotes and nested comments.
  - `splitStatements(source): StatementSpan[]` and `statementToRun(source, selection): StatementSpan | null`, exactly as specified in `contracts/statement-policy.md`.
  - Export a `tokens(text)` helper for T006.

  Make T003 pass.
- [X] T006 [P] Implement `packages/core/src/sql/policy.ts`:
  - `classifyStatement(text, protectedNames): StatementClass` per `contracts/statement-policy.md`, failing closed and using the exact reason strings from the contract table.
  - Add `packages/core/src/sql/index.ts` exporting the scanner and policy.
  - Re-export it from `packages/core/src/index.ts`.

  Make T004 pass.
  Verified: `tests/core` has 96/96 passing (scanner 10, policy 49, plus the existing 37).
- [X] T007 Extend the HostAdapter contract per `contracts/host-adapter-delta.md`:
  - **Core** (`packages/core/src/hostAdapter.ts`): add `OpenedFileRef.stateKey: string` and optional `log?(line: string): void`.
  - **Web** (`apps/web/src/hostAdapter.ts`): `stateKey` is `${name}|${size}|${lastModified}` of the primary file; `log` is omitted.
  - **VS Code host** (`apps/vscode-ext/src/extension.ts`): add `primaryFileUri: document.uri.toString()` to the `assets` message.
  - **VS Code webview** (`apps/vscode-ext/src/webview/hostAdapter.ts`): `stateKey` is that URI; `log` posts the existing `{ type: 'log', detail }`.

  Update `specs/001-quick-look/contracts/host-adapter.md` to point to the delta. Typecheck all workspaces.
  Verified: all workspaces typecheck. The VS Code `stateKey` falls back to the file name if the URI hasn't arrived yet; it always arrives with `assets`, before `openFiles` resolves.
- [X] T008 Add the engine lockdown in `packages/core/src/duckdbService.ts` (research §2):
  - Inside `getDuckDb`, after `LOAD spatial` on the init connection, run `SET allowed_directories = ['/se-source/']`, then `SET enable_external_access = false`, then `SET lock_configuration = true`.
  - Export `SOURCE_DIR = '/se-source/'`.
  - In `packages/core/src/openFile.ts`, register every source file under `SOURCE_DIR` instead of `/tmp/` (registration API calls are not affected by the lockdown).
  - Run `npm run test:web` and `npm run test:vscode-ext`; they must still pass: all formats, including shapefile sidecars and GML.
  Verified: web 12/12, VS Code 20/20. The first run failed for the 3 Parquet cases because the `parquet` extension autoload was blocked; fixed by loading parquet before the lockdown (research §2).
- [X] T009 Add the query data types to `packages/core/src/models.ts`, per `data-model.md`:
  - `QueryableTable`, `QueryResult`, `ResultCrsSource`, `QueryHistoryEntry`, `CatalogSnapshot`.
  - `Layer.rowCount: number` (all rows, including invalid geometry).
  - `LARGE_RESULT_THRESHOLD = 50_000` and `DEFAULT_QUERY = 'SELECT * FROM layer LIMIT 1000'`.
- [X] T010 Refactor `packages/core/src/openFile.ts` to create the queryable table and keep it alive (`contracts/query-service.md`, "openFile() changes"; research §5).
  - **Backing table** (internal `__se_source`):
    - files ≤ 64 MB: `CREATE OR REPLACE TABLE __se_source AS SELECT * FROM <reader>`;
    - larger files: no table; the view reads the reader directly.
  - **The `layer` view**: `CREATE OR REPLACE VIEW layer AS SELECT <attribute columns>, <source geometry column> AS geom FROM <backing>`, applying spec 001's attribute rules (drop `OGC_FID`, keep `fid`; parquet/CSV geometry expressions as today, but **not** reprojected: `geom` stays in the source CRS).
  - **File-name alias**: create the same view under the file's base name when it matches `/^[A-Za-z_][A-Za-z0-9_]*$/` and is not a keyword (check against `duckdb_keywords()`).
  - **Initial view**: build it by running `DEFAULT_QUERY` through the query session (T011). The query-service result path doesn't exist yet in Phase 2, so implement the minimal version now, reusing the existing stats and rows code, and route it through T011's `run()` in US1.
  - **Invalid geometry** (plan, Spec amendments): rows with invalid or NULL geometry are kept in `features` with `geometry: null`. Set `rowCount = all rows` and `featureCount = valid`.
  - Drop registered files only when the backing is materialized. Return `{ layer, session }`.
- [X] T011 Implement `packages/core/src/query/session.ts`, the `QuerySession` skeleton from `contracts/query-service.md`:
  - It owns a **dedicated** query connection (separate from the open connection).
  - Fields: `table` and `defaultQuery`.
  - `cancel()` calls `connection.cancelSent()` and awaits the in-flight promise's settlement.
  - Single-flight guard.
  - `dispose()` drops `__se_result`, temp objects and views, then closes connections.
  - A `runRaw(sql)` that streams through `send` (for internal use and the e2e hook in T036). `run()` itself is completed in US1.
  - Export it from `packages/core/src/index.ts`.
- [X] T012 Update `packages/ui/src/viewerStore.svelte.ts` and both shell entry points (`apps/web/src/App.svelte`, `apps/vscode-ext/src/webview/main.ts`) for `openFile()`'s new `{ layer, session }` return:
  - The store keeps `session` and disposes the previous one on reload or re-open.
  - Update spec 001's table-count expectations for the invalid-geometry amendment:
    - `tests/web/specs/open-file.spec.ts`: grid `aria-rowcount` = 181 (180 rows + header); drawer count text "180 rows · 179 mapped";
    - `tests/web/specs/performance.spec.ts`, `basemap.spec.ts`, `accessibility.spec.ts`: any "179 features" text;
    - `tests/vscode-ext/src/suite/*.test.ts`: `featureCount` assertions stay the valid count; add `rowCount` where reported.
  - Update `packages/ui/src/ViewerLayout.svelte`'s count label to "N rows · M mapped". When `rowCount === featureCount`, show "N features" as today.

**Checkpoint**: `npm run test:core`, `npm run test:web`, `npm run test:vscode-ext` and `npm run lint` all pass. The app behaves like spec 001, except that invalid-geometry rows are listed in the table.

✅ **Phase 2 checkpoint reached (2026-10-10)**: core 96/96, web 12/12, VS Code 20/20 (full format matrix and CRS), lint 0.

Implementation notes:
- **No temp backing table.** `__se_source` and `layer` are regular objects, not TEMP: DuckDB temp tables are visible only to the connection that created them, and queries run on the session's own connection.
- **Result pipeline.** `query/run.ts` (`buildQueryResult`) already is the shared pipeline: it executes once into `__se_result` and streams everything via `send`. The initial view is `DEFAULT_QUERY` through it (FR-003); US1 adds policy, CRS and size handling around it.
- **Two kinds of counts.** `Layer` now separates result-level counts (`rowCount`, `featureCount` = mapped, `invalidGeometryCount`) from whole-file `source` totals, which the status bar and the VS Code test hook report (spec 001 semantics kept).
- **Performance.** Warm ~10 MB open: 1.40 s run alone (spec 001: 1.20 s). The full suite had measured 2.27 s because the timing spec ran alongside other tests. `performance.spec.ts` now runs in its own Playwright project after all others.

---

## Phase 3: User Story 1 - Run a query and see the result on the map and in the table (Priority: P1) 🎯 MVP

**Goal**: a docked SQL editor whose statement runs on Ctrl/Cmd+Enter; the
result replaces the map and table; spec 001's interactions keep working on
results; the large-result guard and the result CRS work.

**Independent Test**: open a file, run a filtering query, and confirm the map
and the table contain exactly the returned rows (quickstart Scenarios 1, 6
and 7).

### Tests for User Story 1 ⚠️ (write first; they must fail)

- [X] T013 [P] [US1] Write `tests/core/result-crs.test.ts` for `resolveResultCrs(...)` (research §4):
  - precedence override > engine-typed `GEOMETRY('EPSG:x')` > extent detection > layer;
  - detection only when the layer CRS is projected (not 4326) **and** the result extent is within ±180/±90 while the layer's isn't;
  - no detection for a WGS84 layer;
  - the `source` field reported correctly in each case.
- [X] T014 [P] [US1] Write `tests/web/specs/query.spec.ts` (Playwright, production build), covering quickstart Scenario 1 steps 1–4 and Scenario 6 (with `usa-utm12n.gpkg`):
  - Open the panel with Ctrl+Shift+Q; assert the editor text is `SELECT * FROM layer LIMIT 1000` and the header reads `layer · EPSG:4326 · 180 rows`.
  - Type a filter, press Ctrl+Enter, and assert the grid `aria-rowcount`, the status line "✓ N rows · N mapped" and the rendered features.
  - Run a `GROUP BY` and assert the "no geometry to map" note.
  - For CRS: assert km² ≈ 10.18e6 and the chip reads `EPSG:26912 (layer)`, then `EPSG:4326 (detected)` after the `ST_Transform` query.
  - Add an SC-001 timing check on the generated ~10 MB parcels file: a filtering query renders in under 1000 ms.
- [X] T015 [P] [US1] Write `tests/web/specs/query-large.spec.ts` for quickstart Scenario 7, using a generated 60,000-point GeoJSON written to a temp dir as in `performance.spec.ts`:
  - `SELECT * FROM layer` shows the dialog with the row count;
  - "Show first 50,000" renders 50,000 rows and says so;
  - "Cancel" keeps the previous result.
- [X] T016 [P] [US1] Write `tests/vscode-ext/src/suite/query.test.ts`. It uses the `spatialExplorer._runQuery` and `_getQueryState` hooks (contract: `host-webview-protocol-delta.md`).
  - **SC-002 parity**: for each format in spec 001's `format-matrix.test.ts` cases, the default query's `mappedCount` equals spec 001's `featureCount`.
  - **A filter query**: `rowCount` and `mappedCount` as expected.
  - **A UTM transform query**: `resultCrsSource === 'detected'`.

### Implementation for User Story 1

- [X] T017 [P] [US1] Implement `packages/core/src/query/resultCrs.ts`: `resolveResultCrs({ override, engineType, resultExtent, layerCrs, layerExtent })` → `{ crs: CrsInfo; source }` (research §4). Make T013 pass.
- [X] T018 [US1] Complete `QuerySession.run()` in `packages/core/src/query/run.ts` for `kind: 'query'` (research §5):
  1. **Pick and classify**: `statementToRun` then `classifyStatement`; a refusal returns a `refused` outcome.
  2. **Materialize**: `CREATE OR REPLACE TEMP TABLE __se_result AS` + `'\n'` + the statement text, via `send`. Drain the reader and await it, so the run is cancellable.
  3. **Describe**: `DESCRIBE __se_result` gives the first `GEOMETRY` column as the mapped one; the others are rendered as `left(ST_AsText(col), 200)` text.
  4. **Stats**: one aggregate gives `rowCount`, `mappedCount`, `invalidGeometryCount`, the extent (in the result CRS) and the geometry types.
  5. **Result CRS**: `resolveResultCrs`.
  6. **Size check**: if `rowCount > LARGE_RESULT_THRESHOLD`, await `hooks.confirmLargeResult`. `'cancel'` gives a `cancelled` outcome; `'first'` sets `truncatedTo = 50,000`.
  7. **Stream rows**: through `send`, selecting the attributes plus `ST_AsGeoJSON(<reprojectToWgs84Sql(geomCol, resultSrid)>)`. Convert each Arrow batch with `sanitizeAttributes`, yield to the event loop (`await new Promise(r => setTimeout(r, 0))`) between batches, and call `hooks.onProgress`.
  8. **Build the Layer** (spec 001 shape) and return `{ kind: 'result', … }` with `durationMs`.
  9. **Log**: call `hostAdapter.log?.(...)` once (contract guarantee 5).

  Keep the previous result untouched on any non-result outcome.
- [X] T019 [US1] Add the remaining kinds to `packages/core/src/query/run.ts`:
  - **`utility`** (`DESCRIBE`, `SHOW`, `SUMMARIZE`, `EXPLAIN`): stream directly into a table-only `QueryResult` (`geometryColumn: null`). Stringify `EXPLAIN` plan text into a single `explain_value` column.
  - **`tempDdl`**: execute via `send`, then return `{ kind: 'ddl', summary }` with a row count for `CREATE … AS` (`SELECT count(*) FROM <name>`), e.g. "Created temp table `buffers` (1,204 rows)" or "Dropped view `v`".
- [X] T020 [US1] Route the initial open through the session in `packages/core/src/openFile.ts`. The layer returned by `openFile()` must be the result of `session.run({ editorText: DEFAULT_QUERY, … })`, so the default query and the initial view are the same code path (FR-003, SC-002). Delete the now-duplicate stats and rows code from `openFile.ts`.
- [X] T021 [P] [US1] Create `packages/ui/src/SqlEditor.svelte`, a CodeMirror 6 wrapper:
  - **Props**: `value`, `onChange`, `onRun(selection)`, `readonly`, `diagnostics`, `completionSources`.
  - **Extensions**: line numbers, history, bracket matching, active line, `sql()` from `@codemirror/lang-sql`, and a `HighlightStyle` built only from the `--se-sql-*` tokens (T002), via `EditorView.theme` with `var(...)` values.
  - **Keys**: `Mod-Enter` runs; Tab moves focus out of the editor and indent moves to `Ctrl-]` (`contracts/ui-query-panel.md`).
  - **Accessibility**: `aria-label="SQL query"`.
  - **Font**: `var(--se-font-mono)`, plus the editor font size in VS Code.
- [X] T022 [P] [US1] Create `packages/ui/src/ResultCrsChip.svelte`: shows `EPSG:x (layer|detected|engine|override)`. Its dropdown takes an EPSG code input or "Same as layer"; on change it calls `onOverride(code | null)`, and the store re-runs the last query. It uses `--se-*` tokens, has a label, and is keyboard-operable.
- [X] T023 [P] [US1] Create `packages/ui/src/LargeResultDialog.svelte` (FR-012; text and buttons from `contracts/ui-query-panel.md`): a modal over the map pane, focus-trapped, with "Show first 50,000" as the default button and Esc meaning Cancel. It returns `'all' | 'first' | 'cancel'`.
- [X] T024 [US1] Add the query state machine to `packages/ui/src/viewerStore.svelte.ts` (`data-model.md`, Query state transitions):
  - **State**: `queryText` (initialized to `DEFAULT_QUERY`), `queryPhase`, `lastOutcome`, `crsOverride`, `fetchProgress`, `pendingLargeResult` (a promise resolver the dialog answers).
  - **`runQuery(selection)`**: calls `session.run` and, on `result`, replaces `session.layer` (`ViewerSession.layer`), clears the selection, keeps the style, and fits the extent.
  - Any non-result outcome leaves the layer untouched.
- [X] T025 [US1] Create `packages/ui/src/QueryPanel.svelte`:
  - **Header**: `layer` (+ alias) · CRS · total rows, a "?" docs link, and the Run button.
  - **Body**: `SqlEditor` and an `aria-live="polite"` status line with all success states from `contracts/ui-query-panel.md` (✓ rows · mapped · ms; table-only; temp DDL; Running… with a live timer; Fetching N / M).
  - **Footer**: `ResultCrsChip`.
  - Show the existing `ProgressBar` while running.
- [X] T026 [US1] Integrate the panel into `packages/ui/src/ViewerLayout.svelte`:
  - Split the bottom drawer into `[QueryPanel | sash (col-resize, keyboard-operable like the row sash) | AttributeTable]`.
  - The query panel is **collapsed to its header strip by default**, opened by clicking the header or Ctrl/Cmd+Shift+Q (a window keydown handler).
  - Stack the two vertically when the viewer is narrower than 720 px.
  - Render `LargeResultDialog` when the store has a pending large result.
  - For a table-only result (FR-006): keep the previous map layer at 35% opacity (MapView `dimmed` prop) and show a map notice "This result has no geometry to map".
- [X] T027 [US1] Update `packages/ui/src/AttributeTable.svelte` and `packages/ui/src/MapView.svelte` for results:
  - **Table**: show `otherGeometryColumns` as monospace truncated text with a title tooltip; rows whose `geometry` is null get a muted "no geometry" marker in the `#` cell.
  - **Map**: `toFeatureCollection` skips null geometries (already the case); add the `dimmed` prop.
  - **Feature inspector**: shows result attributes unchanged.
- [X] T028 [US1] Add the VS Code test hooks and output logging (`contracts/host-webview-protocol-delta.md`):
  - **Host** (`apps/vscode-ext/src/extension.ts`): commands `spatialExplorer._runQuery(sql, confirm?)` and `_getQueryState()`, which post `testRunQuery` and store the last `queryState`.
  - **Webview** (`apps/vscode-ext/src/webview/main.ts`): handle `testRunQuery` by setting the store's `queryText` and calling `runQuery` with the whole text selected, auto-answering the dialog with `confirm`. Report `queryState` from a `$effect.root` in a new `apps/vscode-ext/src/webview/queryState.svelte.ts` (pattern: `viewState.svelte.ts`).
  - **Logging**: query lines reach the "Spatial Explorer" output channel through `HostAdapter.log`.

**Checkpoint**: T013–T016 pass. Quickstart Scenarios 1, 6 and 7 pass by hand in both shells. `npm run screenshots` shows the panel looking native in all three VS Code themes and in web light/dark.

✅ **US1 checkpoint reached (2026-10-10)**: core 104/104; web `query.spec` 3/3 and `query-large.spec` 1/1; VS Code 32/32 (ten-format default-query parity, filter, CRS detection, plus every spec 001 test). Screenshots reviewed: VS Code Dark and Light Modern, web light and dark.

Deviations and notes:
- **Shared pipeline.** T020's "route the initial open through the session" landed with T010/T011: `openFile` calls `session.runDefault()`, which is the same `buildQueryResult` as `run()`.
- **SC-001 timing location.** The SC-001 query timing is in `performance.spec.ts` (run alone), not `query.spec.ts`.
- **Contract change.** `QueryStateReport` gained `runCount` (contract updated).
- **Bugs found by screenshots and fixed:**
  - A new result replayed the previous zoom request: MapView's zoom effect tracked `layer`, so it is now `untrack`ed.
  - `ST_GeometryType` enum lists arrived as dictionary codes, so every layer read as "Point" (open and results alike). Now cast to `VARCHAR`.
  - The status line split "38 ms" across lines; NBSP fixed it.
- **Bundle size**: +423 KB, recorded in research §6 (closes T001).

---

## Phase 4: User Story 2 - Understand and recover from query problems (Priority: P1)

**Goal**: specific errors with editor positions, policy refusals, Cancel and
Esc, and the previous result always preserved.

**Independent Test**: run an invalid query and a slow query; check for a
position-aware error, a working Cancel, and that the previous result is
unchanged (quickstart Scenario 2).

### Tests for User Story 2 ⚠️

- [X] T029 [P] [US2] Write `tests/core/sql-errors.test.ts` for `parseEngineError(message, { statementOffset, ctasLineOffset: 1, editorText })`, using the exact research §8 samples:
  - **Kind and message**: the parser, binder and catalog errors are split into kind and message.
  - **Duplication**: the duplicated LINE block is collapsed.
  - **Position**: the line and column come from the caret, mapped through the CTAS newline (`line - 1`) and the statement offset to an editor `{ line, column, offset }`.
  - **Hints**: "Candidate bindings" is kept; engine-internal "Did you mean" suggestions (`pg_*`, `duckdb_*`, `list_aggregate`, `str_split`) are dropped and real ones kept.
  - **No position**: messages without a LINE block have no position.
- [X] T030 [P] [US2] Write `tests/web/specs/query-errors.spec.ts` for quickstart Scenario 2, steps 1–4:
  - the syntax error message and a `.cm-lintRange-error` on line 2;
  - the binder error names `nope` and lists candidates;
  - `COPY` and `INSERT INTO layer` are refused with the contract reasons and the previous result is unchanged (assert the grid row count before and after);
  - **engine lockdown**: navigate with `?e2e=1` and call `window.__spatialExplorerE2E.runRaw("COPY layer TO '/tmp/x.csv'")` and `runRaw("SELECT * FROM read_csv('https://example.com/x.csv')")`; both must reject with "Permission Error".
- [X] T031 [P] [US2] Write `tests/web/specs/query-cancel.spec.ts` for quickstart Scenario 2, step 5:
  - run the 200,000² cross join;
  - click Cancel after 500 ms, and assert "Cancelled after" appears within 3,000 ms (SC-004);
  - then run `SELECT 1` successfully;
  - repeat with Esc in the editor.
- [X] T032 [P] [US2] Extend `tests/vscode-ext/src/suite/query.test.ts`:
  - a refused `COPY` gives `phase: 'refused'` with the reason;
  - an invalid query gives `errorPosition`;
  - cancel via `spatialExplorer._cancelQuery` during the cross join gives `phase: 'cancelled'` within 3 s;
  - the output channel received one line per query (expose the last N logged lines through a test-only `_getLogLines` command added in T037).

### Implementation for User Story 2

- [X] T033 [P] [US2] Implement `packages/core/src/sql/errors.ts`, `parseEngineError()` as in T029, and use it in `run.ts` for `kind: 'error'` outcomes. Make T029 pass.
- [X] T034 [US2] Show errors and refusals in `packages/ui/src/QueryPanel.svelte` and `SqlEditor.svelte`:
  - **Status line**: an error badge with the kind, plus the message and hints; refusals show "⛔ reason".
  - **Editor diagnostics** (via `@codemirror/lint`'s `setDiagnostics`): an error range from the position offset to the end of its token, and a gutter marker. Cleared on the next edit or run.
  - Add `@codemirror/lint` to the T001 dependency set (MIT), pinned.
- [X] T035 [US2] Add the Cancel flow:
  - **UI** (`QueryPanel.svelte`): a Cancel button visible while running or fetching; Esc in the editor while running cancels.
  - **Store** (`viewerStore.svelte.ts`): `cancelQuery()` calls `session.cancel()`, and the status shows "Cancelled after N s". Make sure fetching (T018 step 7) also stops: the batch loop checks a cancelled flag and the reader is cancelled.
- [X] T036 [US2] Add the e2e escape hatch for T030 in `apps/web/src/App.svelte`: only when `new URLSearchParams(location.search).has('e2e')`, expose `window.__spatialExplorerE2E = { runRaw: (sql) => session.runRaw(sql) }`. Document in a comment that the engine lockdown, not this hook, is the security boundary.
- [X] T037 [US2] VS Code test support in `apps/vscode-ext/src/extension.ts`:
  - `spatialExplorer._cancelQuery` posts `testCancelQuery`;
  - `_getLogLines` keeps the last 50 logged lines in memory in addition to the output channel.
  - Handle `testCancelQuery` in `apps/vscode-ext/src/webview/main.ts`.

**Checkpoint**: T029–T032 pass. Quickstart Scenario 2 passes in both shells.

✅ **US2 checkpoint reached (2026-10-10)**: core 112/112, web `query-errors` 4/4 and `query-cancel` 2/2, VS Code 35/35.

Implementation notes:
- **Errors from `send` are JSON** (research §8 addendum): the parser unwraps them and uses their exact `position`.
- **Esc cancels via a capture-phase handler on the panel**, not a CodeMirror binding, which the editor's own Escape bindings could swallow.
- **Follow-up step errors carry no position.** Errors from our own steps after the user's statement executed (describe, stats, fetch) are re-raised without a LINE block, so they never point into the user's SQL.
- **Status wording**: "1 row", not "1 rows".

---

## Phase 5: User Story 3 - Get back to the original view (Priority: P2)

**Goal**: one Reset action restores the default query, its result, the extent
and the style.

**Independent Test**: run any query, then Reset, and compare with a fresh open
(quickstart Scenario 3).

- [X] T038 [P] [US3] Add a Reset test to `tests/web/specs/query.spec.ts`:
  - run a filter, change the style fill, then click Reset;
  - assert the editor holds the default query, the grid matches the initial counts, the style is the original (default or sidecar), and the map extent matches the initial fit (compare the `data-rendered-features` count and the scale-bar text);
  - with an edited editor, Reset asks for confirmation first.
- [X] T039 [US3] Implement `resetQuery()` in `packages/ui/src/viewerStore.svelte.ts`:
  - restore `queryText = DEFAULT_QUERY`, run it, and restore the style from `layer.styleSidecar` or `DEFAULT_LAYER_STYLE` (reuse `applySidecar`);
  - clear `crsOverride`; refit.
  - Add the Reset button to `packages/ui/src/QueryPanel.svelte`, using the existing `Icon name="reset"`. It asks "Discard your query changes?" with a small inline confirm (not `window.confirm`, which webviews block) when `queryText` differs from the last-run text.

**Checkpoint**: T038 passes in the web build. Reset works in VS Code by hand.

✅ T038 passes. Reset restores the original layer **object** kept from opening, rather than re-running `LIMIT 1000`, which would lose the whole-file fit and the "Showing 1,000 of N" truncation, so the view is exactly the freshly opened one.

---

## Phase 6: User Story 4 - Write queries faster with autocomplete (Priority: P2)

**Goal**: suggestions for tables, columns (with types), spatial functions
(with signatures and descriptions) and keywords, all from the live catalog,
refreshed after temp DDL.

**Independent Test**: type the start of a column and a function, and confirm
both are suggested and completed (quickstart Scenario 4).

- [X] T040 [P] [US4] Write `tests/web/specs/query-autocomplete.spec.ts` for quickstart Scenario 4:
  - typing `SELECT na` lists `name` with the type `VARCHAR`;
  - `ST_Ar` lists `ST_Area` first, with a signature and description in the info panel;
  - after `CREATE TEMP TABLE big AS …`, typing `FROM bi` suggests `big`;
  - `__se_*` objects are never suggested.
- [X] T041 [P] [US4] Implement `packages/core/src/query/catalog.ts`, giving `QuerySession.catalog()` → `CatalogSnapshot` (research §7):
  - **Tables and columns**: `duckdb_tables()`, `duckdb_views()`, `duckdb_columns()` (`NOT internal`, excluding `__se_%`, including `layer`, the alias and temp objects).
  - **Functions**: `duckdb_functions()`, grouped by name with overload signatures `name(params) → return_type` and the description's first paragraph, with `ST_*` ranked first.
  - **Keywords**: `duckdb_keywords()`.
  - Cache the snapshot and invalidate it after `tempDdl` outcomes.
- [X] T042 [US4] Wire completion into `packages/ui/src/SqlEditor.svelte`:
  - pass `schema` (table → columns, with types as `detail`) to `sql({ schema, defaultTable: 'layer', upperCaseKeywords: true })`;
  - add a custom `CompletionSource` for functions (label, `detail` signature, `info` description, boost for `ST_*`) and keywords;
  - style the tooltip with `--se-menu-*` tokens.
  - `QueryPanel` loads the catalog after open and after DDL.
  - *Done*: `query-autocomplete.spec` passes (with query and query-errors, 9/9). Note: `autocompletion({ override })` replaces every source, so `schemaCompletionSource` from lang-sql is composed back in. The store loads the catalog after open and after each `ddl` outcome. `QuerySession.catalog()` returns the cache or `null` while a query runs, never queuing behind it. The test matches `big` by exact label because `BIGINT` and others also contain it. VS Code themes are reviewed via the T049 screenshots.

**Checkpoint**: T040 passes. Autocomplete works in VS Code by hand, in all three themes.

---

## Phase 7: User Story 5 - Reuse recent queries (Priority: P3)

**Goal**: the 20 most recent queries per file, surviving close and reopen, and
loaded into the editor without running.

**Independent Test**: run three queries, reopen the file, and check the
history (quickstart Scenario 5).

- [X] T043 [P] [US5] Write `tests/core/history.test.ts` (Vitest, with a fake HostAdapter `loadState`/`saveState`):
  - newest first; a cap of 20; re-running identical text moves it to the top;
  - error outcomes store the first line only;
  - per-`stateKey` isolation;
  - corrupt stored data recovers as an empty history.
- [X] T044 [P] [US5] Write `tests/web/specs/query-history.spec.ts`:
  - run three queries (one failing), reload the page, and open the same file;
  - the History popover lists three entries newest first with outcomes;
  - Enter on an entry loads it into the editor, and the status line shows that nothing ran;
  - a different file shows an empty history.
- [X] T045 [P] [US5] Implement `packages/core/src/query/history.ts`: `loadHistory(host, stateKey)` and `recordHistory(host, stateKey, entry)`, under the key `history.<stateKey>` per `data-model.md`. Make T043 pass.
- [X] T046 [US5] Create `packages/ui/src/QueryHistory.svelte`, a popover anchored to a History button in `QueryPanel.svelte`:
  - a list with relative time and the outcome (✓ rows / ✗ message);
  - arrow keys, Enter to load, Esc to close (`contracts/ui-query-panel.md`).
  - The store records history after every `result`, `ddl` or `error` outcome (not refusals or cancels).
- [X] T047 [US5] Extend `tests/vscode-ext/src/suite/query.test.ts`: run two queries, close all editors, reopen the same file, and assert `_getQueryState().historyLength === 2` (add `historyLength` to the `queryState` report).
  - *Done*: core `history.test.ts` passes (7 tests; core total 119). `query-history.spec` passes (2 tests: reopen + per file). The VS Code suite passes (36, including the new US5 test). History also stores temp DDL, as `{ ok: true, rows: 0, summary }`, shown with its summary (data-model.md updated). `recordHistory` re-reads storage before writing, so two viewers of the same file don't overwrite each other. The VS Code test is relative to existing entries because globalState outlives test runs.

**Checkpoint**: T043, T044 and T047 pass.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T048 [P] Extend `tests/web/specs/accessibility.spec.ts`: run axe with the query panel open, with an error shown, with the large-result dialog open, and with the history popover open (light and dark). Extend the keyboard test so Tab reaches the editor, Run, Cancel, Reset, History and the CRS chip, and Tab leaves the editor. Fix any violations.
  - *Done*: `accessibility.spec` passes 6/6, including query states light/dark and query keyboard. Fixed one violation axe found: the error badge's contrast. A new `--se-error-fg` token was added in both theme files (VS Code: `errorForeground`), with the badge on `--se-error-bg`/`--se-error-border`.
- [X] T049 [P] Extend `scripts/screenshots.mjs` with query scenes in both shells:
  - the panel open with a result;
  - an error with a squiggle;
  - the autocomplete list open;
  - the large-result dialog.

  Run `npm run screenshots` and visually review all three VS Code themes and the web light/dark scenes.
  - *Done*: the shared `queryScenes()` captures query, query-error, query-autocomplete, query-history and query-large in all three VS Code themes and web light/dark; all were reviewed. Fixes from the review:
    - In High Contrast, the selection made SQL text unreadable (white on white). It is now toned down with `color-mix`.
    - The Modern themes painted keywords, strings and numbers plain `#CCCCCC` (the symbolIcon colors). They now use `--vscode-debugTokenExpression-*` first (research §6 updated).
    - VS Code's `<code>` styling hid the selected history entry's text.
    - The script waits after Ctrl+A, because VS Code applies webview select-all asynchronously.
- [X] T050 Measure and record, in `specs/002-spatial-sql-query/quickstart.md`, a new "Results" section:
  - SC-001 (filtering query on the ~10 MB parcels file, both shells);
  - SC-004 (cancel latency);
  - SC-003 (the error test set from T029/T030: 100% specific messages).

  Then tick the Definition-of-done boxes.
  - *Done*: see quickstart.md Results. SC-001 is web 122 ms and VS Code 62–94 ms. SC-004 cancel is 104–120 ms. SC-003 is 7/7, after the typo'd-keyword refusal fix (`unknownKeywordReason`, policy tests +4). The DoD box for the spec 001 suites is ticked in T052.
- [X] T051 [P] Update the docs:
  - `CHANGELOG.md` ([Unreleased] → Added: SQL query, with every capability);
  - `apps/vscode-ext/README.md` (a Query section: the `layer` table, Ctrl/Cmd+Enter, examples);
  - `THIRD-PARTY-NOTICES.md` (regenerate with the CodeMirror and Lezer licenses, MIT, using the same script approach as spec 001's T047);
  - `specs/002-spatial-sql-query/research.md` (outcomes and any deviations found during implementation).
  - *Done*:
    - CHANGELOG has a spec 002 entry plus the performance lines.
    - The README has a Spatial SQL feature, Query examples (all four verified in the real engine) and updated Notes.
    - THIRD-PARTY-NOTICES: added CodeMirror/Lezer and their dependencies (`style-mod`, `w3c-keyname`, `crelt`, `@marijn/find-cluster-break`, all MIT). The stale DuckDB-Wasm header (1.33.1-dev57.0) is corrected to the pinned 1.32.0 / DuckDB 1.4.3.
    - research.md has an Outcomes section.
    - Fixed "(1 rows)" in the temp-table summary.
- [ ] T052 Run the final full verification:
  - `npm run lint`, all typechecks, `npm run test:core`, `npm run test:web`, `npm run test:vscode-ext`;
  - `npm run package --workspace=apps/vscode-ext`; install the VSIX into a clean profile and run quickstart Scenarios 1–2 by hand.

  Record the results in `tasks.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T001 and T002 can run in parallel.
- **Foundational (Phase 2)**: depends on Setup only for T012's UI parts. T003–T006 can run in parallel; then T007; then T008; then T009 → T010 → T011 → T012. **Blocks every story.**
- **US1 (Phase 3)**: depends on Phase 2. It is the MVP.
- **US2 (Phase 4)**: depends on US1's `run()` (T018) and `QueryPanel` (T025). T029 and T033 (the error parser) can start as soon as Phase 2 is done.
- **US3 (Phase 5)**: depends on US1 (T024, T025).
- **US4 (Phase 6)**: depends on Phase 2's session (T011) and on US1's `SqlEditor` (T021). It is independent of US2 and US3.
- **US5 (Phase 7)**: depends on US1's store (T024) and panel (T025). It is independent of US2–US4.
- **Polish (Phase 8)**: after the desired stories.

### Within each story

- Tests are written first and fail.
- Then core (`packages/core`), then UI (`packages/ui`), then shell wiring (`apps/*`).
- Commit after each task, running the suites the task touches.

### Parallel Opportunities

- Phase 2: T003, T004, T005 and T006 (scanner and policy, tests and implementations, in separate files).
- US1: T013–T016 (four separate test files), then T017, T021, T022 and T023 (separate files).
- US2: T029, T030, T031 and T032 in parallel; T033 in parallel with UI work.
- US4 and US5 can proceed in parallel after US1.

---

## Parallel Example: User Story 1

```text
# Tests first, in parallel:
T013 tests/core/result-crs.test.ts
T014 tests/web/specs/query.spec.ts
T015 tests/web/specs/query-large.spec.ts
T016 tests/vscode-ext/src/suite/query.test.ts

# Then independent building blocks, in parallel:
T017 packages/core/src/query/resultCrs.ts
T021 packages/ui/src/SqlEditor.svelte
T022 packages/ui/src/ResultCrsChip.svelte
T023 packages/ui/src/LargeResultDialog.svelte

# Then, sequentially (shared files):
T018 → T019 → T020 (run.ts / openFile.ts) → T024 (store) → T025 (panel) → T026 (layout) → T027 → T028
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1, then Phase 2. Checkpoint: spec 001 still fully green, now
   running on the locked-down engine with the `layer` view.
2. Phase 3 (US1). **Stop and validate**: run a query, see the result,
   default-query parity across every format, and the large-result guard.
3. Demo-able: the QUERY pillar exists in both shells.

### Incremental Delivery

US1 → US2 (P1, needed before anyone relies on queries daily) → US3 → US4 → US5
→ Polish. Each story ends at a checkpoint with its tests green, and is
committed.

---

## Notes

- `[P]` means different files and no dependency on incomplete tasks.
- Every task names exact files. Where a task changes spec 001 behavior (T012),
  update spec 001's tests in the same task, never in a later one.
- If a spike assumption proves wrong during implementation (e.g. cancel stops
  working for CTAS), record it in `research.md` and adjust `plan.md` before
  continuing (Constitution VI).
