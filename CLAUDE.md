# Spatial Explorer

## What this is
A GIS "quick look" tool that ships as BOTH a standalone web app and a VS Code
extension from one codebase. Goal: never open QGIS for basic GIS work.
Scope is exactly: LOOK (open + view), QUERY (SQL), STYLE (thematic), EXPORT.
The VS Code extension is the priority target; the web app is the secondary shell.

The pre-rebuild single-page app is preserved at tag `legacy-v1` (no longer in the tree).
Use it only as a feature reference (`git show legacy-v1:js/app.js`, or check out the tag).

## Explicitly out of scope
Feature editing, georeferencing, processing toolbox, print layouts, notebooks/ipynb
integration, plugin system, 3D tiles/terrain/planets, raster analysis, stacked
basemaps. Say no to scope creep and flag it instead.
Allowed by user decision (2026-10-11, spec 008): a Mercator/Globe projection toggle
(MapLibre's built-in globe, no terrain), and polygon extrusion as a style option
(height from a column). Nothing else 3D. Also allowed (2026-10-11): an opt-out place search
(OpenStreetMap Nominatim) that sends only the typed text, disclosed before first use (constitution v1.1.0).

## Product decisions (already made)
- Name: Spatial Explorer. Marketplace display name pattern: "Spatial Explorer: Spatial SQL & Map Viewer"
  (keywords in the display name). Extension ID `arpuuk.spatial-explorer` (publisher `arpuuk`, as omx-viewer).
  Publish to VS Code Marketplace AND Open VSX (.github/workflows/publish-extension.yml, manual run only).
  Logo: a globe in SQL square brackets, apps/vscode-ext/icon.svg (icon.png rendered from it; web favicon).
- DuckDB runs as DuckDB-WASM inside the webview (NOT native in the extension host).
  Use the single-threaded bundle (no SharedArrayBuffer; coi-serviceworker is not usable in VS Code webviews).
  Not bundled (user decision 2026-10-11, constitution v1.2.0): DuckDB-WASM, its extensions (spatial, parquet,
  json) and sql.js are downloaded from pinned URLs and checked against SHA-256 hashes recorded by
  scripts/engine-assets.mjs (packages/core/src/engineAssets.json). Rerun it after upgrading either package.
  Tests serve the same files from /engine-mirror (scripts/engine-assets.mjs --mirror).
  Each shell keeps a local copy through HostAdapter.engineFile (VS Code: extension host global storage;
  web: Cache Storage), so it works offline after the first start.
  Known ceiling: the engine's memory limit is 3.1 GiB in both shells (measured, specs/007-viewport-loading/research.md §1;
  omx-viewer's ~512 MB OOM was likely JS-side copies, not the engine). After an OOM the registered file handle must be re-registered.
  Design for it (see performance rules).
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
- Style persistence: DECIDED (2026-10-10, specs/001-quick-look/design-plan.md §8.5). The sidecar is QGIS QML
  (`<basename>.qml` next to the data, which QGIS auto-loads too). Export and import QML, OGC SLD and Mapbox GL style JSON.
  Serializers live in packages/core/src/style/.
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
