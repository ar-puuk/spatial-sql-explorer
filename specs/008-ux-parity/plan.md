# Implementation Plan: UX Polish and Legacy Parity

**Branch**: `008-ux-parity` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-ux-parity/spec.md`

## Summary

Close every gap with the legacy app, and fix the rough edges users have hit,
without new architecture.

**Style (US1).** The style panel is rebuilt around one flow: type, then
column, then classification, colors and appearance, then 3D. It gains:
- a value-distribution chart with the class breaks marked;
- a live ramp preview while browsing ramps;
- a split Save button (QML; a menu for SLD and Mapbox GL).

The style model is unchanged apart from an optional `extrusion` field.

**Table (US2).** A column chooser, remembered per file and layer. Per-column
filters compile to a `WHERE` over the current result, so they cover whole
large files through spec 007's paths. Row checkboxes give a selection held
as ids or as "all matching". Export gains a scope (all / filtered /
selected).

**Several layers (US3).** GeoPackage layers are listed with `ST_Read_Meta`.
One active layer is read as today, and switching re-opens the file on
another layer. Every layer is also a lazy SQL view. File Geodatabase is not
readable in this runtime (research §2), so it gets an honest message.

**Export (US4).** An "Include geometry" switch filters the format list. New
formats:
- **written by the engine**: JSON;
- **written in JS from paged engine output**: FlatGeobuf (the existing
  `flatgeobuf` library), GeoPackage (`sql.js`), zipped Shapefile, KML,
  GeoJSONSeq and Excel (our writers, zipped with `fflate`).

Every GDAL writer still fails in DuckDB-WASM 1.32.0 (research §3).

**Map (US5–US6).**
- A web theme control (System/Light/Dark).
- A globe toggle.
- Satellite, topographic and OSM basemaps.
- Polygon extrusion with tilt and Reset view, saved to QML
  (`<renderer-3d>`) and Mapbox GL (`fill-extrusion`).
- A graduated legend range filter.
- The attribution icon fixed for dark themes.
- Panel handles that reset on double-click.

**Share and present (US7–US8).**
- Map PNG export with the legend and attribution.
- A web share link: query, style, view and file name, never data.
- Bundled sample data.
- Nominatim place search, opt-out and disclosed.

Spikes changed the design (research.md):
- **File Geodatabase has no driver** in the WASM build, and the only JS
  reader fails on current files. It is unsupported, with a message.
- **The engine's xlsx and SQLite writers don't produce usable files.**
  Excel and GeoPackage are written in JS.
- **On the globe, extrusions can't be queried without a point**, so hit
  tests keep a hidden fill under the extrusion.
- **QGIS round-trips extrusion** through the QML `<renderer-3d>` block.

## Technical Context

**Language/Version**: TypeScript (strict), Svelte 5, as before.

**Primary Dependencies**:
- DuckDB-WASM 1.32.0 (v1.4.3) + spatial. Newly used: `ST_Read_Meta`,
  `ST_Read(…, layer=)`, `COPY … (FORMAT json)`, `width_bucket`.
- MapLibre GL JS 6.13. Newly used: `setProjection`, `fill-extrusion`,
  `setPixelRatio`, canvas capture.
- **New runtime dependencies**, justified in Complexity Tracking:
  - `sql.js` 1.14.2 (MIT; 650 KB wasm, loaded only when exporting a
    GeoPackage);
  - `fflate` 0.8.3 (MIT; already installed via `pmtiles` and `flatgeobuf`;
    becomes a direct dependency of `core`).
- Shells: Vite (web), esbuild + VS Code API (extension), unchanged.

**Storage**: none new. Preferences go through `HostAdapter.loadState/saveState`:
- `theme` (web);
- `projection`;
- `columns:<stateKey>[#layer]`;
- `style` per layer;
- `placeSearchNoticeShown`;
- panel sizes.

**Testing**:
- Vitest in `tests/core` (filters SQL, writers, share-link codec, QML/Mapbox
  extrusion, layer listing).
- Playwright in `tests/web` (UI flows, axe, exports read back in the
  engine).
- `@vscode/test-electron` in `tests/vscode-ext` (layers, export formats,
  sample command, image save, CSP).
- `tests/qgis/read_back.py` extended to the new formats.

**Target Platform**: VS Code webview (desktop; Remote/WSL where possible) and
evergreen browsers.

**Project Type**: monorepo, a web app plus a VS Code extension sharing
`packages/core` and `packages/ui`.

**Performance Goals** (spec SC):
- graduated style in ≤3 interactions (SC-001);
- filter on 1M rows ≤3 s, on 10k rows ≤0.5 s (SC-004);
- theme, projection or basemap switch ≤1 s (SC-005);
- 10k extruded polygons with no interaction stall over 200 ms (SC-006);
- PNG export ≤5 s (SC-007);
- sample open ≤3 s offline (SC-008);
- layer switch ≤2 s on files up to 100 MB (SC-009);
- spec 007 timings within 10% (SC-012).

**Constraints**:
- Engine memory 3.1 GiB, and the engine lockdown: no extension loading
  after start.
- Webview CSP: new hosts must be added explicitly.
- Local-first: only typed search text leaves the machine (constitution
  v1.1.0 IV).

**Scale/Scope**:
- 8 user stories and 37 FRs.
- About 12 new UI components or files, 9 new core modules, and changes in
  both shells.

## Constitution Check

*Gate before Phase 0; re-checked after Phase 1. Constitution v1.1.0
(amended 2026-10-11 for this spec).*

| Principle | Status | Notes |
|---|---|---|
| I. Scope Discipline | ✅ | Globe toggle and polygon extrusion are now in scope (v1.1.0). Nothing else 3D. Multi-layer handling is LOOK; export formats are EXPORT; filters and selection are LOOK/QUERY. Excluded: labels, editing, terrain, multi-file sessions (spec 006). |
| II. Host-Agnostic Core | ✅ | Writers, filters, the share codec and layer listing live in `core`; UI controls in `ui`. Theme toggle and share link are web-shell chrome. The VS Code setting and command are in the extension. New HostAdapter needs: `SaveOptions.kind: 'image'`, and an optional `getPreference('placeSearch.enabled')` (contracts). |
| III. Native VS Code Feel | ✅ | New controls use `--se-*` tokens mapped to VS Code tokens. The attribution icon moves to a mask painted with a token (research §11). High contrast is covered by FR-035/SC-013. |
| IV. Local-First and Private | ✅ | Place search sends typed text only, after a notice, with an opt-out (v1.1.0). The share link never holds data or paths. New basemap hosts are tiles only. |
| V. Bounded Resources | ✅ | Filters and selection are SQL over the result (no client-side copies). Writers stream pages. GeoPackage output is capped at 1.5 GB with a message. sql.js is loaded lazily. |
| VI. Verified Claims | ✅ | Every new format, reader and map feature was spiked (research §1–§8). Formats ship only after QGIS/openpyxl read-back in both shells. File Geodatabase is NOT claimed. |
| VII. Accessibility & Keyboard | ✅ | Menu button pattern for Save; grid checkboxes; filter inputs with labels; slider handles with `aria-valuetext`; map tilt and rotate on the keyboard; axe in light/dark/HC (SC-013). |
| VIII. Clean-Room References | ✅ | Legacy app (own repo) used for features only. GeoLibre for style-panel decisions, no code. Writers are written from format specs (OGC GeoPackage, ESRI Shapefile whitepaper, OOXML). |
| IX. Testing | ✅ | Each story has core, web and VS Code tests (tasks). |
| X. Simplicity | ⚠️ justified | Two dependencies (sql.js, fflate as a direct one), and several small writers. See Complexity Tracking. |

**Post-design re-check (after Phase 1)**: unchanged. The contracts add one
optional HostAdapter method, one `SaveOptions` kind and no new packages.

## Spec amendments made during planning

None to requirements. Research outcomes the spec already anticipated:
- **FR-018 (File Geodatabase)**: the "otherwise" branch applies. The format
  isn't supported in either shell, and both say so with a conversion hint.
- **FR-020 (formats)**: all listed formats are reachable through JS
  writers. Each stays gated on read-back verification.

## Project Structure

### Documentation (this feature)

```text
specs/008-ux-parity/
├── plan.md              # This file
├── research.md          # Phase 0: spikes and decisions
├── data-model.md        # Phase 1: new/changed entities
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── core.md          # core APIs: layers, filters, selection, writers, share codec, style extrusion
│   ├── host-and-shells.md  # HostAdapter changes, VS Code setting/command/CSP, web theme + share
│   └── ui.md            # components, roles, keyboard, test hooks
├── spikes/              # evidence
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── source/
│   ├── layers.ts            # NEW: ST_Read_Meta listing → FileLayer[]; lazy per-layer views
│   └── layerSql.ts          # CHANGED: ST_Read(…, layer=)
├── openFile.ts              # CHANGED: OpenOptions.layer; facts.layers
├── query/
│   ├── filters.ts           # NEW: ColumnFilter[] → SQL WHERE (escaped literals)
│   ├── selection.ts         # NEW: Selection → SQL predicate, extent query
│   └── session.ts           # CHANGED: filtered view over the result; selection extent
├── view/stats.ts            # CHANGED: value histogram (width_bucket bins)
├── export/
│   ├── formats.ts           # CHANGED: new formats, geometry: 'with' | 'without' groups
│   ├── plan.ts              # CHANGED: includeGeometry, scope, per-format forced changes
│   ├── run.ts               # CHANGED: engine vs JS writers, scope WHERE
│   ├── rows.ts              # NEW: paged row source (WKB / GeoJSON / attributes)
│   └── writers/
│       ├── flatgeobuf.ts    # NEW
│       ├── geopackage.ts    # NEW (sql.js, lazy)
│       ├── shapefile.ts     # NEW (+ .shx/.dbf/.prj/.cpg, zip)
│       ├── kml.ts           # NEW
│       ├── geojsonseq.ts    # NEW
│       └── xlsx.ts          # NEW
├── style/
│   ├── model.ts             # CHANGED: LayerStyle.extrusion?
│   ├── qml.ts               # CHANGED: <renderer-3d> read/write
│   ├── mapbox.ts            # CHANGED: fill-extrusion read/write
│   └── sld.ts               # CHANGED: notice when extrusion is dropped
├── share.ts                 # NEW: ShareState encode/decode (fflate + base64url)
└── basemapCatalog.ts        # CHANGED: Esri imagery, OpenTopoMap, OSM rows

packages/ui/src/
├── LayerStylePanel.svelte   # REBUILT: sectioned flow, 3D section
├── style/                   # NEW folder for panel parts
│   ├── RendererChoice.svelte
│   ├── ValueHistogram.svelte
│   ├── ExtrusionSection.svelte
│   └── SaveStyleButton.svelte   # split menu button
├── RampPicker.svelte        # CHANGED: live preview on focus, reverse
├── AttributeTable.svelte    # CHANGED: checkbox column, filter row, hidden columns
├── ColumnChooser.svelte     # NEW
├── ColumnFilter.svelte      # NEW
├── SelectionBar.svelte      # NEW (count, zoom to, show only, clear)
├── LayerList.svelte         # NEW (multi-layer files)
├── MapLegend.svelte         # CHANGED: range filter for graduated
├── RangeSlider.svelte       # NEW
├── MapView.svelte           # CHANGED: projection, extrusion layer, hidden hit fill, reset view, selection state, capture()
├── MapImageDialog.svelte    # NEW (1×/2×, legend on/off)
├── PlaceSearch.svelte       # NEW
├── ExportDialog.svelte      # CHANGED: include geometry, scope, new formats
├── ViewerLayout.svelte      # CHANGED: handle reset, layer list slot, map image action
└── viewerStore.svelte.ts    # CHANGED: filters, selection, layers, projection, columns, share apply

apps/web/src/
├── App.svelte               # CHANGED: theme control, Try sample data, Copy link, link apply
├── hostAdapter.ts           # CHANGED: theme preference, image saves
├── theme.css                # CHANGED: light token set alongside dark
└── public/sample/us-counties.parquet   # NEW

apps/vscode-ext/
├── package.json             # CHANGED: setting placeSearch.enabled, command openSample, .gdb folder command
├── src/extension.ts         # CHANGED: sample command, .gdb message, CSP hosts, image save
└── sample/us-counties.parquet          # NEW (same file)

tests/core/        # filters, selection, writers (round-trip via engine where possible), share codec, layers, qml/mapbox extrusion
tests/web/specs/   # style-panel, table-filters, columns, layers, export-formats, map-image, theme, globe-extrusion, share-link, sample, place-search (stubbed network)
tests/vscode-ext/  # layers, export-formats, sample command, image save, CSP, gdb message
tests/qgis/        # read_back.py: gpkg, fgb, shp zip, kml, geojsonl; check_sidecar.py: renderer-3d
```

**Structure Decision**: same monorepo. All new logic sits in the existing
packages: writers and codecs in `core`, controls in `ui`, chrome in the
shells. The `style/` subfolder in `ui` only groups the panel's parts.

## Delivery order (vertical slices)

Slices follow spec priority. Each ends green in all three suites, with a
commit.
1. **Foundation**: dependencies (`sql.js`, direct `fflate`), the
   `SaveOptions.kind: 'image'` contract, the catalog rows, and the
   attribution icon fix (FR-035). Small and independent.
2. **US1 Style panel**: sections, histogram, ramp preview, split Save.
   This is the MVP of this spec.
3. **US2 Table**: column chooser, then filters, then selection, then export
   scope.
4. **US3 Several layers**: listing, switcher, lazy views, the `.gdb`
   message.
5. **US4 Export**: include-geometry switch and the format list; writers in
   this order: JSON, GeoJSONSeq, KML, FlatGeobuf, Shapefile, Excel,
   GeoPackage. Each is shipped only after its read-back test passes.
6. **US5 Theme, globe, basemaps**.
7. **US6 Extrusion**: style model, map, QML/Mapbox, Reset view.
8. **US7 Map image and share link**.
9. **US8 Sample data and place search**.
10. **Polish**:
    - legacy walk-through (SC-011);
    - axe in light, dark and high contrast;
    - spec 007 timing re-check (SC-012);
    - screenshots, README, CHANGELOG, notices.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New dependency `sql.js` (650 KB wasm, lazy) | GeoPackage export (FR-020): the engine's GPKG and SQLite writers fail in this runtime (research §3) | Writing SQLite pages by hand is far more code and risk; `@ngageoint/geopackage` is 13 MB and includes sql.js anyway |
| `fflate` as a direct dependency | Zipping Shapefile sets and xlsx parts, and deflating share links | Already shipped transitively (pmtiles, flatgeobuf); a direct dependency only pins it. No zip API exists in the platform without `CompressionStream` + our own zip framing |
| Six small JS writers | Spatial and Excel formats the engine can't write in WASM | Waiting for upstream GDAL writing (open since spec 005) leaves FR-020 undelivered |
