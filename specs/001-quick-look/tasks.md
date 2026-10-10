---

description: "Task list for Quick Look (001)"
---

# Tasks: Quick Look

**Input**: Design documents from `/specs/001-quick-look/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included — Constitution Principle IX requires unit tests for
`packages/core`, browser tests for `apps/web`, and `@vscode/test-electron`
integration tests for `apps/vscode-ext`; this is a project-wide rule, not an
optional request for this spec.

**Organization**: Tasks are grouped by user story (spec.md priorities P1–P3)
so each can be implemented and tested independently once Phase 2 is done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an
  incomplete task)
- **[Story]**: Maps to spec.md's user stories (US1–US5)

---

## Phase 1: Setup

**Purpose**: Monorepo scaffolding, matching `../omx-viewer`'s tooling
conventions (plan.md "Structure Decision").

- [X] T001 Move the current legacy single-page app (`index.html`, `js/`,
      `css/`, `coi-serviceworker.min.js`, `data/`, `webapp-theme.md`) into
      `legacy/` (already preserved at the `legacy-v1` git tag; kept in-tree
      under `legacy/` for reference during the rebuild, not deleted yet), then
      create the workspace skeleton (`apps/web`, `apps/vscode-ext`,
      `packages/core`, `packages/ui`, `tests/core`, `tests/web`,
      `tests/vscode-ext`) with npm workspaces at the repo root, per
      `plan.md`'s Project Structure.
- [X] T002 [P] Configure strict TypeScript (`tsconfig.json` per package),
      matching `../omx-viewer`'s strictness settings.
- [X] T003 [P] Configure Vite for `apps/web` and `apps/vscode-ext`'s webview
      bundle (`vite.webview.config.ts`, fixed non-hashed output filenames,
      `worker: { format: 'es' }`), and esbuild for the extension host, mirroring
      `../omx-viewer/apps/vscode-ext/vite.webview.config.ts` and `esbuild.js`.
- [X] T004 [P] Configure ESLint/Prettier (or the repo's existing formatter) for
      the new workspaces.

**Checkpoint**: Monorepo builds (empty packages) before any spike or feature
work begins.

---

## Phase 2: Foundational — Spikes and Shared Core (BLOCKS all user stories)

**Purpose**: Resolve the plan's two highest-risk, not-yet-proven assumptions
(`research.md`'s residual-risk table) with real, running code — not more
documentation research — before any user story depends on them. Also builds
the shared `packages/core` surface every story needs.

**⚠️ CRITICAL**: Per Constitution Principle VI (Verified Claims), no
user-facing feature task may claim a format or worker-bootstrap approach
"works" until T005/T006 below record a real, observed result. If either spike
finds the assumed approach broken, STOP and update `research.md` + this file's
remaining tasks before continuing — do not route around a failed spike
silently.

- [ ] T005 **[SPIKE, highest priority]** Inside an actual `resolveCustomEditor`
      webview (a throwaway custom editor registered in a scratch VS Code
      extension is sufficient), prove whether `new Worker(webview.asWebviewUri(...))`
      can successfully instantiate DuckDB-WASM's main worker script
      (`duckdb-browser-mvp.worker.js`), given `../omx-viewer`'s documented
      finding that `new Worker(new URL(..., import.meta.url))` throws
      synchronously in a webview due to an origin mismatch (`research.md` §4).
      Record the exact outcome (works as-is / needs the inline-worker
      workaround scaled up / needs a different approach entirely) in
      `specs/001-quick-look/research.md` §4 before T009/T018 begin.
- [ ] T006 **[SPIKE]** [P] In an actual browser (or the webview from T005 once
      it boots), run `INSTALL spatial; LOAD spatial; SELECT * FROM ST_Drivers();`
      plus a per-format `ST_Read` smoke test (GeoJSON, GeoParquet, FlatGeobuf,
      GeoPackage, Shapefile, GML, MapInfo TAB) against one small sample file
      per format. Record pass/fail per format in
      `specs/001-quick-look/research.md` §1, updating FR-018's format list in
      `spec.md` if any format (especially GeoPackage) turns out unsupported.
- [ ] T007 [P] Measure the actual bundle size impact of `@duckdb/duckdb-wasm`
      (mvp bundle + spatial extension) and MapLibre GL JS once added to
      `apps/vscode-ext`; record the real `.vsix` size delta in
      `specs/001-quick-look/research.md` §3 and set a CI size-budget check
      (compare against `../omx-viewer`'s ~4.9MB baseline).
- [ ] T008 Implement the `HostAdapter` interface and its supporting types
      (`OpenedFileRef`) in `packages/core/src/hostAdapter.ts`, matching
      `contracts/host-adapter.md` exactly (interface + types only — no
      platform implementation here).
- [ ] T009 Implement the DuckDB-WASM bootstrap service in
      `packages/core/src/duckdbService.ts`: single-threaded `mvp` bundle,
      spatial extension loaded from a bundled/local path (not the default CDN)
      per `research.md` §3. Depends on T005 and T006's confirmed approach —
      do not write this against assumed-working behavior.
- [ ] T010 [P] Implement the CRS helper in `packages/core/src/crs.ts`:
      `ST_Transform` to EPSG:4326 for display, preserving the original source
      CRS label (FR-007), plus the WGS84-assumed-and-disclosed path (FR-015).
- [ ] T011 [P] Implement the `Layer`, `Feature`, `ViewerSession`, `CrsInfo`
      types and the `loadState` transitions from `data-model.md` in
      `packages/core/src/models.ts`, including `Layer.featureCount` and
      `Layer.invalidGeometryCount` as independent fields (FR-012, FR-014).
- [ ] T012 [P] Implement the basemap catalog data module in
      `packages/core/src/basemapCatalog.ts`: the 5 OpenFreeMap styles plus a
      `blank` entry (id/name/type/url template/attribution/requiresKey/region
      shape per CLAUDE.md) — enough rows for US4's default+off behavior; the
      full picker UI is spec 004.
- [X] T013 Add a lint rule (ESLint custom rule, or a CI grep-based check if
      faster to ship) enforcing that `packages/core` and `packages/ui` never
      import `vscode`, call `acquireVsCodeApi`, or import the File API /
      IndexedDB directly (Constitution Principle II). _(Done as part of T004 —
      see the scoped `no-restricted-imports`/`no-restricted-globals` block in
      `eslint.config.js`.)_

**Checkpoint**: `packages/core` builds, the worker-bootstrap and format-support
spikes have recorded real outcomes, and no user story task below depends on an
unverified assumption.

---

## Phase 3: User Story 1 - Open a file from VS Code and see it rendered (Priority: P1) 🎯 MVP

**Goal**: Right-click (or Open With, or default) a supported file in VS Code →
viewer shows it on a map (fitted to extent) and in a table, with map↔table
selection sync (spec.md US1).

**Independent Test**: Open a sample GeoJSON file via the VS Code Explorer and
confirm the map renders the geometry zoomed to its extent, the table lists
matching rows, and clicking either highlights the other.

### Tests for User Story 1

- [ ] T014 [P] [US1] `@vscode/test-electron` integration test: opening a
      sample file via the registered custom editor renders a map and a table
      with matching feature counts, in
      `tests/vscode-ext/open-file.test.ts`.
- [ ] T015 [P] [US1] `@vscode/test-electron` integration test: selecting a
      table row highlights the corresponding map feature and vice versa, in
      `tests/vscode-ext/selection-sync.test.ts`.
- [ ] T016 [P] [US1] `@vscode/test-electron` integration test: opening an
      unsupported/corrupt file shows a specific error message with no broken
      viewer state (FR-011), in `tests/vscode-ext/open-file-error.test.ts`.
- [ ] T017 [P] [US1] `@vscode/test-electron` integration test covering two
      edge cases: (a) a zero-feature file reaches `loadState: 'ready'` and
      renders an empty map + empty table with a visible "no features"
      indicator, not an error (FR-012); (b) a file with mixed geometry types
      (points + polygons in one layer) renders every feature, of every
      geometry type, in both the map and the table (FR-013). In
      `tests/vscode-ext/open-file-edge-cases.test.ts`.

### Implementation for User Story 1

- [ ] T018 [US1] Register the `customEditors` provider in
      `apps/vscode-ext/src/extension.ts`: priority `"default"` for
      `.gpkg .fgb .shp .pmtiles .geoparquet`, `"option"` for
      `.geojson .csv .parquet .json`, `retainContextWhenHidden: true`, per
      CLAUDE.md. Depends on T005's confirmed worker approach.
- [ ] T019 [US1] Implement the host↔webview message protocol
      (`initStart`/`initChunk`/`ready`/`triggerError`, base64-chunked,
      32MB-raw-byte chunks, listener-registered-before-`panel.webview.html`)
      in `apps/vscode-ext/src/extension.ts`, exactly per
      `contracts/host-webview-protocol.md`.
- [ ] T020 [US1] Implement the CSP HTML shell (`default-src 'none'`,
      `script-src 'wasm-unsafe-eval' ${csp}`, `worker-src ${csp} blob: data:`,
      etc., matching `../omx-viewer`'s shipped policy) in
      `apps/vscode-ext/src/extension.ts`'s webview HTML builder.
- [ ] T021 [US1] Implement the VS Code-side `HostAdapter` (webview context) in
      `apps/vscode-ext/src/webview/hostAdapter.ts`, implementing
      `contracts/host-adapter.md` over the T019 message protocol.
- [ ] T022 [P] [US1] Implement `MapView` (MapLibre init, fit-to-extent,
      feature highlight on selection) in `packages/ui/src/MapView.svelte`.
      Must render all geometry types present in a layer, including
      mixed-geometry layers (FR-013), and must render a correct, empty map
      (no error, no crash) when `Layer.featureCount === 0` (FR-012).
- [ ] T023 [P] [US1] Implement `AttributeTable` (row list, row selection) in
      `packages/ui/src/AttributeTable.svelte`. Must render an empty table
      with a visible "no features" indicator when `Layer.featureCount === 0`
      (FR-012), as a distinct, non-error empty state.
- [ ] T024 [US1] Implement the open-file → parse pipeline
      (`HostAdapter.getFileSource` → DuckDB `ST_Read`/`read_parquet` →
      populate `Layer`/`Feature`) in `packages/core/src/openFile.ts`. Must
      reach `loadState: 'ready'` (not `'error'`) for a zero-feature file
      (FR-012); must parse and retain every feature regardless of geometry
      type when a layer mixes geometry types, setting
      `Layer.geometryType = 'Mixed'` (FR-013); and must skip invalid
      geometries during parsing while incrementing
      `Layer.invalidGeometryCount` instead of failing the load (FR-014).
      Depends on T009, T010, T011.
- [ ] T025 [US1] Wire map↔table selection sync via
      `ViewerSession.selectedFeatureId` in
      `packages/ui/src/ViewerLayout.svelte`. Depends on T022, T023, T011.
- [ ] T026 [US1] Implement the error-state UI (FR-011) in
      `packages/ui/src/ErrorBanner.svelte`, wired to `ViewerSession.loadState`.
- [ ] T027 [US1] Implement a non-error warning banner in
      `packages/ui/src/LayerWarningBanner.svelte` that displays
      `Layer.invalidGeometryCount` when it is greater than 0 (FR-014) —
      visually distinct from T026's `ErrorBanner`, since a skipped-geometry
      count is a successful load with a caveat, not a failure. Depends on
      T024.
- [ ] T028 [US1] Wire the VS Code webview entry point
      (`apps/vscode-ext/src/webview/main.ts`) connecting T021's HostAdapter to
      `ViewerLayout` (including `ErrorBanner` and `LayerWarningBanner`),
      completing the end-to-end VS Code path.

**Checkpoint**: User Story 1 is fully functional and independently testable —
this is the MVP.

---

## Phase 4: User Story 2 - Open a file from the web shell (Priority: P1)

**Goal**: Same map+table outcome as US1, via the standalone web app's file
picker or drag-and-drop (spec.md US2).

**Independent Test**: Drag a supported file onto the web app and confirm the
same rendering outcome as US1 (SC-006).

### Tests for User Story 2

- [ ] T029 [P] [US2] Browser test: drag-and-drop file open renders the same
      map+table outcome as the VS Code path, in
      `tests/web/open-file.spec.ts`.
- [ ] T030 [P] [US2] Browser test: the empty state (no file loaded) renders
      correctly, in `tests/web/empty-state.spec.ts`.

### Implementation for User Story 2

- [ ] T031 [US2] Implement the web `HostAdapter` (File/Blob API via picker and
      drag-and-drop; no message-passing boundary) in
      `apps/web/src/hostAdapter.ts`, implementing `contracts/host-adapter.md`.
- [ ] T032 [US2] Implement `FileDropZone`/picker entry UI reusing
      `MapView`/`AttributeTable`/`ViewerLayout` (including the zero-feature
      empty states from T022/T023 and the `LayerWarningBanner` from T027,
      which come along for free as shared `packages/ui` components) in
      `apps/web/src/App.svelte`. Depends on T022, T023, T025, T027, T031.
- [ ] T033 [US2] Implement the empty-state UI (no file loaded yet — distinct
      from a loaded zero-feature file) in `apps/web/src/App.svelte`.

**Checkpoint**: User Stories 1 and 2 both work independently; the shared
`packages/ui` components are now proven across both shells.

---

## Phase 5: User Story 3 - Understand what was loaded (Priority: P2)

**Goal**: Show CRS, feature count, geometry type, and live cursor
coordinates; disclose when WGS84 was assumed (spec.md US3).

**Independent Test**: Open a file with a known non-WGS84 CRS and confirm the
displayed CRS/count/type match the file's real metadata, with correct
reprojected rendering.

### Tests for User Story 3

- [ ] T034 [P] [US3] Unit test: CRS reprojection renders at the correct
      location while `Layer.sourceCrs` reports the *original* CRS, and the
      "WGS84 assumed" disclosure fires only when the file truly has no CRS, in
      `tests/core/crs.test.ts`.

### Implementation for User Story 3

- [ ] T035 [P] [US3] Implement the `StatusBar`/metadata display component
      (CRS, feature count, geometry type, CRS-assumed disclosure) in
      `packages/ui/src/StatusBar.svelte`.
- [ ] T036 [US3] Wire VS Code native status bar items (CRS, feature count,
      cursor coordinates) via `HostAdapter.setStatus` in
      `apps/vscode-ext/src/extension.ts` (no-op on web, per CLAUDE.md).
- [ ] T037 [US3] Implement live cursor-coordinate tracking on map hover in
      `packages/ui/src/MapView.svelte` (depends on T022).

**Checkpoint**: Users can now identify what they're looking at, on top of
US1/US2's render pipeline.

---

## Phase 6: User Story 4 - Get a usable default basemap (Priority: P2)

**Goal**: Theme-matched default basemap, with an off/blank toggle, degrading
gracefully on failure (spec.md US4).

**Independent Test**: Open the viewer under light and dark host themes and
confirm the matching default basemap; toggle it off and confirm a blank
background with the data layer intact.

### Tests for User Story 4

- [ ] T038 [P] [US4] Unit test: basemap failure (simulated offline/blocked
      request) degrades to blank + a short message without affecting the data
      layer, in `tests/core/basemap.test.ts`.

### Implementation for User Story 4

- [ ] T039 [US4] Implement theme detection and `onThemeChange` (MutationObserver
      on `documentElement`/`body` per CLAUDE.md) in both
      `apps/vscode-ext/src/webview/hostAdapter.ts` and
      `apps/web/src/hostAdapter.ts`.
- [ ] T040 [US4] Implement the default-basemap-selection + blank-toggle UI in
      `packages/ui/src/BasemapToggle.svelte`, reading from T012's catalog.
      Depends on T012, T039.
- [ ] T041 [US4] Implement graceful basemap-failure handling (offline, CSP
      block, bad key → blank + short message, data layer unaffected — FR-016)
      in `packages/ui/src/MapView.svelte`.

**Checkpoint**: All P1/P2 stories work together; only click-to-inspect (P3)
remains.

---

## Phase 7: User Story 5 - Inspect a single feature (Priority: P3)

**Goal**: Click a rendered feature on the map to see its attributes
(spec.md US5).

**Independent Test**: Click a feature on the map and confirm its attributes
display, independent of any other feature in this spec.

### Tests for User Story 5

- [ ] T042 [P] [US5] Browser test: clicking a map feature shows its
      attributes (e.g. via table selection sync), in
      `tests/web/click-inspect.spec.ts`.

### Implementation for User Story 5

- [ ] T043 [US5] Wire map-click → `ViewerSession.selectedFeatureId` →
      attribute display, reusing T025's selection-sync path, in
      `packages/ui/src/MapView.svelte` and `packages/ui/src/ViewerLayout.svelte`.

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T044 [P] Run all five `quickstart.md` scenarios end to end in both
      `apps/vscode-ext` and `apps/web`; record pass/fail and any deviation.
- [ ] T045 [P] Accessibility pass: keyboard reachability and ARIA labeling for
      the table, map controls, and basemap toggle (Constitution Principle VII).
- [ ] T046 Measure SC-001 (<2s render for ~10MB files), SC-003 (<2s to
      identify CRS/count/type), and SC-004 (<100ms selection highlight)
      against real sample files; record results in `quickstart.md`.
- [ ] T047 [P] Update `THIRD-PARTY-NOTICES.md`/`CHANGELOG.md` for the new
      dependencies introduced (`@duckdb/duckdb-wasm`, MapLibre GL JS), matching
      `../omx-viewer`'s existing convention for these files.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Phase 1; BLOCKS every user story —
  in particular, T018/T021 (US1) and T009 cannot start until T005's worker
  spike has a recorded outcome, and T006's format spike must confirm a format
  before any task claims that format works.
- **User Stories (Phases 3–7)**: all depend on Phase 2. US1 and US2 (both P1)
  can proceed in parallel once Phase 2 is done; US3/US4 depend on US1 or US2
  having a working render pipeline to attach metadata/basemap UI to; US5
  depends on US1's selection-sync path (T025).
- **Polish (Phase 8)**: depends on all desired user stories being complete.

### Parallel Opportunities

- T002–T004 (Setup) in parallel.
- T006 and T007 (Phase 2 spikes) in parallel with each other, but T005 (the
  worker spike) should run first/alone since T009 and all of US1's webview
  work depend on its outcome.
- T010, T011, T012 (Phase 2 core types/data) in parallel once T008 lands.
- T014–T017 (US1 tests) in parallel; T022/T023 (US1 UI components) in
  parallel.
- US1 and US2 can be staffed in parallel once Phase 2 completes (they share
  `packages/ui` components built in US1 — US2 only adds the web `HostAdapter`
  and entry UI).

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup) → Phase 2 (Foundational, including both spikes) →
   Phase 3 (US1). **Stop and validate** US1 independently — this is the MVP
   and the thinnest possible proof of the whole pipeline (custom editor, WASM,
   HostAdapter, theme).
2. If Phase 2's spikes (T005/T006) find the assumed approach broken, treat
   that as a plan-level finding: update `research.md` and `plan.md`'s
   Technical Context before continuing, per Constitution Principle VI — do
   not silently patch around a failed spike inside a later task.

### Incremental Delivery

Phase 2 → US1 (MVP) → US2 → US3 → US4 → US5 → Polish, validating each
checkpoint independently before moving on, per the project's "small vertical
slices" working rule.
