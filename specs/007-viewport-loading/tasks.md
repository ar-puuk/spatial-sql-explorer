---

description: "Task list for spec 007: Large Files and Viewport Loading"
---

# Tasks: Large Files and Viewport Loading

**Input**: Design documents from `specs/007-viewport-loading/`

**Prerequisites**:
- `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`.
- `contracts/`: `core-data-access.md`, `host-and-shells.md`, `ui.md`.
- Spike evidence in `spikes/`. To re-run a spike, apply `spikes/harness.patch`.

**Tests**: REQUIRED. Constitution IX requires:
- unit tests (`tests/core`, Vitest);
- browser tests (`tests/web`, Playwright);
- extension tests (`tests/vscode-ext`, `@vscode/test-electron`).

Every layer a story touches gets them. Within each story, test tasks come
first and must fail before implementation. Scale tests run on
`tests/.large-data` (from `npm run large-data`). When that data is absent
they skip with a message, never pass silently.

**Organization**: tasks are grouped by user story. Commit after each task
(constitution, Development Workflow).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete tasks).
- **[Story]**: US1–US5 from spec.md.
- Paths are repository-relative.

## Ground rules for every task

- **The lockdown is untouched.**
  - Never change `allowed_directories`, `enable_external_access` or
    `lock_configuration`.
  - Sources are registered only under `/se-source/`.
  - User SQL must still be refused for URLs: `read_parquet('http://…')`
    stays a Permission Error (research §3).
- **Never copy a `handle` or `url` source into memory.** Only the `bytes`
  kind (the VS Code fallback, or FlatGeobuf "load for queries") does that
  (research §2–§4).
- **The engine opens with `filesystem: { reliableHeadRequests: true,
  allowFullHTTPReads: false, forceFullHTTPReads: false }`.** Without it,
  DuckDB-WASM silently downloads whole files (research §3).
- **VS Code loopback URLs use the host `localhost.`** (trailing dot). Never
  `localhost` or `127.0.0.1`: VS Code's webview service worker stalls those
  for workers (research §3).
- **Hidden columns**: `__se_rowid` and `__se_xmin/ymin/xmax/ymax` must not
  appear in:
  - the table, the inspector or autocomplete;
  - `DESCRIBE`-derived column lists;
  - exports;
  - style column choices.
- **One query at a time per session.** View, page and stats queries run on
  the session's exclusive, cancellable connection, and a newer request
  cancels an older one of the same kind.
- **Host-agnostic.** No `vscode`, File API (`File`, `Blob.slice`,
  `FileReader`), `fetch` of user files, IndexedDB, `localStorage` or
  `sessionStorage` in `packages/core` or `packages/ui`. Byte access goes
  through `HostAdapter.getFileSource` / `readRange`. Lint stays at 0.
- **Never claim speed without a measurement.** Thresholds (display cap, the
  100 MB whole-read threshold, the 500,000-row materialize cap, the Jenks
  sample size) are constants in `packages/core/src/source/readModes.ts` and
  `packages/core/src/view/`. Each records the measurement that set it.
- **Verify before checking off.** Run the relevant suite(s), then mark the
  task `[X]` with a one-line verification note.

---

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Extend `scripts/large-data.sql` and add `scripts/large-data.mjs`, which `npm run large-data` runs instead of the inline `duckdb -c`:
  - `large-data.mjs` runs the SQL once per variant, with the row count and output name as DuckDB variables:
    - `parcels-4m.parquet`;
    - `parcels-4m-nobbox.parquet`;
    - `parcels-6m.parquet` (about 1.1 GB);
    - `parcels-27m.parquet` (about 5 GB, only with `--huge`).
  - Then, if `ogr2ogr` is on `PATH` (or `OSGEO4W_ROOT` is set), it derives `parcels-4m.fgb` (`SPATIAL_INDEX=YES`), `parcels-460k.fgb`, `parcels-77k.geojson`, `parcels-230k.geojson` and `parcels-460k.geojson`, using the commands in research.md "Test data".
  - It skips existing files and prints sizes. It exits non-zero with a clear message if no DuckDB CLI is found.
  - Update `package.json`'s `large-data` script.
- [ ] T002 [P] Generate and commit the small fixtures in `tests/vscode-ext/fixtures/`, from the same generator with 10,000 rows:
  - `parcels-10k.parquet` (with the `bbox` covering column);
  - `parcels-10k-nobbox.parquet`;
  - `parcels-10k.fgb` (with index);
  - `parcels-10k.geojson`;
  - `sample.pmtiles`: a vector archive from `parcels-10k.geojson` through GDAL's PMTiles driver (`ogr2ogr -f PMTiles … -dsco MINZOOM=4 -dsco MAXZOOM=12`).

  Add `tests/vscode-ext/fixtures/README-007.md` stating provenance, sizes and row counts. The total must stay at or under 12 MB. If GDAL's PMTiles write fails, record that and use any permissively licensed public sample under 2 MB, with its license noted.
- [ ] T003 [P] Add the `pmtiles` dependency (check BSD-3-Clause in its `package.json` and `LICENSE`) to `packages/ui/package.json`. Add it to `apps/vscode-ext/THIRD-PARTY-NOTICES.md`. `npm install`, and confirm the web and webview builds still pass (`npm run build --workspace=apps/web`, `npm run build --workspace=apps/vscode-ext`).
- [ ] T004 [P] Extend `tests/web/specs/helpers.ts`:
  - `openFixture(page, name, search?)` opens a file from `tests/vscode-ext/fixtures`;
  - `largeData(name)` returns the path in `tests/.large-data`, or calls `test.skip(true, 'Run npm run large-data to generate <name>')`;
  - query-string overrides read by the app in `?e2e=1` mode only: `cap=<n>`, `wholeThreshold=<bytes>`, `materializeCap=<n>`, `jenksSample=<n>`. Document them in the helper.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the engine config, the `FileSource` kinds, the loopback server with its probe and fallback, the read-mode catalog, and the result model with hidden columns.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [ ] T005 [P] Write `tests/core/read-modes.test.ts`:
  - every `ReadStrategy` has exactly one `READ_MODES` row;
  - GeoParquet/Parquet → `partial`; FlatGeobuf → `partial-view`; GeoJSON, Shapefile, CSV, GML, GeoPackage → `whole`; PMTiles → `tiles`;
  - caps: 25,000 and about 2,500 for `partial-view`;
  - the whole-read threshold is 100 MB;
  - `readModeFor(…, { partialReads: false })` maps every engine format to `whole` and leaves `tiles` unchanged (FR-015);
  - e2e overrides apply only when passed.
- [ ] T006 Add the types to `packages/core/src/models.ts`, as in data-model.md: `ReadMode`, `DatasetFacts`, `ViewRequest`, `ViewFeatures`, `TablePageRequest`, `TablePage`, `StyleStats` and `OpenPhase`.
  - Add `facts: DatasetFacts` to `Layer`.
  - Keep `features` for now; it is removed in T040.
  - Replace `FileSource` in `packages/core/src/hostAdapter.ts` with the `handle | url | bytes` union (data-model.md).
  - Add `readRange(ref, offset, length)` and `getFileSource(ref, { whole? })` to `HostAdapter`.
  - Keep a temporary adapter that converts the old `{ files, primaryFileName }` shape to `bytes`, so both shells compile until T011–T014 land.
- [ ] T007 Implement `packages/core/src/source/readModes.ts` (`READ_MODES`, `readModeFor`, the constants with their measurement notes) and `packages/core/src/source/index.ts`. Export them from `packages/core/src/index.ts`. T005 passes.
- [ ] T008 In `packages/core/src/duckdbService.ts`:
  - call `db.open({ filesystem: { reliableHeadRequests: true, allowFullHTTPReads: false, forceFullHTTPReads: false } })` right after `instantiate`, before spatial and the lockdown;
  - add an e2e-only `memoryLimit` option to `createDuckDb`, used by T055's out-of-memory test (`SET memory_limit` before the lockdown);
  - keep the existing comment style.

  Verify `npm run test:core` and `tests/web/specs/open-file.spec.ts` pass.
- [ ] T009 Implement `packages/core/src/source/register.ts`:
  - `registerSource(db, source)`:
    - `handle` → `registerFileHandle(path, handle, 2 /* BROWSER_FILEREADER */, true)`;
    - `url` → `registerFileURL(path, url, 4 /* HTTP */, false)`;
    - `bytes` → `registerFileBuffer`.
  - Primary and sidecars go under `/se-source/<name>`.
  - It returns `{ primaryPath, paths, reRegister() }`. `reRegister` drops, then registers again, as needed by out-of-memory recovery (research §1).
- [ ] T010 [P] Write `tests/vscode-ext/src/suite/source-server.test.ts`, against `sourceServer` directly in the extension host (exported for tests through `spatialExplorer._sourceServerForTests`). Cover:
  - `HEAD` with `Range: bytes=0-` → 206, `Content-Length` = size, `Content-Range`;
  - `HEAD` without `Range` → 200;
  - `GET bytes=a-b` → 206, the exact bytes (compare SHA-256 with a disk slice);
  - `GET` without `Range` → 200, all bytes, streamed;
  - multi-range and unsatisfiable ranges → 416;
  - a wrong token or name → 404;
  - `Origin: https://evil.example` → 403, `Origin: vscode-webview://x` → allowed;
  - CORS, Private-Network and Expose headers present;
  - sidecars served by name (`.dbf`, `.shx`, `.prj`);
  - the server closes when the last document is released.
- [ ] T011 Implement `apps/vscode-ext/src/sourceServer.ts` per contracts/host-and-shells.md:
  - a lazy start on `127.0.0.1` and `::1`;
  - `register(document, primaryPath, sidecarPaths)` → `{ token, urlFor(name) }`;
  - `release(token)`;
  - single-range parsing, `HEAD` 206, the `Origin` check, 128-bit tokens (`crypto.randomBytes(16)`);
  - per-token byte counters;
  - URLs built as `http://localhost.:<port>/<token>/<name>`, through `vscode.env.asExternalUri` with the host rewritten to `localhost.`.

  T010 passes.
- [ ] T012 Change `apps/vscode-ext/src/extension.ts`:
  - **Open**: register the document with `sourceServer` and post `{ type: 'fileSource', url, size, resourceUri: asWebviewUri(file), sidecars: [{ name, url }] }` instead of the `initFileStart` / `initFileChunk` stream.
  - **Fallback**: keep the chunked transfer behind a `{ type: 'requestBytes', reason }` message, and log the reason to the output channel.
  - **CSP**: add `http://localhost.:*` to `connect-src`.
  - **Release**: release the token when the panel is disposed.
  - **On close**: log "Read <n> MB of <size> MB" to the output channel.
  - **Test hooks**:
    - `_getSourceStats` (bytes and requests per open document);
    - `_forceBytesFallback(on)` (the next probe is told to fail);
    - `_getOpenState` (the phase, facts and read mode, reported by the webview);
    - `_sourceServerForTests`.
- [ ] T013 Change `apps/vscode-ext/src/webview/hostAdapter.ts`:
  - **`getFileSource`**:
    1. Wait for `fileSource`.
    2. Probe with a main-thread `fetch(url, { method: 'HEAD', headers: { Range: 'bytes=0-' } })`, expecting 206 within 3 s, unless forced to fail.
    3. Return `{ kind: 'url' }` on success.
    4. Otherwise post `requestBytes` and assemble the chunks as today into `{ kind: 'bytes' }`, with the platform set to `partialReads: false` and the reason.
    5. `{ whole: true }` always uses the chunked transfer.
  - **`readRange`**: `fetch(resourceUri, { headers: { Range: 'bytes=a-b' } })` on the main thread, returning the bytes.
- [ ] T014 [P] Change `apps/web/src/hostAdapter.ts`:
  - `getFileSource` returns `{ kind: 'handle', handle: file, size, sidecars }`, with the sidecars from the same pick or drop as today;
  - `{ whole: true }` returns `{ kind: 'bytes' }` via `file.arrayBuffer()`;
  - `readRange` returns `file.slice(offset, offset + length).arrayBuffer()`.

  Remove the temporary adapter from T006 once both shells use the new kinds.
- [ ] T015 [P] Write `tests/core/result-model.test.ts` against pure SQL builders (no engine). Cover:
  - `layerViewSql(mode, info)`:
    - `partial` with covering → hidden columns mapped from `bbox.xmin…`;
    - `partial` without covering → hidden columns joined from `__se_bbox` on `file_row_number`;
    - `partial-view` → `ST_Read` view with computed bbox;
    - `whole` → the table with `row_number() OVER ()` as `__se_rowid` and `ST_XMin(geom)…`.
  - `visibleColumns(columns)` strips every `__se_` name.
  - `resultSql(userSql, { hasHidden })` either keeps or recomputes the hidden columns.
  - Identifiers are quoted.
- [ ] T016 Implement `packages/core/src/source/layerSql.ts` (the builders from T015, so T015 passes). Strip hidden columns everywhere columns leave core:
  - `packages/core/src/query/catalog.ts` (autocomplete);
  - the `DESCRIBE` in `packages/core/src/openFile.ts`;
  - `packages/core/src/export/plan.ts` (column lists and the `SELECT` list);
  - the style column lists in `packages/core/src/style/resolve.ts`.

  Add a unit test asserting that the export plan's SQL never selects a `__se_` column.
- [ ] T017 Rework `packages/core/src/openFile.ts`:
  - **Signature**: `openFile(db, source: FileSource, hooks: { onPhase, confirmWholeRead, isCancelled })`. Use `registerSource` and `readModeFor`, and report phases.
  - **For now**, every mode except `tiles` still runs today's path through the new registration: parse and materialize, then `DEFAULT_QUERY`. Behavior is unchanged except that VS Code no longer transfers whole files.
  - **Wire the store**: update `packages/ui/src/viewerStore.svelte.ts` to call it.

  Verify:
  - `test:core`;
  - all of `test:web`;
  - all of `test:vscode-ext`;
  - the VS Code output channel shows partial byte counts for `sample.parquet`.

**Checkpoint**: both shells open every existing fixture through handles or the loopback server. The fallback works. Nothing user-visible changes yet.

---

## Phase 3: User Story 1 - Open a large file and see it quickly (Priority: P1) 🎯 MVP

**Goal**: GeoParquet, Parquet and FlatGeobuf files of any size show their whole-file facts at once, and an overview map of the whole extent. Progress and Cancel are always there.

**Independent Test**:
- Open `parcels-10k.parquet` with `?e2e=1&cap=1000`: the facts show 10,000 rows, the extent, the CRS and the columns before any feature is drawn; the map shows a thinned overview with the subset notice; Cancel during open returns to the previous state.
- On `tests/.large-data/parcels-4m.parquet`, the facts appear in ≤ 5 s and the map in ≤ 10 s.

### Tests for User Story 1 ⚠️

- [ ] T018 [P] [US1] Write `tests/web/specs/large-open.spec.ts` (US1 part):
  - `parcels-10k.parquet` with `?e2e=1&cap=1000`: the status bar shows 10,000 features, EPSG:4326 and Polygon; the map's `data-rendered-features` is ≤ 1,000; the map notice reads "Showing 1,000 of 10,000 in view. Zoom in to see all.";
  - `parcels-10k-nobbox.parquet`: the "Indexing…" notice appears (or has already passed), then the same overview;
  - `parcels-10k.fgb`: facts from the header (10,000, EPSG:4326);
  - opening and cancelling at the `facts` phase returns to the empty state with no error;
  - a second open works.
- [ ] T019 [P] [US1] Write `tests/vscode-ext/src/suite/large-open.test.ts`:
  - open `parcels-10k.parquet` via `vscode.openWith`, then `_getOpenState` reports read mode `partial`, 10,000 rows and spatial index `covering`;
  - `_getSourceStats` shows Range requests, no full-file GET (bytes served < file size);
  - the facts match the web's (parity) for the same fixture;
  - with `_forceBytesFallback(true)`, the open still succeeds, `facts.fallback` is set, and the notice text matches FR-015.

### Implementation for User Story 1

- [ ] T020 [US1] Implement `packages/core/src/source/facts.ts` (`readFacts`, contracts/core-data-access.md):
  - **`partial`**:
    - `count(*)` from the footer;
    - `parquet_kv_metadata` `geo` (bbox, CRS, geometry types);
    - `DESCRIBE`;
    - covering detection: `geo.columns.<g>.covering.bbox` or a struct column `bbox` with `xmin/ymin/xmax/ymax` → `spatialIndex: 'covering'`, otherwise `'building'`.
  - **`partial-view`**: `ST_Read_Meta` (count, CRS, fields), and the extent from the header via `ST_Read_Meta`'s layer extent.
  - Never call `ST_Read_Meta` for GeoJSON.
- [ ] T021 [US1] In `packages/core/src/openFile.ts`, implement the `partial` open:
  - facts first (`onPhase('facts')`);
  - `layer` as the T016 view over `read_parquet(path, file_row_number := true)`;
  - without covering: start the background index `CREATE TABLE __se_bbox AS SELECT file_row_number AS rn, ST_XMin(geom)…` on the session connection, with `onPhase('indexing')`, cancellable;
  - set `spatialIndex: 'built'` when done.

  Do not materialize the file. The initial result is `{ relation: 'layer', kind: 'view', rows: facts.rows }`.
- [ ] T022 [US1] In `packages/core/src/openFile.ts`, implement the `partial-view` (FlatGeobuf) open:
  - **Small files** (size ≤ `READ_MODES.flatgeobuf.wholeReadThresholdBytes`): get `{ whole: true }` bytes, register a buffer, and open as `whole` (fast: research §4).
  - **Larger files**: `layer` is a view over `ST_Read(path)`. Views use `spatial_filter_box`, and facts come from the header. Whole-file work is marked as needing `loadWhole` (implemented in T045).
- [ ] T023 [US1] Add `packages/ui/src/OpenProgress.svelte` (contracts/ui.md):
  - the phase label, plus elapsed time for reading or indexing;
  - an indeterminate `ProgressBar`;
  - Cancel;
  - shown only after 1 s;
  - `role=status` for the label.

  Wire it to the store's open phases in `packages/ui/src/viewerStore.svelte.ts` (`openPhase`, `cancelOpen()`, which returns to the previous layer or the empty state) and `packages/ui/src/ViewerLayout.svelte`. Use only `--se-*` tokens.
- [ ] T024 [US1] Show whole-file facts everywhere they're displayed:
  - the status bar (`packages/ui/src/StatusBar.svelte`) and the VS Code native status bar (`hostAdapter.setStatus`), from `layer.facts`;
  - the map fits `facts.extent` on open;
  - report the open state to the extension (`apps/vscode-ext/src/webview/main.ts` → `_getOpenState`).

  T018 and T019 pass (overview drawing comes in T027–T029; until then the T018 cap assertions are marked `test.fixme` with a pointer to T029).

**Checkpoint**: large partial-read files open with true facts, progress and Cancel, in both shells.

---

## Phase 4: User Story 2 - Pan and zoom through a large file (Priority: P1)

**Goal**: the map always shows the result's features in the current view: all of them below the cap, an even, disclosed subset above it. It refreshes on pan and zoom without flashing, and selection works outside the view.

**Independent Test**: on `parcels-10k.parquet` with `?e2e=1&cap=1000`:
- zooming into one cluster draws every feature in view (count = in-view count);
- the full extent is thinned with the notice;
- five rapid pans end showing the last view only;
- clicking a feature opens the inspector;
- double-clicking a table row outside the view zooms to it and highlights it.

### Tests for User Story 2 ⚠️

- [ ] T025 [P] [US2] Write `tests/core/viewport-sql.test.ts` for `view/viewport.ts`:
  - the bbox predicate per `spatialIndex`: `covering`/hidden columns, `built` (join `__se_bbox` on `rn`), `rtree` (`ST_Intersects(geom, ST_MakeEnvelope(…))`), FlatGeobuf (`spatial_filter_box`);
  - the WGS84 view bbox is transformed to the layer CRS (an EPSG:26912 example) and the features are not;
  - the count query;
  - the thinning grid: cell = width / √cap; `DISTINCT ON` over both cell indices; `ORDER BY __se_rowid` (deterministic);
  - `LIMIT cap`;
  - geometry output as `ST_AsGeoJSON(ST_Transform(…, 'EPSG:4326'))`, or no transform for 4326;
  - invalid geometry excluded.
- [ ] T026 [P] [US2] Write `tests/web/specs/viewport.spec.ts`, using the Independent Test above, plus:
  - the map never shows zero features between views (sample `data-rendered-features` during pans: never 0 after the first draw);
  - the loading cue appears only for loads over 300 ms (a slow view forced by the e2e hook `slowViewMs`);
  - FlatGeobuf `parcels-10k.fgb` in parts (`?e2e=1&wholeThreshold=1`): a region view is capped at the `partial-view` cap with the notice.

### Implementation for User Story 2

- [ ] T027 [US2] Implement `packages/core/src/view/viewport.ts` (the SQL builders; T025 passes) and `packages/core/src/view/index.ts`.
- [ ] T028 [US2] In `packages/core/src/query/session.ts`, add:
  - `view(req)`: count, then features; cancels an in-flight view (`cancelSent`); drops results from older generations; returns `ViewFeatures`;
  - `featureById(id)` by `__se_rowid`.

  Both run on the exclusive connection, and views yield to user queries (a user query cancels a pending view).
- [ ] T029 [US2] In `packages/ui/src/MapView.svelte` and `packages/ui/src/viewerStore.svelte.ts`:
  - render `ViewFeatures` instead of `layer.features`;
  - request a view on `moveend` (debounced 150 ms) and after every new result;
  - keep the previous features until replaced;
  - a thin loading bar after 300 ms;
  - the map notice for thinned, indexing and fallback (data-model.md "Notices"), `role=status`;
  - the cap from `READ_MODES`, or the e2e `cap` override.

  Un-fixme T018's cap assertions.
- [ ] T030 [US2] Selection outside the view (FR-008), in `packages/ui/src/viewerStore.svelte.ts`, `MapView.svelte` and `ViewerLayout.svelte`:
  - table selection or zoom-to calls `featureById`;
  - a highlight overlay source draws the selected feature even when it isn't in the view set;
  - zoom-to fits it;
  - the inspector reads the feature from `featureById`.

  T026 passes.
- [ ] T031 [US2] VS Code parity: add a `_getViewState` hook (`generation`, `inView`, `drawn`, `thinned`) in `apps/vscode-ext/src/webview/main.ts` and `extension.ts`. Extend `large-open.test.ts`: after open, `thinned` is true at the full extent with `cap=1000` (cap passed via the `_setTestOverrides` hook), and `drawn ≤ 1000`.

**Checkpoint**: US1 and US2 together are the MVP. Large GeoParquet and FlatGeobuf files are browsable in both shells.

---

## Phase 5: User Story 3 - Query, style and export the whole file (Priority: P2)

**Goal**: queries, the table, styles and export all work on the complete result. The default query is `SELECT * FROM layer`, and the 50,000-row prompt is gone (FR-009).

**Independent Test**:
- on `parcels-10k.parquet` with `?e2e=1&materializeCap=5000&jenksSample=2000`:
  - `SELECT * FROM layer WHERE value > 1000000` reports an exact count;
  - the table scrolls to the last row and sorts the whole result;
  - graduated Jenks shows the sample note, with legend counts that sum to the result count;
  - the GeoParquet export has exactly that many rows;
  - no "Show first 50,000" prompt appears for a 60,000-row result.
- Scale: SC-007 on `parcels-4m.parquet` (T057).

### Tests for User Story 3 ⚠️

- [ ] T032 [P] [US3] Write `tests/core/pages-sql.test.ts`:
  - the page SQL (visible columns, `__se_rowid`, the invalid-geometry flag, `ORDER BY col NULLS LAST, __se_rowid`, `LIMIT 200 OFFSET k`);
  - LRU behavior (hit, eviction after 50 pages, cleared on result or sort change).
- [ ] T033 [P] [US3] Write `tests/core/stats-sql.test.ts`:
  - top-12 categories plus the "other" count;
  - nulls;
  - min/max;
  - the `quantile_cont` list for k classes;
  - Jenks values: all when rows ≤ sample, else `USING SAMPLE <n> ROWS (reservoir, 42)` and `sampled: true`;
  - class counts as one `CASE` aggregation, upper-inclusive (spec 003 convention).

  Also check that `style/classify.ts` gives the same breaks from `StyleStats` as from the old feature path, on spec 003's fixtures.
- [ ] T034 [P] [US3] Extend `tests/core/result-model.test.ts` with the count-then-materialize decision:
  - default query → `layer`, no copy;
  - count ≤ cap → `CREATE TEMP TABLE __se_result` plus an R-tree when it has geometry;
  - count > cap → `CREATE TEMP VIEW`;
  - `reRuns` true when `EXPLAIN` shows ORDER BY, a join or an aggregate.
- [ ] T035 [P] [US3] Write `tests/web/specs/paging.spec.ts`, using the Independent Test above, plus:
  - keyboard End/PageDown in the table reaches the last row across pages;
  - skeleton rows carry `aria-busy`;
  - the query panel's default text is `SELECT * FROM layer`.

### Implementation for User Story 3

- [ ] T036 [US3] Implement `packages/core/src/view/pages.ts` (page SQL plus the LRU) and `QuerySession.page()` in `packages/core/src/query/session.ts`. T032 passes.
- [ ] T037 [US3] Rework `QuerySession.run` in `packages/core/src/query/session.ts` and `packages/core/src/query/run.ts`:
  - the default query uses `layer`;
  - otherwise `SELECT count(*)` first (exact), then materialize (≤ `MATERIALIZE_CAP`, with hidden columns and an R-tree) or define a view (with `reRuns`);
  - remove the feature-array building from `run.ts`.

  FR-009:
  - set `DEFAULT_QUERY = 'SELECT * FROM layer'` in `packages/core/src/models.ts`;
  - delete `LARGE_RESULT_THRESHOLD`, `pendingLargeResult`, `answerLargeResult`, `packages/ui/src/LargeResultDialog.svelte` and its mount in `ViewerLayout.svelte`;
  - remove the `confirm` auto-answer in `apps/vscode-ext/src/webview/main.ts` (`testRunQuery`) and the `confirm` argument of `_runQuery`.

  T034 passes.
- [ ] T038 [US3] Rework `packages/ui/src/AttributeTable.svelte` and the store per contracts/ui.md:
  - the row count from `result.rows`;
  - paged rows via `session.page()`;
  - skeleton rows (`aria-busy`);
  - header sort as SQL (cache cleared);
  - the `reRuns` notice in the header;
  - keyboard navigation across pages.

  Remove the JS sort and the `layer.features` uses.
- [ ] T039 [US3] Implement `packages/core/src/view/stats.ts` and `QuerySession.styleStats()`. Rework `packages/core/src/style/resolve.ts`, `classify.ts` and `edit.ts` to classify from `StyleStats`, with exact class counts from the `CASE` aggregation.
  - **Store**: `packages/ui/src/viewerStore.svelte.ts` requests stats when the renderer or result changes, and a newer request supersedes an older one.
  - **Panel** (`packages/ui/src/LayerStylePanel.svelte`): shows "Classifying N rows…".
  - **Legend** (`packages/ui/src/MapLegend.svelte`): shows "Breaks from a 50,000-value sample; counts are exact." when `sampled`.

  T033 passes, and the spec 003 suites still pass.
- [ ] T040 [US3] Remove `Layer.features` from `packages/core/src/models.ts` and every consumer:
  - `ViewerLayout.svelte` (the inspector via `featureById`);
  - `style/edit.ts`;
  - `MapView.svelte` (the feature lookup);
  - the e2e hooks in `apps/web/src/App.svelte` and `apps/vscode-ext/src/webview/*`.

  `npm run typecheck:core`, `typecheck:ui`, the web svelte-check and the extension `tsc` must all reach 0.
- [ ] T041 [US3] Simplify export for FR-009:
  - remove `displayLimited` and the rows choice from `packages/core/src/export/plan.ts`, `packages/ui/src/ExportDialog.svelte`, `apps/vscode-ext/src/webview/exportState.svelte.ts` and the export prefs;
  - the export source is always the complete result (`layer` or `__se_result`).

  Update `tests/core/export-plan.test.ts`.
- [ ] T042 [US3] Update the earlier suites for FR-009, keeping each one's intent:
  - `tests/web/specs/query-large.spec.ts`: replace the prompt tests with "a 60,000-row result shows its exact count, no prompt, map in view";
  - `tests/web/specs/export.spec.ts`: remove the rows-choice assertions; the US4 test runs its 1,000,000-row export without the prompt;
  - `tests/web/specs/accessibility.spec.ts`: remove the "large-result dialog" state; add the OpenProgress and paging states;
  - `tests/web/specs/performance.spec.ts`: rebaseline for the new open path; record the before and after numbers in research.md;
  - `tests/vscode-ext/src/suite/export.test.ts` and `query.test.ts`: remove `confirm` and the display-limited expectations;
  - `scripts/screenshots.mjs`: replace the "large-result dialog" scene with a "thinned overview" scene.

  Full `test:web` and `test:vscode-ext` pass.
- [ ] T043 [US3] VS Code parity: extend `tests/vscode-ext/src/suite/large-open.test.ts`, using `_runQuery` and `_getQueryState`:
  - a filtering query on `parcels-10k.parquet` reports the same exact count as the web;
  - a GeoParquet export of it (spec 005 hooks) has that row count;
  - the default query text is `SELECT * FROM layer`.
- [ ] T044 [P] [US3] FlatGeobuf "load for queries":
  - core: `QuerySession.loadWhole()` in `packages/core/src/query/session.ts`;
  - shell: `getFileSource(ref, { whole: true })` → buffer, then `layer` rebuilt as a table;
  - UI: while the layer is FlatGeobuf in parts and not loaded, the query panel, table, style panel and export show "Load the whole file (<size>) to query it" with a **Load** button (progress and Cancel through OpenProgress);
  - memory: an out-of-memory failure shows the FR-014 message suggesting GeoParquet.

  Test in `tests/web/specs/large-open.spec.ts`: `parcels-10k.fgb` with `?e2e=1&wholeThreshold=1` shows the button; Load enables the query.
- [ ] T045 [US3] Wire T044 into `packages/core/src/openFile.ts` (`partial-view` marks `needsLoad`) and the store. Run the full suites.

**Checkpoint**: on large files, every pillar works on the whole data, in both shells.

---

## Phase 6: User Story 4 - An honest path for formats that must be read whole (Priority: P2)

**Goal**: GeoJSON, Shapefile, CSV, GML and GeoPackage are parsed once into an indexed table, straight from the handle or URL. Above 100 MB the read is announced first. Cancel stops within 3 s, and running out of memory ends in a clear message with a usable viewer.

**Independent Test**:
- with `?e2e=1&wholeThreshold=1000000`, `parcels-10k.geojson` shows the announcement; Open → progress → opened; repeating with Cancel during the read stops within 3 s and the next open works;
- with `?e2e=1&memoryLimit=64MB`, opening `parcels-10k.geojson` ends in the out-of-memory message, and `parcels-10k.parquet` then opens;
- a shapefile with sidecars opens through handles in the web and the loopback server in VS Code.

### Tests for User Story 4 ⚠️

- [ ] T046 [P] [US4] Extend `tests/web/specs/large-open.spec.ts` (US4 part), using the Independent Test above, plus:
  - below the threshold: no announcement;
  - the announcement dialog's Esc cancels, and focus returns to the open button;
  - after the parse, facts come from the table (`spatialIndex: 'rtree'`);
  - views use the R-tree (the view query plan contains `RTREE_INDEX_SCAN`, via an e2e `explainView` hook).
- [ ] T047 [P] [US4] Extend `tests/vscode-ext/src/suite/large-open.test.ts`:
  - `parcels-10k.geojson` opens over the loopback server (`_getSourceStats` shows requests, and no base64 transfer is logged);
  - the shapefile fixture (`sample.shp` with its sidecars) opens and its sidecars are served by name;
  - forced fallback: GeoJSON still opens, with the fallback notice.

### Implementation for User Story 4

- [ ] T048 [US4] In `packages/core/src/openFile.ts`, implement the `whole` open:
  - above `wholeReadThresholdBytes`, `await hooks.confirmWholeRead(size)` (false → cancelled);
  - `onPhase('reading')`, then `CREATE TABLE __se_layer AS SELECT *, row_number() OVER () AS __se_rowid, ST_XMin(g)… FROM ST_Read(path)` on the cancellable connection;
  - `CREATE INDEX … USING RTREE (geom)`;
  - `layer` is a view without the hidden columns;
  - facts via T020's `whole` branch.

  Remove the old ≤ 64 MB materialize / streamed split.
- [ ] T049 [US4] Add `packages/ui/src/ReadWholeDialog.svelte` per contracts/ui.md:
  - a modal, labeled;
  - text with the format name, size and estimated time (70 ms/MB, from research §4, rounded);
  - Open (default) and Cancel;
  - Esc cancels;
  - focus restored.

  Wire `confirmWholeRead` in the store. Use only `--se-*` tokens.
- [ ] T050 [US4] Cancel during a whole read (FR-002, SC-005):
  - in `packages/core/src/openFile.ts`, interrupt the parse (`cancelSent`);
  - if the engine hasn't stopped within 2.5 s, terminate the worker and reset the shared engine (a new `resetDuckDb()` in `packages/core/src/duckdbService.ts`), then reject as cancelled;
  - drop any partial `__se_layer`.

  Test both paths in `large-open.spec.ts` (an e2e `slowParse` hook forces the second).
- [ ] T051 [US4] Out-of-memory recovery (FR-014, research §1):
  - `recoverFromOom(session)` in `packages/core/src/duckdbService.ts` and `query/session.ts`: drop every `__se_` table, `reRegister()` the source, rebuild `layer`, check with `SELECT 1`;
  - map out-of-memory errors at each stage (open, view, page, stats, query, export) to the contracts/core-data-access.md messages;
  - an out-of-memory error while opening leaves the previous layer, or the empty state, with the message.

  Test in `large-open.spec.ts` (`memoryLimit` override) and with a unit test of the message mapping in `tests/core/sql-errors.test.ts`.
- [ ] T052 [US4] Make sidecars flow through every source kind:
  - web: the sidecar `File`s from the pick or drop;
  - VS Code: the sidecar URLs from `sourceServer`;
  - the fallback: bytes.

  Keep spec 001's sidecar rules (`.shp` + `.dbf` + `.shx` + optional `.prj`/`.cpg`) in `packages/core/src/source/register.ts`. T047's shapefile case passes.

**Checkpoint**: every format opens honestly. Nothing hangs or blanks.

---

## Phase 7: User Story 5 - View a PMTiles archive (Priority: P3)

**Goal**: `.pmtiles` vector archives render at every zoom, reading only the tiles in view, with the inspector and the archive's facts. The other pillars are disabled with a reason.

**Independent Test**: open `sample.pmtiles` in both shells:
- the map renders features (`data-rendered-features > 0`) at two zooms;
- clicking a feature shows its attributes and layer name;
- the status bar shows the archive's bounds and zoom range;
- the query, table, style and export controls show the FR-009a reason.

### Tests for User Story 5 ⚠️

- [ ] T053 [P] [US5] Write `tests/web/specs/pmtiles.spec.ts`, using the Independent Test above, plus a check that `HostAdapter.readRange` was called with ranges smaller than the file (an e2e counter), i.e. no whole read.
- [ ] T054 [P] [US5] Add a PMTiles case to `tests/vscode-ext/src/suite/large-open.test.ts`:
  - opens via the custom editor;
  - `_getOpenState` reports read mode `tiles`;
  - the map renders (`_getViewState.drawn > 0`).

### Implementation for User Story 5

- [ ] T055 [US5] Register `*.pmtiles` in `apps/vscode-ext/package.json` `customEditors` (priority `default`, per CLAUDE.md), the `openInViewer` `when` clauses and `FORMATS` (`apps/web/src/App.svelte`). Add `pmtiles` to `ReadStrategy` detection in `packages/core/src/openFile.ts`. `tiles` mode skips the engine entirely.
- [ ] T056 [US5] In `packages/ui/src/MapView.svelte` (plus a new `packages/ui/src/pmtilesSource.ts`):
  - a `pmtiles` `Source` implementation calling `hostAdapter.readRange` (no `fetch` or File API in ui);
  - `maplibregl.addProtocol('pmtiles', …)` registered once;
  - a vector source for the archive, with one layer per `vector_layers` entry, styled with spec 001's single-symbol colors per geometry type;
  - the inspector shows the clicked feature's properties and its source layer;
  - facts (bounds, minzoom, maxzoom, layers) from the archive header and metadata go into `layer.facts`.
- [ ] T057 [US5] Disable the other pillars for `tiles` layers, with the FR-009a reason ("PMTiles holds map tiles, not a table: SQL, table, styling and export aren't available."):
  - `packages/ui/src/QueryPanel.svelte`;
  - `AttributeTable.svelte`;
  - `LayerStylePanel.svelte`;
  - the Export button in `ViewerLayout.svelte`;
  - the `spatialExplorer.exportData` command in `apps/vscode-ext/src/extension.ts`.

  T053 and T054 pass.

**Checkpoint**: all five stories are complete.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T058 Write `tests/web/specs/scale.spec.ts` (in the Playwright `performance` project, so it runs alone; it skips with a message when `tests/.large-data` is missing). Record every number in `test-results/scale.json`:
  - **SC-001**: `parcels-6m.parquet` (~1.1 GB) and `parcels-4m.fgb`: facts ≤ 5 s, map overview ≤ 10 s.
  - **SC-003**: after a pan stops, the view is drawn ≤ 2 s at or below the cap (10 city views).
  - **SC-004**: a `longtask` observer during open, pans, a query and styling: none ≥ 1 s.
  - **SC-005**: cancel during open ≤ 3 s, for GeoParquet, FlatGeobuf and GeoJSON (325 MB).
  - **SC-006**: `parcels-460k.geojson` is announced; an out-of-memory error (`memoryLimit` override) ends in the message with a usable viewer.
  - **SC-007**: `value > 1500000` on `parcels-4m.parquet` = 1,000,166, and its GeoParquet export has 1,000,166 rows.
  - **SC-009**: the spec 001 10 MB open is no slower than before (compare with `performance.json` from spec 005's final run: 1,594 ms warm rendered).
- [ ] T059 SC-002 (5 GB session), local and recorded. With `npm run large-data -- --huge`:
  - open `parcels-27m.parquet`, pan through 5 cities, run a filter, style it, and export the filtered result;
  - sample the engine memory (`duckdb_memory()` through an e2e hook) after each step: it stays under 3.1 GiB, with no out-of-memory error.

  Record the results in quickstart.md.
- [ ] T060 VS Code scale run, local and recorded: a `@vscode/test-electron` test gated on `SE_LARGE_DATA=1` (`tests/vscode-ext/src/suite/scale.test.ts`):
  - SC-001 on `parcels-6m.parquet`;
  - bytes served per the output channel (expect tens of MB, not GB);
  - SC-005 cancel.
- [ ] T061 [P] Extend `tests/web/specs/accessibility.spec.ts` (light and dark): axe on OpenProgress during a read, ReadWholeDialog, a thinned map with its notice, the table while paging (skeleton rows), the "Load the whole file" state, and the PMTiles disabled panels. Keyboard: Cancel and the Load button are reachable; the dialog's Esc returns focus.
- [ ] T062 [P] Extend `scripts/screenshots.mjs` with large-file scenes in both shells:
  - open progress;
  - a thinned overview with the notice;
  - a zoomed city;
  - the table deep-scrolled with skeleton rows;
  - the whole-read announcement;
  - PMTiles.

  Review all three VS Code themes and web light/dark.
- [ ] T063 [P] Update the docs:
  - `apps/vscode-ext/README.md`: the "Supported formats" matrix gains a read-mode column with the measured limits (FR-018). For example: "GeoParquet: read in parts, any size (4M rows: facts 17 ms, views < 0.3 s)", "GeoJSON: read whole, announced above 100 MB (325 MB ≈ 23 s)".
  - `CHANGELOG.md` (Added: large files, viewport loading, PMTiles; Changed: no default LIMIT, no 50,000 prompt, no export rows choice);
  - `specs/007-viewport-loading/research.md`: outcomes and deviations.
  - If the user approves, update the "~512 MB" line in `CLAUDE.md` to the measured 3.1 GiB (research §1).
- [ ] T064 Record the quickstart Results (SC-001–SC-009, plus the Remote-SSH observation in Scenario 7.2 if a remote host is available, otherwise "not run: no remote host") in `specs/007-viewport-loading/quickstart.md`, and tick the Definition of done.
- [ ] T065 Run the final full verification and record the results in this file:
  - lint, all typechecks;
  - `test:core`, `test:web` (incl. performance and scale when the data exists) and `test:vscode-ext`;
  - package the VSIX and install it into a clean profile;
  - check that the installed copy registers `*.pmtiles` and ships `pmtiles` in `THIRD-PARTY-NOTICES.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T001–T004 can all run in parallel.
- **Foundational (Phase 2)**: needs Setup. The order:
  - T005 → T006 → T007;
  - T008 and T009 after T006;
  - T010 → T011 → T012 → T013;
  - T014 after T006;
  - T015 → T016;
  - T017 last.

  **This phase blocks every story.**
- **US1 (Phase 3)**: needs Phase 2.
- **US2 (Phase 4)**: needs US1's facts and open (T020–T024). US1 + US2 = MVP.
- **US3 (Phase 5)**: needs US2's session view/featureById (T028) for T040. T036–T039 can start after Phase 2.
- **US4 (Phase 6)**: needs Phase 2 and T020. It is independent of US2/US3, except that views over the R-tree need T027.
- **US5 (Phase 7)**: needs Phase 2 only (`tiles` skips the engine). It can run in parallel with US3/US4.
- **Polish (Phase 8)**: after the desired stories.

### Within each story

- Tests first (they must fail), then core SQL builders, then session methods, then UI, then shell parity.

### Parallel Opportunities

- **Phase 1**: T001–T004.
- **Phase 2**: T005, T010, T014 and T015 in parallel (different files).
- **US1**: T018 ∥ T019.
- **US2**: T025 ∥ T026.
- **US3**: T032 ∥ T033 ∥ T034 ∥ T035; T044 alongside T036–T039.
- **US4**: T046 ∥ T047.
- **US5**: T053 ∥ T054.
- **Polish**: T061, T062, T063.

---

## Parallel Example: User Story 3

```text
Task: "T032 [P] [US3] Write tests/core/pages-sql.test.ts"
Task: "T033 [P] [US3] Write tests/core/stats-sql.test.ts"
Task: "T034 [P] [US3] Extend tests/core/result-model.test.ts"
Task: "T035 [P] [US3] Write tests/web/specs/paging.spec.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 and Phase 2. Both shells already gain the no-copy open path; the 50 MB GeoJSON problem goes away at T017.
2. US1 (facts, progress, cancel), then US2 (views, thinning, selection).
3. **Stop and validate**: Scenarios 1–2 of quickstart.md on `parcels-4m.parquet` in both shells.

### Incremental Delivery

1. Setup + Foundation: faster opens everywhere, nothing else visible.
2. US1 + US2: large files are browsable (MVP).
3. US3: the whole dataset in SQL, the table, styles and export; FR-009 changes to specs 002 and 005.
4. US4: whole-read formats are honest and recover from out-of-memory errors.
5. US5: PMTiles.
6. Polish: scale runs, accessibility, screenshots, docs, final verification.

---

## Notes

- `[P]` tasks touch different files and have no dependency on incomplete tasks.
- Commit after each task. Mark `[X]` only after its suite passes, with a one-line note.
- Scale numbers are recorded, never asserted against unmeasured guesses. If a threshold turns out wrong, change the constant, note the measurement, and update research.md.
