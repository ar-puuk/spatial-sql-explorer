---

description: "Task list for spec 017: Grid cells (H3 and A5), the Bin into cells action"
---

# Tasks: Grid cells (H3 and A5)

**Input**: Design documents from `specs/017-grid-cells/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/bin-cells.md`.
Step 1 (the `fts`, `h3` and `a5` extensions, commit 74c3e03) is already built; these tasks are step 2.

**Tests**: REQUIRED (constitution IX): Vitest in `tests/core`, Playwright in `tests/web/specs`, `@vscode/test-electron` in
`tests/vscode-ext/src/suite`. Within each story the test tasks come first and must fail before the implementation.

**Organization**: grouped by user story (spec.md US1 to US6), after a setup and a foundational phase. Slices from plan.md:
1 = Phase 2 + US1 (SQL), 2 = US1 (date line, non-points), 3 = US5, 4 = US1/US4 (store, style), 5 = US1/US2/US3 (dialog), 6 = US2 (preview), 7 = Polish.

Commit after each task on branch `017-grid-cells`; never push. Run lint, typecheck and the affected suites before moving on.
Build the web app from Git Bash with `MSYS_NO_PATHCONV=1`; use `SE_BASE_URL` with a free port for the browser suite (see quickstart.md).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: US1 to US6 (spec.md).

---

## Phase 1: Setup

- [x] T001 Create `packages/core/src/grid/` with `index.ts` (empty exports) and export it from `packages/core/src/index.ts`.
- [x] T002 [P] Add a `grid` entry (Lucide `Hexagon`) to the icon map in `packages/ui/src/Icon.svelte`.
- [x] T003 [P] Spike S4: in a temporary Playwright probe (not committed) read `h3_get_hexagon_area_avg(res, 'km^2')`, `h3_get_hexagon_edge_length_avg(res, 'km')` for res 0..15 and `a5_cell_area(res)`, `a5_cell_edge_length_avg(res)` for res 0..30 (cast the resolution to INTEGER) and save them as JSON in `specs/017-grid-cells/spikes/cell-sizes.json`; add the outcome to `research.md` section 4.
- [x] T004 [P] Spike S2: in the same kind of probe, try the date-line split SQL for H3 and A5 cells at lon 179.99, lon -179.99, lat 89 and lat -89 (unwrap longitudes, intersect with the two half-world boxes, return a MultiPolygon); record the working SQL and any failures in `research.md` section 4 and keep the probe under `specs/017-grid-cells/spikes/` as a `.txt` so no build picks it up.

## Phase 2: Foundational (blocks every story)

- [x] T005 [P] Test first: `tests/core/grid-systems.test.ts` checks the registry (ids `h3` and `a5`, resolution ranges 0..15 and 0..30, argument order `latlng` and `lonlat`, `equalArea` only for A5) and that the size tables are the T003 numbers within 0.5%.
- [x] T006 Implement `packages/core/src/grid/gridSystems.ts`: the `GridSystem` registry from data-model.md with `cellAreaKm2[]` and `edgeKm[]` taken from `specs/017-grid-cells/spikes/cell-sizes.json`, plus `GridSystemId`, `getGridSystem(id)` and `GRID_SYSTEMS`.
- [x] T007 [P] Test first: `tests/core/grid-bin-sql.test.ts` (golden strings) for `binQuerySql`: H3 and A5, count, a 4326 point layer; asserts the output columns `cell_id, resolution, value, n, geom`, the argument order of each system, `ST_SetCRS(..., 'EPSG:4326')`, and that an out-of-range resolution or a non-numeric measure column returns null.
- [x] T008 Implement `packages/core/src/grid/binSql.ts`: `BinSpec`, `BinQuery`, `binQuerySql(spec, facts)` (pure, no engine) for points in EPSG:4326 with the count measure, per contracts/bin-cells.md section 1; quote identifiers with `quoteIdent` from `packages/core/src/query/util.ts`.
- [x] T009 Add `QuerySession.binQuerySql(spec)` and `layerFactsForBin()` in `packages/core/src/query/session.ts` (geometry column, layer SRID, geometry type, WGS84 extent, row count, numeric columns), beside `shapesQuerySql`; unit-test it with the existing session test harness in `tests/core`.

**Checkpoint**: a hand-typed or generated bin query runs in the engine.

## Phase 3: User Story 1 - Bin a layer into cells (Priority: P1) MVP

**Goal**: from an open layer, choose Bin into cells, make at most four choices, and see a colored grid with a legend.
**Independent test**: open a point layer, bin it with H3 and with A5, and the cells are drawn, colored by count, with counts that add up.

### Tests for User Story 1 (write first, they must fail)

- [x] T010 [P] [US1] `tests/web/specs/grid-cells-017.spec.ts`: bin `sample.geojson` (points) by H3 and by A5 through the generated SQL; assert the sum of `n` equals the rows with a location (SC-2) and that every `geom` is a valid polygon.
- [x] T011 [P] [US1] Same file: A5 cells at about 10 and 60 degrees north have equal `ST_Area` on the sphere within 1% (SC-3), using `a5_cell_area` as the reference.
- [x] T012 [P] [US1] Same file: a layer with points on both sides of the date line draws no polygon wider than 180 degrees, for H3 and A5, and the result passes `ST_IsValid`.
- [x] T013 [P] [US1] `tests/core/grid-bin-sql.test.ts`: projected layer (EPSG:26912) uses `ST_Transform` to 4326; polygon and line layers use `ST_Centroid`; a layer with no geometry returns null.
- [x] T014 [P] [US1] `tests/web/specs/grid-cells-017.spec.ts`: the dialog flow end to end: open the dialog from the query panel button, keep H3 and count, apply; the result is drawn and the legend title reads "Number of features".

### Implementation for User Story 1

- [x] T015 [US1] Extend `binQuerySql` in `packages/core/src/grid/binSql.ts` for projected layers (`ST_Transform` from the layer CRS) and non-point layers (`ST_Centroid`), per contracts/bin-cells.md.
- [x] T016 [US1] Add the date-line and polar split to the cell geometry SQL in `packages/core/src/grid/gridSystems.ts` using the T004 outcome, so every `geom` is a valid polygon or MultiPolygon.
- [x] T017 [US1] Add the default graduated style in `packages/core/src/grid/gridStyle.ts`: `gridStyle(valueLabel)` returns the `LayerStyle` patch (graduated renderer on `value`, quantile, 5 classes, a sequential ramp from `packages/core/src/style/ramps.ts`, a thin outline) and the legend title; unit-test it in `tests/core/grid-style.test.ts`.
- [x] T018 [US1] Store actions in `packages/ui/src/viewerStore.svelte.ts`: `binDialog` state (`open, spec, estimate, previewing, error`), `openBinDialog`, `closeBinDialog`, `setBinSpec`, `applyBin` (writes `binQuerySql` into `queryText`, opens the SQL tab, runs it with `runQuery`, applies `gridStyle` through `setStyle` when the previous result was not a bin), `cancelBin`; declare them on the store interface near `runQuery`.
- [x] T019 [US1] Create `packages/ui/src/BinCellsDialog.svelte` from the kit (`Segmented` for H3/A5, `Slider` or `Select` for the resolution, `Select` for the measure, Apply and Cancel); first version without sizes or the estimate; Esc cancels, Enter applies, focus starts on the system control; styled from tokens only.
- [x] T020 [US1] Mount the dialog in `packages/ui/src/ViewerLayout.svelte` and add the "Bin into cells" button (icon `grid`) to the query panel header in `packages/ui/src/QueryPanel.svelte`; disable it with a reason through `UnavailableNotice` when the layer has no geometry or the `h3`/`a5` extension did not load (read `duckdb_extensions()` once per session in the session class).
- [x] T021 [US1] Settle and build the second entry point: look at the existing layer-level actions (`packages/ui/src/LayerStylePanel.svelte`, `ActivityRail.svelte`, `SidePanel.svelte`), put an item "Bin into cells" in the most natural one, and record the choice in `plan.md` decision 9.
- [x] T022 [US1] Pick the first resolution from the layer: add `suggestResolution(extent, rows, system)` to `packages/core/src/grid/binEstimate.ts` (aim for about 2,000 cells, bounded by the row count) with `tests/core/grid-estimate.test.ts`; use it when the dialog opens.

**Checkpoint**: US1 works alone: open a layer, bin it, see a colored, legended grid.

## Phase 4: User Story 2 - Choose the resolution with confidence (Priority: P1)

**Goal**: the resolution picker shows cell sizes and an estimate, and warns before a huge result.
**Independent test**: moving the resolution changes the shown size and estimate; the warning appears above 100,000 estimated cells.

- [x] T023 [P] [US2] Test first: `tests/core/grid-estimate.test.ts` for `estimateCells` (extent area over cell area, never above the row count), `resolutionChoices` (size text in metric and imperial, in-range flag, the "all resolutions" remainder) and the 100,000 limit.
- [x] T024 [P] [US2] Test first: `tests/web/specs/grid-cells-017.spec.ts` dialog checks: the size text changes with the resolution, the estimate is in a live region, the warning and "Run anyway" appear above 100,000 estimated cells, finer resolutions are behind "All resolutions".
- [x] T025 [US2] Implement `estimateCells` and `resolutionChoices` in `packages/core/src/grid/binEstimate.ts`; reuse the units choice the Measure tool uses (find it in `packages/ui/src/draw/`) via a small shared formatter in core if one does not exist.
- [x] T026 [US2] Show sizes, the estimate and the warning in `packages/ui/src/BinCellsDialog.svelte`; announce changes through a live region; add the A5 note that cells are equal area.
- [x] T027 [US2] Live preview in `packages/ui/src/viewerStore.svelte.ts`: `setBinSpec` runs the query after a 250 ms pause when the estimate is under 5,000, otherwise waits for Run; each preview cancels the one in flight (`cancelQuery`); `cancelBin` restores the previous query text and view (`showDefaultView` or the saved result).
- [x] T028 [P] [US2] Test: `tests/web/specs/grid-cells-017.spec.ts` preview redraws below 5,000 cells, does not run above it, and Cancel restores the previous view and query text.

**Checkpoint**: US1 and US2 work together.

## Phase 5: User Story 3 - See and own the SQL (Priority: P1)

**Goal**: the query is visible, editable and rerunnable; the result is a normal result.
**Independent test**: edit the resolution in the SQL and rerun; the style stays; "As layer" and export work.

- [x] T029 [P] [US3] Test first: `tests/web/specs/grid-cells-017.spec.ts`: after Apply the query panel shows the generated SQL; editing the resolution number and running keeps the graduated style on `value`; the export dialog lists the usual formats for the result.
- [x] T030 [US3] Show the generated SQL read-only in the dialog (a collapsible block in `packages/ui/src/BinCellsDialog.svelte`) with a "Copy" button using the existing copy affordance from `QueryPanel.svelte`.
- [x] T031 [US3] Make the "previous result was a bin" check in `applyBin` (T018) depend on the result's columns (`cell_id`, `value`, `geom`) rather than on a flag, so a rerun of an edited query keeps the user's style and a bin after a normal query gets the default style.
- [x] T032 [P] [US3] Test: SC-4 in `tests/web/specs/grid-cells-017.spec.ts`: export the cells to GeoParquet, read it back with `inspectParquet` from the e2e hook, and compare the row count and the `geo` metadata.

## Phase 6: User Story 4 - Style the cells (Priority: P2)

**Goal**: the cells open with the graduated default and keep every polygon style option.
**Independent test**: change ramp, classes and opacity, and turn on extrusion by `value`.

- [x] T033 [P] [US4] Test first: `tests/web/specs/grid-cells-017.spec.ts` after a bin the style panel shows a graduated style on `value`, a ramp change redraws, and extrusion by `value` is available.
- [x] T034 [US4] Name the legend after the measure: pass `valueLabel` ("Number of features", "Average of population") into the style's legend title in `packages/core/src/grid/gridStyle.ts` and check `packages/core/src/style/legend.ts` and `packages/ui/src/MapLegend.svelte` show it; adjust only if the title is not already taken from the renderer.
- [x] T035 [US4] Confirm the style survives a rerun with the same columns and falls back safely when the column is missing; add the case to `tests/core/grid-style.test.ts`.

## Phase 7: User Story 5 - Respect what the user already narrowed (Priority: P2)

**Goal**: the cells are built from the rows the layer currently shows.
**Independent test**: with a column filter active, the counts add up to the filtered row count.

- [x] T036 [P] [US5] Test first: `tests/web/specs/grid-cells-017.spec.ts`: with a column filter the sum of `n` equals `filterCounts().matching`; with a drawn-shape filter likewise; with selected-rows-only it equals the selection size; rows without a location are reported.
- [x] T037 [US5] Spike S3 (selection predicate inside a query that reads `layer`): run it in a probe, record the result in `research.md`, and extend `binQuerySql` / `QuerySession.binQuerySql` in `packages/core/src/query/session.ts` to inline `filterWhere`, `spatialWhere` and (when `selectedOnly`) the selection predicate.
- [x] T038 [US5] Add `QuerySession.binSkippedRows(spec)` and show "N rows had no location and are not counted" in the dialog and in the query status after a run (`packages/ui/src/BinCellsDialog.svelte`, `viewerStore.svelte.ts`).
- [x] T039 [US5] (the measures sum, avg, min, max, median in `binSql.ts` with unit tests were built early, in T008) Add the measure and column selects to the dialog; null handling per the spec edge cases; unit tests in `tests/core/grid-bin-sql.test.ts`.

## Phase 8: User Story 6 - Read a cell (Priority: P3)

**Goal**: clicking a cell shows its attributes and the id can be copied.
**Independent test**: click a cell; the card shows `cell_id`, `resolution`, `value`, `n`.

- [x] T040 [P] [US6] Test first: `tests/web/specs/grid-cells-017.spec.ts` click a cell and read the feature card; the copy action puts the id on the clipboard.
- [x] T041 [US6] Check `packages/ui/src/FeatureInspector.svelte` already shows the columns and offers copy for text values; add only what is missing (a copy button on `cell_id`).

## Phase 9: Polish and cross-cutting

- [x] T042 [P] Persist the last system and measure kind with `HostAdapter.saveState('binCells')`, normalized on read, in `packages/ui/src/viewerStore.svelte.ts`; unit-test the normalizer in `tests/core/grid-style.test.ts` or a new `grid-preference.test.ts`.
- [x] T043 [P] Accessibility: add the dialog to the axe scans (`tests/web/specs/accessibility.spec.ts` style), keyboard-only run through the dialog, high-contrast check.
- [ ] T044 [P] Performance check at 6x CPU throttle with a 1M-point layer (opening the dialog, moving the resolution, applying) following the project's responsiveness rule; fix what shows up; note numbers in `research.md`.
- [ ] T045 [P] Extension-host smoke test `tests/vscode-ext/src/suite/grid-cells.test.ts`: open a fixture, open the dialog, apply, read the status bar; confirm the a5 telemetry host is never contacted.
- [ ] T046 Update `CHANGELOG.md` and `apps/vscode-ext/CHANGELOG.md`, `README.md` (and the extension README), and `CLAUDE.md` (a "Grid cells (spec 017)" paragraph and the allowed-scope line); add the memory entry for spec 017.
- [ ] T047 Run the full suites (`npm run test:core`, `npm run lint`, typecheck, the web suite on Chrome, the extension suite) and fix regressions; then ask the user before merging `017-grid-cells` into main.

---

## Dependencies and order

- Phase 1 (T001 to T004) first; T003 and T004 are spikes that feed T006 and T016.
- Phase 2 blocks everything. Then US1 (MVP), then US2 and US3 (both extend the US1 dialog and store), then US4, US5, US6.
- US5 (T037 to T039) touches `binSql.ts` and `session.ts` again; do it after US1's SQL is stable.
- Within a story: tests, then core, then store, then ui.

## Parallel opportunities

- T002, T003, T004 (different files, independent).
- T005 and T007; T010 to T014 (one spec file, written together but independent cases).
- In US2: T023 and T024.
- Polish T042 to T045.

## Implementation strategy

- **MVP**: Phases 1 to 3 (US1): a working Bin into cells with H3 and A5, count only, a colored grid with legend.
- Then US2 (sizes, estimate, preview), US3 (SQL visible), and US5 (filters and measures) in that order; US4 and US6 are small checks.
- After each phase run its tests and commit; the user reviews at the MVP checkpoint before US2 starts.
