# Spec 010: Redesign implementation plan

**Status:** approved direction, ready to implement (written 2026-10-12)
**Branch:** `010-redesign` (create from `main`)
**Audience:** an AI agent with no memory of the conversation that produced this plan. Everything you need is here or in the files it names. Read the whole document before writing any code.

---

## 0. What this plan changes, in one page

Spatial Explorer is a DuckDB (WASM) query and mapping engine with a MapLibre map, shipped as a VS Code extension and a web app. The user found it slow and cluttered. These decisions are final:

1. **Map drawing (the speed fix).** Today every pan or zoom re-queries DuckDB, converts up to 25,000 features to GeoJSON text, parses it on the main thread, and calls `setData` (`QuerySession.view()` in `packages/core/src/query/session.ts`, `requestView()` in `packages/ui/src/viewerStore.svelte.ts`). This is replaced by GeoLibre's two modes:
   - **GeoJSON mode:** results with fewer than 100,000 rows, and files under 100 MiB, are converted **once**, in batches that yield to the event loop, and handed to MapLibre with one `setData`. Panning then does no engine work at all.
   - **Tiles mode:** everything larger is drawn from Mapbox Vector Tiles that DuckDB builds per tile with `ST_AsMVT`. They are served to MapLibre through a custom protocol (`addProtocol`). This happens **silently** (no dialog). A **"Load all"** link in the status bar switches the current result to GeoJSON mode on request.
   - The thinning, view cap, "Showing X of Y in view" notice, preview pass and FlatGeobuf partial reads are deleted.
2. **GeoPackage and SQLite.** Keep the GDAL path. The feature id (`fid`) must never block or break an open:
   - when GDAL streams a layer, its ids are exactly 1..N, so `fid` is computed as the row number, without sql.js;
   - sql.js runs only for layers that need it;
   - if anything fails, the file opens without `fid`.
3. **Basemaps.**
   - Keep today's short list.
   - Add a **"More basemaps…"** button that opens a modal with a searchable, filterable catalog of about 120 raster and vector basemaps, taken from GeoLibre's `maplibre-gl-basemap-control` package. API keys are supported for MapTiler, Stadia, Protomaps and CARTO.
   - **Only one basemap is ever drawn**: choosing another replaces the current one.
   - Switching basemaps never clears or re-queries the data.
   - Excluded: Chinese providers, Google, traffic and label overlays, stacked basemaps, Mapbox, Amazon.
4. **Layout "Option A".**
   - The map fills the editor.
   - **One collapsible right side panel** holds Style, Feature details and Basemap, opened from an **icon rail on the far right**, like VS Code's activity bar.
   - A **bottom panel** has tabs: **Table** and **SQL**. The SQL tab lists the workspace files beside the editor.
   - **Export** sits in the bottom panel's tab bar.
   - A **search box floats on the map** (top left).
   - The legend floats on the map (bottom left).
   - The status bar shows the draw mode, "Load all", cursor coordinates and CRS.
   - The app shows **one layer at a time**. There is no layer list panel.
5. **SQL across files.**
   - **VS Code:** a query can name any data file by its path relative to the workspace root, e.g. `ST_Read('data/links.shp')`. The extension finds the file (and its Shapefile sidecars) and lets the engine read it.
   - **Web:** the user adds files (picker or drag and drop) and names them by file name.
6. **Search.** The floating search box finds values in the layer (SQL), coordinates, and places (OpenStreetMap Nominatim, already implemented and disclosed).
7. **Styling (last phase).** Add a **rule-based renderer**, where each rule is a SQL condition, and **graduated by expression**, which classifies a SQL expression instead of a column.

The interactive mockup of Option A that the user approved: https://claude.ai/artifact/FrneREaWj2nSzAyjs3fHxf (option A; tags A1–A5 and S1–S3). Match its arrangement, not its exact pixels. The real app keeps its existing VS Code theme tokens and components.

---

## 1. Ground rules (read before every phase)

1. **Read `CLAUDE.md` first.** It is the project's rulebook. Phase 1 updates it; follow the updated version.
2. **Branch:**
   - work on `010-redesign`;
   - commit at the end of every task group, with the message given in the phase;
   - end every commit message with the attribution line your harness tells you to use;
   - **never push**, never publish, never run the publish workflow;
   - when everything is done, stop and tell the user. They decide about merging.
3. **Commands.** Run them from the repo root, `D:\GitHub\spatial-sql-explorer`:
   - `npm run lint`
   - `npm run typecheck:core`
   - `npm run typecheck:ui`
   - `npm run typecheck --workspace=apps/web`
   - `npm run typecheck --workspace=apps/vscode-ext`
   - `npm run test:core` (Vitest, `tests/core`)
   - `npm run test:web` (Playwright, `tests/web`; builds the web app first; takes several minutes)
   - `npm run test:vscode-ext` (`@vscode/test-electron`; builds the extension first; takes several minutes)
   - Run the long suites in the background and wait for them; do not poll with sleeps.
4. **After every phase, all of these must pass:** lint, every typecheck, `test:core`, `test:web`, `test:vscode-ext`. If a test fails because this plan deliberately changed behavior, update or delete that test **and say so in the commit message**. Never delete a test just to make it pass when the behavior it checks should still hold.
5. **`packages/core` and `packages/ui` must never** import `vscode`, call `acquireVsCodeApi`, or touch the File API or IndexedDB. A lint rule enforces this. All platform access goes through `HostAdapter` (`packages/core/src/hostAdapter.ts`).
6. **Do all data work in DuckDB SQL.** Use custom JS only where the engine provably can't do it, and write down why in a code comment.
7. **Spike before building on an assumption.** Phase 2 lists the spikes. Record every outcome in `specs/010-redesign/research.md` (create it), with numbers. If a spike fails, follow that spike's "if it fails" instruction. If none is given, **stop and ask the user**.
8. **Performance is judged in the VS Code webview, which is slower than headless Chromium.**
   - For any UI that renders lists or does work while typing, measure with Playwright at a CDP CPU throttle of 6×: `Emulation.setCPUThrottlingRate {rate: 6}`.
   - Watch long tasks with a `PerformanceObserver`.
   - Long lists must be virtualized.
   - Never re-run engine work on unrelated state changes.
9. **Code style.** Match the surrounding code:
   - TypeScript strict, Svelte 5 runes;
   - no semicolons in TS (look at existing files);
   - short comments that say *why*;
   - user-facing text is plain and specific (see existing strings).
10. **Third-party code.** GeoLibre (`D:\GitHub\_refs\GeoLibre`), `maplibre-gl-vector` and `maplibre-gl-basemap-control` are MIT, © 2026 Qiusheng Wu.
    - You may copy and adapt code from them when it saves real work.
    - When you do, add a comment `// Adapted from GeoLibre <path> (MIT)` at the copied function.
    - Phase 1 adds the license notice to `THIRD-PARTY-NOTICES.md`.
    - Port React code to Svelte 5. Never add React.
11. **Theming.** UI chrome uses the existing `--se-*` CSS tokens; see `apps/vscode-ext/src/webview/theme.css` and the web theme file. Canvas and WebGL colors can't use CSS variables:
    - read them with `getComputedStyle`;
    - re-apply them on theme change (MapView already does this for `--se-map-selection`).
12. **Scope.** Feature editing, print layouts, processing tools, plugins, terrain, multiple layers on the map and stacked basemaps are out of scope. If you think one is needed, ask.
13. **When to ask the user** (stop and ask; do not guess):
    - a spike fails and the plan gives no fallback;
    - a change would remove a feature the plan doesn't mention removing;
    - a keyed basemap provider needs a real API key to test;
    - you would need a new runtime dependency not named in this plan.

---

## 2. Glossary of existing code you will touch

| Name | Where | What it is |
|---|---|---|
| `openFile()` | `packages/core/src/openFile.ts` | Opens a file into the engine: registers it, creates views `layer` (public) and `__se_layer` (internal: adds `__se_rowid` and bbox columns `__se_xmin/ymin/xmax/ymax`), returns `{ layer, session }`. |
| `QuerySession` | `packages/core/src/query/session.ts` | One per viewer. Runs queries (`run`), pages (`page`), style statistics (`resolveStyle`), export, and today the map views (`view`). Serializes engine work through `exclusive(work, kind)`. |
| `viewTarget()` | same file | The relation the map draws: `__se_layer` (default view) or the last query's result `__se_result` with hidden columns added. |
| `viewport.ts` | `packages/core/src/view/viewport.ts` | SQL builders for map views (thinning, FlatGeobuf tiles, feature by id). Mostly deleted in phase 3. |
| `readModes.ts` | `packages/core/src/source/readModes.ts` | The per-format read mode catalog, plus thresholds and e2e test overrides. |
| `sqlite.ts` | `packages/core/src/source/sqlite.ts` | GeoPackage and SQLite reading (GDAL SQLite driver fallback, key restore via sql.js). |
| `createViewerStore()` | `packages/ui/src/viewerStore.svelte.ts` | All UI state. `requestView`, `viewFeatures`, `load`, `runQuery`, styles, export, basemap choice. |
| `MapView.svelte` | `packages/ui/src/MapView.svelte` | The MapLibre map: builds the style (`buildStyle`), the data source `layer-source`, layers `fill`, `halo`, `fill-outline`, `line`, `circle`, `marker-select`, `marker`, `extrusion`; basemap switching (`applyBasemap`); PMTiles. |
| `ViewerLayout.svelte` | `packages/ui/src/ViewerLayout.svelte` | Today's layout: map pane with popovers, plus a bottom drawer with the query panel and the attribute table side by side. |
| `basemapCatalog.ts`, `basemap.ts` | `packages/core/src/` | The short basemap list, `resolveBasemap`, `loadBasemapStyle`, `rasterStyle`, `BasemapHealth`. |
| `BasemapPicker.svelte` | `packages/ui/src/` | Today's basemap popover. |
| `sourceServer.ts` | `apps/vscode-ext/src/` | The loopback HTTP range server: serves an opened file (and sidecars) to the webview's engine under a random token. |
| `extension.ts` | `apps/vscode-ext/src/` | Custom editor provider, webview HTML and CSP (`getHtml`), and the message handling between the webview and the host. |
| `webview/hostAdapter.ts` | `apps/vscode-ext/src/webview/` | The VS Code `HostAdapter`; talks to the host with `request({type,...})`, which resolves on `requestResult`. |
| `apps/web/src/hostAdapter.ts` | | The web `HostAdapter` (File objects, localStorage, Cache Storage). |
| `__spatialExplorerE2E.runRaw(sql)` | `apps/web/src/App.svelte` | Test-only hook (with `?e2e=1`) that runs SQL with no statement policy. Use it in spikes. |
| e2e overrides | `parseTestOverrides` in `readModes.ts` | Query-string switches like `?e2e=1&cap=50` that shrink thresholds for tests. |

---

## Phase 1: Housekeeping (no behavior change)

### T001: Create the branch and folder
1. Run `git status`. Only `specs/010-redesign/implementation-plan.md` (this file) may be untracked. If anything else is modified, stop and ask the user.
2. Run `git checkout -b 010-redesign`. Do not pull or fetch.
3. Add an empty `specs/010-redesign/research.md` with the heading `# Spec 010 research`.

### T002: Update `CLAUDE.md`
Make exactly these edits, and keep everything else.
1. **"References" section:** replace the heading line `## References: copy DECISIONS and design, never code or assets` with `## References`. Then add this paragraph directly under it:
   > GeoLibre (opengeos/GeoLibre), maplibre-gl-vector and maplibre-gl-basemap-control are MIT (© 2026 Qiusheng Wu). Their code may be copied and adapted when it is justified, with a `// Adapted from …` comment and the notice in THIRD-PARTY-NOTICES.md. Port React code to Svelte; never add React. Other references (Data Wrangler, Hex Editor, GitLens, SQLite Viewer): decisions and design only, never code or assets.
2. **"VS Code integration" section:** replace the bullet `"Add to Spatial Explorer Session" for multi-file work and spatial joins (separate Session panel).` with:
   > One layer on the map at a time (user decision 2026-10-12, spec 010). Multi-file work is SQL: a query names other workspace files by their path relative to the workspace root (`ST_Read('data/links.shp')`), and the result is drawn. The web app does the same with files the user adds.
3. **"Scale and performance rules" section:** replace the first two bullets (`Never load a whole large file…` and `Prefer range reads…`) with:
   > - Map drawing (spec 010, GeoLibre's model): results under 100,000 rows (and files under 100 MiB) are converted to GeoJSON once and drawn from memory; larger ones are drawn from vector tiles DuckDB builds per tile (ST_AsMVT through MapLibre addProtocol), silently, with a "Load all" link. No per-pan re-queries.
   > - Prefer range reads (registerFileURL against the loopback server) over posting whole files to the webview.

   Delete the bullet `Later: serve vector tiles via maplibre addProtocol + ST_AsMVT…`, because it is now done.
4. **"Basemaps" section:** add these bullets at the end:
   > - Spec 010: a short featured list in the Basemap panel, plus "More basemaps…": a searchable modal over the maplibre-gl-basemap-control catalog (generated into packages/core by scripts/basemap-catalog.mjs). Excluded: Chinese providers, Google, traffic/label/route overlays, 3D, Mapbox and Amazon (they need request rewriting). Keys for MapTiler, Stadia, Protomaps, CARTO: VS Code SecretStorage, web localStorage.
   > - Exactly one basemap is drawn at a time; switching replaces it and never touches the data source.
5. **"Explicitly out of scope" section:** add `multiple map layers` to the list.

### T003: Third-party notices
Append to `THIRD-PARTY-NOTICES.md` (keep its existing format) three entries: **GeoLibre**, **maplibre-gl-vector**, **maplibre-gl-basemap-control**.
- Each entry gets the MIT license text, copied from `D:\GitHub\_refs\GeoLibre\LICENSE`. It is the same text for all three, with `Copyright (c) 2026 Qiusheng Wu`.
- Under each entry, add one line saying what was used:
  - GeoLibre: "batched GeoJSON conversion and other adapted functions";
  - maplibre-gl-vector: "the ST_AsMVT tile-query approach";
  - maplibre-gl-basemap-control: "basemap catalog data".

**Commit:** `Spec 010: plan, CLAUDE.md direction (single layer, GeoLibre code allowed, new map drawing), third-party notices`

---

## Phase 1b: Upgrade the engine to DuckDB 1.5.6 (user request, 2026-10-12)

The app ships DuckDB-WASM `1.32.0` (DuckDB v1.4.3). The newest build is `@duckdb/duckdb-wasm@1.33.1-dev65.0` (npm tag `next`, published 2026-09-29), which reports `version() = v1.5.6`. That is the same DuckDB release as the latest native one.

The browser (`wasm_eh`) builds of every extension we use exist for v1.5.6 (checked 2026-10-12, HTTP 200):
- `spatial`, `parquet`, `json` (used today);
- also available: `excel`, `sqlite_scanner`, `fts`, `icu`, `inet`, `iceberg`, `vss`, `httpfs`;
- community: `h3`, `a5`, `lindel`.

Not available for the browser: `delta`, and community `geography`.

All spikes in phase 2 run **after** this upgrade.

### T004: Upgrade
1. In `packages/core/package.json`, set `"@duckdb/duckdb-wasm": "1.33.1-dev65.0"` (exact, no caret). Run `npm install`.
2. In `scripts/engine-assets.mjs`, change `DUCKDB_VERSION` to `'v1.5.6'` and update its comment (`The DuckDB release inside @duckdb/duckdb-wasm 1.33.1-dev65.0`).
3. Run `node scripts/engine-assets.mjs`, then `node scripts/engine-assets.mjs --mirror`. Check that `packages/core/src/engineAssets.json` now names `1.33.1-dev65.0`, `v1.5.6` and the v1.5.6 extension URLs.
4. Check the web build's vite config and `apps/web/scripts/copy-wasm-assets.js`, plus `apps/vscode-ext/scripts/copy-duckdb-wasm.js`, for hard-coded version strings. Search the repo for `1.32.0` and `v1.4.3` outside `specs/` and `CHANGELOG.md`, and update every hit.
5. Run every suite (ground rule 3).
   - Expect breakage: DuckDB 1.5 changed how GEOMETRY is typed and printed, and spatial changed function behavior between 1.4 and 1.5.
   - Fix each failure in our code, not by weakening tests.
   - Where 1.5 behaves differently on purpose, update the test and note the change in `research.md` under "Engine upgrade".
   - Pay attention to:
     - `GEOMETRY('EPSG:…')` parsing (`epsgFrom` in `openFile.ts`);
     - `ST_Read` column names;
     - `ST_Read_Meta` structure (`detectSourceSrid`);
     - GeoParquet CRS metadata;
     - axis order in `ST_Transform` (`always_xy`);
     - `ST_Area`/`ST_Length` results in the export and stats tests;
     - the statement policy and lockdown tests (settings names may have changed).
6. Run the QGIS interop checks too, if any style or export test touches geometry output. They are in `tests/qgis/`; see how they are run there.
7. **The SQL editor catalog:** autocomplete lists functions from `duckdb_functions()`, so new functions appear automatically. Nothing to do; check that completion still works in `query-autocomplete.spec.ts`.

**If the upgrade breaks something you can't fix in a reasonable time** (for example, a spatial regression in the WASM build), stop, record it in `research.md` with the exact error, and ask the user whether to stay on 1.32.0.

### Engine spikes to add to phase 2 (S7–S9)
These follow the user's "DuckDB-native first" rule: move work into the engine wherever it now works.

**S7: GDAL `COPY … (FORMAT gdal)` writers on 1.5.6.**
- Re-run `specs/008-ux-parity/spikes/gdal-writers.spec.ts.txt`: copy it back to `tests/web/specs/`, apply `harness.patch` if it is still needed, and run it.
- Use the 1.5 option syntax: `LAYER_CREATION_OPTIONS ('A=B', 'C=D')` as a parenthesized list, plus `DATASET_CREATION_OPTIONS`, `GEOMETRY_TYPE`, `LAYER_NAME`, and `SRS` or `CRS`.
- Test each of GPKG, FlatGeobuf, ESRI Shapefile, KML, GeoJSONSeq and GeoJSON.
- Try every target in the earlier spike: a plain path under `/se-source/`, a pre-registered buffer, and `/vsimem/` read back.
- On 1.4.3 and 1.5.4, only `/vsimem/` worked, and its bytes could not be read from outside (`specs/008-ux-parity/research.md`, "COPY TO GDAL").
- **Decision rule:** for each format that writes **and** reads back correctly (row count, geometry type, CRS):
  1. switch its row in `packages/core/src/export/formats.ts` to the engine writer;
  2. build its `COPY` in `export/plan.ts` the way GeoParquet's is built;
  3. delete its JS writer in `packages/core/src/export/writers/`;
  4. keep the existing export tests passing, plus the QGIS reopen checks.

  Formats that still fail keep their JS writers. Record the matrix in `research.md`, replacing the 008 table's "next time" note.

**S8: `sqlite_scanner` on registered files.**
- Load `sqlite_scanner` for v1.5.6 (temporarily add it to `EXTENSIONS` in `engine-assets.mjs`, rerun the script, and load it before the lockdown).
- Try both `SELECT * FROM sqlite_scan('/se-source/<file>.gpkg', '<table>')` and `ATTACH '/se-source/<file>.gpkg' AS g (TYPE sqlite, READ_ONLY)` on a registered GeoPackage and on `cube-network.sqlite`.
- On 1.4.3 it couldn't see registered files ("unable to open database file").
- **If it reads them:** in phase 6, replace sql.js for key reading and for listing a SQLite file's attribute tables with SQL through `sqlite_scanner`.
  - If S7 also moved GeoPackage export to the engine, sql.js has no remaining use: delete `packages/core/src/sqlJs.ts`, the `sql.js` dependency, its engine asset and `loadSqlWasm`.
  - Keep `sqlite_scanner` in `EXTENSIONS`.
- **If it doesn't:** remove it again and keep sql.js.

**S9: the `excel` extension.**
- Load `excel` the same way.
- Write `COPY (SELECT …) TO '/se-source/__se_export_test.xlsx' (FORMAT xlsx)` and read the bytes back as spec 008 did.
- Open the file with Python's `openpyxl`: `C:\OSGeo4W\bin\python-qgis.bat -c "import openpyxl; …"`. If `openpyxl` is missing there, use any Python that has it.
- On 1.4.3 the file started with a stray byte (spec 008 research).
- **If the file is valid:** switch the xlsx export to the engine and delete the JS xlsx writer. Also add `.xlsx` as an **input** format through `read_xlsx` (tables with lon/lat or WKT columns open like CSV), following how CSV is handled in `openFile.ts` (`detectStrategy`, `buildFromExpr`'s `csv` case) and `readModes.ts`. Add `*.xlsx` to the VS Code `customEditors` "option" selector and the explorer context menu `when` clause.
- **If it isn't:** remove it again.

Loading an extra extension adds its download (first start only; it is cached after that) and about 0.3–1 s to engine start. Measure the start time with and without each kept extension, and record it. If `excel` and `sqlite_scanner` together add more than 1.5 s on a warm start in VS Code, ask the user before keeping them.

### Other new extensions
Do **not** add `h3`, `a5`, `vss`, `fts`, `iceberg` or the others in this plan. The user will decide on them separately; see the summary message that came with this plan.

**Commit:** `Spec 010: DuckDB-WASM 1.33.1-dev65 (DuckDB 1.5.6) with v1.5.6 extensions`. S7–S9 outcomes go into the phase 2 commit, and the code changes they trigger go into the phases named above.

---

## Phase 2: Spikes (prove the risky assumptions first)

Run these after phase 1b (the engine upgrade). S7–S9 are described in phase 1b. Write each spike as a temporary Playwright test, `tests/web/specs/spike-010-<name>.spec.ts`.
- It opens a fixture with the `openFile(page, fixture('…'), '?e2e=1')` helper from `tests/web/specs/helpers.ts`.
- It runs SQL through `page.evaluate(() => window.__spatialExplorerE2E.runRaw(sql))`.
- It prints measurements with `console.log`.
- Run one spike with `npx playwright test spike-010-<name> --reporter=line` from `tests/web`.

After recording results in `research.md`, move each spike file to `specs/010-redesign/spikes/<name>.spec.ts.txt`, so it no longer runs in the suite.

Large test data:
- `tests/.large-data/parcels-77k.geojson`, `parcels-230k.geojson` and `parcels-460k.geojson` exist. `npm run large-data` regenerates them.
- For in-test fixtures, use `writeParcels(n)` from helpers.

### S1: `ST_AsMVT` in the WASM build
**Question:** does the upgraded engine (DuckDB-WASM 1.33.1-dev65, DuckDB 1.5.6, with spatial) build tiles, with which argument forms and property types, and how fast?

Steps:
1. Open `parcels-10k.geojson` (`tests/vscode-ext/fixtures/`).
2. Run this, then check that the result is a non-empty BLOB:
   ```sql
   SELECT ST_AsMVT({'geometry': ST_AsMVTGeom(ST_Transform(geom, 'EPSG:4326', 'EPSG:3857', always_xy := true), ST_Extent(ST_TileEnvelope(10, 196, 388)))}, 'data') AS tile
   FROM layer WHERE ST_Intersects(geom, ST_Transform(ST_TileEnvelope(10, 196, 388), 'EPSG:3857', 'EPSG:4326', always_xy := true))
   ```
   Pick a tile that covers the fixture. Compute z/x/y from the fixture's extent with the standard slippy-map formula; print the extent first with `SELECT ST_Extent_Agg(geom) FROM layer`.
3. Add properties of each type to the struct and see which work: `'n_int': 1::INTEGER`, `'n_big': 1::BIGINT`, `'n_dbl': 1.5::DOUBLE`, `'b': true`, `'s': 'x'`, `'d': DATE '2020-01-01'`, `'dec': 1.25::DECIMAL(10,2)`, `'nul': NULL::DOUBLE`. Record which types are accepted and which error.
4. Add `'__id': 7::BIGINT` and confirm it appears as a property. Decode with `@mapbox/vector-tile` + `pbf` in the test. They are devDependencies of `tests/web`; add them only if not present. If adding them is a problem, decode using MapLibre itself in step 6.
5. **Timing:**
   - Open `parcels-230k.geojson`.
   - Time 20 tiles at z 8, 10, 12 and 14 near the data center, both with `LIMIT 50000` inside the subquery and without.
   - Use the bbox columns of `__se_layer` (`__se_xmin` etc.) as the prefilter, as in phase 3.
   - Record the median and p95 milliseconds per tile.
6. **Render check:** register a protocol in the page (`maplibregl.addProtocol`) that returns these bytes, and confirm features render. Phase 4 builds this properly; here a quick check is enough.

**Pass:**
- tiles decode with properties;
- median under 150 ms per tile at z ≥ 10 on the 230k file in headless Chromium.

**If it fails:** if `ST_AsMVT` is missing or errors, stop and ask the user. The fallback would be `geojson-vt` tiling in a worker, as GeoLibre does for in-memory layers. If it is slow, record the numbers and continue; phase 3 adds a per-tile cache and prefiltering.

### S2: Vector source with `promoteId` and feature-state in the VS Code webview
**Question:** does a vector source on a custom protocol work in the webview (CSP, worker), with `promoteId` and `setFeatureState`?

1. In `tests/vscode-ext`, add a temporary test that opens a fixture.
2. Through a temporary test hook, have the webview add a vector source `se-tiles://…` whose protocol returns the tile from S1.
3. Set feature-state `selected` on id 7.
4. Confirm the highlighted feature renders: query rendered features with state, through the existing `_getMapView` style hooks.

**Pass:** tiles render and feature-state applies. **If it fails:** record the exact error and stop and ask.

### S3: Basemap swap keeps the data source
**Question:** when the basemap changes, can the data source survive without being reloaded?

1. In the web app, open `parcels-10k.geojson` and count calls to a stub `se-tiles` protocol (or `setData` calls in GeoJSON mode).
2. Switch the basemap:
   - raster → raster;
   - vector → vector;
   - raster → vector;
   - vector → blank.

   Use two approaches:
   - **(a)** for raster↔raster and blank, remove the old basemap layers and sources and add the new ones with `addLayer(layer, beforeId)`, without `setStyle`;
   - **(b)** for anything involving a vector style, `map.setStyle(nextDoc, { diff: true, transformStyle: (prev, next) => ({ ...next, sources: { ...next.sources, ...ourSources(prev) }, layers: [...next.layers, ...ourLayers(prev)] }) })`.
3. Record whether the data source is reloaded: the protocol is called again, or the GeoJSON source fires a `sourcedata` event with `sourceDataType: 'metadata'`.

**Pass:** (a) never reloads the data. (b) may reload; that is acceptable because phase 4 adds a tile cache. Record which.

### S4: Workspace file paths in SQL
**Question:** can the engine resolve a relative file name through DuckDB's `file_search_path`, given that the configuration is locked after start?

1. Make a temporary change in `packages/core/src/duckdbService.ts` `getDuckDb()`: run `SET file_search_path = '/se-source/ws'` before `lockDown(conn)`.
2. In the test, register a file as `/se-source/ws/data/sample.geojson`. Use a new temporary e2e hook that calls `db.registerFileBuffer`, then delete the hook.
3. Run `SELECT count(*) FROM ST_Read('data/sample.geojson')`, `read_parquet('data/x.parquet')` and `read_csv_auto('data/points.csv')`.

**Pass:** all three resolve. Record which do.

**If any fails:** use the fallback in phase 9: rewrite the string literals to absolute paths before running, with an offset map for error positions. Either way, revert the temporary change.

### S5: GeoPackage `fid` without sql.js
**Question:** when GDAL streams a GeoPackage layer, are its ids exactly the row number (1-based, in read order)?

1. For `sample.gpkg` and `multi-layer.gpkg` (every layer that streams), compare `SELECT row_number() OVER () AS rn FROM ST_Read('<path>', layer := '<name>')` with the real `fid` values read through sql.js. sql.js is already loaded in the page; use the existing `loadSqlJs`, or read the file in node with sql.js inside the test.
2. Run `SELECT * FROM ST_Read_Meta('<path>')` and record whether it exposes the FID column name (look inside `layers[1]` for a `fid` or `fid_column` field).

**Pass:** they match for every streamable layer. **If they don't match:** keep today's sql.js key restore for GeoPackage too, but run it in the background as described in phase 6, option B.

### S6: Keyed basemap URLs without a key
1. Fetch `https://a.basemaps.cartocdn.com/light_all/2/1/1.png` and `https://a.basemaps.cartocdn.com/light_all/2/1/1.png?key=`.
2. Record whether CARTO works without a key.

**Pass:** it works without a key, so CARTO is "key optional" (phase 7 strips the parameter when no key is set). **If it fails:** treat CARTO as "key required".

**Commit after all spikes:** `Spec 010 spikes: ST_AsMVT, vector tiles in the webview, basemap swap, workspace paths, GeoPackage fid, CARTO keys (research.md)`

---

## Phase 3: Core — draw modes, the batched GeoJSON load and tile SQL

Goal: `packages/core` can give the UI either all features once (GeoJSON) or one vector tile at a time, and decides which. Nothing in the UI changes yet, so the old `view()` stays until phase 4 removes it.

### T010: Draw-mode thresholds
Create `packages/core/src/view/drawMode.ts`:
```ts
// How the map draws the displayed result (spec 010, GeoLibre's maplibre-gl-vector auto mode):
// small results as one GeoJSON source, big ones as vector tiles the engine builds per tile.
export type DrawMode = 'geojson' | 'tiles'

/** Results with at least this many rows are drawn as tiles (GeoLibre DUCKDB_VECTOR_FEATURE_WARN_COUNT). */
export const TILE_ROWS = 100_000
/** The opened file at or above this size is drawn as tiles (GeoLibre DUCKDB_VECTOR_ROUTE_BYTES). */
export const TILE_BYTES = 100 * 1024 * 1024
/** Most features one tile carries (maplibre-gl-vector TILE_FEATURE_LIMIT). */
export const TILE_FEATURE_LIMIT = 50_000

export interface DrawModeInput {
  rows: number
  /** The opened file's size; only counts for the default view (`SELECT * FROM layer`). */
  fileBytes: number | null
  defaultView: boolean
  /** The user chose "Load all" for this result. */
  loadAll: boolean
}

export function drawModeFor(i: DrawModeInput): DrawMode {
  if (i.loadAll) return 'geojson'
  if (i.rows >= tileRows()) return 'tiles'
  if (i.defaultView && i.fileBytes !== null && i.fileBytes >= TILE_BYTES) return 'tiles'
  return 'geojson'
}
```
1. Add `tileRows?: number` to `TestOverrides` in `readModes.ts`, plus the key `'tileRows'` to `TEST_OVERRIDE_KEYS` and its parsing in `parseTestOverrides` (copy how `cap` is parsed).
2. Export `function tileRows(): number { return overrides.tileRows ?? TILE_ROWS }` from `readModes.ts`, and import it in `drawMode.ts`.
3. Export everything from `packages/core/src/view/index.ts`.

**Test:** create `tests/core/draw-mode.test.ts` with these cases:
- 99,999 rows → geojson;
- 100,000 → tiles;
- the default view with a 100 MiB file and 10 rows → tiles;
- a non-default view with a 200 MiB file and 10 rows → geojson;
- `loadAll` with 5M rows → geojson;
- the override `setTestOverrides({ tileRows: 50 })` with 50 rows → tiles. Reset the overrides after the test.

### T011: Web Mercator SQL helper
In `packages/core/src/crs.ts`, next to `reprojectToWgs84Sql`, add `toWebMercatorSql(g: string, srid: number | null): string`.
- It returns `ST_Transform(${g}, 'EPSG:${srid ?? 4326}', 'EPSG:3857', always_xy := true)`.
- Mirror `reprojectToWgs84Sql`'s handling of null and 4326. Read it first.
- Add a unit test in `tests/core/crs.test.ts`.

### T012: Tile SQL builder
Create `packages/core/src/view/tiles.ts`:
```ts
import type { Bbox } from '../models.js'
import { toWebMercatorSql } from '../crs.js'
import { quoteIdent } from '../query/util.js'
import type { ViewTarget } from './viewport.js'
import { TILE_FEATURE_LIMIT } from './drawMode.js'

/** The MVT layer name every engine tile uses (MapLibre `source-layer`). */
export const TILE_LAYER = 'data'

/** WGS84 bounds of an XYZ tile (standard slippy-map math). */
export function tileBoundsWgs84(z: number, x: number, y: number): Bbox { ... }

/** One attribute in a tile: its name and how it is encoded (S1 decides the accepted types). */
export interface TileAttr { name: string; type: string }

/**
 * SQL building one Mapbox Vector Tile from `t.relation` (spec 010, adapted from maplibre-gl-vector's
 * mvtTileStreamQuery, MIT). `box` is the tile's bounds in the layer's own CRS (from viewBoxSql), so the
 * bbox columns prune rows by constants. Each feature carries `__id` (= __se_rowid) for promoteId.
 */
export function tileSql(t: ViewTarget, z: number, x: number, y: number, box: Bbox, attrs: TileAttr[]): string { ... }
```
Rules for `tileSql`:
- **Struct:**
  - starts with `'__id': __se_rowid`;
  - then each attribute as `'<name>': <expr>`, where `<expr>` is:
    - numeric types (`TINYINT SMALLINT INTEGER BIGINT HUGEINT UTINYINT USMALLINT UINTEGER UBIGINT FLOAT DOUBLE DECIMAL(...)`) → `CAST(col AS DOUBLE)`;
    - `BOOLEAN` → `col`;
    - everything else → `CAST(col AS VARCHAR)`.

    Adjust this if S1 found other type limits.
  - ends with `'geometry': ST_AsMVTGeom(<webmercator geom>, ST_Extent(ST_TileEnvelope(z, x, y)))`.
- **Quoting:** quote attribute names as SQL string keys with `'` doubled. Quote column references with `quoteIdent`.
- **WHERE clause:**
  - `index === 'columns'`: the bbox-overlap predicate on `__se_xmin…` with `box` as constants (reuse the private `overlaps`/`hiddenOverlap` logic in `viewport.ts`; export a helper from there rather than copying);
  - `index === 'bbox-table'`: `__se_rowid IN (SELECT rn FROM __se_bbox WHERE <overlap>)` (reuse `candidates`);
  - then `AND <validGeometry>` (reuse `validGeometry` from `viewport.ts`; export it).
- **Full statement:** `SELECT ST_AsMVT(<struct>, 'data') AS tile FROM (SELECT * FROM <relation> WHERE <where> LIMIT ${TILE_FEATURE_LIMIT})`
- **FlatGeobuf (`index === 'fgb'`):** throws `Error('FlatGeobuf is loaded whole since spec 010')`. Phase 5 removes that index kind.

**Test:** `tests/core/tiles-sql.test.ts`:
- `tileBoundsWgs84(0,0,0)` ≈ `[-180, -85.0511, 180, 85.0511]`; `tileBoundsWgs84(1,1,0)` ≈ `[0, 0, 180, 85.0511]`;
- the SQL contains `ST_AsMVT(`, `'__id': __se_rowid`, `CAST("pop" AS DOUBLE)`, `LIMIT 50000`, and the overlap constants;
- a column named `it's` is quoted correctly.

### T013: Batched features, the one-time GeoJSON load
Create `packages/core/src/view/features.ts`:
```ts
/** Every mappable row of `t` as GeoJSON features, built once (spec 010 GeoJSON mode). */
export function allFeaturesSql(t: ViewTarget, attrs: string[], textAttrs: string[]): string
```
- **SQL:** `SELECT <attrs…>, __se_rowid, ST_AsGeoJSON(<reprojectToWgs84Sql(geom, srid)>) AS __se_geojson FROM <relation> WHERE <validGeometry> ORDER BY __se_rowid`. Attributes in `textAttrs` (temporal types) are `CAST(… AS VARCHAR)`, as in `recordAttrs` in `viewport.ts`.
- **`relation`:** the same relation the view uses, so filters ("narrowed") apply.

Then add the batching helper, `packages/core/src/view/featureBatches.ts`. Adapt it from `D:\GitHub\_refs\GeoLibre\apps\geolibre-desktop\src\lib\duckdb-feature-batches.ts` (MIT; put the comment). It exports:
- `yieldToEventLoop()`;
- `FEATURE_SLICE_BUDGET_MS = 12`;
- a function `rowsToFeatures(rows, push, sliceStart, budget)`, or simpler: an async `collectFeatures(stream, onBatchRow)` that converts each row to `{ type: 'Feature', id: Number(__se_rowid), properties: { ...sanitizedAttrs, __id: Number(__se_rowid) }, geometry: JSON.parse(__se_geojson) }`. It skips rows whose `__se_geojson` is null, and yields every 256 rows once 12 ms have passed.
- Use `sanitizeAttributes` from `packages/core/src/query/util.ts` for property values (BigInt → number, Date → string).

`streamRows` (in `query/util.ts`) already streams Arrow batches with a callback. The callback is synchronous, so collect the batch rows and convert them inside an async loop after each batch. Read `streamRows` and pick the simplest correct structure.

### T014: Session methods `allFeatures` and `tile`
In `packages/core/src/query/session.ts`:

1. Add `'tile'` to `EngineWorkKind`. In `exclusive()`, treat `'tile'` exactly like `'view'`: the `interruptible()` check must include `this.inFlightKind === 'tile'`, and a busy engine throws `ViewSkippedError` for `'tile'` too.
2. Add the method:
   ```ts
   /** Spec 010 GeoJSON mode: every mappable row of the displayed result, as one FeatureCollection. */
   async allFeatures(attrs: string[] | undefined, onProgress?: (n: number) => void): Promise<GeoJSON.FeatureCollection>
   ```
   - Runs under `exclusive(…, 'background')` (user work preempts it; the store retries).
   - Uses `viewTarget()`. Returns an empty collection when it is null.
   - Includes **all** visible attributes when `attrs` is undefined (GeoLibre does this; style changes then never refetch).
3. Add the method:
   ```ts
   /** Spec 010 tiles mode: one MVT tile of the displayed result. Empty tiles are a 0-byte array. */
   async tile(z: number, x: number, y: number, attrs: string[]): Promise<Uint8Array>
   ```
   - Runs under `exclusive(…, 'tile')`.
   - Steps:
     1. compute `tileBoundsWgs84`;
     2. if the target's srid is not null/4326, run `viewBoxSql` (it exists) to get the source-CRS box;
     3. build `tileSql`, with attribute types from `this.facts.columns` (or `this.table.columns` for the default view);
     4. run it with `singleRow`;
     5. return the BLOB as a `Uint8Array` (`new Uint8Array(0)` when null).
4. Add `drawMode(): DrawMode`:
   ```ts
   drawModeFor({ rows: this.displayedRowsKnown(), fileBytes: this.fileBytes, defaultView: !!this.facts?.defaultView, loadAll: this.loadAll })
   ```
   - `displayedRowsKnown()` is `facts.totalRows`, or `matchingRows` when filters are active and counted.
   - Add a field `fileBytes: number | null` with a setter `setFileBytes(n)`, called by `openFile` (`source.size`).
   - Add a field `loadAll = false`, a method `setLoadAll(on: boolean)`, and reset `loadAll = false` inside `resultChanged()`.
5. Add `dataVersion: number`. It increments in `resultChanged()`, `setFilters()` (when `where` changed), `setShowSelectedOnly()` (when changed) and `setLoadAll()`. The UI uses it to build tile URLs and to know when to refetch.

**Tests:**
- `tests/core` can't run DuckDB-WASM, so unit-test only the SQL builders (T012, T013).
- The session methods are tested through the web suite in phase 4.

**Commit:** `Spec 010: core draw modes, one-time GeoJSON load and ST_AsMVT tile SQL`

---

## Phase 4: UI — draw from the new modes and delete per-pan views

### T020: Tile protocol in the UI package
Create `packages/ui/src/engineTiles.ts`:
```ts
// Spec 010: the engine's vector tiles reach MapLibre through a custom protocol, like PMTiles
// (pmtilesSource.ts). URLs: `se-tiles://<key>/{z}/{x}/{y}`; <key> = `<viewerId>-<dataVersion>-<attrsHash>`,
// so any change of data or carried columns is a new URL and MapLibre re-requests.
```
1. **Registration:** `ensureEngineTilesProtocol()` calls `addProtocol('se-tiles', handler)` once (guard with a module flag, as `pmtilesSource.ts` does).
2. **Providers:** `const providers = new Map<string, (z, x, y) => Promise<Uint8Array>>()`. Expose `registerTileProvider(key, fn): () => void`; the returned function unregisters.
3. **Handler:**
   - parse `params.url` with a regex `^se-tiles://([^/]+)/(\d+)/(\d+)/(\d+)$`;
   - look up the provider, and reject with `Error('No tile provider')` if there is none;
   - check the cache;
   - call the provider;
   - honor `abortController.signal`: if aborted before the provider starts, reject with an `AbortError`;
   - return `{ data: bytes.buffer.slice(…) }`. For an empty tile, return `{ data: new ArrayBuffer(0) }`. Check MapLibre's typing for `addProtocol` responses; `pmtilesSource.ts` is a working example.
4. **Cache:** an LRU of 512 entries keyed by the full URL, storing bytes. A basemap swap that reloads the source is then served from memory (S3). Clear entries for a key when it is unregistered.
5. **One tile at a time:** keep a FIFO queue so only one provider call runs at a time. The engine is single-threaded, so parallel requests just queue inside `exclusive` and throw `ViewSkippedError`.
   - Before starting each queued request, drop it if its signal was aborted.
   - On `ViewSkippedError` or `QueryCancelledError` from the provider, wait for `session.whenIdle()` and retry the same request. Make it part of the provider closure the store passes in, so the queue stays generic.

### T021: The store loads data by draw mode
In `packages/ui/src/viewerStore.svelte.ts`:

1. **Remove:**
   - `requestView`, `viewFeatures`, `viewLoading` (keep a new `drawLoading`, see below);
   - `PREVIEW_CAP`, `previewedLayer`, `waitForPaint`'s use in views, `lastViewArgs`, `viewGeneration`, `viewAttrs`;
   - the `thinned` branch of `viewNotice`;
   - every import of these from core.
   - Keep `notifyPainted()` and the paint counter: tests use `data-paints` and `data-rendered-features`.
2. **Add state:**
   ```ts
   /** Spec 010: how the map draws the displayed result. */
   let drawMode = $state<DrawMode | null>(null)
   /** GeoJSON mode: the features, unproxied (never $state: MapLibre must get plain objects). */
   let mapData = $state.raw<GeoJSON.FeatureCollection | null>(null)
   /** Tiles mode: the source URL template (`se-tiles://key/{z}/{x}/{y}`). */
   let tileUrl = $state<string | null>(null)
   let drawLoading = $state(false)
   let drawProgress = $state<number | null>(null)
   ```
3. **`refreshDraw()`:** a new async function that runs whenever the displayed data changes. Call it after `setLayer(...)` in `load()`, after `applyOutcome` for a `result`, after `narrowed()`, and from `loadAll()`.
   - A table-only result keeps the old drawing dimmed: if `mapDimmed`, return.
   - `const mode = qs.drawMode()`.
   - **GeoJSON mode:**
     - set `drawLoading = true` after 300 ms (as the old view did);
     - `mapData = await retryWhenBusy(qs, () => qs.allFeatures(undefined, (n) => drawProgress = n))`;
     - `tileUrl = null`;
     - guard with a generation counter so an older load never overwrites a newer one.
   - **Tiles mode:**
     - unregister the previous provider;
     - `key = \`${viewerId}-${qs.dataVersion}-${hash(attrs)}\`` with `attrs = styleColumns(style)` (the existing helper);
     - `registerTileProvider(key, (z, x, y) => qs.tile(z, x, y, attrs))`;
     - `tileUrl = \`se-tiles://${key}/{z}/{x}/{y}\``;
     - `mapData = null`.
   - Set `drawMode = mode`.
4. **Style changes in tiles mode:** when the style's columns (`styleColumns(style)`) change and the mode is `tiles`, re-run the tiles branch to get a new key. Do this in the existing style `$effect` after `refreshStyle`. Compare the joined column list to the previous one; do nothing if it is equal. GeoJSON mode carries all columns, so it never refetches on style changes.
5. **`loadAll()`:** `qs.setLoadAll(true); void refreshDraw()`. Also add `drawAsTiles()`, which calls `qs.setLoadAll(false)` and `refreshDraw()` (only offered after Load all).
6. **The store interface:** expose `drawMode`, `mapData`, `tileUrl`, `drawLoading`, `drawProgress`, `loadAll`, `drawAsTiles`. Update the `ViewerStore` interface at the top of the file.
7. **The selected feature outside the drawn set** (`outsideFeature`) still works through `featureById`. In tiles mode, also fetch the selected feature by id, so it can be drawn into the selection overlay source (T022).
8. **The VS Code status bar:** extend `hostAdapter.setStatus(...)` with `drawMode?: 'geojson' | 'tiles'` and `drawLoadAllAvailable?: boolean`. Add both to `StatusFields` in `hostAdapter.ts`. Call it whenever `drawMode` changes.

### T022: MapView draws GeoJSON or tiles
In `packages/ui/src/MapView.svelte`:

1. **Props:**
   - replace `viewFeatures` with `mapData: GeoJSON.FeatureCollection | null` and `tileUrl: string | null`;
   - remove `onViewChange`, along with `emitViewChange`, `scheduleViewChange` and the `moveend` → view call (keep the `moveend` camera callback).
2. **Rename our ids with the `se-` prefix**, so basemap layers and ours never collide and phase 7 can tell them apart:
   - `SOURCE_ID = 'se-data'`;
   - layer ids `se-fill`, `se-halo`, `se-fill-outline`, `se-line`, `se-circle`, `se-marker-select`, `se-marker`, `se-extrusion`;
   - `BLANK_BG = 'basemap-blank'`. The blank background is a basemap, not data.

   Search the whole repo for the old ids (`'layer-source'`, `'fill'`, `"fill-outline"` etc. in `tests/`, `apps/`, `mapImage.ts`) and update them. `LAYER_DEFS` keeps a `def` id, but the map layer id gets the prefix. Change `layerInstances()` to return `id: \`se-${def.id}\``.
3. **Sources by mode:**
   - **GeoJSON:** `{ type: 'geojson', data: mapData ?? empty, promoteId: '__id' }`.
     - Remove `toFeatureCollection`'s JSON round trip: `mapData` is already plain (`$state.raw`).
     - Keep adding `DOT_PROP`? No: GeoJSON mode always sends real geometry, so remove the dot logic. Remove `DOT`/`MARKER_POINT`'s dependency on `DOT_PROP` only if nothing else sets it. Check with grep. PMTiles never set it.
   - **Tiles:** `{ type: 'vector', tiles: [tileUrl], minzoom: 0, maxzoom: 14, promoteId: { data: '__id' } }`. Every data layer gets `'source-layer': 'data'`. This works like PMTiles' `sourceLayer` handling in `layerInstances()`: treat engine tiles as a single source layer named `data`, and keep the PMTiles path as it is.
   - **Switching** between GeoJSON, tiles and PMTiles needs a different source definition. Remove our layers and our source, then re-add them with `map.addSource` / `map.addLayer` (no `setStyle`). Write a function `replaceDataSource()` for this, used by both the GeoJSON↔tiles switch and a new `tileUrl`. Keep `setData` for a new `mapData` in GeoJSON mode (the cheap path).
4. **Selection overlay in tiles mode:**
   - add a small GeoJSON source `se-selection` and a line layer `se-selection-halo` (same paint as the halo), fed with the selected feature's geometry (`extraFeature`) when the mode is `tiles`;
   - feature-state `selected`/`hover` still works on the vector source because of `promoteId`;
   - keep `applyTicked()`, but in tiles mode apply it only to ids in `tickedIds` (a Set). Skip it for `'all'`; a whole-result selection is not highlighted in tiles mode. Add a code comment saying so.
5. **The rendered-feature counter** (`data-rendered-features` on idle): keep it; it works for both modes.
6. **Zoom to feature:** `zoomToFeature()` currently searches `viewFeatures`. In GeoJSON mode, search `mapData.features` by `id`. In tiles mode, use `extraFeature`, which the store fetched by id; the store already fetches the selected feature.

### T023: Delete what per-pan views needed
1. Delete these functions from `packages/core/src/view/viewport.ts`, and their tests in `tests/core/viewport-sql.test.ts` (keep the tests for the functions that remain):
   - `viewCountSql`, `thinnedIdsSql`, `thinnedRowsSql`, `viewFeaturesSql`, `featuresByIdsSql`;
   - `fgbTileSql`, `tileMeetsExtent`, `viewTiles`, `fgbByIdSql`;
   - `mapGeometry`, `featureSelect`, `sampleWhere`.

   Keep:
   - `ViewTarget`, `clampWgs84`, `viewBoxSql`, `recordByIdSql`, plus the helpers that `tiles.ts`/`features.ts` now import;
   - `candidates`, `overlaps` and `validGeometry`, now exported.

   Rename the test file to `viewport-helpers.test.ts` if little remains.
2. In `session.ts`:
   - delete `view()`, `toViewFeature` (if unused), and the imports of deleted functions;
   - `featureById` stays, using `recordByIdSql`;
   - remove `viewCapFor`, `PREVIEW` and other leftovers.
3. In `models.ts`: delete `ViewRequest`, `ViewFeatures` and `DEFAULT_FEATURE_CAP` (if unused). Update any imports.
4. In `readModes.ts`:
   - delete `VIEW_CAP`, `PARTIAL_VIEW_CAP`, `viewCapFor`, the `cap` override and `slowViewMs`; `slowViewMs` only delayed views, so replace it with a `slowTileMs` override that `tile()` honors, if a test needs one;
   - update `TEST_OVERRIDE_KEYS` and `parseTestOverrides`;
   - update `tests/core/read-modes.test.ts`.
5. **Search for leftovers** with the Grep tool:
   - `requestView|viewFeatures|ViewSkippedError|viewCapFor|thinned|PREVIEW_CAP|onViewChange|\.view\(\{`
   - across `packages`, `apps` and `tests`.

   Fix every hit:
   - `apps/web/src/App.svelte` and `apps/vscode-ext/src/webview/mapViewState.svelte.ts` reference view state for test hooks. Report `drawMode`, `features` (GeoJSON count) and `tileUrl` instead.
   - Keep `ViewSkippedError`; tiles use it.
6. **Web tests:**
   - `tests/web/specs/viewport.spec.ts` tests thinning and the view cap. Replace it with `tests/web/specs/draw-mode.spec.ts` (below).
   - Go through `large-open.spec.ts`, `scale.spec.ts`, `accessibility.spec.ts` and `performance.spec.ts`. Remove assertions about "Showing N of M in view" and the cap; keep everything else.

**New web tests, `tests/web/specs/draw-mode.spec.ts`:**
1. Open `parcels-10k.geojson` (10,000 rows < 100k) → GeoJSON mode:
   - `data-rendered-features` > 0;
   - the status bar has no "Load all";
   - pan 3 times with `page.mouse` drags, and assert that no engine query ran. Expose a counter of `qs.allFeatures`/`qs.tile` calls on the e2e hook (`__spatialExplorerE2E.drawCalls()`).
2. Open the same file with `?e2e=1&tileRows=1000` → tiles mode:
   - features render;
   - the status bar shows "Tiles" and a "Load all" button;
   - a pan triggers tile calls;
   - click "Load all" → GeoJSON mode, and "Draw as tiles" appears.
3. In tiles mode, click a feature → the inspector opens with its attributes (feature-state and promoteId work). Select a table row → the selection halo shows.
4. Run a query returning 50 rows → GeoJSON mode even with `tileRows=1000`.
5. Apply a categorized style in tiles mode → tiles re-requested with the new column (the draw-call counter increases), and the legend counts are unchanged (still SQL).

**VS Code tests:** update `tests/vscode-ext/src/suite/large-open.test.ts` and `scale.test.ts` the same way. Add one test that opens `parcels-10k.geojson` with the `_setTestOverrides({ tileRows: 1000 })` command (it exists) and checks that features render in tiles mode. This is S2 made permanent.

### T024: Status bar items
1. **Web** (`packages/ui/src/StatusBar.svelte`): add a left item. Read `StatusBar.svelte` and follow its item style.
   - GeoJSON mode: `$(layers) All drawn · {n} features`.
   - Tiles mode: `$(layers) Tiles` plus a button `Load all`. Tooltip: `Over 100,000 features: drawn from tiles the engine builds as you move. Load all draws every feature at once (slower to open, then no work while panning).`
   - After "Load all": a button `Draw as tiles`.
   - While loading: `Loading features… {n}`.
2. **VS Code:**
   - add a status bar item `statusBarDraw` (right side, priority 31) in `extension.ts`;
   - text `$(layers) Tiles · Load all`, with command `spatialExplorer.loadAll`;
   - register the command; it posts `{type: 'loadAll'}` to the active panel;
   - in GeoJSON mode, text `$(layers) All drawn` with no command;
   - hide it with the other items;
   - the webview handles `loadAll` by calling `store.loadAll()`. Find where `testSetStyle` etc. are handled in `apps/vscode-ext/src/webview/main.ts` and add the case there;
   - declare the command in `apps/vscode-ext/package.json` `contributes.commands` with `"enablement": "false"`, or hide it from the palette with a `when` clause in `menus.commandPalette`, so users don't run it blind.

**Verify by hand:**
1. Open `tests/.large-data/parcels-230k.geojson` in VS Code (Extension Development Host).
2. Pan and zoom: the map must stay responsive, with no "Loading the features in view" bar on every pan.
3. Take screenshots with `npm run screenshots` and look at them.

**Commit:** `Spec 010: draw small results once as GeoJSON and big ones as engine vector tiles; remove per-pan views`

---

## Phase 5: FlatGeobuf is always loaded whole

The FlatGeobuf partial-read path (0.74 ms per feature, its own JS reader, and the "Load the whole file to query it" step) existed only to make per-pan views possible. With tiles from the engine, it goes.

1. In `readModes.ts`, change the flatgeobuf row to `mode: 'whole'`. Remove the `'partial-view'` kind from `ReadModeKind` in `models.ts`, and the `partial-view` branch in `readModeFor`.
2. In `openFile.ts`:
   - delete `openFlatGeobufInParts`;
   - delete the `options.loadWhole` handling and `OpenOptions.loadWhole`;
   - in `factsOf`, delete `needsLoad: readMode === 'partial-view'`;
   - delete `DatasetFacts.needsLoad` in `models.ts`.
3. Delete `packages/core/src/source/fgbReader.ts`. Delete `fgbHeader.ts` and `tests/core/fgb-header.test.ts` **only if** nothing else imports them (grep `fgbHeader`, `parseFgbHeader`, `flatGeobufFacts`). Remove their exports from `source/index.ts`.
4. In `session.ts`, delete:
   - `needsLoad` and every `if (this.needsLoad)` branch;
   - `LayerViewInfo.fgbReader`, `rowidExpr`, `path` and `extent`, if now unused;
   - the `'fgb'` index kind from `ViewTarget` in `viewport.ts`.
5. In the UI:
   - delete `LoadWholeNotice.svelte` and its uses (`ViewerLayout`, `LayerStylePanel`, `QueryPanel`);
   - delete the store's `needsLoad`, `loadWhole` and `openedSize` (if only used for that);
   - delete the `needsLoad` props everywhere.

   Grep `needsLoad|loadWhole|LoadWholeNotice|partial-view` until there are no hits.
6. Keep the whole-read announcement (`confirmWholeRead` / `ReadWholeDialog`) for whole-read files over 100 MB. It still applies, now to FlatGeobuf too.
7. **Tests:** update the large-open and scale tests that asserted FlatGeobuf partial reads (web and VS Code), and `tests/core/read-modes.test.ts`.

**Commit:** `Spec 010: FlatGeobuf is read whole into the engine (partial reads and their JS reader removed)`

---

## Phase 6: GeoPackage and SQLite open without `fid` when it isn't needed

Read `packages/core/src/source/sqlite.ts` fully first, and research §16 in `specs/008-ux-parity/research.md`.

### Option A (when S5 passed: streamed ids = row number)
1. In `planSqliteSource`, for a **GeoPackage** layer that `streams()`:
   - do not read its key with sql.js;
   - its reader becomes `(SELECT CAST(row_number() OVER () AS BIGINT) AS "fid", * FROM ST_Read('<path>', layer := '<name>'))`. Use `readLayerSql` for the inner part.
   - The column is named `fid`. If the layer already has a column named `fid` (rare), skip adding it.
   - If S5 found that `ST_Read_Meta` exposes the real FID column name, use that name instead of `fid`.
2. **sql.js** runs only when:
   - at least one GeoPackage layer is blocked (needs the SQLite-driver copy, so the bytes are in memory anyway); or
   - the format is `sqlite` (attribute-only tables and INTEGER PRIMARY KEY columns such as Cube's `n`).

   Change `needBytes` to `blocked.size > 0 || format === 'sqlite'`. A plain, streamable GeoPackage then never copies the whole file into JS.
3. **Never let the key step break the open.** Wrap `await input.wholeBytes()` in a try/catch:
   - for a blocked layer, the bytes are required, so rethrow with the message `This GeoPackage layer can't be read in this engine without loading the file into memory, and that failed: <reason>`;
   - for `sqlite` key reading, log and continue without keys.

   `readCatalog` failures already fall back; keep that.
4. **Log one line per restored or skipped key**, e.g. `[open] fid: row number (ids are 1..N)` or `[open] fid not restored: <reason>`, through the existing `log`.

### Option B (only if S5 failed)
Keep sql.js key restore for GeoPackage, but:
- give it a 2-second budget (`Promise.race` with a timeout); on timeout, open without the key and log it;
- keep the try/catch from step 3.

### Tests
1. `tests/core/sqlite-source.test.ts`: add tests for the reader SQL of a streamable layer (it contains `row_number() OVER ()` and `AS "fid"`).
2. `tests/web/specs/sqlite-sources.spec.ts`:
   - `sample.gpkg` shows a `fid` column whose values equal the real ids (1..N);
   - `gapped-ids.gpkg` still shows its real gapped ids (sql.js path);
   - `cube-network.sqlite` still shows `n`.
3. **New fixture `corrupt-key.gpkg`:**
   - generate it in a new script `scripts/fixtures-010.mjs` (follow `scripts/fixtures-008.mjs`'s style);
   - copy `gapped-ids.gpkg` and break the `gpkg_contents` table by dropping it with sql.js, **or**, if GDAL then refuses the file entirely, truncate the file's last page;
   - pick whichever makes sql.js fail while GDAL still opens it. If no such corruption exists, skip this fixture and say so in `research.md`.
   - Test: it opens, rows show, and there is no `fid` column.

**Commit:** `Spec 010: GeoPackage fid from the row number when ids are 1..N; sql.js only when needed and never fatal`

---

## Phase 7: Basemaps — one at a time, swap without touching data, "More basemaps…"

### T040: The single-basemap invariant and swapping without clearing data
In `packages/ui/src/MapView.svelte`, rewrite `applyBasemap(entry)`:

1. **Ownership rule:** layers and sources whose id starts with `se-` are ours (data). **Everything else in the style is the basemap.** Keep a module-level `let basemapLayerIds: string[]` and `let basemapSourceIds: string[]`, recording what the current basemap added.
2. **The two paths:**
   - **Neither style is a vector style** (`blank`↔`raster`↔`raster`):
     1. remove every layer in `basemapLayerIds`, then every source in `basemapSourceIds`;
     2. add the new basemap's sources (`map.addSource`) and layers with `map.addLayer(layer, firstOurLayerId)`, where `firstOurLayerId` is the first `se-` layer in `map.getStyle().layers`, so the basemap goes **under** the data;
     3. record the new ids.

     No `setStyle`, so the data is untouched.
   - **Anything involving a vector style:**
     - `map.setStyle(buildBaseDoc(base, entry), { diff: true, transformStyle: (prev, next) => carryOurs(prev, next) })`;
     - `carryOurs` returns `next` with the `se-` sources from `prev` added to `next.sources`, `prev`'s `se-` layers appended after `next.layers`, and `projection`/`sky` taken from today's `buildStyle` logic. Strip the basemap style's own `center`/`zoom`/`bearing`/`pitch`, as `buildStyle` does today;
     - record the new basemap ids from `next` (everything not `se-`);
     - in `once('style.load')`, restore feature-state as today.
3. **`buildStyle(base, entry)`** today merges basemap and data into one document. Split it into:
   - `buildBaseDoc(base, entry)`: the basemap only. For blank, a single `basemap-blank` background layer;
   - `dataLayers()` / `dataSources()`: ours.

   The first map creation still uses one document (`{...base, layers: [...base.layers, ...ours]}`).
4. **Races:**
   - keep `basemapRequest` (the newest request wins);
   - a swap that starts while a previous `setStyle` hasn't fired `style.load` must wait for it, then apply only the newest choice. Use a `pendingBasemap` variable and handle it in the `style.load` callback.
5. **Test hook:** after each swap and on `idle`, set `container.dataset.basemapLayers = basemapLayerIds.join(',')`.

**Tests** (`tests/web/specs/basemap.spec.ts`, add):
1. Open a file. Switch Positron → Satellite → OpenStreetMap → Dark → Blank → Topographic quickly (no waits between clicks), then wait for idle. Assert:
   - every non-`se-` layer id in the style belongs to Topographic (read `map.getStyle()` through an e2e hook, or compare with `data-basemap-layers`);
   - there is exactly one `raster` source.
2. In GeoJSON mode, count `setData` calls on the `se-data` source across raster→raster swaps: **zero** (expose a counter through the e2e hook).
3. In tiles mode (`tileRows=1000`), the `drawCalls()` counter does not increase across a raster→raster swap. Across a vector swap it may, but then every repeated tile must come from the cache: count cache hits through the hook.
4. The data stays visible (`data-rendered-features` > 0) after every swap.

### T041: Generate the gallery catalog
1. Add `maplibre-gl-basemap-control` **exactly `0.14.4`** as a devDependency of the repo root (`npm install -D -E maplibre-gl-basemap-control@0.14.4`). Only the generator script uses it; it is never bundled.
2. Create `scripts/basemap-catalog.mjs`. It:
   1. imports `DEFAULT_BASEMAPS` and `DEFAULT_BASEMAP_PROVIDERS` from the package;
   2. **excludes** an entry if any of these is true:
      - `provider` ∈ {`google`, `tianditu`, `amap`, `tencent`, `here`, `tomtom`, `mapbox`, `amazon`, `waymarkedtrails`, `openrailwaymap`};
      - `category` ∈ {`Labels`, `Traffic`, `3D`};
      - `type === 'vector-overlay'`;
      - `tags` includes `overlay`;
      - the source JSON contains `{session}`;
   3. drops entries whose style URL equals a featured entry in `BASEMAP_CATALOG` (`packages/core/src/basemapCatalog.ts`);
   4. maps each kept entry to:
      ```ts
      interface GalleryBasemap {
        id: string            // the package id, prefixed 'g-' to avoid clashes with featured ids
        name: string
        provider: string      // package provider id
        providerName: string  // from DEFAULT_BASEMAP_PROVIDERS
        kind: 'raster' | 'vector'   // 'style' → 'vector'
        category: string
        description: string
        attribution: string   // sanitized: keep only <a href="https://…">text</a>, strip other tags
        url?: string          // vector: the style URL (may contain {api-key})
        tiles?: string[]      // raster: tile URL templates (may contain {api-key})
        tileSize?: number
        maxzoom?: number
        key: 'none' | 'optional' | 'required'   // 'required' when {api-key} appears; CARTO 'optional' if S6 passed
        tags: string[]
      }
      ```
   5. writes `packages/core/src/basemapGallery.json` (pretty-printed, sorted by provider then name) with a top-level `{ "source": "maplibre-gl-basemap-control@0.14.4 (MIT, © 2026 Qiusheng Wu)", "basemaps": [...] }`;
   6. **CSP host list:**
      - collect every `https://host` from `url` and `tiles`;
      - for each **keyless vector** style, `fetch` its style JSON and also collect the hosts of `sprite`, `glyphs` and every source's `url`/`tiles`. Fetch each source's TileJSON `url` once and collect its `tiles` hosts;
      - for keyed providers, add a fixed map in the script: maptiler → `api.maptiler.com`; stadia → `tiles.stadiamaps.com`; protomaps → `api.protomaps.com`, `protomaps.github.io`; carto → `*.basemaps.cartocdn.com`;
      - replace hosts that differ only by a subdomain letter (`a.`, `b.`, `c.`, `d.`) with `*.` + the rest;
      - write `apps/vscode-ext/src/basemapHosts.generated.ts`: `// Generated by scripts/basemap-catalog.mjs. Do not edit.\nexport const BASEMAP_HOSTS = '<space-separated https://host list>'`.
3. Run it with `node scripts/basemap-catalog.mjs`, and commit both generated files. Add a line to `CLAUDE.md`'s Basemaps section: `Rerun scripts/basemap-catalog.mjs after upgrading maplibre-gl-basemap-control.`
4. Create `packages/core/src/basemapGallery.ts`. It exports:
   - `GALLERY: GalleryBasemap[]` (import the JSON; check that `tsconfig` allows `resolveJsonModule`, as `engineAssets.json` already works);
   - `galleryCategories()`;
   - `searchGallery(q, { category, provider, keylessOnly })`, which matches `q` case-insensitively against name, providerName, category, description and tags. Every word must match.
   - `applyKey(entry, key: string | null): { url?: string; tiles?: string[] } | { needsKey: true }`:
     - replaces `{api-key}` with `encodeURIComponent(key)`;
     - for `key: 'optional'` with no key, removes `?key={api-key}` / `&key={api-key}` cleanly;
     - for `'required'` with no key, returns `needsKey`.
   - `toCatalogEntry(g, resolved)` → a `BasemapCatalogEntry` (the existing type; add the optional fields you need, such as `tiles?: string[]`), so the existing `loadBasemapStyle`/`rasterStyle` work unchanged. Extend `rasterStyle` to use `entry.tiles` when present.

   **Unit tests** in `tests/core/basemap-gallery.test.ts`:
   - no excluded provider or category is present;
   - search `"esri imagery"` finds `World Imagery`;
   - `applyKey` for each key mode;
   - every entry has a name and either `url` or `tiles`.
5. **CSP** in `apps/vscode-ext/src/extension.ts`:
   - replace `RASTER_TILE_HOSTS` with `BASEMAP_HOSTS` (import from the generated file);
   - keep `https://tiles.openfreemap.org`, the featured hosts and `nominatim`;
   - `connect-src` and `img-src` both get the list.
   - `tests/vscode-ext/src/suite/theme-csp.test.ts` already reads the CSP. Add a check that every host in `basemapGallery.json` is allowed by `connect-src`. Write a small matcher for `*.` wildcards.
6. **Web:** the web app has no CSP meta tag today (check `apps/web/index.html`). If it does, add the same hosts.

### T042: API keys
1. Add to `HostAdapter` (`hostAdapter.ts`):
   ```ts
   /** Spec 010: a basemap provider's API key. VS Code: SecretStorage. Web: localStorage (this browser only). */
   getSecret?(name: string): Promise<string | undefined>
   setSecret?(name: string, value: string | null): Promise<void>
   ```
   Key names: `basemapKey.<provider>`.
2. **VS Code:**
   - the webview adapter sends `{type: 'getSecret', name}` and `{type: 'setSecret', name, value}` through `request(...)`;
   - `extension.ts` handles them with `this.context.secrets.get/store/delete`. Allow only names matching `/^basemapKey\.[a-z0-9-]+$/`; reply with an error otherwise;
   - add both message types to `WebviewToHostMessage`.
3. **Web:** `localStorage` under `spatialExplorer.secret.<name>`, wrapped in try/catch.
4. The store gets `basemapKeys`: a map `provider → boolean` (has a key). It never keeps key values in reactive state. It also gets the methods `setBasemapKey(provider, key | null)` and `chooseGalleryBasemap(id)`:
   - `chooseGalleryBasemap(id)` reads the key with `getSecret`, then calls `applyKey`;
   - if the result is `needsKey`, it opens the key form (see T043);
   - otherwise it sets the basemap choice to that entry (see step 5).
5. **The choice model.** `basemapChoice` today is `'auto' | catalog id`. Allow gallery ids (`g-…`). `resolveBasemap(choice, appearance)` in `basemap.ts` must find gallery entries too:
   - for a gallery entry, the resolved entry needs the key, so resolution becomes async for keyed entries;
   - keep `resolveBasemap` synchronous for featured and keyless ones, and have the store hold a `resolvedGalleryEntry` state for keyed ones;
   - persist the choice with `saveState('basemap.choice', id)` and restore it on start. If a keyed choice has no key any more, fall back to the theme default with a notice: `<name> needs an API key. Showing <default>.`
6. **Key failures:** a wrong key shows up as tile/style errors. The existing `BasemapHealth` then falls back to blank with a message. Change the message for keyed entries to `<name> basemap unavailable (check the <Provider> API key). Showing a blank background.`

### T043: The "More basemaps…" modal
1. In the Basemap panel (today's `BasemapPicker.svelte`, which moves into the side panel in phase 8), add a full-width secondary button at the bottom of the list: `More basemaps…`. It opens `BasemapGallery.svelte`.
2. **`BasemapGallery.svelte`** is a modal dialog. Copy the structure and focus handling of `ExportDialog.svelte`: an overlay, `role="dialog"`, `aria-modal="true"`, focus trap, Escape closes, focus returns to the opener. Its size is `min(880px, 92vw)` × `min(640px, 86vh)`. Content:
   1. **Header:** title `Basemaps`, a count `120 basemaps`, and a close button.
   2. **Toolbar:**
      - a search input (placeholder `Search basemaps`, debounced 120 ms);
      - category chips (`All` + `galleryCategories()`), as a horizontally scrollable row;
      - a provider `<select>` (`All providers` + provider names);
      - a checkbox `No API key needed`.
   3. **Results:**
      - a virtualized list (`VirtualList` if one exists in `packages/ui`; otherwise render only visible rows with a fixed 64 px row height and a spacer, as `AttributeTable.svelte` does — read it first);
      - **each row:**
        - preview (96×56);
        - name;
        - `providerName · category`;
        - description (one line, ellipsis);
        - a badge: `Needs key` (required), `Key optional` or nothing;
        - a check mark for the active entry.
      - **Clicking a row** applies the basemap immediately and keeps the modal open, so users can compare. Double-click or Enter applies and closes.
      - **Keyboard:** arrow keys move through rows; Enter applies.
   4. **Previews**, loaded only for rows in view (an `IntersectionObserver` on the row element):
      - **raster:** an `<img>` of tile `z=2, x=2, y=1` from the first tile template, with the key applied when the user has one. If keyed and no key, show the provider name on a neutral swatch instead;
      - **vector, keyless:** fetch the style JSON once (cache it in a module Map), and paint the swatch with its `background` layer color and the first `fill` layer whose id contains `water`, the same idea as today's `preview: {land, water}`;
      - **keyed vector without a key:** a neutral swatch.
   5. **Key form:** choosing an entry that needs a key (and none is stored) shows an inline panel at the top of the dialog:
      - text: `<Provider> needs an API key. Keys stay on this computer (VS Code secret storage)` (web: `in this browser`);
      - a password input, `Save and use`, `Cancel`;
      - a link `Get a key` to the provider's sign-up page: maptiler `https://cloud.maptiler.com/account/keys/`, stadia `https://client.stadiamaps.com/signup/`, protomaps `https://protomaps.com/account`, carto `https://carto.com/`. Put these in `basemapGallery.ts` as `KEY_SIGNUP` data.
   6. **Footer:**
      - an `API keys…` button that shows a list of providers with a stored key, each with `Remove`;
      - the attribution note `Catalog: maplibre-gl-basemap-control (MIT)`.
3. **Performance:** at 6× CPU throttle, opening the modal and typing in search must not produce a long task over 100 ms. Measure it in a Playwright test (`tests/web/specs/basemap-gallery.spec.ts`), as described in ground rule 8.
4. **Tests** (`basemap-gallery.spec.ts`):
   - open the modal;
   - search `imagery` → only imagery entries;
   - the `No API key needed` filter hides MapTiler;
   - choosing `Esri World Topo Map` applies it, and the single-basemap invariant holds;
   - choosing a MapTiler entry shows the key form; saving a fake key applies the URL with `key=<fake>`, checked via `page.route` intercepting `api.maptiler.com` and asserting the query parameter;
   - Escape closes and focus returns to `More basemaps…`;
   - an axe check (copy from `accessibility.spec.ts`) shows no violations.

**Commit (after T040–T043):** `Spec 010: single-basemap swaps without touching data; More basemaps gallery with API keys`

**Ask the user** to test one keyed provider with their own key. You can't, and must not invent keys.

---

## Phase 8: Layout Option A

Read `ViewerLayout.svelte`, `QueryPanel.svelte`, `AttributeTable.svelte`, `LayerStylePanel.svelte`, `FeatureInspector.svelte`, `BasemapPicker.svelte`, `PlaceSearch.svelte`, `MapLegend.svelte` and `StatusBar.svelte` fully before starting. Open the mockup (https://claude.ai/artifact/FrneREaWj2nSzAyjs3fHxf, option A) for the arrangement.

### Target structure
```
.viewer-layout (column)
  banners (ErrorBanner, changed-on-disk, LayerWarningBanner, OpenProgress, ReadWholeDialog) — unchanged
  .workbench (row, flex 1)
    .main (column, flex 1)
      .map-pane (flex 1, position relative)
        MapView (fills)
        .map-ov.tl  → SearchBox (+ LayerPicker select when the file has several layers)
        .map-ov.tr  → MapView's own controls (zoom in, zoom out, zoom to layer, globe, map image, reset view)
        .map-ov.bl  → MapLegend (unchanged component)
        .map-notice (top center) → existing notices (no-geometry, memory, fallback, basemap)
        mapOverlay snippet (web status bar overlay, if still used)
      sash (horizontal, existing startDrag/sashKeydown logic)
      BottomPanel (height = fraction of .main; collapsed = tab bar only)
        tab bar: [TABLE] [SQL] ……… [Export] [maximize/restore] [hide/show]
        body: TABLE → table toolbar (count, Columns, Clear filters, SelectionBar, hint) + AttributeTable
              SQL   → QueryPanel (editor, run, history, result CRS chip) | WorkspaceFiles (250 px, right)
    SidePanel (width 300 px default, 240–560 resizable by a sash on its left edge; hidden when closed)
      header: title (Style | Feature details | Basemap) + close
      body:   LayerStylePanel (embedded) | FeatureInspector (embedded) or empty state | BasemapPicker (embedded) + "More basemaps…"
    ActivityRail (44 px): [Style] [Details] [Basemap]   (active indicator on the right edge, dot badge on Details)
  dialogs: ExportDialog, MapImageDialog, BasemapGallery
```

### T050: New components
1. **`packages/ui/src/ActivityRail.svelte`:**
   - props `active: 'style' | 'details' | 'basemap' | null`, `badge: { details?: boolean }`, `disabled: { style?: string | null }` (a reason string, shown as the tooltip; PMTiles disables Style), and `onSelect(panel)`;
   - each button is 44×44 with an `Icon` (`paint`, `info`, `layers`) and `aria-pressed`;
   - clicking the active one calls `onSelect(null)`, which collapses the panel, as in VS Code;
   - `role="toolbar"`, `aria-orientation="vertical"`; arrow keys move focus between buttons.
2. **`packages/ui/src/SidePanel.svelte`:**
   - props `title`, `width`, `onResize(width)`, `onClose`, and children (a snippet);
   - the left edge is a `role="separator"` sash (copy the pointer and keyboard logic from `ViewerLayout`'s col-sash);
   - Escape inside the panel closes it and returns focus to the rail button.
3. **`packages/ui/src/BottomPanel.svelte`:**
   - props `tab: 'table' | 'sql'`, `onTab`, `collapsed`, `onToggleCollapsed`, `maximized`, `onToggleMaximized`, plus snippets `actions`, `table` and `sql`;
   - the tab bar is 35 px high, with uppercase 11 px labels and an active underline in `--se-accent` (match VS Code's panel tabs);
   - tabs use `role="tablist"`/`tab`/`tabpanel`; arrow keys switch tabs.
4. **`packages/ui/src/SearchBox.svelte`** (phase 10 fills in the search logic; here it is the shell):
   - an input with a search icon, 300 px wide, styled as a map widget (`--se-control-bg`, `--se-control-border`, `--se-shadow-card`);
   - a results dropdown with groups;
   - it replaces the separate Search places button and popover. Remove the search button from `MapView`'s controls. `PlaceSearch.svelte`'s logic moves into SearchBox in phase 10; until then, SearchBox shows only the place search to keep the feature working.
5. **`packages/ui/src/LayerPicker.svelte`:**
   - for files with several layers (today's `LayerList`): a compact `<select>` labelled `Layer`, next to the search box;
   - it calls `store.switchLayer(name)` and is disabled while busy;
   - delete `LayerList.svelte` after moving its tests' selectors.
6. **`packages/ui/src/WorkspaceFiles.svelte`:** in this phase, a list with only the open file (`(layer)`); phase 9 fills it. Clicking a row inserts its SQL name at the editor cursor. `QueryPanel` exposes `insertText(text)` (it has `focusEditor()`; add `insertText` on the CodeMirror view at the selection).

### T051: Embed the existing panels
1. `LayerStylePanel.svelte`, `FeatureInspector.svelte` and `BasemapPicker.svelte` each render their own header and close button (they were popovers). Add a prop `embedded = false`. When true, they render no header or close button, no popover border or shadow, and fill the width. Keep their content and behavior unchanged.
2. **FeatureInspector empty state** in the side panel: `Click a feature on the map or a row in the table to see its attributes.`
3. **Details auto-open rule** (the selection handler in the new layout):
   - a map click or table row selection opens the side panel on Details if the panel is closed or showing Details/Basemap;
   - if it is showing Style, it stays on Style and sets `badge.details = true`;
   - opening Details clears the badge.
4. Remove from `MapView`'s control group: the `Layer style` button, the `Search places` button and the `Basemap` button, plus the `openPanel`/`onTogglePanel`/`styleUnavailable`/`placeSearch` props. Keep zoom, fit, globe, map image and reset view.

### T052: Rewrite `ViewerLayout.svelte` to the target structure
- **State to keep and persist** (load on mount, save on change, through `hostAdapter`):
  - store-level `saveState('layout', { sideOpen, sideTab, sideWidth, bottomTab, bottomCollapsed, bottomFraction })`.
  - Add `layout` state and setters to the store, so both shells share it. The VS Code webview keeps it in `globalState` (all files share the layout), as `blankColor` does.
- **Defaults:** side panel closed; bottom panel open on Table at 32%.
- **Running a query:** after `runQuery`, if the outcome is a `result`, switch the bottom tab to Table.
- **Keyboard:**
  - `Ctrl/Cmd+Shift+Q` opens the bottom panel on SQL and focuses the editor (keep the existing shortcut);
  - `Escape` closes the side panel when focus is inside it.
- **Narrow layout:** when the viewer is under 720 px wide, the side panel overlays the map (absolute, right: 44 px, full height, shadow) instead of shrinking it.
- **Export button:** moves into the bottom panel's tab-bar actions. Keep `aria-label="Export data…"`, its disabled reason, and focus return after the dialog closes.
- **Map resizing:** the map must resize once after the panels change size. MapView observes its container already; with `resizing` set during drags, so keep passing `dragging`.
- **Web shell:** `apps/web/src/App.svelte` passes `mapOverlay` with its status bar. Keep that working, or move the status bar below the workbench as a full-width row if that is simpler and looks like VS Code. Screenshot both and pick the cleaner one; the mockup puts it at the bottom.

### T053: Tests and screenshots
1. Update the Playwright selectors that changed:
   - `openQueryPanel` in `helpers.ts` (still `Ctrl+Shift+Q`);
   - the style panel opener (now `getByRole('button', { name: 'Style' })` on the rail);
   - the basemap opener;
   - `layers.spec.ts` (LayerPicker);
   - `place-search.spec.ts` (SearchBox).
2. Do the same in the VS Code suite (`style.test.ts`, `layers.test.ts`). Most of those use test commands, not selectors, so check them.
3. **New `tests/web/specs/layout.spec.ts`:**
   - the rail toggles the side panel;
   - the active rail button collapses it;
   - the Details badge appears when a feature is clicked while Style is open;
   - the bottom tabs switch with arrow keys;
   - maximize and restore work;
   - layout state persists across reload (web localStorage);
   - at 700 px width, the side panel overlays the map;
   - an axe scan passes.
4. Run `npm run screenshots` and look at every image in `screenshots/`, in light, dark and high contrast. Fix any misalignment before committing.

**Commit:** `Spec 010: layout Option A (activity rail, side panel, bottom panel tabs, floating search)`

---

## Phase 9: SQL across workspace files

### T060: Host API
Add to `HostAdapter`:
```ts
/** Spec 010: a data file the user can reference in SQL, by its path relative to the workspace root. */
export interface WorkspaceFile { path: string; size: number }

/** Data files under the workspace root (VS Code) or added by the user (web). Paths use '/'. */
listWorkspaceFiles?(): Promise<WorkspaceFile[]>
/** The engine source for each path (primary + same-basename sidecars), or why it can't be read. */
resolveWorkspaceFiles?(paths: string[]): Promise<Array<{ path: string; source: FileSource } | { path: string; error: string }>>
/** Web: lets the user add files (picker); VS Code omits it. */
addWorkspaceFiles?(): Promise<WorkspaceFile[]>
onWorkspaceFilesChanged?(cb: () => void): () => void
```

### T061: VS Code host
1. **`listWorkspaceFiles`** (`extension.ts`, message `listWorkspaceFiles`):
   - root = `vscode.workspace.getWorkspaceFolder(documentUri)?.uri`, or the document's folder when none;
   - `vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*.{geojson,json,shp,gpkg,fgb,flatgeobuf,parquet,geoparquet,csv,gml,sqlite,db}'), '**/{node_modules,.git,.venv,dist,out}/**', 5000)`;
   - return the paths relative to the root (`path.posix`, with `/`) and their sizes (`fs.stat`);
   - sort by path;
   - send `workspaceFilesChanged` when a `FileSystemWatcher` on the same glob fires, debounced 500 ms.
2. **`resolveWorkspaceFiles`** (message `resolveWorkspaceFiles`, with `paths: string[]`). For each path:
   1. reject the path if it is absolute, contains `..` segments or backslashes, or has a scheme;
   2. resolve it with `path.resolve(root.fsPath, p)` and check that the result starts with `root.fsPath + path.sep`;
   3. check that it exists and is a file;
   4. collect same-basename sidecars, using the exact logic of `sendAssetsAndFile` (`.dbf .shx .prj .cpg …`, no `.qml`/`.sld`);
   5. register on the source server under the panel's existing token, with names `ws/<path>` and `ws/<dir>/<sidecar>`.

   - **Source server change:** add `export function addFiles(token: string, files: Array<{ name: string; fsPath: string }>): void` to `sourceServer.ts`. It adds to `entries.get(token).files`.
   - **Check `handle()`:** confirm it decodes the URL segment with `decodeURIComponent`, so `ws%2Fdata%2Flinks.shp` maps to the name `ws/data/links.shp`. If it splits on `/` before decoding, fix it to take everything after the token as one encoded name.
   - **Reply:** `{ path, source: { kind: 'url', name: 'ws/<path>', size, url: reg.urlFor('ws/<path>'), sidecars: [...] } }`.
   - **Non-`file:` schemes** (vscode.dev, remote without forwarding): reply with `{ path, error: 'Joining workspace files needs local file access, which this window doesn't have.' }`.
3. Webview adapter: the two `request(...)` calls, plus a `workspaceFilesChanged` message that calls the registered callback.
4. **Tests** in `tests/vscode-ext/src/suite/source-server.test.ts`:
   - registering `ws/data/x.geojson` serves it with ranges;
   - `../` paths are refused.

   And a new `workspace-sql.test.ts`:
   - with the fixtures folder as the workspace, open `sample.geojson`;
   - run `SELECT count(*) AS n FROM ST_Read('multi-layer.gpkg', layer := '<a layer name>')` through the `_runQuery` command → a count;
   - run a spatial join between `layer` and `ST_Read('sample.shp')` → rows.

   The test workspace is set up in `tests/vscode-ext/src/runTest.ts`; read it to see which folder is open.

### T062: Web host
1. Add a module-level `workspaceFiles = new Map<string, File[]>()` in `apps/web/src/hostAdapter.ts`, keyed by primary file name, holding the primary file plus its sidecars (reuse `isLikelySidecar` and `primaryOf`).
2. `addWorkspaceFiles()` opens `<input type="file" multiple>`, groups the chosen files by basename, adds them, and notifies listeners. Dropping files on the SQL tab (WorkspaceFiles area) does the same; use `provideFiles`-like plumbing from `App.svelte`.
3. `listWorkspaceFiles()` returns the open file's name plus the added names.
4. `resolveWorkspaceFiles(paths)` returns `{ kind: 'handle', name: 'ws/<name>', handle: file, sidecars }` for known names, and `{ error: 'Add <name> to the workspace first (SQL tab, Add files…).' }` otherwise.
5. **Test** (`tests/web/specs/workspace-sql.spec.ts`):
   - open `sample.geojson`;
   - in the SQL tab, add `sample.gpkg` through the file input;
   - run `SELECT count(*) AS n FROM ST_Read('sample.gpkg')` → the count matches.

### T063: Core — make referenced files readable before a query runs
1. **`packages/core/src/sql/workspacePaths.ts`:**
   - `export function referencedPaths(sql: string): string[]` uses the existing `tokenize` from `sql/scanner.ts`;
   - collect every **string literal token** whose text, after unescaping `''`:
     - ends (case-insensitive) with a data extension in the list from T061;
     - is relative: no `://`, no leading `/` or `\`, no drive letter, no `..` segment;
     - is not already under `/se-source/`;
   - **unit tests** in `tests/core/workspace-paths.test.ts`:
     - `ST_Read('data/a.shp')` → `['data/a.shp']`;
     - `'x.csv'` in a comparison is still returned (harmless: resolving a missing file just fails later);
     - `'/etc/passwd.csv'` → `[]`;
     - `'../x.shp'` → `[]`;
     - a literal inside a comment is ignored (the tokenizer handles comments; check that).
2. **`QuerySession`:**
   - `setWorkspace(resolver: (paths: string[]) => Promise<...>)` is set by the store from `hostAdapter.resolveWorkspaceFiles`;
   - add `private wsRegistered = new Map<string, RegisteredSource>()`.
   - **In `run()`,** after the policy check and before executing:
     1. `const paths = referencedPaths(span.text).filter((p) => !this.wsRegistered.has(p))`;
     2. if there are any, call the resolver;
     3. for each `source`, call `registerSource(db, source)` from `source/register.ts`. Register under `${SOURCE_DIR}ws/` by making the `source.name` the `ws/<path>`. `registerSource` builds `/se-source/<name>`, so `/se-source/ws/data/links.shp` results. Check that `db.registerFileURL` accepts nested paths; S4 confirmed this;
     4. for any `error`, return `{ kind: 'refused', reason: error, statement }` before running.
   - **Make the engine find them:**
     - **if S4 passed:** in `getDuckDb()` (`duckdbService.ts`), add `await conn.query("SET file_search_path = '/se-source/ws'")` immediately **before** `lockDown(conn)`, with a comment citing S4. The user's `ST_Read('data/links.shp')` then resolves;
     - **if S4 failed:**
       1. rewrite each literal in `span.text` to `'/se-source/ws/<path>'` before running;
       2. compute the offset shifts;
       3. map `error.position.offset` back in `toEngineError`. Add an optional `offsetMap` parameter to `parseEngineError`'s context;
       4. **unit-test** the mapping.
   - `dispose()` drops the `ws` files.
3. **The store:** call `qs.setWorkspace(...)` after open. Keep `workspaceFiles: WorkspaceFile[]` state, loaded with `listWorkspaceFiles()` after open and on `onWorkspaceFilesChanged`.
4. **`WorkspaceFiles.svelte`:**
   - a folder tree, grouped by directory;
   - the open file is marked `(layer)`;
   - each row shows the file name and a dim size;
   - a filter input appears when there are more than 30 files;
   - virtualize above 200 rows;
   - clicking a file inserts:
     - for `.parquet`/`.geoparquet`: `read_parquet('<path>')`;
     - for `.csv`: `read_csv_auto('<path>')`;
     - otherwise: `ST_Read('<path>')`;
     - for the open file: `layer`.
   - Web: an `Add files…` button and a drop target.
   - Footer hint: `Click a file to insert it. Paths are relative to the workspace root.` (web: `…to the files you added.`).
5. **Autocomplete (optional, do it last):** inside a string literal, `packages/ui/src/completion.ts` offers workspace paths. Skip this if it takes more than an hour, and say so.

**Commit:** `Spec 010: SQL can read other workspace files by relative path (VS Code) or added files (web)`

---

## Phase 10: Search box (layer values, coordinates, places)

1. **Core:** `QuerySession.searchValues(q: string, limit = 8): Promise<Array<{ id: number; column: string; value: string }>>`
   - runs under `exclusive(…, 'background')`;
   - for each text column of the displayed result (`facts.columns` with a VARCHAR-like type, same regex as `distinctCounts`), builds `SELECT __se_rowid AS id, '<col>' AS column, CAST("<col>" AS VARCHAR) AS value FROM <pageTarget relation> WHERE CAST("<col>" AS VARCHAR) ILIKE '%' || $q || '%' ESCAPE '\'`;
   - `q` is escaped for `%`, `_` and `\`, then quoted as a SQL string;
   - joins the per-column queries with `UNION ALL`, ranks with `ORDER BY (value ILIKE q) DESC, (value ILIKE q || '%') DESC, length(value), value`, and applies `LIMIT ${limit}`;
   - returns an empty list for `q.trim().length < 2`.

   **Unit-test** the SQL builder (`tests/core/search-sql.test.ts`).
2. **`SearchBox.svelte` logic.** On input (debounced 200 ms):
   1. **Coordinates:** `lon, lat` or `lat, lon` with N/S/E/W (reuse any parser in `PlaceSearch.svelte` / `placeSearch.ts`; read them) → a group `Coordinates` with `Go to <lon>, <lat>`;
   2. **Layer values:** `store.searchValues(q)` → a group `In <file name>`. Each item shows the value, with the column name dimmed. Choosing one selects that row (`store.selectFeature(id)`) and zooms to it (`store.zoomToFeature(id)`);
   3. **Places:** only when `placeSearchEnabled` (the existing setting) and after the one-time disclosure (keep `placeSearchNoticeShown` / `markPlaceSearchNoticeShown`). Nominatim results (reuse `placeSearch.ts`) → a group `Places`; choosing one flies there.
   - **Keyboard:** Up and Down move through the results across groups, Enter chooses, Escape clears and closes. Use `role="combobox"` with `aria-expanded` and `aria-activedescendant`, and a `listbox` with `option` items.
3. **Delete** `PlaceSearch.svelte` once SearchBox covers it. Update `tests/web/specs/place-search.spec.ts` to use the search box (Nominatim is mocked there with `page.route`; keep that).
4. **New test** (`search.spec.ts`):
   - searching a value in `world-boundaries.geojson` (`'Nam'`) finds `Namibia`; choosing it selects the row and opens Details;
   - `-111.9, 40.7` offers Go to.

**Commit:** `Spec 010: one search box for layer values, coordinates and places`

---

## Phase 11: Styling — rules and graduated by expression

Read first:
- `packages/core/src/style/model.ts` (`LayerStyle`, `rendererOf`, renderer kinds);
- `style/resolve.ts`;
- `style/expressions.ts` (`paintFor`);
- `style/qml.ts`;
- `LayerStylePanel.svelte`.

Follow how the `bivariate` renderer (spec 009) was added end to end. It is the closest model: renderer type → resolve → paint → legend → QML/SLD/Mapbox → panel UI → tests.

### Design
1. **A new renderer kind:**
   ```ts
   { kind: 'rules'; rules: Array<{ id: string; label: string; where: string; color: string; visible: boolean }>; elseColor: string; elseVisible: boolean; elseLabel: string }
   ```
   `where` is a SQL boolean expression over the result's columns, e.g. `pop_est > 1e8 AND continent = 'Asia'`. The **first** matching rule colors a feature.
2. **Graduated by expression:** the graduated renderer gets an optional `expression?: string`. When set, it classifies that SQL expression instead of `column`, and `column` is the label shown, defaulting to the expression text.
3. **Validation (core, `style/sqlExpression.ts`):** `checkExpression(text): string | null`:
   - tokenize with `sql/scanner.ts`;
   - refuse `;`, unbalanced parentheses, and the words `SELECT FROM ATTACH COPY INSTALL LOAD PRAGMA CREATE DROP INSERT UPDATE DELETE ALTER SET CALL` as tokens (case-insensitive, outside strings);
   - return a plain message, e.g. `Use a condition on this layer's columns, like pop > 1000.`;
   - then the session checks it against the engine with `SELECT (${expr}) FROM <relation> LIMIT 0` (background work), and turns engine errors into short messages with `parseEngineError`.
4. **How colors reach the map.** MapLibre can't evaluate SQL, so the engine computes a class index per feature:
   - add a hidden computed column `__se_cls` (rules: `CASE WHEN (<r1>) THEN 0 WHEN (<r2>) THEN 1 … ELSE -1 END`) or `__se_val` (expression: `(<expr>)`) to the relation used by `allFeatures`/`tile`, only when the style needs it;
   - `allFeaturesSql`/`tileSql` get an optional `computed: Array<{ name: string; sql: string }>` parameter, which appends `<sql> AS <name>` to the selected attributes (inside the struct for tiles);
   - `paintFor` uses `['match', ['get', '__se_cls'], 0, color0, 1, color1, …, elseColor]` for rules. Graduated-by-expression uses the existing graduated step expression on `['get', '__se_val']`. Find where the graduated expression reads `['get', column]` and pass `'__se_val'` instead;
   - hidden classes (`visible: false`) go through the existing `visibilityFilter` mechanism. Make it understand `__se_cls`;
   - **refetch:** in GeoJSON mode, a change to the rules or expression changes the computed columns, so `refreshDraw()` must re-run `allFeatures` when the computed-column SQL changes. Keep the comparison cheap: compare the joined SQL strings. In tiles mode, the computed SQL becomes part of the tile key hash.
5. **Statistics:**
   - **rules:** one query `SELECT cls, count(*) AS n FROM (SELECT CASE … END AS cls FROM <statsRelation>) GROUP BY cls` gives each rule's count, shown in the legend and panel;
   - **graduated by expression:** run the existing graduated statistics over `(SELECT *, (<expr>) AS __se_val FROM <statsRelation>)` with column `__se_val`. The `resolveStyle` code takes a relation and column names, so pass the derived relation.
6. **Panel UI** (`LayerStylePanel.svelte`): the renderer selector gets a `Rules` option.
   - **Rules editor:**
     - a list of rows, each with: a color swatch (existing color input), a `where` text field (monospace, validated on blur with the message under the field), an optional label field, a count, and a remove button;
     - `Add rule` and an `Everything else` row (color, plus a show/hide toggle);
     - reorder with up and down buttons, or drag. The buttons are simpler and accessible; use them.
   - **Graduated:** the Value select gets a last option `Expression…`. Choosing it shows a monospace input with the hint `A SQL expression over this layer's columns, e.g. gdp_md * 1e6 / pop_est`.
   - **Suggestions:** when Rules is chosen with no rules, prefill two example rules from the data: the first numeric column `> its median`, and the first text column `= its most common value`. Get the values from existing statistics.
7. **Legend:** rules show each rule's label (or its `where` text, truncated to 40 characters) with its count, then `Everything else`. Make sure the map-image legend (`legendSpec` in `ViewerLayout`) includes them.
8. **Style files:**
   - **QML (`style/qml.ts`):** write a QGIS `RuleRenderer` with one rule per rule. `filter` is the `where` text as is (QGIS expressions use the same `"col" > 5 AND name = 'x'` syntax for simple comparisons), `label` is the label, and the symbol is a fill, line or marker of the rule's color, chosen by geometry type (copy how bivariate writes its RuleRenderer). The `ELSE` rule uses `filter="ELSE"`. Store the full renderer JSON in the custom property `spatialExplorer/rules`, as bivariate does with its own property, so a round trip is exact. On import, prefer the custom property; otherwise read RuleRenderer rules back into `rules`.
   - **SLD and Mapbox:** export the rules only when every `where` is a simple comparison chain (`col op literal` joined by AND/OR, op ∈ `= != <> < <= > >= LIKE`). Write a tiny parser for that subset in `style/simpleWhere.ts` and test it. Translate each rule to an SLD `ogc:Filter` / a Mapbox `case` branch. When any rule isn't simple, export without the rules (single color) and show the notice `Rules with complex conditions are only kept in QML.` through the existing mechanism (`previewExportNotice` in `interchange.ts`).
   - **Graduated by expression:** QML writes the expression as the renderer's `attr` (QGIS accepts expressions there); SLD and Mapbox can't express it, so show the same kind of notice.
   - **Interop check:** use PyQGIS at `C:\OSGeo4W`, the oracle for QML. Run `cmd //c "C:\\OSGeo4W\\bin\\python-qgis.bat script.py"` from Git Bash. Write a script that loads an exported rules QML onto `world-boundaries.geojson` and prints the rule count and filters. Follow the existing QGIS checks in `tests/qgis/` and how they are run.
9. **Tests:**
   - **core:** `checkExpression`, CASE SQL building, paint expression shape, QML round trip, and the `simpleWhere` parser;
   - **web:** create two rules on `world-boundaries.geojson` (`continent = 'Africa'`, `pop_est > 100000000`) → the legend shows both with correct counts (compute the expected numbers with a first-match `runRaw` query in the test rather than hard-coding them), the map colors match, and an invalid rule shows its error without breaking the map;
   - **graduated by expression:** `gdp_md * 1e6 / pop_est` produces classes;
   - do all of this in both GeoJSON mode and tiles mode (`tileRows=10`).

**Commit:** `Spec 010: rule-based styling and graduated by SQL expression (QML round trip, SLD/Mapbox when simple)`

---

## Phase 12: Final gates

1. Run all suites (ground rule 3). Everything passes.
2. **Performance, written into `research.md` as a table:**
   - **open time and pan smoothness** at 6× CPU throttle in Playwright:
     - `parcels-10k.geojson` (GeoJSON mode): no long task over 200 ms during 5 pans;
     - `tests/.large-data/parcels-230k.geojson` (tiles mode): the median tile time and the longest main-thread task during 5 pans;
   - **open time** for the same two files in the VS Code test suite (`performance.test.ts` exists; extend it);
   - compare with the numbers recorded for spec 007 in `specs/007-viewport-loading/research.md`.
3. **Screenshots:** `npm run screenshots`. Look at all of them in light, dark and high contrast.
4. Update `README.md` and `CHANGELOG.md` (`[Unreleased]`) with the user-visible changes:
   - faster maps;
   - Load all;
   - More basemaps with API keys;
   - the new layout;
   - SQL across workspace files;
   - the search box;
   - rules and expression styling;
   - FlatGeobuf is now read whole.
5. Leave `specs/010-redesign/research.md` with every spike and measurement.
6. **Stop.** Tell the user what was done, the measurements, anything skipped and why, and that the branch is ready for them to try. Do not merge or push.

---

## Appendix A: Decisions already made (do not reopen them)

| Topic | Decision |
|---|---|
| Framework | Stay on Svelte 5. No React. |
| Engine | DuckDB-WASM 1.33.1-dev65.0 (DuckDB 1.5.6) with v1.5.6 extensions. Move GDAL export formats, SQLite reading and xlsx to the engine wherever spikes S7–S9 show they now work. |
| Layers | One layer on the map. No layer list panel. Multi-layer GeoPackages: a Layer picker. |
| Tiling trigger | ≥ 100,000 rows, or the opened file ≥ 100 MiB (default view only). Silent. "Load all" in the status bar. |
| Tile feature limit | 50,000 features per tile (low-zoom tiles of huge files show a subset; accepted, as in GeoLibre). |
| FlatGeobuf | Always read whole. |
| Whole-read announcement | Kept for whole-read files over 100 MB. |
| GeoPackage fid | Row number when ids are 1..N; sql.js only when needed; never fatal. |
| Basemaps | Featured list + "More basemaps…" modal; one basemap at a time; no overlays or stacking; no Chinese providers, Google, Mapbox, Amazon, traffic, labels or 3D. |
| Keys | VS Code SecretStorage; web localStorage; never in reactive state, logs or saved state. |
| Layout | Option A (activity rail, one side panel, bottom panel with Table and SQL tabs, floating search, legend on the map). |
| Multi-file SQL | VS Code: paths relative to the workspace root. Web: files the user adds, by name. |
| Styling additions | Rules (SQL conditions) and graduated by expression. |

## Appendix B: Known risks and what to do

| Risk | What to do |
|---|---|
| ST_AsMVT is slow on huge non-Parquet files (whole-read table scans per tile). | The bbox columns prefilter rows. If tiles are still slow, record it and propose building an R-tree index on `__se_source` after open (DuckDB spatial `CREATE INDEX … USING RTREE`) to the user. Do not build it without asking. |
| Tile requests pile up during fast zooming. | The queue drops aborted requests before running them; MapLibre aborts tiles that leave the view. |
| A basemap style uses `mapbox://` URLs. | Mapbox is excluded. If another provider does this, exclude that entry in the generator and note it. |
| CSP blocks a gallery basemap's sprite or glyph host. | The generator collects hosts from keyless style JSON; the CSP test checks the catalog hosts. A missed host shows as a basemap failure notice (graceful). Add the host to the generator's fixed map. |
| `file_search_path` doesn't work for GDAL (`ST_Read`). | Use the literal-rewrite fallback (phase 9, T063). |

## Appendix C: Noted for later (do NOT implement in this plan)

The user wants to finish improving the current features first (2026-10-12). These are ideas for later specs:

| Idea | Notes |
|---|---|
| `h3` and `a5` extensions (community, v1.5.6 wasm builds exist) | Hexagon and equal-area binning in SQL. Would back the aggregation ideas below. |
| `fts` extension | Full-text search over attribute columns, which could power the search box on large files. |
| `iceberg`, `vss`, `inet`, `lindel` extensions | Available, but of little use while network access is locked down. Skip unless asked. |
| Heat maps | A MapLibre `heatmap` layer for point data (a new renderer). |
| Bubble aggregation (proportional symbols over bins or clusters) | Aggregate in SQL (grid, H3 or clusters), then draw sized circles. |
| OMX to flow maps | Read OpenMatrix (OMX, HDF5) origin–destination matrices and draw flows (lines sized by volume) between zone centroids. Related to the user's own omx-viewer. |
