# Quickstart: Validating Quick Look (001)

Validation guide only — no implementation code here. Full task breakdown is in
`tasks.md`; full design detail is in `data-model.md` and `contracts/`.

## Prerequisites

- Node LTS, npm (matching `../omx-viewer`'s workspace tooling).
- VS Code (any recent release; see Spike 4's `research.md` note — confirm the
  minimum `engines.vscode` version once worker bootstrapping is proven).
- A small (~10MB or less) sample file per confirmed format from Spike 1's
  follow-up task (T001) — start with GeoJSON, since it needs no WASM driver to
  prove the pipeline, then extend to the others as each is confirmed.

## Setup

```bash
npm install
npm run build --workspace=packages/core
npm run build --workspace=packages/ui
```

## Scenario 1 — VS Code: open a file (User Story 1, P1)

1. `npm run watch --workspace=apps/vscode-ext` (or the project's equivalent
   dev task) and launch the Extension Development Host (F5).
2. In the Explorer, right-click a sample `.geojson` file → **Open With...** →
   Spatial Explorer (or rely on the default association once
   `customEditors` priorities are wired per CLAUDE.md).
3. **Expected**: the viewer opens; the map is fitted to the layer's extent; the
   attribute table lists the same features. Click a table row → the matching
   map feature highlights, and vice versa (FR-005).
4. Repeat with a file this project's spike confirmed as unsupported/corrupt
   (or a deliberately corrupted file) → **Expected**: a specific, readable
   error message (FR-011), no partial/broken viewer state.

## Scenario 2 — Web: open a file (User Story 2, P1)

1. `npm run dev --workspace=apps/web`.
2. Drag the same sample file onto the page (or use the file picker).
3. **Expected**: same map + table outcome as Scenario 1 (SC-006).
4. With no file loaded, **Expected**: a clear empty state inviting the user to
   open a file.

## Scenario 3 — Metadata and cursor coordinates (User Story 3, P2)

1. Open a sample file whose source CRS is documented as non-WGS84 (e.g. a
   state-plane or UTM GeoJSON/GeoParquet export).
2. **Expected**: displayed CRS matches the file's actual source CRS (not
   "EPSG:4326"), feature count and geometry type are shown, and geometry
   renders in the correct location on the map (reprojected for display only —
   FR-007).
3. Move the cursor over the map. **Expected**: live coordinates update
   continuously (FR-008).
4. Open a file with no CRS metadata. **Expected**: the UI discloses that
   WGS84 was assumed (FR-015) rather than presenting it as read from the file.

## Scenario 4 — Default basemap and theme (User Story 4, P2)

1. With the host (VS Code or OS) in light appearance, open a file.
   **Expected**: a light-appropriate default basemap.
2. Switch to dark appearance. **Expected**: chrome and basemap update live,
   without reopening the file (FR-017).
3. Toggle the basemap off. **Expected**: blank background, data layer stays
   correctly positioned.
4. Disconnect network (or block the basemap host) and open a file.
   **Expected**: basemap degrades to blank + a short message; the data layer
   and table are unaffected (FR-016).

## Scenario 5 — Click-to-inspect (User Story 5, P3)

1. Click a rendered feature on the map.
2. **Expected**: that feature's attributes are shown (e.g. selected/highlighted
   in the table) — FR-010.

## Edge cases to exercise before calling 001 done

- Zero-feature file → empty map + empty table with a visible indicator, not
  an error (FR-012).
- Mixed geometry types in one layer → all render, table shows all rows
  (FR-013).
- A layer with some invalid geometries → those are skipped with a visible
  count/warning, load still succeeds (FR-014).
- A multi-layer file (e.g. multi-table GeoPackage, once GeoPackage is
  confirmed per Spike 1) → only the first layer opens (clarified scope).

## Definition of done for this quickstart

- [X] All five scenarios pass in both the VS Code extension and the web app
      (SC-006). See "Results" below.
- [X] SC-001 (small file, <2s to render) and SC-003 (CRS/count/type visible
      within 2s) measured, not just eyeballed.
- [X] Spike 1's T001 per-format results are recorded in `research.md` and the
      format list actually exercised here matches what T001 confirmed. The
      end-to-end format matrix found and fixed two formats the spike had
      passed (GeoParquet, GML); see research.md §9.

## Results (T044 / T046, 2026-10-10)

To re-run: `npm run test:core`, `npm run test:web`, and
`npm run test:vscode-ext` (close other VS Code windows first). For a visual
check of the real extension and web app, run `npm run screenshots`.

### Scenarios

| Scenario | VS Code extension | Web app |
|---|---|---|
| 1. Open a file; map fit and table; selection sync both ways; corrupt file gives a specific error | ✅ T014–T016 (`open-file*.test.ts`, `selection-sync.test.ts`); fit and sync confirmed in screenshots | ✅ `open-file.spec.ts`, `click-inspect.spec.ts` |
| 2. Web: open via picker or drop; empty state | n/a | ✅ `open-file.spec.ts`, `empty-state.spec.ts` |
| 3. Non-WGS84 CRS reported and reprojected; live cursor; WGS84-assumed disclosure | ✅ T034 (`open-file-crs.test.ts`, UTM 12N GeoPackage and GeoParquet); cursor in the native status bar (screenshot) | ✅ status bar (screenshots); same core code path |
| 4. Theme-matched basemap; live theme switch; basemap off; offline falls back to blank with a message | ✅ `host-integration.test.ts`: Dark → Light → High Contrast while open | ✅ `basemap.spec.ts`: light/dark default; Blank and its remembered color; blocked basemap falls back to blank with a message, data intact |
| 5. Click a feature to see its attributes | ✅ inspector confirmed in screenshots; T015 covers the selection path | ✅ `click-inspect.spec.ts` |

Edge cases: zero features, mixed geometry and invalid geometries (T017). A
multi-layer GeoPackage opens only its first layer, and every claimed format
opens (`format-matrix.test.ts`, SC-002).

### Timings (SC-001 / SC-003 / SC-004)

Test file: a generated ~10.4 MB GeoJSON (22,000 polygons, 6 attributes).
Map-side numbers come from headless Chromium with SwiftShader (software
WebGL), so they are pessimistic compared with a real GPU.

| Measure | Target | Web (warm) | Web (cold) | VS Code |
|---|---|---|---|---|
| SC-001: file chosen → rendered on map | < 2 s | **1.20 s** | 2.80 s | **1.64 s** (median of 3) |
| SC-003: file chosen → CRS, count and type visible | < 2 s | **0.88 s** | 2.50 s | (same load) |
| SC-004: table selection → map highlight | < 100 ms | **33 ms** (median) | | same UI code |
| SC-004: map click → table row selected | < 100 ms | **≤ 7 ms** | | same UI code |

- **Web, warm:** DuckDB pre-warmed while the user was choosing a file.
- **Web, cold:** the file was chosen the instant the page loaded, so the
  timing includes DuckDB-WASM start-up and the spatial-extension download.
- **VS Code:** every webview starts its own DuckDB, overlapped with the file
  transfer, so its figure includes start-up.
- **Before the parse-once change:** the same file took 3.2 s warm
  (research.md §9).
- **Per-step breakdown:** each open is logged in VS Code's
  "Spatial Explorer" output channel.
