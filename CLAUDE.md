# Spatial Explorer

## What this is
A GIS "quick look" tool that ships as BOTH a standalone web app and a VS Code
extension from one codebase. Goal: never open QGIS for basic GIS work.
Scope is exactly: LOOK (open + view), QUERY (SQL), STYLE (thematic), EXPORT.
The VS Code extension is the priority target; the web app is the secondary shell.

The pre-rebuild single-page app is preserved at tag `legacy-v1` (no longer in the tree).
Use it only as a feature reference (`git show legacy-v1:js/app.js`, or check out the tag).

## Explicitly out of scope
Feature editing, georeferencing, processing toolbox, notebooks/ipynb
integration, plugin system, 3D tiles/planets, raster analysis, stacked
basemaps, multiple map layers. Say no to scope creep and flag it instead.
Allowed by user decision (2026-10-11, spec 008): a Mercator/Globe projection toggle
(MapLibre's built-in globe, no terrain), and polygon extrusion as a style option
(height from a column). Nothing else 3D, except (user decision 2026-10-13) the map can always be tilted and rotated, so a basemap's own 3D layers (Liberty's buildings) show. Allowed by user decision (2026-10-15, spec 014, constitution v1.3.0): a terrain on/off switch (a DEM is a height source the one basemap and the data are lifted onto, not a second basemap; with hillshade, an exaggeration slider and a cursor elevation readout), and scratch shapes drawn on the map to measure, select and filter (never edits to the data). Allowed by user decision (2026-10-16, spec 016): GeoLibre's whole Print Layout composer (the map as a page: paper and screen sizes, title block, legend, scale bar, north arrow, colorbar, info block, attribute table and chart blocks, a 1:N scale, a drawn print extent, and an atlas), saved as PNG, PDF or SVG. It replaces "Save as image". Also allowed (2026-10-11): an opt-out place search
(OpenStreetMap Nominatim) that sends only the typed text, disclosed before first use (constitution v1.1.0).

## Product decisions (already made)
- Name: Spatial Explorer. Marketplace display name pattern: "Spatial Explorer: Spatial SQL & Map Viewer"
  (keywords in the display name). Extension ID `arpuuk.spatial-explorer` (publisher `arpuuk`, as omx-viewer).
  Publish to VS Code Marketplace AND Open VSX (.github/workflows/publish-extension.yml, manual run only).
  Logo: a globe in SQL square brackets, apps/vscode-ext/icon.svg (icon.png rendered from it; web favicon).
- DuckDB runs as DuckDB-WASM inside the webview (NOT native in the extension host).
  Use the single-threaded bundle (no SharedArrayBuffer; coi-serviceworker is not usable in VS Code webviews).
  Not bundled (user decision 2026-10-11, constitution v1.2.0): DuckDB-WASM, its extensions (spatial, parquet,
  json, and, user decision 2026-10-17, spec 017, constitution v1.4.0, the optional fts, h3 and a5, the last two from
  community-extensions.duckdb.org) and sql.js are downloaded from pinned URLs and checked against SHA-256 hashes recorded by
  scripts/engine-assets.mjs (packages/core/src/engineAssets.json). Rerun it after upgrading either package. On an engine upgrade also check whether the new DuckDB-WASM build uses WebAssembly's `try_table` exception instructions: Firefox prints "The WebAssembly exception handling 'try' instruction is deprecated" for the current build, and only an upstream rebuild removes it (the engine files are used unmodified).
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
- Folder-based formats (.gdb) cannot bind to a custom editor: use an explorer/context command (it opens a table file inside the folder; spec 013).
- SQL names (user decision 2026-10-14, packages/core/src/sql/names.ts): the open file is `layer` and also its own cleaned name (`us_counties`, `"2020_tracts"`); a multi-layer file's layers are views in a schema named after the file (`us_boundaries.counties`).
- One layer on the map at a time (user decision 2026-10-12, spec 010). Multi-file work is SQL: a query names other workspace files by their path relative to the workspace root (`ST_Read('data/links.shp')`), and the result is drawn. The web app does the same with files the user adds.
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
- Picker shows previews (spec 012): keyless vector styles as thumbnails rendered by scripts/basemap-thumbnails.mjs and
  bundled (packages/core/src/basemapThumbnails.json, lazy-loaded), raster rows as one live tile of the same place
  (GeoLibre's center, 8°E 47°N, at city scale), keyed rows as a "Needs key" tile. Rerun the script after basemap-catalog.mjs.
- Failure must degrade gracefully (offline, CSP block, bad key): fall back to blank + short message.
- API keys: non-secret values in settings, secrets in context.secrets (SecretStorage).
- CSP: webview needs img-src/connect-src for style, sprite, glyph and tile hosts; worker-src blob:;
  script-src 'wasm-unsafe-eval'.
- Spec 010: a short featured list in the Basemap panel, plus "More basemaps…": a searchable modal, grouped by provider, over the maplibre-gl-basemap-control catalog plus keyless CARTO GL and VersaTiles styles (generated into packages/core by scripts/basemap-catalog.mjs). Every provider is offered (user decision 2026-10-13: Google with an optional key and Map Tiles API sessions, Mapbox with its mapbox:// URLs rewritten, Amazon with key and AWS region, Chinese providers with their datum warnings). Still excluded: overlays meant to stack (labels-only, traffic) and 3D styles. Keys: VS Code SecretStorage, web localStorage; the AWS region is a saved setting. Rerun scripts/basemap-catalog.mjs after upgrading maplibre-gl-basemap-control.
- Exactly one basemap is drawn at a time; switching replaces it and never touches the data source.
- Terrain (spec 014, user decision 2026-10-15) is the one exception that sits next to a basemap, and it is not a basemap: a `raster-dem` source (keyless Terrarium tiles from AWS Open Data, packages/core/src/terrain.ts) plus a hillshade layer under the data, lifted with `setTerrain`. Off at every start; exaggeration remembered. A tile failure turns it off with a message. Its ids are `terrain-dem` and `terrain-hillshade` (no `se-` prefix: `replaceDataSource` drops those, and `swapBasemap` puts the new basemap under the shading).

## Scale and performance rules
- Map drawing (spec 010, GeoLibre's model): results under 100,000 rows (and files under 100 MiB) are converted to GeoJSON once and drawn from memory; larger ones are drawn from vector tiles DuckDB builds per tile (ST_AsMVT through MapLibre addProtocol), silently, with a "Load all" link. No per-pan re-queries.
- Prefer range reads (registerFileURL against the loopback server) over posting whole files to the webview.
- Prefer binary/Arrow transfer between host and webview over JSON.
- CRS: read the layer CRS and ST_Transform to EPSG:4326 for display. Plan for this from day one.

## Styling and export
- Styling: single, categorized, graduated (equal/quantile/jenks), inline color-ramp picker with previews, legend.
  Spec 011: the style is channels (packages/core/src/style/channels.ts): each property (color, outline color and
  width, size, width, shape, pattern, opacity, rotation, height) is fixed or an Encoding {source, scale} with
  categories, classes, continuous, conditions (SQL, engine-computed __se_cls_<ch>), as is, or bivariate (color only).
  The panel keeps the Color type and adds "Vary by attribute"; legend groups merge on the same column and classes.
  Labels are their own side-rail panel (style.labels; expression text computed as __se_lbl), drawn with the
  system's sans-serif (no glyph download).
  Spec 009: plus bivariate (two numeric columns, 2 to 4 classes per axis, generated 3x3 palettes read at other sizes, a keyboard legend square or diamond set in the style) and an
  optional size channel (marker size / line width by its own numeric column, classed or proportional) next to
  any color style but bivariate. QML writes the size channel as QGIS data-defined sizes and bivariate as a
  RuleRenderer; both ride along in spatialExplorer/* custom properties. Marker shapes and line patterns too.
  Points can also be drawn as a heatmap or as clusters (user request 2026-10-14, after mapgl's cluster_options):
  `draw.points` 'heatmap' | 'clusters' with style.heatmap / style.clusters. Clusters use MapLibre's GeoJSON
  clustering, or the engine groups points per tile in SQL (view/tiles.ts); QML writes QGIS's pointCluster renderer.
- Style persistence: DECIDED (2026-10-10, specs/001-quick-look/design-plan.md §8.5). The sidecar is QGIS QML
  (`<basename>.qml` next to the data, which QGIS auto-loads too). Export and import QML, OGC SLD and Mapbox GL style JSON.
  Serializers live in packages/core/src/style/.
- Export: via DuckDB COPY/ST_Write: GeoJSON, GeoParquet, CSV, and others only if the WASM build supports them.

## Grid cells (spec 017)
- "Bin into cells" (user decision 2026-10-17; step 1 the `fts`, `h3` and `a5` extensions, step 2 the action): the open layer's rows are assigned to H3 or A5 cells
  (a point by its place, a line or polygon by its centroid), a measure per cell (count, or sum, average, minimum, maximum, median of a number
  column), and the cells are drawn like any result. It is QUERY plus STYLE of a result, never a second layer; joins between grids are out of scope
  (spec 021, user request 2026-10-17, adds Every cell touched for lines and polygons, and Smooth with neighbors for H3: see below).
- The query is the product (packages/core/src/grid/binSql.ts, `QuerySession.binQuerySql`): the dialog (packages/ui/src/BinCellsDialog.svelte, from the map control `binCells`;
  user decision 2026-10-17: no button in the query panel) writes SQL with the columns `cell_id, resolution, value, n, geom` (`geom` is `ST_SetCRS(..., 'EPSG:4326')`), the store runs it as
  a query (`openBinDialog`, `setBinSpec`, `applyBin`, `cancelBin`) and the user can edit and rerun it. A fresh bin gets the style in `gridStyle`
  (quantile classes on `value`, the legend titled with the measure); a rerun of an edited bin keeps the user's style.
- Sizes and estimates come from the engine's own tables (`gridSizes.ts`, checked by a core test against specs/017-grid-cells/spikes/cell-sizes.json). A5 starts at
  resolution 1 (0 fails the date-line split). Cells across the date line are cut into a MultiPolygon in SQL; H3's two pole cells are drawn as caps.
  Under 5,000 estimated cells the dialog previews on change; over 100,000 it asks first.
- The rows binned are those the layer shows: the column filters and the shape filter are inlined as WHERE (only while the layer itself is displayed); "selected
  rows only" first publishes them as the temp table `selected_rows` (the SQL policy protects the engine's hidden row ids). Rows without a location are
  left out and counted.
- Spec 021: `BinSpec.assign: 'cover'` puts a line or polygon in every cell it touches (H3: `h3_polygon_wkt_to_cells_experimental(..., 'overlap')` per part, lines and A5 by sampled points: `coverSql` in gridSystems.ts); `smooth` (a number of rings, 1 to 9, warned past 5: a switch and a `kit/NumberField`; H3 only) makes a cell's value that of its neighborhood (`diskSql`). They are alternatives. A5's own polygon and neighbor functions are incomplete (specs/021-grid-extras/spec.md), so A5 is sampled and not smoothed. Lambda names in generated SQL start with `_` (a name like `g` or `v` loses to the query's columns).
- h3 and a5 are community extensions (constitution v1.4.0): pinned, hash-checked, optional. The a5 extension phones home to Query.Farm when it loads; the engine
  worker blocks that host (duckdbService.ts) and a test checks no request reaches it.

## Search by words (spec 018)
- The search box has a Words switch (offered when the result has text columns and the optional `fts` extension is loaded). It ranks rows by BM25 over up to 12 text columns, every word required, English stemming and stop words (`packages/core/src/view/textSearch.ts`, `QuerySession.searchWords`). The plain substring search stays the default.
- The app builds the index itself on the hidden temp table `__se_fts` (`PRAGMA create_fts_index`, schema `fts_main___se_fts`): the SQL policy still refuses PRAGMA from the user. One index per displayed result (rebuilt when the facts change), keyed by `__se_rowid`; the column filters apply when searching, not when indexing.

## Time slider (spec 020)
- The map control `timeSlider` opens a bar (`TimeSlider.svelte`, at the foot of the map) with a two-handle window over a DATE or TIMESTAMP column of the displayed result, and Play. The window is that column's `between` column filter (`view/timeSlider.ts` `timeFilter`; the whole span is no filter), so every consumer of the filters (map, table, counts, styles, export, tiles) follows without a second path. A new result closes it. Numeric years and text dates are not time columns.

## Snippet library (spec 023)
- A Snippets button in the query panel header (`SnippetLibrary.svelte`, beside Query history) lists ready-made queries that fit the open layer (`packages/core/src/snippets/snippets.ts`: id, category, geometry it suits, columns it needs, a template). A template is a whole query using the file's table name, the geometry column and a first number or text column, with editor fields (`${1:default}`); choosing one replaces the editor text through `SqlEditor.insertSnippet` (CodeMirror `snippet()`, Tab between fields, Ctrl+Z restores). Not run automatically. `QuerySession.snippetContext`, store `snippetContext`.
- Adding a snippet is adding a row; the core test checks each is one allowed statement, and the browser test runs every snippet on a polygon, a line and a point layer in the engine. Combining snippets read another workspace file by its path (`ST_Read('data/x.geojson')`). Spheroid functions want longitude and latitude, so a projected layer is converted first (`geom4326`).

## Dot density (spec 022)
- The map control `dotDensity` (user request 2026-10-17) opens a dialog (`DotDensityDialog.svelte`, like Bin into cells: floating over the map, the SQL tab holds the query, Esc restores) for a polygon layer: one to six number columns (each its own color, `category`) and the amount one dot stands for (a 1, 2, 5 ladder, first chosen for about 5,000 dots). The result is a points layer `feature, category, one_dot, geom`, a user-editable query like the bin (`packages/core/src/dots/dotSql.ts`, `QuerySession.dotQuerySql`, store `openDotDialog`, `setDotSpec`, `applyDots`, `cancelDots`).
- The engine has no point-in-polygon generator (`ST_GeneratePoints` takes a box), so the SQL samples each polygon's box with `hash(feature, column, k)` (the same map every time) and keeps the first n points that are `ST_Within`; a remainder is one more dot with that chance. Limits: preview to 20,000 dots, asks over 100,000, refuses over 1,000,000. Very detailed polygons are slow (cost is vertices times candidates: specs/022-dot-density/spec.md).

## File Geodatabase and zips (spec 013, experimental)
- The SQL engine cannot read a `.gdb` or anything inside a zip (its lockdown refuses `/vsizip/`, and it fails even unlocked: specs/013-file-geodatabase/research.md §8). Each shell reads a geodatabase with gdal3.js (GDAL 3.8.4 in WebAssembly, LGPL, user decision 2026-10-18, constitution v1.5.0): the VS Code extension host runs it in a child process (`apps/vscode-ext/src/gdbReader.ts`, `gdbWorker.ts`; GDAL blocks while it works, and the process can be killed to cancel), the web app in a worker (`apps/web/src/gdb/`). Experimental until DuckDB's spatial extension has the OpenFileGDB driver for WASM; then delete the reader and keep the picker.
- gdal3.js is pinned like the engine (`engineAssets.json` `gdal`, written by `scripts/engine-assets.mjs`; a mirror for tests), downloaded the first time a geodatabase is opened (about 40 MB), kept by `HostAdapter.engineFile`. It is loaded unmodified as a separate file.
- Core (`packages/core/src/gdb/`): `GdbHost` (`HostAdapter.gdb`: `list`, `convert`, `cacheInfo`, `clearCache`), the catalog from `ogrinfo -json`, domains, the reader's helpers and error messages, and `openGeodatabaseLayer`. `openFile` lists the layers, converts the one to open into a FlatGeobuf (cached: VS Code global storage keyed by the files' sizes and modification times, web OPFS) and opens that through the normal FlatGeobuf path. SQL names are the file as a schema, each layer a view (`network.roads`; `ST_Read('x.gdb', layer=…)` is not offered). Another layer is a placeholder view with its columns and no rows until a statement names it: `QuerySession.prepareLazyLayers` converts it first and replaces the view. A table without shapes is converted with `SPATIAL_INDEX=NO` and its empty `geom` column left out.
- The web reader mounts the picked files with WORKERFS and copies the chosen layer's table files (found through `GDB_SystemCatalog`: row id N is file `a<8 hex>`) into memory before converting, 25 times faster than reading them from the picked files. A layer's files plus its FlatGeobuf must fit in memory (about 3 GB).
- Domains are hidden from SQL and shown in the table, the card, the hover tooltip and the column filter: the description by default (a switch in the table toolbar shows the code; remembered, `domainDisplay`), `Layer.columnDomains`, `describeCode`. SQL, filters, search and exports always use the stored code.
- A geodatabase opens as a folder pick or drop (web), "Open in Spatial Explorer" on the folder (VS Code), or a `.gdb.zip`; a zip of ordinary data (`source/zip.ts`, fflate) is unzipped in core into an in-memory source, and a zip with several datasets asks which (`ZipChoiceDialog`, `OpenHooks.chooseDataset`). A zip never opens by default: right-click or Open With only (`*.zip` and `*.gdbtable` are `option` editors).
- A geodatabase layer that records no coordinate system asks for one when it is opened as `layer` (`OpenHooks.chooseCrs`, `GdbCrsDialog` over the export's `CrsPicker`): the answer is written into the converted layer (`ogr2ogr -a_srs`, its own cached file `<layer>.epsgN.fgb`) and remembered for the session; "None recorded" goes on with WGS84 assumed, and the status bar says so. A layer read by name from SQL is not asked about.
- Compressed geodatabases cannot be read by any open-source reader (message says to uncompress in ArcGIS); 64-bit ObjectIDs (Pro 3.2+) are untested with GDAL 3.8.4.
- Kept apart on purpose (user decision 2026-10-18): the workaround is the folders `packages/core/src/gdb/` (including `integration.ts`, the only glue `openFile.ts` imports), `apps/web/src/gdb/` and the two `apps/vscode-ext/src/gdb*.ts` files, plus a few lines marked "Spec 013". `specs/013-file-geodatabase/removal.md` lists everything to delete when the engine reads `.gdb` itself. New geodatabase code goes in those places, not into shared files.
- Fixtures: `node scripts/fixtures-013.mjs` (needs GDAL with Python bindings); a real sample runs the acceptance spec when `SE_GDB_SAMPLE` names a `.gdb`.

## GTFS (spec 024, proposal)
- A GTFS feed (zip; detected by content, never by name; an inner zip is ignored) opens as the `network`: every route (a colored line) and every stop (a point) in one result (`kind, id, name, routes, route_type, trips, route_count, color, geom`), drawn together: the one exception to "one layer" (user decision 2026-10-19, constitution v1.6.0). `schema.routes`, `schema.stops` and the feed's other tables are views. Routes and stops only; no timetables, service filters, GTFS-Realtime or analysis. Code: packages/core/src/gtfs/ (`detect`, `feed`, `sql`, `open`, `style`); the default style (`Layer.defaultStyle`) reads the `color` column as given and labels from zoom 13 (`LabelSettings.minZoom`).
- Reading order (user decision): GDAL's GTFS driver first, then what GTFS-X does (parse the text files), then SQL (`read_csv`, `ST_Point`, `ST_MakeLine`). Measured: the driver inside DuckDB-WASM cannot open a registered folder or zip (specs/024-gtfs/research.md §1), so the driver runs in gdal3.js like spec 013's reader (`HostAdapter.gdb.convertFeed`; GDAL gets a header-only `stop_times.txt`, so opening is constant-time); the plain tables are read by the engine. GDAL makes only the lines (`shapes_geom`, and `trips` only when a trip has no shape); STOPS are always made in SQL (GDAL turns a blank coordinate into 0, 0). When GDAL cannot be used (no reader, blocked download, too large) `openGtfsFeed` falls back to `mode: 'sql'` (lines by `ST_MakeLine`: shapes.txt, or the stops of each route's longest shape-less trip) and the notice says so; both modes give the same geometry on the UTA feed (tested). `?e2e=1&noGdal=1` forces the fallback. A feed that is a folder or loose files becomes a stored zip first (`gtfs/folder.ts`; VS Code opens it through its `stops.txt`). `LayerFacts.notice` (`feedNotice`) is the over-the-map caveat; webview messages are JSON, so a feed goes to the extension host as base64 chunks.
- The default look follows GTFS-X's decisions (research §4). GTFS-X is AGPL-3.0: never copy its code. Real sample feed: `D:\GTFS.zip` (Utah Transit Authority).

## Layer zoom (spec 025, user request 2026-10-19)
- `LayerStyle.zoom` (`packages/core/src/style/zoom.ts`): `min`/`max` = the zoom range the layer shows in (MapLibre `minzoom`, `maxzoom` on every `se-*` map layer, set in `MapView.applyPaint` and `dataLayers`; `maxzoom` hides from that zoom up), and `sizes` = marker radius, outline width (`factor`) and line width (`lineFactor`) follow the zoom (`paintWithZoom` wraps `circle-radius`, `circle-stroke-width`, `line-width` in a top-level `interpolate` on `zoom`, whatever expression they are). In the style panel the range is a two-handle slider (`kit/RangeSlider.svelte`, two overlaid range inputs like the time slider) in a row like Opacity at the top, with two small triangles, above and below the track, for the map's current zoom (`camera` prop; grey when hidden there; tooltip gives the value; no sentence, no scale); the sizes switch is under Appearance. QML: our JSON plus QGIS `hasScaleBasedVisibilityFlag`/`minScale`/`maxScale` (scale = 559082264.03 / 2^zoom); Mapbox GL: `minzoom`/`maxzoom` and zoom curves; SLD leaves it out with a note. The GTFS default style turns the sizes on (spec 024).

## Line arrows (spec 019)
- `LayerStyle.arrows` (placement along or center, spacing px, size, optional color) draws arrowheads along lines in the line's direction (first vertex to last): the map layer `se-line-arrow`, a MapLibre symbol layer with an SDF chevron (`drawArrowIcon`, `ARROW_ICON_ID`) tinted by the line's color. The style panel's Arrows control (lines and mixed layers). Our QML keeps it in `spatialExplorer/style`; SLD and Mapbox GL leave it out, with a note.

## Map controls and quality-of-life tools (spec 014)
- The map's controls are a registry (packages/core/src/mapControls.ts): id, group, label, default on and default corner. A fourth right-rail tab, "Map controls" (sliders icon), has a row per control: an on/off switch, its name and a dropdown for its position. Each control declares the positions that suit it (user decision 2026-10-15): buttons, search, legend, scale bar and logo take the four corners; the coordinates readout takes the middle of the top or bottom edge; the hover tooltip has none. The user is treated as the developer of the map, as with mapgl, where every control has a `position`. Search (with the selected feature's card under it), zoom, zoom to layer, reset view, globe, terrain, draw, measure, select by shape, export image, legend, coordinates, the MapLibre logo (on by default) and the scale bar are all positionable; the hover tooltip has no place; the attribution stays at the bottom right (licences). Controls at a position stack in registry order, and buttons of one group side by side share a box. A global user preference through `HostAdapter.saveState('mapControls')` (`visible`, `positions`; the first version's group corners are migrated, and a saved position a control no longer offers is dropped). Adding a control is adding a row, plus its element in MapView (a button, or `extra` for something ViewerLayout owns).
- Drawing is Terra Draw (MIT) with its MapLibre adapter, lazy-loaded (packages/ui/src/draw/controller.ts). Tools: point, line, polygon, rectangle, circle, freehand, edit. Three purposes share one palette: Draw, Measure (labels with length, or area and perimeter, metric or imperial) and Select by shape (a finished shape selects the rows it covers; Ctrl or Cmd adds).
- A drawn line follows its great circle: Terra Draw keeps the vertices you place, a layer (`draw-geodesic`) draws the path between them (live while drawing), and `geodesicGeometry` gives SQL and exports the same densified line (cut at the date line). Polygon edges stay straight in longitude and latitude.
- Shapes are scratch geometry for queries and filters, never edits to the data. The store owns them (`shapes`); they are the temp table `drawn` in SQL (`id, kind, purpose, geom, area_m2, length_m, perimeter_m`; spherical measures within about half a percent of the spheroid); the SQL button writes a query with the geometry inlined, in the layer's CRS; "As layer" runs `SELECT * FROM drawn` (so every export format applies); GeoJSON saves them. The spatial predicate (intersects, within, contains, centroid within) defaults to intersects. A shape can select rows (ids into the existing Selection) or be a standing filter (`QuerySession.setSpatialFilter`, a restriction beside the column filters). Selection runs in the engine, never on rendered features, so it covers off-screen rows and tiles mode.
- A hover tooltip (columns chosen in the Map controls panel; tiles mode fetches the record by id) and an on-map coordinates readout (click copies lat, lon; elevation is shown, not copied).

## Visual design (spec 015)
- One icon library: Lucide (`@lucide/svelte`, ISC), behind `packages/ui/src/Icon.svelte` (our names map to Lucide components; unused icons are not bundled). Never draw an icon by hand.
- Interactive components come from bits-ui (headless, MIT), wrapped once in `packages/ui/src/kit/` (Switch, Segmented, Slider, Select, Tip) and styled from tokens. Prefer a maintained library to writing a widget.
- The web shell's identity lives in `apps/web/src/theme.css` (generated from one list of tokens; same token names as the VS Code file): chart ink on cool paper, ultramarine the single accent, navy for dark, a muted blue-teal as the default data fill. IBM Plex Sans (interface) and Fira Code (data only: SQL, coordinates, nested values) are web-only, self-hosted through @fontsource. In VS Code, colors and fonts are the host's: never ship the web palette there.
- No all-caps labels, no numbered cards, no dot-joined meta strings in the web shell. One radius per role (`--se-radius-sm` controls, `--se-radius` floating groups, `--se-radius-lg` dialogs and the hero), hairline rules for docked panels, shadows only on floating things. Motion answers an action, apart from the landing demo; always honor reduced motion.
- Values are colored by type (`--se-type-*`, `valueKind.ts`): the host's debug-variable tokens in VS Code. Color is never the only cue.
- The layer picker and the selected feature's card are not map controls: they show wherever needed (top left).

## Print layout (spec 016)
- The map control `exportImage` (label "Print map") opens the composer (packages/ui/src/print/): settings on the left, a live preview of the page on the right, exports underneath (PNG, PDF, SVG, the clipboard; an atlas gives a multi-page PDF or a zip of PNGs). Page drawing, atlas helpers, the print extent tool and the saved settings are adapted from GeoLibre (MIT; `// Adapted from GeoLibre` comments, notice in THIRD-PARTY-NOTICES.md), with our own legend (`mapImage.ts`, drawn from the resolved style; its editor renames, hides and moves classes for the page only).
- One drawing routine (`print/layout.ts`, `drawLayoutContext`) paints a 2D canvas (preview, PNG, PDF) and svgcanvas (SVG: text, swatches, tables and charts stay editable; the map is one embedded image). jsPDF, svg2pdf.js and svgcanvas load on first use. The PDF is the same page as the SVG, drawn as vector content by svg2pdf.js (text in the PDF's built-in Helvetica, the map one embedded picture); a page whose text has characters those fonts lack (CJK, say) is the page image at 150 dpi instead, with a note, and the arrows of the legends become -> and <- in the PDF. (GeoLibre's PDF is always the page image.)
- Placement on the page (user request 2026-10-16): the north arrow top-right, the legend bottom-left, the scale bar bottom-right (middle of the bottom edge when the info block takes the corner); panels aimed at a corner stack beside what holds it. The map credit ("MapLibre | the basemap's credit") is a small strip in the map's bottom-right corner, with everything else above it. The legend is always on the page (a plain layer is one row), on the flat map and the globe alike, and the atlas works on both. The composer centers in the map area like the basemap gallery.
- The settings are a global preference through `HostAdapter.saveState('printLayout.2')` (`PrintLayoutConfig` in packages/core/src/printLayoutConfig.ts, normalized on read). The captured map, atlas pages and legend edits are the session's.
- Data blocks and the atlas read the engine (`QuerySession.printBlock`, `printAtlasFeatures`; SQL and reducers in packages/core/src/printBlocks.ts): a table is a query, a bar or pie a GROUP BY, a line sampled to 2,000 points, the page-extent filter ST_Within or ST_Intersects in the layer's CRS. One layer is on the map, so it is the coverage layer; an atlas reads at most 20,000 features (2,000 lines). The atlas needs the flat map. Its mask is painted on the capture, not drawn as a map layer.
- MapView hands the store a capture (`MapCapture`: a frame at 2x, cut to the print extent, with the atlas mask) and a `PrintCamera` (zoom, fit, settle, the extent box). The extent box uses layer ids without the `se-` prefix and is hidden while the map is captured.

## Query UX
Embedded SQL editor first (a native .sql document is a later option). Results become map layers.
Autocomplete from the DuckDB catalog. Docked, resizable panel.

## References
GeoLibre (opengeos/GeoLibre), maplibre-gl-vector and maplibre-gl-basemap-control are MIT (© 2026 Qiusheng Wu). Their code may be copied and adapted when it is justified, with a `// Adapted from …` comment and the notice in THIRD-PARTY-NOTICES.md. Port React code to Svelte; never add React. Other references (Data Wrangler, Hex Editor, GitLens, SQLite Viewer): decisions and design only, never code or assets.
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
