# Spatial Explorer: Claude Code + Spec Kit handoff

Contents:
- Part 0: human steps before starting
- Part 1: `CLAUDE.md` (copy into repo root; carries the decisions Claude Code can't otherwise know)
- Part 2: the Spec Kit command sequence with paste-ready prompts
- Part 3: later specs and known unknowns

---

## Part 0: Before you start (human steps)

1. **Preserve the old app.** The repo is being rebuilt in place.
   ```bash
   git status                      # must be clean
   git tag legacy-v1 && git push --tags
   ```
   Spec Kit creates numbered feature branches itself (e.g. `001-quick-look`), so start from a clean `main`.

2. **Put references next to the repo** (read-only, for decisions and conventions, not code):
   ```
   ../omx-viewer          # monorepo convention: apps/web + apps/vscode-ext
   ../_refs/GeoLibre      # git clone https://github.com/opengeos/GeoLibre.git
   ```
   Start Claude Code with the sibling visible: `claude --add-dir ../omx-viewer --add-dir ../_refs/GeoLibre`

3. **Prerequisites:** Node LTS, Python 3.11+, `uv`, git.

4. **Install and init Spec Kit in the existing folder:**
   ```bash
   uv tool install specify-cli --from git+https://github.com/github/spec-kit.git
   specify init --here --ai claude     # newer versions may use: --integration claude
   specify check
   ```
   Flags have changed between releases. Run `specify init --help` and use whatever your installed version documents. The folder is not empty, so expect a confirmation prompt.

5. **Create `CLAUDE.md`** (Part 1) before running any `/speckit.*` command. Spec Kit's plan step may append to an agent context file; keep the section below at the top.

---

## Part 1: `CLAUDE.md` (copy to repo root)

```markdown
# Spatial Explorer

## What this is
A GIS "quick look" tool that ships as BOTH a standalone web app and a VS Code
extension from one codebase. Goal: never open QGIS for basic GIS work.
Scope is exactly: LOOK (open + view), QUERY (SQL), STYLE (thematic), EXPORT.
The VS Code extension is the priority target; the web app is the secondary shell.

The repo currently contains the legacy single-page app (tag `legacy-v1`).
It is being rebuilt, not patched. Use the legacy app only as a feature reference.

## Explicitly out of scope
Feature editing, georeferencing, processing toolbox, print layouts, notebooks/ipynb
integration, plugin system, 3D tiles/globe/planets, raster analysis, stacked
basemaps. Say no to scope creep and flag it instead.

## Product decisions (already made)
- Name: Spatial Explorer. Marketplace display name pattern: "Spatial Explorer: Spatial SQL & Map Viewer"
  (keywords in the display name; id/publisher TBD). Publish to VS Code Marketplace AND Open VSX.
- DuckDB runs as DuckDB-WASM inside the webview (NOT native in the extension host).
  Use the single-threaded bundle (no SharedArrayBuffer; coi-serviceworker is not usable in VS Code webviews).
  Known ceiling: omx-viewer hit a ~512 MB OOM. Design for it (see performance rules).
- Each custom-editor webview owns its own DuckDB instance. Use retainContextWhenHidden for the MVP.
- Do not rely on IndexedDB inside the webview. Persist through the HostAdapter.
- Map: MapLibre GL JS. deck.gl only later, only if needed.
- UI: Svelte 5 + Vite + strict TypeScript (matches omx-viewer). Extension host: esbuild.
- Layout (match omx-viewer's convention; inspect ../omx-viewer first):
    apps/web, apps/vscode-ext, packages/core, packages/ui
  `core` and `ui` MUST NOT import `vscode`, call `acquireVsCodeApi`, or touch File API/IndexedDB
  directly. Enforce with a lint rule. All platform access goes through `HostAdapter`.

## HostAdapter (sketch; refine in the plan)
getTheme/onThemeChange; openFiles; getFileSource (bytes or URL for range reads);
saveFile; loadState/saveState; setStatus (status bar in VS Code, no-op on web).

## VS Code integration (the differentiator)
- `customEditors` with Open With. Priority "default" for .gpkg .fgb .shp .pmtiles .geoparquet;
  priority "option" for .geojson .csv .parquet .json (do not hijack text/data viewers).
- Explorer/editor-tab context menu: "Open in Spatial Explorer" (gated on resourceExtname).
- Folder-based formats (.gdb) cannot bind to a custom editor: use an explorer/context command.
- "Add to Spatial Explorer Session" for multi-file work and spatial joins (separate Session panel).
- Status bar items: CRS, feature count, cursor coordinates. Output channel for query logs/timings.
- Works under Remote-SSH/WSL/Containers where possible; must not break on vscode.dev if avoidable.

## Theming
- Chrome (panels, inputs, tables, buttons) uses VS Code tokens with fallbacks, e.g.
  var(--vscode-sideBar-background, var(--vscode-editor-background)).
- Mapping: bg-base→--vscode-editor-background, panel→--vscode-sideBar-background,
  input→--vscode-input-background, overlay→--vscode-editorWidget-background,
  border→--vscode-panel-border, text→--vscode-foreground,
  secondary text→--vscode-descriptionForeground, muted→--vscode-disabledForeground,
  accent→--vscode-button-background, selection→--vscode-list-activeSelectionBackground,
  hover→--vscode-list-hoverBackground, focus→--vscode-focusBorder,
  fonts→--vscode-font-family / --vscode-editor-font-family.
- Support light, dark and high-contrast (use --vscode-contrastBorder).
- Canvas/WebGL colors (MapLibre paint, selection highlight) do NOT follow CSS variables.
  Read them via getComputedStyle and re-apply on theme change. Observe
  document.documentElement (attr "style") and document.body (attr "class") with a MutationObserver.
- Data colors (choropleth ramps, categorical palettes) are fixed and theme-independent.
- The web shell keeps the omx-viewer brand palette; it uses the SAME token names, with a different token file.
  Tailwind (if used) cannot do alpha on plain var() colors: use color-mix().

## Basemaps
- Catalog is DATA (one table: id, name, type, url template, attribution, requiresKey, region).
  UI renders from it; adding a provider = adding a row.
- Vector: OpenFreeMap styles liberty, bright, positron, dark, fiord at
  https://tiles.openfreemap.org/styles/{name}. dark and fiord may be less complete: verify visually.
- Raster: curated KEYLESS subset using URL templates borrowed from leaflet-providers as data
  (do not depend on leaflet-providers). Expand {s} and {r} ourselves. Show attributions.
  Respect provider usage policies (OSM standard tiles discourage heavy use).
- A BLANK background is a first-class option.
- Default follows VS Code theme kind: positron (light) / dark (dark).
- Picker shows previews (background color first, then a snapshot).
- Failure must degrade gracefully (offline, CSP block, bad key): fall back to blank + short message.
- API keys: non-secret values in settings, secrets in context.secrets (SecretStorage).
- CSP: webview needs img-src/connect-src for style, sprite, glyph and tile hosts; worker-src blob:;
  script-src 'wasm-unsafe-eval'.

## Scale and performance rules
- Never load a whole large file into memory when avoidable. Query by viewport bbox with a feature cap in the MVP.
- Prefer range reads (registerFileURL against asWebviewUri) over posting whole files to the webview. VERIFY first (spike).
- Prefer binary/Arrow transfer between host and webview over JSON.
- Later: serve vector tiles via maplibre addProtocol + ST_AsMVT, if available in the WASM spatial build.
- CRS: read the layer CRS and ST_Transform to EPSG:4326 for display. Plan for this from day one.

## Styling and export
- Styling: single, categorized, graduated (equal/quantile/jenks), inline color-ramp picker with previews, legend.
- Style persistence: sidecar next to the data file. FORMAT IS OPEN: own JSON vs QGIS QML / SLD / Mapbox style JSON
  for interop. Decide in /speckit.clarify, and prefer interop if the cost is moderate.
- Export: via DuckDB COPY/ST_Write: GeoJSON, GeoParquet, CSV, and others only if the WASM build supports them.

## Query UX
Embedded SQL editor first (a native .sql document is a later option). Results become map layers.
Autocomplete from the DuckDB catalog. Docked, resizable panel.

## References: copy DECISIONS and design, never code or assets
- Data Wrangler (MS): right-click "Open in …" entry, grid + side panel, view/edit modes.
- Hex Editor (MS): native-looking custom editor, inspector side panel, status bar items.
- GitLens: dense toolbars/hover cards, theme fidelity. Licensing is mixed: do not reuse assets.
- SQLite Viewer (qwtel): file-as-document, table list + query + grid.
- Built-in Image Preview: minimal canvas chrome, zoom in status bar.
- GeoLibre (opengeos/GeoLibre; same stack): style panel UX, ramp previews, basemap picker with previews,
  data-driven basemap catalog, graceful basemap failure, SQL panel docking, QML/SLD/Mapbox style interchange.
  Read its release notes and docs for what they fixed after launch.
- omx-viewer (own repo): monorepo convention, brand tokens (webapp-theme.md).
- Study webviews with the command "Developer: Open Webview Developer Tools".

## Working rules for the agent
- Spike before building on a risky assumption. Record outcomes in research.md.
- Do not claim a file format is supported until it is tested in the real WASM build.
- Keep spec.md technology-agnostic. Put stack decisions in plan.md.
- Ask before assuming anything listed as OPEN. Prefer small vertical slices.
- Tests: unit tests for core; browser tests for web; @vscode/test-electron for the extension.
```

---

## Part 2: Spec Kit sequence

Run these inside Claude Code, in order. Prompts are ready to paste.

### 2.1 `/speckit.constitution`

```text
Create the project constitution for Spatial Explorer (see CLAUDE.md for context). Principles:

1. Scope discipline: the product does look, query, style and export only. Editing,
   georeferencing, processing toolbox, print layouts, notebook integration, plugins and
   3D/raster analysis are out of scope. New scope requires a constitution amendment.
2. Host-agnostic core: packages/core and packages/ui never import the vscode API, the File
   API or IndexedDB directly. All platform access goes through a HostAdapter. Enforced by lint.
3. Native VS Code feel: chrome follows VS Code theme tokens with fallbacks, supports light,
   dark and high-contrast, and reacts to live theme changes. Data colors are independent of theme.
4. Local-first and private: user data never leaves the machine. No telemetry without explicit
   opt-in. Network is used only for basemaps and, if needed, the DuckDB spatial extension.
5. Bounded resources: single-threaded WASM with a known memory ceiling. Do not load whole large
   files when avoidable, cap rendered features, and fail with clear messages instead of crashing.
6. Verified claims: a file format or capability is "supported" only after being tested in the real
   WASM build. Risky assumptions get a spike and a recorded result before dependent work begins.
7. Accessibility and keyboard: every interactive control is keyboard reachable and labeled.
8. Clean-room references: take decisions and design ideas from reference tools, never code or assets.
9. Testing: core logic has unit tests, the web shell has browser tests, and the extension has
   integration tests. Features are not complete without tests.
10. Simplicity: prefer the smallest design that meets the spec. Justify every new dependency.
```

### 2.2 `/speckit.specify` (spec 001: the vertical slice)

Keep this technology-agnostic. Stack decisions belong in the plan.

```text
Feature: Quick look. Open a geospatial file and immediately see it on a map and in a table.

Users: analysts, data scientists and developers who need to inspect geospatial files without
opening a desktop GIS.

User stories (priority order):
P1. As a VS Code user, I right-click a supported geospatial file (or use Open With, or set it as
    the default viewer) and it opens in a viewer showing the data on a map and its attributes in a
    table. Map and table selection stay in sync. Layer extent is fitted on open.
P1. As a web user, I open a file by picker or drag-and-drop and get the same viewer.
P2. I can see the layer's coordinate reference system, feature count and geometry type, and the
    cursor's coordinates, even when the source CRS is not WGS84.
P2. I get a sensible default basemap that matches the light or dark appearance of the host, and I
    can turn the basemap off (blank background).
P3. I can inspect a feature's attributes by clicking it.

Supported formats to open (to be confirmed against what is actually testable):
GeoJSON, GeoParquet, FlatGeobuf, GeoPackage, Shapefile (with sidecar files or zipped), and
CSV with coordinate columns or WKT. [NEEDS CLARIFICATION: confirmed format list after the
format-support spike]

Edge cases: unsupported or corrupt file; empty file; mixed geometry types; invalid geometries;
multiple layers in one file; missing CRS; very large file [NEEDS CLARIFICATION: target size and
acceptable load time]; file changed on disk while open; host theme changes while open;
no network (basemap unavailable).

Out of scope for this spec: SQL querying, styling beyond a single default style, export,
multi-file sessions, basemap picker.
```

Then run **`/speckit.clarify`** and answer its questions. Settle in particular: the format list, size and time targets, and how multi-layer files should open.

### 2.3 `/speckit.plan`

```text
Use the technology decisions and architecture in CLAUDE.md. Specifically:
- Monorepo matching ../omx-viewer conventions (inspect it first): apps/web, apps/vscode-ext,
  packages/core, packages/ui. Svelte 5, Vite, strict TypeScript. Extension host bundled with esbuild.
- DuckDB-WASM (single-threaded bundle) with the spatial extension, one instance per webview.
- MapLibre GL JS for rendering.
- A HostAdapter interface with a web implementation and a VS Code implementation.
- VS Code customEditors contribution with the priorities listed in CLAUDE.md.
- Theme tokens: one token file per shell, same token names.

Phase 0 (research.md) MUST resolve these four spikes before design is finalized:
1. Which formats can the WASM spatial build actually read (GPKG, SHP, FGB, KML, GeoParquet, GeoJSON)?
   If drivers are missing, propose JS fallbacks and their size cost.
2. Can DuckDB-WASM read large files lazily by registerFileURL against asWebviewUri
   (HTTP range requests), including under Remote-SSH?
3. How is the spatial extension delivered offline (bundled vs CDN), and what is the VSIX size?
4. Worker bootstrapping and CSP in a VS Code webview (worker-src blob:, wasm-unsafe-eval, connect-src).

Deliverables: data-model.md, contracts/ (HostAdapter, host-webview message protocol), quickstart.md.
```

### 2.4 Remaining steps

```text
/speckit.checklist    # optional: requirements-quality checklist (e.g. UX, performance)
/speckit.tasks
/speckit.analyze      # run before implementing: checks spec/plan/tasks consistency
/speckit.implement
```

When implementing, ask Claude Code to:
- run the spike tasks first and stop to report if any spike changes the plan;
- implement phase by phase, not everything at once;
- commit after each task and run tests before moving on.

---

## Part 3: Later specs and known unknowns

Specify each as its own feature after 001 works end to end:

| Spec | Scope |
|---|---|
| 002 | SQL query panel: embedded editor, catalog autocomplete, results become layers, query timing in the output channel |
| 003 | Styling: single / categorized / graduated, ramp picker with previews, legend, sidecar persistence |
| 004 | Basemaps: catalog-driven picker with previews, 5 OpenFreeMap styles, curated keyless raster list, blank, graceful failure, key storage |
| 005 | Export: GeoJSON, GeoParquet, CSV (+ others the WASM build supports), optional map image |
| 006 | Multi-file Session panel for spatial joins ("Add to Spatial Explorer Session") |

Known unknowns I could not verify and have left as open items:
- Which GDAL drivers the WASM spatial build includes (spike 1).
- Whether the VS Code webview resource server supports Range requests, including remotely (spike 2).
- Whether `ST_AsMVT` is available in the WASM spatial build (needed only for later tile streaming).
- The structure of omx-viewer's `apps/` folder: I could not read it. Claude Code should inspect `../omx-viewer`.
- Whether "Spatial Explorer" is available as a Marketplace display name.
- Style sidecar format (own JSON vs QML/SLD/Mapbox): decide in clarify.
- Spec Kit command and flag names drift between versions: trust `specify init --help` over this document.
