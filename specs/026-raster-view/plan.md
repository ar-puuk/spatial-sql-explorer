# Implementation Plan: Raster view and inspect

**Branch**: `026-raster-view` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)
**Evidence**: [research.md](research.md) §4 to §7 (Chrome spike, harness in `spikes/`), codebase map taken 2026-10-26 (line numbers below are from HEAD `e3ca62c`).

## Summary
A GeoTIFF or COG opens as the one layer on the map, replacing any vector layer. It is drawn by `cog-tiler-wasm` through a MapLibre `addProtocol` handler (`se-raster://`), read by byte ranges (web: a `File` read by slices; VS Code: the loopback range URL). A facts card, a per-pixel readout, a raster style panel (bands, colormap, range, nodata, opacity, histogram) and a color bar sit on top. Vector-only UI is not shown. A striped file is converted to a COG in the browser under a sample limit. The raster engine (two wasm files, 4.6 MB, plus a 6.7 MB converter only when needed) is downloaded from pinned, hash-checked URLs and cached by each shell, like DuckDB-WASM and gdal3.js. The style sidecar is a QGIS raster QML.

## Technical Context
**Language/Version**: TypeScript (strict), Svelte 5, Vite; extension host esbuild. **New runtime dependencies** (all MIT or MIT/Apache-2.0, each justified under principle X): `cog-tiler-wasm` 0.5.0 (the tiler), `whitebox-wasm` 0.6.1 (its wasm core, a peer), `proj4` 2.x, `geotiff` 3.x, `geotiff-geokeys-to-proj4` (peers of the tiler; CRS and the fallback decoder), `geolibre-wasm` 1.7.1 (striped to COG only; lazy). `lerc`, `zstddec`, `pako` are optional peers: add only if a test needs them (LERC, ZSTD files); until then the notice says the compression is not supported. No React, no deck.gl.
**Storage**: the style sidecar (`<basename>.qml`) beside the data; `HostAdapter.saveState('raster:<stateKey>')` for the same style when no sidecar can be written (web). Engine files in each shell's cache through `HostAdapter.engineFile`.
**Testing**: vitest in `tests/core`; Playwright in `tests/web` (run with `npm run test:web:chrome`, per the memory note that bundled browsers are blocked); mocha with `@vscode/test-electron` in `tests/vscode-ext`; QGIS read-back in `tests/qgis/` for the QML.
**Target Platform**: web app (Chrome, Firefox, Safari) and VS Code webview (desktop, Remote-SSH, WSL; vscode.dev if it works, not promised).
**Project Type**: monorepo (`apps/web`, `apps/vscode-ext`, `packages/core`, `packages/ui`, `tests/*`).
**Performance Goals**: spec SC-001 to SC-006. Measured baselines (research §4): first view 214 to 300 ms and 0.14% of an 8.8 GB COG read; open 15 ms; hover `point()` 4 to 10 ms; striped to COG 17 s at 100 M samples.
**Constraints**: no whole-file read for a first view (the VS Code whole-file fallback must never run for a raster); JS heap about 2 GB for the largest allowed conversion; `script-src 'wasm-unsafe-eval'` without `unsafe-eval`; no network except the pinned engine files and basemaps (principle IV).
**Scale/Scope**: GeoTIFF/COG up to several GB with overviews; 1 to a few dozen bands; one raster at a time.

## Constitution Check
Gate: the current constitution (1.7.0) does not allow this feature without an amendment. Principle I lists "raster analysis" as out and has no raster view. The amendment is task T001 and is a blocking first step (Governance: scope changes are a dedicated amendment, never absorbed in a feature).

| Principle | Status |
|---|---|
| I Scope Discipline | **Amend (v1.8.0, MINOR)**: raster VIEW and STYLE are LOOK and STYLE; the raster is the open layer and replaces vector (user decision 2026-10-26); raster analysis, raster in SQL, vector over raster and several rasters stay out. |
| II Host-agnostic core | Pass. Raster code in `packages/core/src/raster/` is pure (types, style, QML, stats helpers). The tiler glue lives in `packages/ui/src/raster/` and receives a `File` as `unknown` or a URL string through `FileSource`, like the engine does today. No `vscode`, no `FileReader`, no `localStorage`; the lint rule is unchanged. |
| III Native VS Code feel | Pass. New panels reuse the kit and tokens; the color bar and histogram read colors from tokens or are data colors. |
| IV Local-first and private | **Amend**: the raster engine is downloaded once from pinned, hash-checked URLs (jsDelivr npm paths, already allowed) and kept by each shell; the converter only when a striped file is opened. No file content, name or path leaves the machine (the tiler makes no requests; checked). |
| V Bounded resources | Pass with limits: ranges only; striped conversion capped at 100 M samples (warn at 40 M); a file with no overviews over 16.7 M samples is not drawn zoomed out (message). |
| VI Verified claims | Chrome spike done. **VS Code webview spike is T002 and gates all VS Code work.** Untested items stay listed in research §5 and are not claimed in docs. |
| VII Accessibility | Pass by design: every control from the kit with names; the card and pixel readout are text; color is never the only cue (values and class names are shown as text). |
| VIII Clean-room | GeoLibre is MIT: adaptations carry `// Adapted from GeoLibre` and entries in THIRD-PARTY-NOTICES.md. Reference files: `cog-imagery.ts`, `raster-info.ts`, `raster-histogram.ts`, `raster-palette.ts`, `cog-convert.ts`. `maplibre-gl-raster` and deck.gl are not used. |
| IX Testing | Core, web and extension tests per the strategy below. |
| X Simplicity | One reader, one new store concept (`layerKind`), no new panel framework. The five new npm packages replace what would otherwise be a hand-written COG reader, a CRS library and a TIFF decoder. |

Re-check after design: the design adds no second map layer and no query path for a raster; passes once T001 lands.

## Design

### D1. The layer model: a raster is a `Layer` with `raster` facts
The codebase has no layer kind (codebase map §0.3, §10.2). Making `Layer` a discriminated union would touch every consumer of `columns`, `geometryType` and `source` (status bar, count label, VS Code load report, print blocks). The smaller, safer change follows the PMTiles precedent (`packages/ui/src/pmtilesSource.ts:47-104`, `viewerStore.svelte.ts:2042-2056`):
- `Layer.raster?: RasterFacts` (see data-model.md). When set, the other fields are neutral placeholders (`geometryType: 'none'`, `columns: []`, `rowCount` and `featureCount` 0, `extent` = WGS84 bounds so zoom to layer works).
- The store gains `layerKind: 'vector' | 'raster'` (`$derived` from `layer.raster`) and `capabilities` (one object: `query`, `table`, `filters`, `search`, `selection`, `shapes`, `grid`, `time`, `exportRows`, `vectorStyle`, `rasterStyle`, `print: {tables, atlas}`), `$derived` from it. `tilesOnlyReason` (PMTiles) stays; raster uses `capabilities` and PMTiles is moved onto it only if it is a small diff.
- No `store.session`/`querySession` for a raster (null); everything that needs it already null-checks it (PMTiles and the empty state).

### D2. Opening: a branch before teardown, so a failure keeps the previous layer
`openFileOnce` always ends in DuckDB (§1), so the raster branch lives in the store's `load()` next to the PMTiles check (`viewerStore.svelte.ts:2042`), selected by `isRasterName` (`.tif`, `.tiff`; added to `READ_MODES` as format `'geotiff'`, `source/readModes.ts:36-51`) and not by content (a `.tif` with no GeoKeys fails with a clear message).
- **Prepare first, tear down second** (new for raster; the spec's "leave the previous layer on failure"): `prepareRaster(ref)` gets the `FileSource` with `rangeOnly: true`, loads the engine, opens the COG (or converts a striped file) and builds `RasterFacts`. Only then does `load()` run its existing teardown (`2011-2039`) and install the raster. A failure (engine download, unreadable file, over the sample limit) shows the error and leaves what was on the map. The vector open path is unchanged.
- **`rangeOnly`**: `HostAdapter.getFileSource(ref, { whole?, rangeOnly? })`. With `rangeOnly` the VS Code webview adapter throws if the probe fails instead of calling `requestWholeTransfer` (the base64 transfer of a multi-GB file, `apps/vscode-ext/src/webview/hostAdapter.ts:395-397`). The web adapter is unchanged (a `File` is always range-readable).
- `OpenHooks.onPhase` gets a `preparing` phase text for striped conversion and engine download with progress (`OpenProgress`), and `cancelOpen` an abort for the raster open.
- Teardown additions (§1, §3): drop the raster source and layer, unregister the tile provider (`unregisterTiles`), dispose the `CogSource`.

### D3. Engine delivery (core): `packages/core/src/raster/engine.ts`
- `engineAssets.json` gets a `raster` section: `{ whitebox: {url,sha256,bytes}, cogTiler: {...}, converter: {...} }` (jsDelivr npm URLs of the exact versions). `scripts/engine-assets.mjs` hashes them from `node_modules` (byte-identical to jsDelivr, as for the others) and adds them to `--mirror`.
- **Prune hazard** (§10.7): `engineHashes()` (`engineAssets.ts:21-23`) MUST list the raster hashes, or `pruneEngineFiles(engineHashes())` (`duckdbService.ts:237`) deletes the cached files on the next DuckDB start. Core test pins this.
- `loadRasterEngine(source)`: `fetchVerified` for the two files (the converter is a separate `loadConverterEngine`), then `initWhitebox({ module_or_path: bytes })` and `initTiler({ module_or_path: bytes })` before the package `init()` (idempotent; research §4.1). Same `EngineLoadError{network|integrity}`, same offline message pattern as gdal3.js (`engineAssets.ts:112-124`, `gdalFileRefs`). Does **not** start DuckDB (`prewarm()` runs at startup anyway and is not awaited).
- VS Code: the host's allowlist regex (`extension.ts:193`) already admits jsDelivr; no change. The CSP needs no new host (tiles are produced in the webview and handed to MapLibre as bytes).
- The `EngineSource.mirror` for tests is threaded like the gdal host (`App.svelte:22`, `gdbHost.ts:76`): the engine source object is passed to the raster loader, not read from a global.

### D4. Reading and drawing (UI): `packages/ui/src/raster/`
- `rasterSource.ts` (adapted from `pmtilesSource.ts` and `engineTiles.ts`): `openRaster(source: FileSource, engine) → RasterHandle` (`cog`, `facts`, `stats`), `registerRasterProvider(key, handle, getRender)` adds one MapLibre protocol `se-raster` once and serves `se-raster://<key>/<v>/{z}/{x}/{y}`: a 256 px RGBA tile rendered by `renderTileRGBA` and encoded to PNG by a small pure-JS encoder in core (`fflate` `zlibSync`, 2.75 ms per tile measured; `OffscreenCanvas.convertToBlob` took up to 1 s in one webview run, so no canvas on the hot path). A serial queue, `AbortSignal` support and a 256-entry LRU, as in `engineTiles.ts:9-59`. `<v>` is a version number bumped by a style change so MapLibre refetches (the source is re-added, `replaceDataSource`-style, not mutated).
- Source reading: `FileSource.kind` `'handle'` passes the `File` straight to `openCog`; `'url'` passes the URL string; `'bytes'` is refused for a raster (D2).
- `MapView.svelte`: new props `raster` (`RasterHandle | null`) and `rasterRender` (the resolved render options). A raster `$effect` next to the tiles effect (`1330-1346`) adds source `se-raster` and layer `se-raster` (type `raster`, `raster-opacity`, `raster-resampling: 'nearest'` for class rasters, `'linear'` for continuous). It uses the `se-` prefix (required: `replaceDataSource` and the basemap-error test rely on it, §3), is added to `replaceDataSource`'s hard-coded source list (`628-638`) and is inserted before the first label layer like data layers. Terrain's hillshade goes under it (it is inserted before the first `se-` layer): acceptable and noted in the spec's edge cases; the raster can be made partly transparent.
- Globe and terrain: nothing special; a MapLibre raster source works on both (checked in the web test).
- **Hover and click**: `mousemove` (`774-787`) adds a throttled (50 ms, latest wins, one in flight) `cog.point(lon, lat)` when a raster is open; the result goes to `store.setPixel` and shows in the coordinates readout control, the status bar (`StatusFields.pixel`, new optional field; VS Code status bar text is built at `extension.ts:601-606`), and the context menu copy. `click` copies lat, lon and values. No pixel read when the cursor is outside `layer.extent`.

### D5. Facts, statistics, histogram (core + UI)
- `core/raster/info.ts` (adapted from GeoLibre `raster-info.ts`): from `cog.info()`, `levels`, `crsLabel`, `geotiff_info`-style header fields (when the converter engine is not loaded, from the tiler's own header; CRS code and units come from the GeoKeys through `geotiff-geokeys-to-proj4`, since `CrsInfo` today only has `{label, isWgs84}`; `CrsInfo` gets optional `code?`, `units?` and the raster card reads them).
- **Statistics**: `cog.statistics({maxSize})` takes the coarsest level at or under `maxSize` (research §4.6b). The plan picks the level itself: call with a `maxSize` that selects a level of at least 512 px on the long side (or the largest level if none), and for a file whose only overview is tiny, falls back to a window read of the current view (`cog.bbox` with `maxSize 1024`, `preview`). Defaults: percentiles 2 and 98 from the histogram it returns; the histogram has the tiler's bin count (256, to confirm in T010).
- `RasterHistogram.svelte` (adapted from GeoLibre `raster-histogram.ts`), drawn with the existing `style/ValueHistogram.svelte` where it fits, markers for low and high.

### D6. Style: `RasterStyle`, one panel, QML sidecar
- `core/raster/style.ts`: `RasterStyle` (data-model.md), defaults from the facts (`defaultRasterStyle`: 3 bands of 8 or 16 bit with RGB color interpretation or no color table → `rgb` bands 1,2,3 with a 2 to 98 percent stretch per band; a color table → `paletted`; otherwise `single` band 1, colormap `viridis` (or `gray` for a one-band 8-bit image), percentile 2 to 98), `toRenderOptions(style, facts)` (the tiler's `RenderOptions`: `bidx`, `min`/`max` or `rescale`, `colormap`, `reversed`, `stretch`, `nodata`, `opacity`).
- `RasterStylePanel.svelte`: a separate component, shown by `ViewerLayout`'s side-panel switch (`layout.sideTab === 'style'`) when `layerKind === 'raster'`; `LayerStylePanel` is not extended (it is 2,191 lines of vector logic). Sections: Appearance (type, bands, opacity), Range (min, max, stretch, histogram), Colors (colormap picker with preview strips via the tiler's `colorize` or our `style/ramps.ts` where the names coincide, reverse), Nodata. Reuses `kit/*` (`Segmented`, `Select`, `RangeSlider`, `NumberField`, `Switch`), `RampPicker` if its data shape fits, `style/SaveStyleButton`. A style change debounces 80 ms, bumps `<v>` and re-adds the source (SC-003).
- Labels rail panel: hidden for raster (there is no data to label); `layout.sideTab` falls back to `style` (`readLayout` already falls back for unknown tabs).
- **Sidecar** (`core/raster/qml.ts`): write a QGIS raster QML (`<pipe><rasterrenderer type="singlebandpseudocolor|multibandcolor|paletted|singlebandgray">`, `<rasterTransparency>`, `<brightnesscontrast>` omitted) plus our own JSON in a `spatialExplorer/raster` custom property, as the vector sidecar does; read QGIS-only files by the renderer type. `style/index.ts` `importStyle` routes by content (`<rasterrenderer` → raster; `<renderer-v2` → vector) before `qmlToStyle` (which throws on a raster QML, `qml.ts:1331`), and `exportStyle` is bypassed for a raster. A vector-style sidecar beside a `.tif` is ignored with a note. Checked against QGIS 4.2 (`tests/qgis/`).
- Persistence: `FileSource.styleSidecar` (read) and `hostAdapter.saveSidecar` / `saveFile` (write), the same as the vector path (`viewerStore.svelte.ts:2159-2198`), through a `saveRasterStyle` action. Web falls back to `saveState('raster:<stateKey>')` for automatic restore (a download is not a restore).

### D7. Hiding vector-only UI (FR-013, FR-015)
One source of truth, `store.capabilities` (D1):
- **Bottom panel is structural** (`ViewerLayout.svelte:410-660`; `BottomPanel.svelte:20-23`). For a raster, `ViewerLayout` omits the sash and the bottom pane and lets `.map-pane` fill, and shows the raster card as a floating panel/side section, not in the bottom pane. This is a layout branch, not a tab change.
- `MAP_CONTROLS` rows get an optional `layerKinds` (default both); `search`, `draw`, `measure`, `select`, `binCells`, `dotDensity`, `timeSlider`, `tooltip` are vector-only. `controlsAt(prefs, position, available)` already takes a predicate (`mapControls.ts:172-174`): MapView and `MapControlsPanel` pass `capabilities`. Saved preferences drop unknown ids, so no migration; a raster simply does not offer them. `tests/core/map-controls.test.ts` and `map-controls-014.spec.ts` get cases.
- Hidden: query panel and snippets, table, column filters and chooser, selection bar, shape bar, export-rows dialog, grid and dot dialogs, time slider, layer picker (GTFS), feature inspector, hover tooltip, Labels rail panel, `ReadWholeDialog` and the other vector dialogs. The layer area (`LayerPicker` slot, top left) shows a small "Raster" label with the file name and a button for the card; the card also says "Queries need a vector layer" (FR-013). The share link carries `raster` style only (no `query`; `applyShare` skips `runQuery`).
- **Print** (`ViewerLayout.svelte:94-169`, `legendSpec`): a raster branch returns a legend with `ramp: {colors, min, max}` (continuous), `rows` with area swatches (paletted) or the three band names (RGB, as a note); the on-map legend (`MapLegend`) gets the same color bar. The info block prefill: the CRS field from the raster's CRS; the data blocks (table, chart) and the atlas are disabled for a raster with a reason (`composer.fields` reads `displayedLayer.columns`).

### D8. Striped GeoTIFF to COG (core + UI)
- `core/raster/convert.ts` (adapted from GeoLibre `cog-convert.ts`; `// Adapted from GeoLibre`): the tiler error "striped, not tiled" is detected by its message (a test pins the wording to the pinned version); `geotiff_info` gives samples; over 100 M samples → message with the limit and a `gdal_translate -of COG` hint; 40 M to 100 M → a confirm (`OpenHooks.confirm`-style, reuse `ReadWholeDialog` wording); under → convert. Reads the file fully (a `File` via `arrayBuffer()`; VS Code: the whole-file transfer is allowed here only, size-checked first, because it is bounded by the sample limit), `CogBuilder` float32 or u8, deflate, 512 px tiles, **our own overview ladder** (factors 2, 4, 8, ... until the long side is at most about 256), keeps EPSG, geo transform, nodata. The COG bytes stay in memory for the session (not written next to the user's data); the notice says a colour table and non-float types are not preserved and how to save a COG (a "Save as COG" is not built: out of scope).
- The converter engine (6.7 MB) is loaded only here (separate `engineAssets.json` entry and `engineFile`).

### D9. VS Code and web shell wiring
- `apps/vscode-ext/package.json`: `*.tif`, `*.tiff` in `spatialExplorer.editor` (priority default; VS Code's Image Preview does not claim them, research §6); the four `when` regexes (`package.json:159, 181, 188, 195`) gain `tif|tiff`; `DEFAULT_EDITOR_EXTENSIONS` (`extension.ts:978`) too. The webview CSP is unchanged (a test pins it, `theme-csp.test.ts`). No raster glue in the host except the extension lists: the file is served by the existing `sourceServer` (note: it answers `application/octet-stream`; the tiler does not care).
- Web: the picker has no `accept` filter; `provideFiles` (`hostAdapter.ts:35-46`) learns `.tfw`, `.wld`, `.aux.xml`, `.ovr` as sidecars (not primary). `Landing.svelte` copy and the error text at `openFile.ts:392,403` list the format. The web test hooks (`__spatialExplorerE2E`) publish `data-raster-ready` and the tile counts (D10), since `data-rendered-features` is vector-only (`tests/web/specs/helpers.ts` `openFile` waits on it).
- `webview/main.ts` `reportLoadState` (131-187) reads `layer.source.features`: gets a raster branch.

### D10. Test strategy and fixtures
**Fixtures** (`scripts/fixtures-026.mjs`, outputs committed under `tests/vscode-ext/fixtures/raster/`, small): generated with the test GDAL (`OSGEO4W_ROOT`, like `fixtures-013`; existing files are kept). Files (each under 1 MB): `dem-4326.tif`, `dem-utm12.tif`, `dem-3857.tif`, `dem-albers.tif`, `dem-stateplane-ft.tif` (COGs, float32, nodata, overviews), `ortho-rgb.tif` (3 bands, COG), `ortho-u16.tif` (16-bit, 4 bands), `classes.tif` (color table), `striped.tif` (not tiled), `no-overviews.tif` (tiled, large dimensions, constant value, sparse: written with GDAL's `SPARSE_OK` so it is tiny on disk), `not-georeferenced.tif`, `world-file.tif` + `.tfw`. A large COG is generated on demand into `tests/.large-data/` by `npm run large-data` (an 8 GB sparse-written file is not committed). `README.md` in the fixtures folder lists provenance.
**Core unit (`tests/core`)**: `raster-style.test.ts` (defaults, `toRenderOptions`), `raster-qml.test.ts` (round trip; a QGIS-written QML fixture; vector QML not mistaken), `raster-facts.test.ts`, `raster-convert.test.ts` (limits, ladder, error-message pin), `engine-assets.test.ts` (new section, `engineHashes()` includes raster, no prune), `map-controls.test.ts`, `capabilities.test.ts`.
**Web (`tests/web`, Chrome config)**: `raster-026.spec.ts`: open each fixture and wait on `data-raster-ready`; position within one pixel against GDAL-computed expectations (point values at known places, SC-005); hover shows all band values and "no data"; style changes update the map and the color bar; vector open replaces raster and back, with vector controls restored; hiding of vector-only controls (SC-007); engine download interception (`page.route('**/engine-mirror/npm/...')`) for offline and integrity failure; striped file converts and says so; over-limit message; `rangeReads` asserts that a large COG reads under 10% (SC-001). Globe, terrain, basemap switch and print (PNG) with a raster open. CPU throttle 6x performance spec in the `performance` project (SC-002, SC-003).
**Extension (`tests/vscode-ext`)**: open `ortho-rgb.tif` and `dem-utm12.tif` through Open With and "Open in Spatial Explorer"; `_getLoadState` raster fields; CSP unchanged; engine files cached with hashed names (`engine-cache.test.ts` list extended); the loopback range requests for a tif; fallback refusal (`rangeOnly`).
**QGIS read-back (`tests/qgis/`)**: QGIS 4.2 loads our `.qml` for each renderer type and gets the same range and colormap.
**Performance** (memory note on responsiveness): profile open, hover and slider drags at 6x CPU throttle; hover must not queue (one in flight); no work on the keystroke path; virtualize nothing new (no large lists).

### D11. Documentation and housekeeping
CLAUDE.md gets a "Raster view (spec 026)" section; THIRD-PARTY-NOTICES.md the new packages and GeoLibre adaptations; the extension README and landing list GeoTIFF; `specs/026-raster-view/removal.md` is not needed (nothing here is a workaround to delete later), but the converter is kept in its own folder so it can go if a tiler reads striped files.

## Project Structure

### Documentation (this feature)
```text
specs/026-raster-view/
├── spec.md
├── plan.md              # this file
├── research.md          # spike A results; webview spike outcome gets added (T002)
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── raster-engine.md   # engine files, init, tile protocol, HostAdapter additions
│   └── raster-style-qml.md
├── checklists/requirements.md
├── spikes/              # throwaway harness for research.md
└── tasks.md             # by /speckit-tasks
```

### Source code
```text
packages/core/src/raster/        # pure: types.ts, facts.ts, style.ts, stats.ts, qml.ts, convert.ts (limits, ladder), engine.ts (hash-checked load + init), index.ts
packages/core/src/engineAssets.json, engineAssets.ts   # + raster section, engineHashes()
packages/core/src/models.ts, hostAdapter.ts, mapControls.ts, source/readModes.ts, style/index.ts, share.ts   # small edits
packages/ui/src/raster/          # rasterSource.ts (protocol, handle), RasterStylePanel.svelte, RasterCard.svelte, RasterHistogram.svelte, ColorBar.svelte, pixel.ts
packages/ui/src/{viewerStore.svelte.ts, ViewerLayout.svelte, MapView.svelte, StatusBar.svelte, ActivityRail.svelte, MapLegend.svelte, print/*}   # kind branches
apps/web/src/hostAdapter.ts      # sidecar extensions
apps/vscode-ext/{package.json, src/extension.ts, src/webview/hostAdapter.ts, src/webview/main.ts}
scripts/engine-assets.mjs, scripts/fixtures-026.mjs
tests/{core,web,vscode-ext,qgis}/...
```
**Structure Decision**: the existing monorepo. Pure logic in `core`, tiler glue and components in `ui` (the PMTiles precedent), shells touched only for extension lists, `rangeOnly` and test hooks.

## Risks
- **VS Code webview** (T002, done: works, see research §5; Remote-SSH untested): the tiler's `fetch` with `Range` from a `vscode-webview://` origin to the loopback server; `proj4` or wasm-bindgen using `eval` (blocked, no `unsafe-eval`); main-thread decode cost. A blocker here moves the VS Code editor to `option` priority and the web shell ships first.
- **Store size**: `viewerStore.svelte.ts` is about 3,200 lines; the raster state goes into its own `rasterState.svelte.ts` module composed into the store, not inline.
- **Hiding UI by omission** touches `ViewerLayout`'s structure (D7); a regression test opens vector, raster, vector.
- **Colormap names and previews**: the tiler's named colormaps are the only ones its `render` accepts; our `ramps.ts` names may differ. Resolve in T-style (use the tiler's list; a custom ramp becomes a 256-step table only if the tiler takes one, otherwise not offered).
- **Style fidelity in QGIS**: QGIS's pseudocolor shader types (continuous, discrete) vs the tiler's; only continuous is written; verified by T-qml.
- **Pinned versions**: error-message detection (striped) and `statistics` level choice depend on `cog-tiler-wasm` 0.5.0 behaviour; each is pinned by a test so an upgrade fails loudly.

## Complexity Tracking
| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Five new npm packages (+1 lazy) | a COG reader with CRS handling and a TIFF decoder | a hand-written reader is far larger and untested; GeoLibre's choice is proven; all MIT |
| `Layer.raster?` with placeholder vector fields | smallest change to a type read in about 20 places | a `Layer` union would force a wide refactor for one kind |
| A layout branch that omits the bottom panel | FR-013 says vector-only UI is not shown, not disabled | PMTiles' disabled-with-notice would contradict the spec and waste half the screen |
