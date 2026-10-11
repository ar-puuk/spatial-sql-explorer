---

description: "Task list for spec 005: Export"
---

# Tasks: Export

**Input**: Design documents from `specs/005-export/`

**Prerequisites**:
- `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`.
- `contracts/`: `export-core.md`, `host-and-ui.md`.
- Spike evidence in `spikes/`.

**Tests**: REQUIRED. Constitution IX requires unit tests (`tests/core`,
Vitest), browser tests (`tests/web`, Playwright) and extension tests
(`tests/vscode-ext`, `@vscode/test-electron`) for every layer a story
touches. Within each story, test tasks come first and must fail before
implementation.

**Organization**: tasks are grouped by user story. Commit after each task
(constitution, Development Workflow).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete tasks).
- **[Story]**: US1–US5 from spec.md.
- Paths are repository-relative.

## Ground rules for every task

- **The lockdown is untouched.** Never change `allowed_directories`,
  `enable_external_access` or `lock_configuration`. Exports are written only
  to `/se-source/__se_export-<n>.<ext>` and the CRS probes to
  `/se-source/__se_crs_<code>.geojson`. Every export target is `dropFile`d
  in a `finally` (research §1, §7).
- **No GDAL writes.** Every GDAL driver fails in DuckDB-WASM 1.32.0
  (research §2). GeoJSON is our own writer, and the rest is DuckDB `COPY`.
- **GeoParquet** is always written as WKB `BLOB` with
  `GEOPARQUET_VERSION 'NONE'` and exactly one `geo` key of our own, with the
  full PROJJSON (research §3). Never rely on DuckDB's default GeoParquet
  output: it mislabels projected data as WGS84 in QGIS.
- **Exports run on the query session's exclusive, cancellable connection**
  (`send` + `cancelSent`, spec 002 research §1). They never replace
  `__se_result` or the displayed layer.
- **Host-agnostic.** No `vscode`, File API, IndexedDB, `localStorage` or
  `sessionStorage` in `packages/core` or `packages/ui`. Lint stays at 0.
- **Theming.** Dialog colors come only from `--se-*` tokens, defined in both
  theme files.
- **Verify before checking off.** Run the relevant suite(s), then mark the
  task `[X]` with a one-line verification note.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add test fixtures: `tests/core/fixtures/export/` with a small table description (columns of every DuckDB type family: VARCHAR, BIGINT beyond 2^53, DOUBLE, DECIMAL, BOOLEAN, DATE, TIMESTAMP, VARCHAR[], STRUCT, BLOB, a second GEOMETRY), as JSON used by the plan tests. Copy `specs/005-export/spikes/geoparquet-utm12n.parquet` to `tests/core/fixtures/export/` as the reference shape QGIS reads (README noting its provenance).
  - *Done*: tests/core/fixtures/export/ holds columns.json (12 type families), the QGIS-verified geoparquet-utm12n.parquet, and a README.
- [X] T002 [P] Add the `export` icon variant if the existing `export` icon doesn't fit a data download. Otherwise confirm reuse, in `packages/ui/src/Icon.svelte`.
  - *Done*: The existing 'export' icon (an arrow out of a tray) fits a data export, so it is reused with no new icon.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the format catalog, the export plan, the engine-side runner,
and the result facts the plan needs. Specs 001–003 behavior is unchanged.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [X] T003 Expose the facts the plan needs as a `lastResult` getter on `QuerySession` (`packages/core/src/query/session.ts`), returning `{ geometryColumn, otherGeometryColumns, resultCrs: { label, srid, assumed }, totalRows, truncatedTo, defaultView }`.
  - Set it from `run()` (the BuiltResult) and from `runDefault()`, with `defaultView: true` and `totalRows` = the file's row count.
  - A unit-testable `describeResult()` helper may live in `query/run.ts`.
  - Add assertions to `tests/vscode-ext/src/suite/query.test.ts` or a web check that the initial view reports `defaultView: true` and a query reports `false`.
  - *Done*: QuerySession.lastResult (ResultFacts: exportable, geometry columns, resultCrs label/srid/assumed, totalRows, truncatedTo, defaultView) is set by run(), runDefault() and utility results (exportable: false). Found a trap: Reset shows the initial view without re-running, while __se_result still holds the last query. showDefaultView() restores the default facts, and the default view always exports from layer. A new query.spec test via the e2e resultFacts hook covers default, query, DESCRIBE and Reset: 6/6.
- [ ] T004 [P] Write `tests/core/export-formats.test.ts`:
  - `EXPORT_FORMATS` lists exactly geojson, geoparquet, csv and parquet (FR-004, research §2);
  - each entry has a label, an extension, a geometry requirement and a crs rule;
  - GeoJSON is `wgs84-only`, and Parquet is offered only for table results.
- [ ] T005 [P] Implement `packages/core/src/export/formats.ts` (`EXPORT_FORMATS` as data per `data-model.md`) and `export/index.ts`, and export it from `packages/core/src/index.ts`. Make T004 pass.
- [ ] T006 [P] Write `tests/core/export-plan.test.ts` (pure, per `contracts/export-core.md` `planExport`), covering:
  - **rows (FR-002)**:
    - the untouched default view with 22,000 file rows gives `displayLimited {shown: 1000, total: 22000}`, `source: 'layer'` for 'all', and `rowCount` 22,000 or 1,000;
    - `truncatedTo` 50,000 of 60,000 gives a display-limited plan and 'shown' writes 50,000;
    - a user query with LIMIT 50 is not display-limited.
  - **formats**: a result without geometry offers only csv and parquet, with a reason; a geometry result offers geojson, geoparquet and csv.
  - **CRS**: GeoJSON forces WGS84 with a reason; GeoParquet in the result CRS keeps the srid.
  - **notice items** (each from `data-model.md`): invalid-geometry rows, other geometry columns, BIGINT > 2^53 (GeoJSON), lists and structs, BLOB, assumed CRS, and the GeoJSON reprojection notice.
  - **file names**: `parcels-export.geojson`, and stripping multiple extensions (`world.shp` gives `world-export.parquet`).
  - **SQL**:
    - geometry as `ST_AsWKB(...)::BLOB` for GeoParquet, `ST_AsText` for CSV WKT, `ST_X`/`ST_Y` for CSV xy;
    - `reprojectToWgs84Sql` when the CRS is WGS84 and the result isn't;
    - other geometry columns as `ST_AsText`;
    - `LIMIT shown` for 'shown'.
- [ ] T007 Implement `packages/core/src/export/plan.ts` (`planExport`) per the contract. Make T006 pass.
- [ ] T008 Implement `packages/core/src/export/projjson.ts`: `projjsonFor(db, conn, srid)` registers `/se-source/__se_crs_<srid>.geojson` (the GeoJSON `crs` member with `urn:ogc:def:crs:EPSG::<srid>`, no features), reads `ST_Read_Meta(...).layers[1].geometry_fields[1].crs.projjson`, caches it per engine and srid, and drops the probe file. It throws a clear error if PROJ doesn't know the code. The browser test comes in US2 (T020).
- [ ] T009 Implement `packages/core/src/export/run.ts`, the engine-side runner:
  - `copyExport(session, sql, format, geo?)` runs `COPY (sql) TO '/se-source/__se_export-<n>.<ext>' (FORMAT …)` through `conn.send(sql, true)` (drained).
    - Parquet and GeoParquet use `GEOPARQUET_VERSION 'NONE'`, with `KV_METADATA {geo: …}` when `geo` is given.
    - CSV uses `(FORMAT CSV, HEADER)`.
  - It then runs `db.copyFileToBuffer` and always `db.dropFile` in `finally`.
  - Add `QuerySession.exportData(plan, request, hooks)` wrapping it in `exclusive(...)`, so `cancel()` stops exports exactly as it stops queries. A `QueryCancelledError` propagates.
  - Unit-test the pure parts (target naming, COPY option strings) in `tests/core/export-plan.test.ts`.
- [ ] T010 Add export state to `packages/ui/src/viewerStore.svelte.ts`:
  - `exportOpen`, `openExport()`, `closeExport()`;
  - `exportRequest` (defaults from `HostAdapter.loadState('export.prefs')`, saved on change);
  - `exportPlan` (`$derived` from `planExport` + `querySession.lastResult` + `displayedLayer`, raw);
  - `exportPhase: 'idle' | 'running' | 'done' | 'failed' | 'cancelled'`, `exportProgress`, `exportOutcome`;
  - `runExport()` (calls `querySession.exportData`, then `hostAdapter.saveFile(fileName, bytes, { kind: 'data' })`), `cancelExport()`.

  Export is disabled while a query is running (`queryPhase` running or awaitingConfirm), with the reason.
- [ ] T011 VS Code binary delivery (`contracts/host-and-ui.md`):
  - in `apps/vscode-ext/src/webview/hostAdapter.ts`, `saveFile` with a `Uint8Array` sends `saveFileBegin`, then 32 MB `saveFileChunk`s, then `saveFileEnd` (text keeps the single `saveFile` message);
  - in `apps/vscode-ext/src/extension.ts`:
    - reassemble per `requestId`;
    - for `kind: 'data'`, show the save dialog with the format's filter, defaulting next to the source;
    - refuse the source document URI (FR-012) with "Choose a different file: this is the opened source.";
    - write with `workspace.fs.writeFile` only after `saveFileEnd`, and reply `{ saved, location }`;
    - add the `_saveNextExportTo(path)` test hook, which makes the next data save skip the dialog and write to the given path, so tests can drive it.

  Extend the `WebviewToHostMessage` union.

**Checkpoint**: specs 001–003 suites are green. Core can plan and run an
export, and both hosts can receive bytes.

---

## Phase 3: User Story 1 - GeoJSON, GeoParquet and CSV (Priority: P1) 🎯 MVP

**Goal**: export the current result (or the whole file) to the three core
formats, from an Export button and dialog, in both shells.

**Independent Test**: quickstart Scenarios 1–2.

- [ ] T012 [P] [US1] Write `tests/web/specs/export.spec.ts` (US1). It captures downloads with `page.waitForEvent('download')` and saves them to a temp dir. Checks in the page use the e2e hook (T014):
  - **Scenario 1**: the 22,000-parcel file → Export → the "All 22,000 rows" default → GeoParquet → the download's row count read back via the engine is 22,000, and its `geo` metadata has `primary_column` geom, WKB, and no `crs` (WGS84).
  - **Scenario 2**:
    - `WHERE zone = 'R1'` → GeoJSON: parse the JSON, 4,400 features, lon/lat coordinates in range, properties present;
    - CSV (WKT): 4,401 lines, header includes `geom`, the first data line has `POLYGON`;
    - for the points CSV fixture with X/Y: columns `x`, `y`.
  - The confirmation text shows the file name and the row count.
  - **SC-007**: the source file's SHA-256 is unchanged.
- [ ] T013 [P] [US1] Write `tests/vscode-ext/src/suite/export.test.ts` (US1):
  - open a temp copy of `world-boundaries.geojson`, `_saveNextExportTo(<tmp>/out.parquet)`, then `_runExport({ format: 'geoparquet', rows: 'all', crs: 'result' })`;
  - wait for `_getExportState().phase === 'done'`; the file exists, its first 4 bytes are `PAR1`, and the reported rows are 180;
  - the same for GeoJSON (JSON parses to 180 features, with geometry `null` for the 1 invalid row);
  - the source checksum is unchanged.

  Add the hooks `_runExport`, `_getExportState` and `_saveNextExportTo` in `extension.ts` and `webview/main.ts`, mirroring `_runQuery` / `_getQueryState`.
- [ ] T014 [US1] Add the e2e helpers the web test needs in `apps/web/src/App.svelte` (`?e2e=1` only): `parquetRows(bytes)` and `parquetGeo(bytes)` register the bytes under `/se-source/__se_check.parquet`, read the count and `parquet_kv_metadata`, then drop the file. Test-only, like `runRaw`.
- [ ] T015 [US1] Implement `packages/core/src/export/geojson.ts`, the streamed RFC 7946 writer (research §4):
  - batches from `streamRows` with `yieldToUi`;
  - a JSON chunk array (never one giant string before the Blob);
  - BIGINT > 2^53 as a string, DATE and TIMESTAMP as ISO, nested values as JSON, BLOB as base64;
  - `"geometry": null` for rows without valid geometry;
  - progress after each batch.

  Wire it into `QuerySession.exportData` for `format: 'geojson'`. For GeoParquet, build the `geo` metadata (geometry types and bbox from a stats query in the output CRS; `crs` omitted for WGS84). The PROJJSON for a non-WGS84 result comes in US2, so until then, assert WGS84 or the srid's PROJJSON via T008.
- [ ] T016 [US1] Create `packages/ui/src/ExportDialog.svelte` per `contracts/host-and-ui.md`:
  - a modal dialog labeled "Export data" with focus trap, Esc and Enter;
  - Rows (only when display-limited), Format, CRS, and CSV geometry radio groups;
  - notices; Cancel / Export…;
  - a running state with progress and "Cancel export"; the done and failed states.

  Add an **Export** button (icon `export`, label "Export data…") to the attribute table header in `packages/ui/src/AttributeTable.svelte` (or the drawer header in `ViewerLayout.svelte`), and mount the dialog in `ViewerLayout.svelte`. Make T012 and T013 pass (excluding the CRS-specific assertions owned by US2). Commit.

**Checkpoint**: the MVP. Convert or extract to GeoJSON, GeoParquet or CSV
in both shells.

---

## Phase 4: User Story 2 - Export in the original CRS (Priority: P1)

**Goal**: projected results export in their own CRS, recorded so QGIS reads
it, or in WGS84 on request (FR-006).

**Independent Test**: quickstart Scenario 3.

- [ ] T017 [P] [US2] Extend `tests/web/specs/export.spec.ts` (US2), using `usa-utm12n.gpkg`:
  - GeoParquet in the result CRS: the `geo.columns.geom.crs` PROJJSON has `id` EPSG 26912 and type ProjectedCRS, the bbox is in metres (|x| > 1,000), and the row count is 1;
  - GeoParquet in WGS84: no `crs`, and the bbox is lon/lat;
  - GeoJSON: the CRS control is disabled with "WGS84 (required by GeoJSON)", and the coordinates are lon/lat;
  - a query whose result CRS was overridden (spec 002 chip, e.g. EPSG:3857) exports with that CRS's PROJJSON.
- [ ] T018 [P] [US2] Extend `tests/vscode-ext/src/suite/export.test.ts`: `usa-utm12n.gpkg` GeoParquet in the result CRS → the `geo` metadata `crs.id.code` is 26912, read by parsing the Parquet footer in Node. A minimal footer reader in the test is acceptable: find `"geo"` JSON in the last KB.
- [ ] T019 [US2] Wire `projjsonFor` into the GeoParquet path in `export/run.ts` / `geojson.ts` / `session.ts`:
  - the result CRS → PROJJSON (cached);
  - WGS84 → reproject with `reprojectToWgs84Sql` and omit `crs`;
  - an assumed CRS → omit `crs`, with the notice.

  Make T017 and T018 pass.
- [ ] T020 [US2] SC-002 in QGIS: run `tests/qgis/read_back.py` on the UTM and WGS84 GeoParquet, the GeoJSON and the CSV downloaded by T017/T012 (saved under `screenshots/export-check/`). Record the output in `specs/005-export/research.md`, "SC-002 read-back". Expected: EPSG:26912 and EPSG:4326 respectively, with the right counts and fields. Commit.

**Checkpoint**: exports keep the CRS honestly, as QGIS confirms.

---

## Phase 5: User Story 3 - Only formats that truly work (Priority: P2)

**Goal**: the format list shows exactly the verified formats, and table
results save as Parquet (FR-004, FR-008).

**Independent Test**: quickstart Scenario 4.

- [ ] T021 [P] [US3] Extend `tests/web/specs/export.spec.ts`:
  - for a geometry result, the format radios are exactly GeoJSON, GeoParquet and CSV;
  - for `SELECT zone, count(*) AS n FROM layer GROUP BY zone`, they are exactly CSV and Parquet, with no CRS control;
  - Parquet export: the engine read-back shows 5 rows with columns zone and n, and no `geo` key;
  - no FlatGeobuf, GeoPackage, Shapefile or KML anywhere in the dialog.
- [ ] T022 [US3] Make T021 pass: the Parquet path in `run.ts` (a plain `COPY … (FORMAT PARQUET)`) and availability reasons shown in the dialog. Document in `research.md` how to re-verify a GDAL format once a newer DuckDB-WASM ships (the spike recipe plus `read_back.py`). Commit.

---

## Phase 6: User Story 4 - Large exports stay responsive (Priority: P2)

**Goal**: progress, cancel, no partial files, and a clear OOM message
(FR-010, FR-011).

**Independent Test**: quickstart Scenario 5.

- [ ] T023 [P] [US4] Extend `tests/web/specs/export.spec.ts` (US4), using 100,000 parcels (`writeParcels(100_000)`):
  - GeoJSON export shows "rows written" progress and finishes;
  - another export cancelled after the progress appears gives the `cancelled` phase within 3 s, no download event, and a following `SELECT 1` query succeeds;
  - after a cancel, the e2e hook confirms no `/se-source/__se_export-*` file remains (glob).
- [ ] T024 [P] [US4] Write a unit test in `tests/core/export-plan.test.ts` for the OOM message mapping: an engine error matching `/out of memory|Out of Memory|memory limit/i` or a `RangeError` (array buffer allocation) maps to "The export ran out of memory. Filter the result or choose GeoParquet (smallest)."
- [ ] T025 [US4] Implement progress in the store and dialog:
  - rows written for GeoJSON; an indeterminate bar plus elapsed time after 1 s for COPY formats;
  - `cancelExport()` → `querySession.cancel()`; the OOM mapping;
  - make sure `dropFile` runs on every outcome.

  Make T023 and T024 pass. Commit.

---

## Phase 7: User Story 5 - Command palette (Priority: P3)

**Goal**: "Spatial Explorer: Export Data…" opens the dialog (FR-013).

**Independent Test**: quickstart Scenario 6.

- [ ] T026 [P] [US5] Extend `tests/vscode-ext/src/suite/export.test.ts`:
  - with a viewer active, `executeCommand('spatialExplorer.exportData')` gives `_getExportState().open === true`;
  - with no viewer, the command shows the info message (stub `window.showInformationMessage` in the test, or check that the command resolves without error and `open` stays false).
- [ ] T027 [US5] Contribute `spatialExplorer.exportData` in `apps/vscode-ext/package.json`, with title "Spatial Explorer: Export Data…" and `commandPalette` `when` set to `activeCustomEditorId == spatialExplorer.editor || activeCustomEditorId == spatialExplorer.editorOption`. Register it in `extension.ts`: post `openExport` to the active viewer, or show the message. Handle `openExport` in `webview/main.ts` → `store.openExport()`. Make T026 pass. Commit.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T028 [P] Extend `tests/web/specs/accessibility.spec.ts`:
  - axe in light and dark with the export dialog open (geometry result, table result, display-limited rows, and the running state);
  - keyboard: Tab reaches every radio group, the CRS select, Cancel and Export; Esc closes and returns focus to the Export button.

  Fix any violations.
- [ ] T029 [P] Extend `tests/web/specs/performance.spec.ts`:
  - **SC-003**: 100,000 polygons → GeoParquet; time from Export to the download event is < 15 s, and no long task ≥ 1 s;
  - **SC-004**: cancel latency < 3 s.

  Record the numbers.
- [ ] T030 [P] Extend `tests/vscode-ext/src/suite/export.test.ts` with:
  - a result of more than 32 MB exported as GeoJSON (e.g. 80,000 generated polygons), proving the chunked transfer (bytes on disk equal the reported size);
  - choosing the source path via `_saveNextExportTo(<source>)` is refused, with the reply `saved: false` and the message.
- [ ] T031 [P] Extend `scripts/screenshots.mjs` with export scenes in both shells:
  - the dialog for a geometry result;
  - the display-limited rows choice;
  - the running progress;
  - the done confirmation with notices.

  Review all three VS Code themes and web light/dark.
- [ ] T032 Record in `specs/005-export/quickstart.md`, in a "Results" section:
  - SC-002 (the QGIS read-back from T020);
  - SC-003 and SC-004 (T029);
  - SC-005 (the notice coverage list);
  - SC-006 (parity: T012/T013 counts);
  - SC-007 (checksums).

  Tick the Definition-of-done boxes.
- [ ] T033 [P] Update the docs:
  - `CHANGELOG.md` (Added: export);
  - `apps/vscode-ext/README.md` (an Export bullet: formats, CRS, command);
  - `specs/005-export/research.md` (outcomes and deviations).
- [ ] T034 Run the final full verification:
  - lint, all typechecks;
  - `test:core`, `test:web` (incl. performance) and `test:vscode-ext`;
  - package the VSIX and install it into a clean profile.

  Record the results in `tasks.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**:
  - T003 first (the result facts);
  - T004/T005 and T006/T007 in parallel pairs;
  - T008 and T009 after T005;
  - T010 needs T007 and T009;
  - T011 is independent of core (it can start at once).

  **This phase blocks every story.**
- **US1 (Phase 3)**: Phase 2. It is the MVP.
- **US2 (Phase 4)**: US1's GeoParquet path (T015) and T008.
- **US3 (Phase 5)**: Phase 2 and US1's dialog (T016).
- **US4 (Phase 6)**: US1 (export runs and the dialog).
- **US5 (Phase 7)**: US1's dialog and T013's hooks.
- **Polish (Phase 8)**: after the desired stories.

### Parallel Opportunities

- **Phase 2**: T004+T006 (tests), then T005+T007; T011 alongside everything in core.
- **US1**: T012, T013 (tests) in parallel; then T014 and T015 in parallel; then T016.
- **US2–US5**: their test tasks in parallel. US3 and US5 are independent of each other.

---

## Parallel Example: User Story 1

```text
# Tests first, in parallel:
T012 tests/web/specs/export.spec.ts (US1)
T013 tests/vscode-ext/src/suite/export.test.ts (US1)

# Then, in parallel (different files):
T014 apps/web/src/App.svelte (e2e Parquet read-back helpers)
T015 packages/core/src/export/geojson.ts (+ geo metadata)

# Then:
T016 packages/ui/src/ExportDialog.svelte + AttributeTable button + ViewerLayout mount
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1, then Phase 2. **Checkpoint**: specs 001–003 green; plan and runner unit-tested; both hosts receive bytes.
2. Phase 3 (US1). **Stop and validate**: convert a whole file and extract a filtered subset to all three formats, in both shells.

### Incremental Delivery

US1 → US2 (P1: CRS honesty, QGIS-verified) → US3 → US4 → US5 → Polish.
Each story ends at a checkpoint with its tests green, and is committed.

---

## Notes

- `[P]` means different files and no dependency on incomplete tasks.
- If a newer DuckDB-WASM fixes GDAL writing during this work, do **not**
  add formats here. Record it in `research.md` and leave it for a follow-up
  slice (FR-004 requires QGIS verification per format).
- A spike result that proves wrong during implementation is recorded in
  `research.md`, and `plan.md` is adjusted before continuing
  (Constitution VI).
