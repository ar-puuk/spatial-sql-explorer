---

description: "Task list for spec 008: UX Polish and Legacy Parity"
---

# Tasks: UX Polish and Legacy Parity

**Input**: Design documents from `specs/008-ux-parity/`

**Prerequisites**:
- `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`.
- `contracts/`: `core.md`, `host-and-shells.md`, `ui.md`.
- Spike evidence in `spikes/`.

**Tests**: REQUIRED (constitution IX):
- Vitest in `tests/core`;
- Playwright in `tests/web/specs`;
- `@vscode/test-electron` in `tests/vscode-ext/src/suite`.

Within each story, test tasks come first and must fail before
implementation.

**Organization**: grouped by user story (spec.md US1–US8). Commit after each
task. Run lint, typecheck and the affected suites before moving on.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete tasks).
- **[Story]**: US1–US8 from spec.md.
- Paths are repository-relative.

## Ground rules for every task

- **The engine lockdown is untouched.**
  - No new extensions are loaded.
  - Never change `allowed_directories`, `enable_external_access` or
    `lock_configuration`.
  - Exports still go through `/se-source/__se_export*` (spec 005), or, for
    JS writers, through pages read by the session.
- **SQL built from user input** (filter values, layer names, column names)
  only uses core's quoting helpers: identifiers double-quoted with `"`
  doubled, literals single-quoted with `'` doubled. Never interpolate raw
  text.
- **Spec 007 behavior is preserved.**
  - Views, pages and stats run as `view`/`background` work.
  - Filters and exports over large files show progress and can be
    cancelled.
  - PMTiles stays view-only, with the FR-009a reason.
  - Hidden `__se_*` columns never reach the UI, filters or exports.
- **Host-agnostic**: no `vscode`, File API or IndexedDB in `packages/core`
  or `packages/ui` (the lint rule enforces it).
- **Accessible names in `contracts/ui.md` are binding**, because tests query
  by them.
- **Data colors stay fixed**: ramps and palettes don't follow the theme.
  Chrome uses `--se-*` tokens.

---

## Phase 1: Setup

**Purpose**: dependencies, fixtures and assets every later phase uses.

- [ ] T001 Add `sql.js@1.14.2` and `fflate@0.8.3` as dependencies of `packages/core/package.json`. Copy `node_modules/sql.js/dist/sql-wasm.wasm` into the web build (`apps/web/public/sqljs/`, via the same copy step that serves `/duckdb/`) and into the extension bundle (`apps/vscode-ext/dist-webview/sqljs/`). Run `npm install` and commit the lockfile.
- [ ] T002 [P] Add `scripts/fixtures-008.mjs` and `scripts/fixtures-008.bat`, following `specs/008-ux-parity/spikes/make-data.bat.txt`. They write into `tests/vscode-ext/fixtures/`:
  - `three-layers.gpkg`: `countries` (polygons), `city points` (points), `lookup_table` (no geometry);
  - `wide-50.parquet`: 200 rows, 50 columns of mixed types, point geometry;
  - `buildings-10k.parquet`: 10,000 polygons with `height_m` (some null, zero and negative values);
  - `mixed-types.geojson`: points and polygons;
  - `two.gdb/`: a small 2-layer File Geodatabase, for the "not supported" message.

  Commit the generated fixtures (each under 2 MB) and add a line to `tests/vscode-ext/fixtures/README-007.md`, renamed `README.md`.
- [ ] T003 [P] Build the sample dataset `apps/web/public/sample/us-counties.parquet`:
  - Source: US Census cartographic boundary counties, 1:20m, public domain.
  - Columns: `name`, `state`, `population`, `area_km2`, `density`.
  - Format: GeoParquet, EPSG:4326, under 2 MB.
  - Script: `scripts/sample-data.mjs` (runs once, with the source URL in a comment).

  Copy the file to `apps/vscode-ext/sample/us-counties.parquet` and include `sample/` in the VSIX (`apps/vscode-ext/.vscodeignore`). Record the source and license in `THIRD-PARTY-NOTICES.md`.
- [ ] T004 [P] Add `sql.js` (MIT) and `fflate` (MIT, now direct) to `THIRD-PARTY-NOTICES.md`.

---

## Phase 2: Foundational (blocking)

**Purpose**: contracts and shared helpers more than one story needs.

- [ ] T005 Add `'image'` to `SaveOptions.kind`, and the optional `getPreference?(key: 'placeSearch.enabled')`, in `packages/core/src/hostAdapter.ts` (contracts/host-and-shells.md). Implement both in `apps/web/src/hostAdapter.ts` (image saves download as PNG; the preference returns undefined) and in `apps/vscode-ext/src/webview/main.ts` plus `apps/vscode-ext/src/extension.ts` (PNG save dialog defaulting to `<basename>-map.png`; the setting is read and posted on configuration change).
- [ ] T006 [P] Add `quoteIdent(name)` and `quoteLiteral(value)` to `packages/core/src/sql/` (export from `index.ts`), if no equivalent exists, and use them everywhere new SQL is built. Unit tests in `tests/core/sql-quote.test.ts`: quotes, backslashes, unicode, and empty names.
- [ ] T007 [P] Add three raster rows to `packages/core/src/basemapCatalog.ts`, with attribution and `maxzoom`: `esri-imagery` (Esri World Imagery), `opentopomap` (OpenTopoMap) and `osm` (OpenStreetMap Standard). Update the catalog test in `tests/core/` to check the attribution of each row. Add the hosts to the VS Code webview CSP `img-src`/`connect-src` in `apps/vscode-ext/src/extension.ts` (research §7).
- [ ] T008 [P] Fix the attribution icon (FR-035) in `packages/ui/src/MapView.svelte`:
  - Replace MapLibre's dark background icon on `.maplibregl-ctrl-attrib-button` with a CSS `mask-image` of the same "i" glyph, filled with `--se-text-secondary`. Check focus and hover states in high contrast (`--vscode-contrastBorder`).
  - Web test `tests/web/specs/attribution.spec.ts`: in dark and light, the computed icon color is not the same as the control background.

**Checkpoint**: contracts compile in both shells, and all existing suites pass.

---

## Phase 3: User Story 1 — A style panel that is quick to use (P1) 🎯 MVP

**Goal**: the sectioned style panel, value histogram, live ramp preview and
split Save button (FR-001–FR-007).

**Independent test**: quickstart scenarios 1–3. A graduated style in ≤3
interactions, SLD saved from the menu, keyboard only.

### Tests for US1

- [ ] T009 [P] [US1] Core test `tests/core/value-histogram.test.ts`: `valueHistogram()` returns 40 bins whose counts sum to the non-null rows, with edges from min to max; a single-value column gives 1 bin; a large result reports `sampled: true` (use the `jenksSample` override).
- [ ] T010 [P] [US1] Web test `tests/web/specs/style-panel.spec.ts`:
  - the section order follows contracts/ui.md;
  - Graduated plus a column draws classes with no Apply step, counting interactions ≤3 (SC-001);
  - the histogram `img` named "Value distribution" lists the breaks;
  - focusing ramps changes map paint, and Escape restores it;
  - `Reverse ramp` reverses the colors;
  - opacity updates map and legend live.
- [ ] T011 [P] [US1] Web test `tests/web/specs/style-save-menu.spec.ts`:
  - the `Download style (QML)` main action downloads `<name>.qml`;
  - `More style formats` opens a `menu` with 3 items, and SLD and Mapbox GL each download;
  - keyboard: Enter/ArrowDown opens and focuses the first item, Up/Down/Home/End move, Escape returns focus to the arrow;
  - no separate "Export style" button remains.

  Update the spec 003 tests that used the old Export button (`tests/web/specs/style-*.spec.ts`).
- [ ] T012 [P] [US1] VS Code test in `tests/vscode-ext/src/suite/style.test.ts` (extend): the main Save writes the sidecar; the menu's SLD item opens the save dialog through the test hook.

### Implementation for US1

- [ ] T013 [US1] Implement `valueHistogram(session, column, bins = 40)` in `packages/core/src/view/stats.ts` (`width_bucket` over the result, with the sampling rules of the existing stats path), and export it from `packages/core/src/index.ts`.
- [ ] T014 [P] [US1] Create `packages/ui/src/style/RendererChoice.svelte`: a radiogroup with Single, Categorized and Graduated, arrow-key navigation, named `Style type`.
- [ ] T015 [P] [US1] Create `packages/ui/src/style/ValueHistogram.svelte`:
  - an SVG bar chart with break lines;
  - `role="img"`, named "Value distribution", with an `aria-describedby` text listing the breaks;
  - a "sample" label when sampled;
  - bars use `--se-text-secondary`; breaks use the class colors.
- [ ] T016 [P] [US1] Create `packages/ui/src/style/SaveStyleButton.svelte`, a split menu button per contracts/ui.md: a main button labeled `Save style (QML)` when `canSaveSidecar`, else `Download style (QML)`; an arrow `More style formats`; a `menu` with the three formats; full keyboard support; it closes on outside click.
- [ ] T017 [US1] Change `packages/ui/src/RampPicker.svelte` to a listbox that previews the focused ramp through an `onPreview(ramp | null)` callback, commits on Enter/click, restores on Escape or blur without a choice, and has a `Reverse ramp` toggle.
- [ ] T018 [US1] Rebuild `packages/ui/src/LayerStylePanel.svelte` into sections in this order: `Style type` → `Color by` → `Classes` (method, count, ValueHistogram) → `Colors` (RampPicker, ClassList) → `Appearance` (fill opacity, outline color/width/opacity, point size; sliders with `aria-valuetext`).
  - Remove the Apply flow, so every change calls the store immediately.
  - Replace the Save and Export buttons with `SaveStyleButton`; keep `Import style…` and `Reset style`.
  - Make it fit the narrowest panel width without horizontal scroll (FR-007).
- [ ] T019 [US1] Wire it up in `packages/ui/src/viewerStore.svelte.ts`:
  - a temporary preview style (`previewRamp`), never saved or undone, restored on cancel;
  - the histogram load as `background` work with `retryWhenBusy`;
  - `saveStyleAs(format)`, used by the menu, which reuses the existing serializers.
- [ ] T020 [US1] Update `scripts/screenshots.mjs` style scenes, and `apps/vscode-ext/README.md` style section, for the new panel.

**Checkpoint**: US1 tests green in all suites. The style panel MVP is shippable.

---

## Phase 4: User Story 2 — Find columns and rows in the table (P1)

**Goal**: column chooser, per-column filters, row selection and export
scope (FR-008–FR-014).

**Independent test**: quickstart scenarios 4–6.

### Tests for US2

- [ ] T021 [P] [US2] Core test `tests/core/filters.test.ts`:
  - `filterKindsFor` per type;
  - `parseFilter` validity (letters in a number filter mark it invalid);
  - `filtersToSql` output for `contains` (escaping `%`, `_`, `\` and `'`), `eq`/`gte`/`lte`/`between` on numbers and dates, `bool`, and AND-combining;
  - column names with quotes and spaces;
  - run each generated WHERE against a real engine table to check row counts.
- [ ] T022 [P] [US2] Core test `tests/core/selection.test.ts`: `selectionPredicate` for `ids` (small and over 50,000 via a temp table) and for `all-matching`; `selectionExtent` equals `ST_Extent_Agg` of the chosen rows.
- [ ] T023 [P] [US2] Web test `tests/web/specs/table-columns.spec.ts` with `wide-50.parquet`:
  - the `Columns` dialog: search, Hide all keeps ≥1 visible with a message, Show all;
  - the header indicator "Columns (N hidden)";
  - the table has no horizontal scroll at 1,280 px with 5 visible (SC-003);
  - reopening restores the choice;
  - another file starts with all columns shown;
  - a query with different columns shows all of them.
- [ ] T024 [P] [US2] Web test `tests/web/specs/table-filters.spec.ts`:
  - text contains plus number ≥ gives "N of M rows" in the table and the same count on the map (`filterState()` hook);
  - an invalid value sets `aria-invalid` and is not applied;
  - "No rows match the filters" offers `Clear filters`;
  - a new query clears filters;
  - a 10,000-row file updates in ≤0.5 s (SC-004, performance project).
- [ ] T025 [P] [US2] Web test `tests/web/specs/table-selection.spec.ts`:
  - row checkboxes highlight features (`selectionState()`);
  - the header checkbox selects all matching (`mixed` state after untick);
  - `Zoom to selection` changes the map bounds to the selection extent;
  - `Show selected only` limits the table and map;
  - map click selects and scrolls the row; Ctrl-click adds;
  - export with Rows: Selected writes exactly the selected count (read back with `inspectParquet`).
- [ ] T026 [P] [US2] VS Code test `tests/vscode-ext/src/suite/table-tools.test.ts`: the column choice persists across reopen (workspace/global state); a filter plus a scoped export writes the filtered count.
- [ ] T027 [P] [US2] Large-data test in `tests/web/specs/scale.spec.ts` (gated `SE_LARGE_DATA`): a filter on `parcels-4m.parquet` updates the count in ≤3 s and can be cancelled (SC-004).

### Implementation for US2

- [ ] T028 [US2] Implement `packages/core/src/query/filters.ts` (contracts/core.md) and `QuerySession.setFilters()` in `packages/core/src/query/session.ts`:
  - the displayed result is re-pointed at a filtered view (`__se_result_filtered`), so pages, view queries, counts, style stats and export read it;
  - `{ total, matching }` is counted as cancellable background work;
  - filters clear on a new query or layer switch.
- [ ] T029 [US2] Implement `packages/core/src/query/selection.ts`:
  - `Selection` types;
  - `selectionPredicate`, using a temp-table join when there are more than 50,000 ids;
  - `selectionExtent`;
  - `QuerySession.setShowSelectedOnly()` layered on the filtered view.
- [ ] T030 [US2] Extend `packages/core/src/export/plan.ts` and `run.ts` with `scope: 'all' | 'filtered' | 'selected'`, wrapping the export source in the filter and selection predicates. Extend `tests/core/export-plan.test.ts`.
- [ ] T031 [P] [US2] Create `packages/ui/src/ColumnChooser.svelte`: a dialog named `Choose columns`, with a searchbox `Find column`, a checkbox per column, `Show all` and `Hide all`, focus trap, and Escape to close.
- [ ] T032 [P] [US2] Create `packages/ui/src/ColumnFilter.svelte`: an input named `Filter <column>`, an operator select for number and date columns, a second input for `between`, `aria-invalid` with the reason, and 300 ms debounce.
- [ ] T033 [P] [US2] Create `packages/ui/src/SelectionBar.svelte`: "N selected", `Zoom to selection`, `Show selected only` (`aria-pressed`) and `Clear selection`.
- [ ] T034 [US2] Change `packages/ui/src/AttributeTable.svelte`:
  - a toolbar with the `Columns` button and indicator, `Clear filters`, and "N of M rows";
  - a filter row under the sticky header;
  - a checkbox column (header tri-state `Select all matching rows`, rows `Select row <n>`, Space toggles);
  - hidden columns are not rendered;
  - keep virtualization and the spec 007 `syncedIndex` behavior.
- [ ] T035 [US2] Wire `packages/ui/src/viewerStore.svelte.ts`:
  - `columnView` loaded and saved via `saveState('columns:' + stateKey)`, applied to results whose column set equals the source's (data-model ColumnView);
  - `filters`, `setFilter`, `clearFilters` and `filterCounts`;
  - `selection` (transitions in data-model.md), `toggleSelect`, `selectAllMatching`, `clearSelection`, `zoomToSelection`, `showSelectedOnly`;
  - test hooks `filterState()` and `selectionState()` in `apps/web/src/App.svelte` and the VS Code `_get*` commands.
- [ ] T036 [US2] Map selection in `packages/ui/src/MapView.svelte`: feature-state highlight for selected ids, using the selection color read from tokens and re-applied on theme change; a plain click replaces the selection; Ctrl/Cmd-click toggles.
- [ ] T037 [US2] Change `packages/ui/src/ExportDialog.svelte` to add the `Rows` radiogroup (All, Filtered (N), Selected (N)), shown only when they apply.

**Checkpoint**: US2 tests green; US1 still green.

---

## Phase 5: User Story 3 — Files with several layers (P1)

**Goal**: layer listing, switcher and lazy per-layer SQL views; File
Geodatabase gets an honest message (FR-015–FR-018).

**Independent test**: quickstart scenarios 7–8.

### Tests for US3

- [ ] T038 [P] [US3] Core test `tests/core/layers.test.ts` with `three-layers.gpkg`:
  - `listLayers` returns 3 layers with names, counts, geometry types (`null` for `lookup_table`) and CRS;
  - single-layer formats return `[]` or 1 layer;
  - `.gdb` paths raise `UnsupportedFormatError` with the ogr2ogr hint.
- [ ] T039 [P] [US3] Web test `tests/web/specs/layers.spec.ts`:
  - the `Layers in this file` listbox has 3 options and the status "This file has 3 layers";
  - countries is active;
  - switching to `city points` updates the map, table, facts and style in <2 s (SC-009);
  - `lookup_table` shows rows and a "no geometry" map message;
  - `SELECT count(*) FROM "lookup_table"` works and autocomplete offers layer names;
  - a style set on one layer survives switching away and back;
  - a single-layer file shows no layer list.
- [ ] T040 [P] [US3] VS Code test `tests/vscode-ext/src/suite/layers.test.ts`:
  - the same listing and switch through test hooks;
  - update `format-matrix.test.ts` (`multi-layer.gpkg` note: "two layers listed; first opens");
  - the `.gdb` folder command shows the unsupported message (stub `showInformationMessage`).

### Implementation for US3

- [ ] T041 [US3] Implement `packages/core/src/source/layers.ts` (`listLayers`, `FileLayer`, `UnsupportedFormatError` for `.gdb`), and change `packages/core/src/source/layerSql.ts` to read `ST_Read(path, layer = <literal>)`.
- [ ] T042 [US3] Change `packages/core/src/openFile.ts`:
  - `OpenOptions.layer`;
  - the active-layer rule;
  - `facts.layers` and `facts.activeLayer` when there are 2 or more layers (`packages/core/src/models.ts`);
  - switching re-uses the registered source with no new transfer.
- [ ] T043 [US3] Change `packages/core/src/query/session.ts` to create lazy views for the other layers (skipping names that collide with `layer` or `__se_*`). Check that `packages/core/src/query/catalog.ts` lists them for autocomplete.
- [ ] T044 [P] [US3] Create `packages/ui/src/LayerList.svelte`, a listbox per contracts/ui.md, and place it in `packages/ui/src/ViewerLayout.svelte` (shown only when `facts.layers` is present).
- [ ] T045 [US3] Wire `switchLayer(name)` in `packages/ui/src/viewerStore.svelte.ts`:
  - per-layer `stateKey` (`<file>#<layer>`) for style, columns and history;
  - clear filters and selection;
  - test hook `layers()`.
- [ ] T046 [US3] VS Code `.gdb`:
  - in `apps/vscode-ext/package.json`, an `explorer/context` entry when `explorerResourceIsFolder && resourceExtname == .gdb`;
  - in `apps/vscode-ext/src/extension.ts`, a handler showing the message with a "Copy command" action.

  Web: picking a `.gdb` zip or folder shows the same message (`apps/web/src/App.svelte`).

**Checkpoint**: US3 tests green.

---

## Phase 6: User Story 4 — Export exactly what you need (P2)

**Goal**: the "Include geometry" switch, grouped formats and six new
verified writers (FR-019–FR-021).

**Independent test**: quickstart scenarios 9–10.

### Tests for US4

- [ ] T047 [P] [US4] Core test `tests/core/export-formats.test.ts`:
  - the `group` filter;
  - `planExport` with `includeGeometry` off keeps attribute formats only;
  - forced changes: Shapefile renames (10 characters, unique), mixed-type split, DBF coercions, KML reprojection, xlsx row limit, GeoPackage size cap.
- [ ] T048 [P] [US4] Core writer tests `tests/core/writers.test.ts`. For each writer, write the `world-boundaries` sample and the `buildings-10k` fixture, then read the output back in a real engine (DuckDB-WASM in Node, as `tests/core` does):
  - FlatGeobuf and GeoPackage: `ST_Read`, same count, geometry equality via `ST_Equals` on a sample;
  - Shapefile zip: unzip with `fflate`, then `ST_Read` the `.shp` with its sidecars;
  - KML and GeoJSONSeq: `ST_Read`;
  - xlsx: unzip and parse `sheet1.xml` (row count, header).
- [ ] T049 [P] [US4] Web test `tests/web/specs/export-formats.spec.ts`:
  - the `Include geometry` switch changes the format radiogroup;
  - a format invalid after the switch is replaced, with a notice;
  - "What changes" lists the Shapefile renames for `wide-50.parquet`;
  - every format downloads a file with a non-zero size and the expected magic bytes or extension.
- [ ] T050 [P] [US4] VS Code test in `tests/vscode-ext/src/suite/export.test.ts` (extend): each new format saves through the host and the file exists with a non-zero size.
- [ ] T051 [P] [US4] Extend `tests/qgis/read_back.py` to the new formats (gpkg, fgb, shp zip via `/vsizip/`, kml, geojsonl), comparing count and CRS. Document it in `tests/qgis/README.md`.

### Implementation for US4

- [ ] T052 [US4] Change `packages/core/src/export/formats.ts` to the format table in data-model.md (`group`, `writer`, `limits`), and `plan.ts` to `includeGeometry`, per-format `forcedChanges` and limits.
- [ ] T053 [US4] Create `packages/core/src/export/rows.ts`, `exportRows(session, plan, { geometry, pageSize })`: paged reads from the (scoped) result, with geometry as `ST_AsWKB` or `ST_AsGeoJSON` reprojected per the plan; progress in rows; cancel between pages. Change `export/run.ts` to dispatch to `engine` (unchanged COPY, plus `FORMAT json`) or `js` writers that stream chunks to the sink.
- [ ] T054 [P] [US4] Create `packages/core/src/export/writers/geojsonseq.ts`, one feature per line.
- [ ] T055 [P] [US4] Create `packages/core/src/export/writers/kml.ts`: WGS84 only, `ExtendedData` for attributes, XML escaping, MultiGeometry for multi types.
- [ ] T056 [P] [US4] Create `packages/core/src/export/writers/flatgeobuf.ts` with `flatgeobuf`'s feature serialization: a header with columns, CRS (EPSG code when known) and feature count; no spatial index.
- [ ] T057 [P] [US4] Create `packages/core/src/export/writers/shapefile.ts`:
  - `.shp`, `.shx`, `.dbf` (types C, N, F, L, D, field names ≤10 characters), `.prj` (WKT from the CRS), `.cpg` (UTF-8);
  - one set per geometry type for mixed results;
  - zipped with `fflate` `Zip` streaming;
  - a 2 GB per-part guard.
- [ ] T058 [P] [US4] Create `packages/core/src/export/writers/xlsx.ts`: a minimal OOXML (workbook, one sheet, inline strings, numbers and booleans, ISO dates as text), zipped with `fflate`, with the 1,048,576-row limit.
- [ ] T059 [P] [US4] Create `packages/core/src/export/writers/geopackage.ts`:
  - dynamic-import `sql.js` with the shell-provided `assets.sqlWasmUrl`;
  - the three required tables, the SRS row from the CRS, and the feature table;
  - GPKG blobs (header plus envelope plus WKB) per research §3;
  - `gpkg_contents` extent;
  - `db.export()` streamed to the sink;
  - abort past 1.5 GB with the plan's message.
- [ ] T060 [US4] Pass `sqlWasmUrl` through the assets in `apps/web/src/App.svelte` and `apps/vscode-ext/src/webview/main.ts`. Add the extension CSP entries for it (`apps/vscode-ext/src/extension.ts`).
- [ ] T061 [US4] Change `packages/ui/src/ExportDialog.svelte`:
  - an `Include geometry` switch (disabled with the reason when there is no geometry);
  - the format radiogroup filtered by group;
  - auto-replacing an invalid format, with a notice;
  - the "What changes" list showing all `forcedChanges`.
- [ ] T062 [US4] Gate each format: a format is listed in `EXPORT_FORMATS` only after T048–T051 pass for it. Record the results (counts, QGIS read-back) in `specs/008-ux-parity/research.md` under "Implementation outcomes (US4)".

**Checkpoint**: US4 tests green; spec 005 export tests still green.

---

## Phase 7: User Story 5 — Theme, globe and basemaps (P2)

**Goal**: web theme control, globe toggle and new basemaps (FR-022–FR-024).

**Independent test**: quickstart scenarios 11–13.

### Tests for US5

- [ ] T063 [P] [US5] Web test `tests/web/specs/theme.spec.ts`:
  - the `Theme` menu with System, Light and Dark;
  - Light persists across reload;
  - with System, `page.emulateMedia({ colorScheme })` switches live;
  - with Light picked, an OS change is ignored;
  - the default basemap follows the effective theme;
  - the switch takes ≤1 s (SC-005).
- [ ] T064 [P] [US5] Web test `tests/web/specs/globe.spec.ts`:
  - `Globe view` toggles `mapState().projection` and keeps the center;
  - the choice persists;
  - with a large-file fixture (`parcels-10k.parquet`, `cap` override), the spec 007 notices still appear;
  - map clicks still open the inspector on the globe.
- [ ] T065 [P] [US5] Web test `tests/web/specs/basemaps-raster.spec.ts`: each new basemap is offered with a preview and attribution text. Route its tile host to a failing response and check the fallback to Blank with a message (network stubbed with `page.route`).
- [ ] T066 [P] [US5] VS Code test `tests/vscode-ext/src/suite/theme-csp.test.ts`: the webview CSP contains the new tile and Nominatim hosts; there is no theme control in the webview.

### Implementation for US5

- [ ] T067 [US5] Web theme:
  - in `apps/web/src/App.svelte`, a header `Theme` menu button (`menuitemradio`) driving `data-theme`;
  - `saveState('theme')`; `matchMedia` live for System;
  - in `apps/web/src/hostAdapter.ts`, `getTheme`/`onThemeChange` derive from the preference;
  - `apps/web/src/theme.css` gets a full light token set next to the dark one (omx-viewer brand palette).
- [ ] T068 [US5] Globe:
  - `packages/ui/src/MapView.svelte`: a `Globe view` toggle in `Map controls`, calling `map.setProjection`;
  - store `projection` via `saveState('projection')` in `viewerStore.svelte.ts`;
  - test hook `mapState()`.
- [ ] T069 [US5] Check that `packages/ui/src/BasemapPicker.svelte` renders raster previews (the catalog's preview color or a z2 tile snapshot), with attribution, and that the failure fallback covers raster sources.

**Checkpoint**: US5 tests green.

---

## Phase 8: User Story 6 — Polygons in 3D (P2)

**Goal**: extrusion by a column or constant, tilt and Reset view, saved to
QML and Mapbox GL (FR-025–FR-027).

**Independent test**: quickstart scenarios 14–15.

### Tests for US6

- [ ] T070 [P] [US6] Core test `tests/core/style-extrusion.test.ts`:
  - `sanitizeStyle` drops extrusion for non-polygons;
  - `resolveStyle` height expression and `flatCount`;
  - QML writes `<renderer-3d>` like `specs/008-ux-parity/spikes/extrude.qml`, and `fromQml` reads `"col" * k`, `"col"` and constants;
  - other expressions import as off, with a notice;
  - the Mapbox `fill-extrusion` round trip;
  - SLD returns the `extrusion-dropped` notice.
- [ ] T071 [P] [US6] Web test `tests/web/specs/extrusion.spec.ts` with `buildings-10k.parquet`:
  - the `3D` section appears for polygons only (a point file shows the reason);
  - turning it on tilts the map (`mapState().pitch > 0`);
  - "N polygons drawn flat" matches the null, zero and negative count;
  - `Height scale` changes the paint;
  - `Reset view` returns pitch and bearing to 0;
  - clicking a raised polygon opens the inspector (Mercator and globe);
  - saved QML and Mapbox GL contain the extrusion, and reopening restores it.
- [ ] T072 [P] [US6] QGIS check: extend `tests/qgis/check_sidecar.py` to print the 3D renderer and height expression, run it on a QML saved by the app, and record the result in research.md (SC/US6 scenario 6).

### Implementation for US6

- [ ] T073 [US6] Add `LayerStyle.extrusion?` in `packages/core/src/style/model.ts`; sanitize and defaults in `edit.ts`; resolution in `resolve.ts` (height expression `max(0, coalesce(col, 0) * scale)`, plus `flatCount` from a SQL count as background work).
- [ ] T074 [P] [US6] QML read and write of `<renderer-3d type="vector">` in `packages/core/src/style/qml.ts` (research §5).
- [ ] T075 [P] [US6] Mapbox GL `fill-extrusion` read and write in `packages/core/src/style/mapbox.ts`; the SLD notice in `packages/core/src/style/sld.ts`.
- [ ] T076 [P] [US6] Create `packages/ui/src/style/ExtrusionSection.svelte`: an `Extrude polygons` switch, a `Height from` combobox (numeric columns plus "Constant height"), a `Height scale` input and the flat-count status. Add it to `LayerStylePanel.svelte` as the `3D` section.
- [ ] T077 [US6] Map extrusion in `packages/ui/src/MapView.svelte`:
  - a `fill-extrusion` layer replacing the fill when on, with the same color expression and fill opacity;
  - a hidden (opacity 0) fill kept beneath for hit tests and `data-rendered-features` (research §4);
  - turning extrusion on eases to pitch 50 if flat;
  - `Reset view` button (enabled when pitch or bearing ≠ 0);
  - keyboard tilt and rotate documented in the map help text.

**Checkpoint**: US6 tests green; US1 panel tests still green.

---

## Phase 9: User Story 7 — Share and present (P3)

**Goal**: map PNG export and the web share link (FR-030–FR-031).

**Independent test**: quickstart scenarios 16–17.

### Tests for US7

- [ ] T078 [P] [US7] Core test `tests/core/share.test.ts`:
  - encode/decode round trip;
  - invalid fields are dropped and listed;
  - a garbage hash returns null;
  - no row data can be encoded (the type only allows query, style and view);
  - a typical state is under 2 KB.
- [ ] T079 [P] [US7] Web test `tests/web/specs/map-image.spec.ts`:
  - the `Export map image` dialog;
  - 1× and 2× downloads are PNGs of the canvas size and twice it (decode the header);
  - with the legend, the image is larger than without, and legend pixels are present in the corner;
  - a route that drops CORS headers on a raster basemap still exports, with the "basemap left out" message;
  - done in ≤5 s (SC-007).
- [ ] T080 [P] [US7] Web test `tests/web/specs/share-link.spec.ts`:
  - `Copy link` writes a `#v1=` URL (clipboard permission granted);
  - opening it in a new page shows the "Choose that file" banner;
  - choosing the file restores the query, style, basemap, projection and view;
  - a different file warns but applies;
  - an over-long query offers "Copy query".
- [ ] T081 [P] [US7] VS Code test in `tests/vscode-ext/src/suite/map-image.test.ts`: `Export map image` saves through the host with kind `image` and the file is a PNG; there is no `Copy link` in the webview.

### Implementation for US7

- [ ] T082 [US7] Implement `captureMap({ scale, legend })` in `packages/ui/src/MapView.svelte` (research §6):
  - capture in a `render` event;
  - draw the legend from `ResolvedStyle` with 2D canvas calls;
  - add the attribution text;
  - 2× via `setPixelRatio` with a max-texture fallback;
  - on a `SecurityError`, retry with the basemap hidden.
- [ ] T083 [P] [US7] Create `packages/ui/src/MapImageDialog.svelte` (`1×`/`2×`, `Include legend`, `Export`) and add `Export map image…` to the map controls. Wire saving with `saveFile(name, bytes, { kind: 'image' })` in `viewerStore.svelte.ts`, plus the test hook `captureMap(scale)`.
- [ ] T084 [US7] Implement `packages/core/src/share.ts` (contracts/core.md).
- [ ] T085 [US7] Web share link in `apps/web/src/App.svelte`:
  - `Copy link` in the header (enabled when a file is open);
  - on load, parse `#v1=`; with `sample`, open the sample; otherwise show the banner and "Choose file";
  - after opening, apply layer, query, style, basemap, projection and view in order;
  - report failures in one message;
  - test hook `shareLink()`.

**Checkpoint**: US7 tests green.

---

## Phase 10: User Story 8 — Try it without a file, and find a place (P3)

**Goal**: sample data and place search (FR-032–FR-033).

**Independent test**: quickstart scenarios 18–19.

### Tests for US8

- [ ] T086 [P] [US8] Web test `tests/web/specs/sample.spec.ts`: offline (`context.setOffline(true)` after the app and engine load), `Try sample data` draws within 3 s (SC-008) and runs the default query; styling and export work.
- [ ] T087 [P] [US8] Web test `tests/web/specs/place-search.spec.ts`, with Nominatim stubbed via `page.route`:
  - first use shows the `Place search` notice dialog, and only once;
  - Enter searches; no request goes out while typing (request count);
  - results form the `Places` listbox, and picking one moves the map;
  - "No places found";
  - offline shows "can't reach the place search service";
  - the only request is to `nominatim.openstreetmap.org` with `q=<typed text>` and nothing else.
- [ ] T088 [P] [US8] VS Code test `tests/vscode-ext/src/suite/sample-search.test.ts`: the `spatialExplorer.openSample` command opens the sample in the custom editor with no workspace file; with `spatialExplorer.placeSearch.enabled = false`, the search box is absent.

### Implementation for US8

- [ ] T089 [US8] Sample data:
  - web: `Try sample data` in the empty state (`apps/web/src/App.svelte`) opens `/sample/us-counties.parquet` as a `bytes` source;
  - VS Code: a `spatialExplorer.openSample` command in `apps/vscode-ext/package.json` and `src/extension.ts`, opening `sample/us-counties.parquet` with the custom editor.
- [ ] T090 [US8] Create `packages/ui/src/PlaceSearch.svelte`:
  - a `search` landmark with the `Search places` searchbox and a button;
  - a request only on Enter or click, at most 1 per second;
  - the `Places` listbox (up to 5 results), with Escape to close;
  - fit the result's bounding box;
  - attribution "Search © OpenStreetMap contributors (Nominatim)";
  - the first-use notice dialog, stored via `saveState('placeSearchNoticeShown')`;
  - hidden when `getPreference('placeSearch.enabled') === false`;
  - network fetches go through a `HostAdapter`-independent `fetch` in `packages/ui` (allowed: not the File API). If the lint rule objects, add a `searchPlaces` HostAdapter method instead and note it in contracts.
- [ ] T091 [US8] Add the `spatialExplorer.placeSearch.enabled` setting in `apps/vscode-ext/package.json`, forwarded on configuration change. Add the Nominatim host to the CSP `connect-src` (if not done in T007).

**Checkpoint**: US8 tests green.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [ ] T092 [P] Panel reset (FR-029): resize handles in `packages/ui/src/ViewerLayout.svelte` reset to the default on double-click or Enter, and save the size. Web test in `tests/web/specs/layout.spec.ts`.
- [ ] T093 [P] Graduated legend range filter (FR-028):
  - `packages/ui/src/RangeSlider.svelte` (two `slider`s, `Minimum value`/`Maximum value`, `aria-valuetext`, keyboard steps);
  - `packages/ui/src/MapLegend.svelte` `Value range` group with `Reset range`;
  - a map filter expression in `MapView.svelte`;
  - it resets when the style changes.

  Web test `tests/web/specs/legend-range.spec.ts`: dragging or keyboard hides features outside the range; reset restores them; the table is unaffected.
- [ ] T094 Accessibility sweep: extend `tests/web/specs/accessibility.spec.ts` with axe on the style panel, column chooser, filters, layer list, export dialog, map image dialog, theme menu and place search, in light, dark and the forced high-contrast emulation (SC-013).
- [ ] T095 Legacy parity walk (SC-011): go through `git show legacy-v1:README.md` feature by feature and record in `specs/008-ux-parity/research.md` "Legacy parity" a table of each feature, where it lives now, and the test. Anything missing becomes a task here before closing.
- [ ] T096 Regression and timing check (SC-012): run all suites, plus `SE_LARGE_DATA=1` scale tests in both shells. Compare to the spec 007 research timings (within 10%), and record the numbers in research.md "Implementation outcomes (Polish)".
- [ ] T097 [P] Docs:
  - `apps/vscode-ext/README.md`: style panel, table tools, layers, export formats table, globe/3D, map image, sample, place search and its privacy note, `.gdb` status;
  - root `README.md` and `CHANGELOG.md`;
  - `scripts/screenshots.mjs` new scenes (style panel, filters, layers, extrusion on the globe, theme light/dark).
- [ ] T098 Package and smoke test: `npm run package` for the VSIX. Check it contains `sample/` and `sqljs/sql-wasm.wasm`, then install it and open the sample and `three-layers.gpkg`. Fill in the quickstart "Definition of done" and mark this file's tasks `[X]`.

---

## Dependencies & Execution Order

- **Setup (T001–T004)**, then **Foundational (T005–T008)**. Both block all stories.
- **Story dependencies**:
  - US1 (style panel): needs only Foundational.
  - US2 (table): only Foundational. T030 (export scope) touches the export plan and must come before US4's T052.
  - US3 (layers): only Foundational. It shares `viewerStore` with US2, so run it after US2, or merge carefully.
  - US4 (export): after US2 (scope), because of the shared `ExportDialog` and `plan.ts`.
  - US5 (theme, globe, basemaps): only Foundational (T007 catalog rows).
  - US6 (extrusion): after US1 (panel sections) and US5 (globe hit tests).
  - US7 (image, share): after US5 (projection in the share state) and US6 (the legend drawn from the extrusion-aware style); share needs US3 (layer field).
  - US8 (sample, search): only Foundational; T089 uses T003.
- **Polish**: after all stories (T093 can start after US1).

Within each story: tests, then core, then UI components, then wiring, then
shells.

## Parallel Opportunities

- Setup: T002, T003 and T004 together.
- Foundational: T006, T007 and T008 together after T005.
- US1: T009–T012 (tests) together; T014, T015 and T016 together; then T017–T019 in sequence.
- US2: T021–T027 together; T031, T032 and T033 together.
- US4: the six writers T054–T059 together (separate files), after T053.
- US6: T074, T075 and T076 together after T073.
- Different stories can proceed in parallel once their dependencies above are met (for example, US5 next to US2).

Example (US4 writers):
```
T054 geojsonseq.ts | T055 kml.ts | T056 flatgeobuf.ts | T057 shapefile.ts | T058 xlsx.ts | T059 geopackage.ts
```

## Implementation Strategy

1. **MVP = Setup + Foundational + US1** (the style panel and split Save
   button). This is the change the user felt most. Stop and demo.
2. Add **US2** (table) and **US3** (layers): with US1, all P1 stories, and
   the biggest gaps against the legacy app.
3. Add **US4** (export formats), each format only after its read-back gate.
4. Add **US5 → US6** (theme, globe, then extrusion), then **US7 → US8**.
5. **Polish**: the legacy walk-through must show no gaps before merging to
   `main` (locally; do not push until the web version is spec-complete).

## Notes

- 98 tasks. Commit after each one; run the affected suites first.
- The writers are the riskiest code. Never list a format in the dialog
  before its read-back test passes (T062).
- File Geodatabase stays unsupported (research §2). Do not add a reader in
  this spec.
