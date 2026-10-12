# Changelog

All notable changes to Spatial Explorer are documented here. The VS Code
extension and the web app share one engine (`packages/core`, `packages/ui`)
and are versioned together. The pre-rebuild single-page app is tagged
`legacy-v1`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **SQLite and SpatiaLite databases** (`.sqlite`, `.db`), such as Bentley
  Cube 7 networks: spatial tables open as layers with their CRS, and
  attribute-only tables (transit modes, tolls, junctions) can be queried by
  name. In VS Code they open under **Open With…**, so SQLite viewers keep them.

### Fixed

- **GeoPackage layers whose feature ids don't run 1..N** (for example a
  subset exported with its original ids) failed to open: the map stayed grey,
  or showed the basemap without data, with "thread constructor failed". They
  now open.
- **Feature ids are kept**: a GeoPackage's `fid` and a SQLite table's integer
  primary key (a Cube node's `n`) are columns again; they were dropped.

## [0.1.0] - 2026-10-11

The first release of the VS Code extension (VS Code Marketplace and Open VSX)
and the web app (GitHub Pages).

### Added

- **Quick Look (spec 001).** Open a vector file and see it on a map and in an
  attribute table, in VS Code (custom editor) and in the web app (file
  picker or drag and drop). Formats: GeoJSON, GeoPackage, FlatGeobuf,
  Shapefile (with sidecars), GeoParquet, Parquet with a WKB column, GML, and
  CSV with `lon`/`lat`, `longitude`/`latitude` or `wkt` columns.
- **CRS handling.**
  - The source CRS is read from the file and the layer is reprojected to WGS84
    for display; the status bar reports the original CRS.
  - Files without a CRS are disclosed as "WGS84 assumed".
- **Basemaps.**
  - OpenFreeMap basemaps (Positron, Liberty, Bright, Dark, Fiord), with
    previews in the picker, plus keyless raster basemaps: Satellite (Esri),
    Topographic (OpenTopoMap) and OpenStreetMap (spec 008).
  - The default follows the light/dark theme, including theme changes while
    the viewer is open.
  - Blank background whose color can be customized; the choice is remembered.
  - If a basemap fails to load, the map falls back to blank and shows a short
    message; the data is unaffected.
- **Attribute table.**
  - A resizable, collapsible drawer under the map.
  - Fast with large files: only visible rows are rendered.
  - Sortable, resizable columns, with a header that stays in place while
    scrolling.
  - Keyboard navigation.
  - Selection stays in sync with the map; double-click a row to zoom to it.
- **Map.**
  - Zoom, fit-to-layer, layer style and basemap controls, plus a scale bar.
  - Clicking a feature selects it and opens a feature inspector listing all
    of its attributes.
- **Layer styles.**
  - Fill, outline, width and point size.
  - Saved as a QGIS `.qml` sidecar next to the data. QGIS loads it too, and
    it is applied automatically on open.
  - Export and import as QGIS QML, OGC SLD, or Mapbox GL style JSON.
- **VS Code integration.**
  - Native look under every color theme, including high contrast.
  - Native status bar items: CRS, feature count, cursor coordinates.
  - "Open in Spatial Explorer" in the Explorer and editor-tab context menus.
  - A "Spatial Explorer" output channel with per-open timings.
  - A notice, with Reload, when the open file changes on disk.
- **Web app.** Branded header, a landing page with a world population map,
  **Try sample data** (US counties) and the SQL engine's status, and a
  status bar docked to the map. A theme menu offers System, Light and Dark
  (remembered).
- **Developer tooling.** `npm run screenshots` captures the real VS Code
  extension (three themes) and the web app (light and dark).
- **Spatial SQL query (spec 002).** A query panel docked beside the
  attribute table (Ctrl/Cmd+Shift+Q). It runs DuckDB spatial SQL against the
  opened file, in both the extension and the web app.
  - The file is the ready-made table `layer`, also aliased by its file name,
    in its original CRS. The initial view is the editable query
    `SELECT * FROM layer`: the whole file (spec 007).
  - Results with a geometry column replace the map layer and the table;
    results without one show in the table, with the last map dimmed. The
    result's CRS is resolved automatically and shown in a chip that can be
    overridden.
  - Ctrl/Cmd+Enter runs the selection or the statement under the cursor.
  - Editor: SQL highlighting in theme colors, and autocomplete from the live
    catalog (tables, columns with types, spatial functions with signatures
    and descriptions, keywords, and temp tables you create).
  - Errors name the problem, underline it in the editor, and keep the
    previous result. A typo in the first keyword suggests the fix.
  - Read-only by design: queries plus `CREATE TEMP TABLE/VIEW`. Writes,
    exports, extensions and settings are refused with a reason, and the
    engine itself is locked to the opened file (no file or network access).
  - Cancel a running query with the Cancel button or Esc. Results of any
    size report their exact row count (spec 007).
  - Timing in the panel and in the "Spatial Explorer" output channel.
  - Reset returns to the original view and style. Per-file history keeps the
    20 most recent queries across reopening; picking one loads it without
    running.

- **Thematic styling (spec 003).** Style the displayed layer by its data.
  - **Categorized**: a color per value, most frequent first, up to 12 classes
    plus "Other"; nulls get a "No value" class.
  - **Graduated**: a numeric column in 2–10 classes by equal interval,
    quantile or natural breaks (Jenks, the exact optimum). Breaks match
    QGIS's; values on a break fall in the class below, as in QGIS.
  - **Color ramps** with previews (Viridis, Magma, Plasma and ColorBrewer
    sequential, diverging and qualitative), reversible.
  - **Per-class editing**: color, label, visibility (hides features on the
    map), values or bounds, add and delete. Editing values or bounds fixes
    the classes (Manual).
  - **Legend** on the map with counts. It is collapsible, and a swatch hides
    or shows its class.
  - **Follows queries**: classes are recomputed for each result. If the
    styled column disappears, the single symbol is shown with the reason, and
    the style comes back with the column.
  - **QGIS-compatible**: the `.qml` sidecar now holds categorized and
    graduated styles, verified in QGIS 4.2.3. QML and Mapbox GL round-trip
    losslessly. SLD loses the method and hidden classes, and the Export menu
    says so before writing.
- **Accessibility**: closing a map popover with Esc returns focus to its
  button (unless you were typing elsewhere).
- **Export (spec 005).** Save the displayed result to a new file from the
  **Export** button above the attribute table, or with **Spatial Explorer:
  Export Data…** in the VS Code command palette.
  - **Formats**: GeoParquet, GeoJSON and CSV (geometry as WKT, or X/Y
    columns for points); results without geometry export as CSV or Parquet.
    Spec 008 adds more formats (below).
  - **Which rows**: the whole result (spec 007), or since spec 008 the
    filtered or selected rows.
  - **CRS**: the result's own CRS by default, or WGS84. GeoParquet carries the
    full CRS definition, so QGIS reads projected exports in the right place
    (verified in QGIS 4.2.3). GeoJSON is always WGS84 (RFC 7946).
  - **Nothing lost silently**: a notice lists what the format changes
    (invalid geometries written empty, nested values as JSON text, other
    geometry columns as WKT, reprojection).
  - **Large exports** show rows written and can be cancelled; nothing is
    saved and nothing is left behind. In VS Code the file is saved next to the
    data by default; the opened source can never be overwritten.

- **Large files and viewport loading (spec 007).** Files of several GB open
  in both shells without freezing.
  - **Facts first**: row count, extent, CRS, geometry type and columns for the
    whole file appear within seconds, with progress and a Cancel that always
    ends the open within 3 s.
  - **The map draws what's in view**: up to 25,000 features, refreshed as you
    pan and zoom. Above that, an even, stable sample with a notice ("Showing
    25,000 of 310,412 in view"); tiny features are drawn as dots so the
    overview shows where the data is.
  - **Read in parts where the format allows it**: GeoParquet/Parquet through
    range reads (a loopback server in VS Code, file slices on the web);
    FlatGeobuf through its spatial index, read in JavaScript; PMTiles tile by
    tile.
  - **Formats that must be read whole** (GeoJSON, Shapefile, CSV, GML,
    GeoPackage) are parsed once into an indexed table, and files over 100 MB
    are announced first with an estimate and a pointer to GeoParquet.
  - **Whole-data pillars**: the attribute table pages through any number of
    rows and sorts them in SQL; styles classify the whole result with exact
    counts; export writes every row. FlatGeobuf files read in parts offer
    **Load the whole file** before queries.
  - **PMTiles (vector)**: view-only, with the archive's facts and an
    inspector; SQL, table, styling and export say why they don't apply.
  - **Out of memory** at any stage ends in a clear message, and the viewer
    keeps working.

- **UX polish and legacy parity (spec 008).**
  - **Style panel**: sections for style type, column, classification,
    colors and appearance; a chart of the column's values with the class
    breaks; ramps previewed on the map while browsing; a layer opacity
    slider; one split **Save style (QML)** button whose menu saves SLD or
    Mapbox GL; a visible **Load…** button.
  - **Attribute table**: a **Columns** chooser to show or hide columns
    (remembered per file), a filter in each column header (text, numbers,
    dates, true/false), and row checkboxes with **Zoom to selection** and
    **Show selected only**. Map clicks select too (Ctrl/Cmd+click adds).
  - **Files with several layers**: a GeoPackage's layers are listed with
    their geometry type and count, and each one can be shown. A File
    Geodatabase folder explains that it can't be read here and offers an
    `ogr2ogr` command to convert it.
  - **Export**: an **Include geometry** switch; new formats GeoPackage,
    FlatGeobuf, Shapefile (zipped), KML, newline-delimited GeoJSON, Excel
    workbook and JSON, each checked by reading the file back; any EPSG CRS
    from a searchable list grouped like QGIS and ArcGIS, with the usual ones
    pinned and suggestions for the data; an editable file name; all,
    filtered or selected rows. Shapefile field renames and per-type splits
    are listed before export. GeoPackage and Shapefile exports open in QGIS
    with their CRS.
  - **Globe view**: a Mercator/Globe toggle, with a night sky and an earth
    glow around the globe. Every map opens flat.
  - **3D extrusion**: polygons raised by a numeric column times a scale
    (set automatically for columns that aren't heights) or by a constant,
    in the style's colors; polygons with no height are counted. Tilt and
    rotate with right-drag or Shift+arrows, and **Reset view**. Saved in the
    QML (QGIS's 3D renderer) and in Mapbox GL style JSON.
  - **Map image**: **Export map image…** saves the view as a PNG at 1x or
    2x, with the legend and the basemap's attribution.
  - **Share link** (web): **Copy link** holds the query, style, basemap,
    projection and view, never the data. Opening it asks for the same file,
    or opens the sample.
  - **Place search**: find a place and fit the map to it (OpenStreetMap
    Nominatim). Only the typed text is sent, on Enter, after a one-time
    notice; it can be turned off (`spatialExplorer.placeSearch.enabled`).
  - **Sample data**: **Try sample data** on the web landing page, and
    **Spatial Explorer: Open Sample Data (US Counties)** in VS Code.
  - **Feature inspector**: wide records scroll at a readable size, with a
    filter for many attributes. Dates and times show as dates everywhere.
  - The map attribution's "i" is visible on dark themes, and its text is a
    standard size.

### Changed

- The default query no longer has `LIMIT 1000`, the "Show first 50,000"
  prompt is gone, and every pillar works on the whole data (spec 007).
- **The SQL engine is downloaded, not bundled.** DuckDB-WASM, its spatial,
  parquet and json extensions, and sql.js come from pinned URLs (jsDelivr
  and extensions.duckdb.org). Each file is checked against a SHA-256
  recorded at build time and refused if it doesn't match. The extension
  package went from 8.7 MB to 1.4 MB, and the web app from 39 MB to 4 MB.
- **Works offline after the first start.** Each shell keeps a checked local
  copy of the engine (VS Code: the extension's storage; web: the browser's
  Cache Storage). The first start needs a connection.

### Performance

- Large files (spec 007, measured in the web build on a laptop):
  - 1.1 GB GeoParquet (6M rows): facts 2.0 s, overview 4.9 s, every city view
    within 1.9 s; no task blocks the viewer for more than 0.15 s.
  - 1.45 GB FlatGeobuf (4M rows): facts 2.0 s, overview 2.7 s, city views
    0.4 s.
  - 5 GB GeoParquet (27M rows): overview 9.5 s, and engine memory stays under
    60 MB through pans, a filter, a style and an export.
  - A 1,000,166-row filter on 4M rows: 11.6 s, exact; its GeoParquet export
    (189 MB) has every row.


- About 10 MB opens in ~1.2 s with the engine already started. DuckDB starts
  in the background (pre-warm) and is reused between opens. Each file is
  parsed once, then its memory is released.

- A filtering query on a ~10 MB file returns in ~0.1 s, and cancelling takes
  ~0.1 s (spec 002 quickstart, Results).
- Restyling 22,000 features takes ~0.1 s, and natural breaks on 50,000 values
  take ~0.2 s with no long tasks (spec 003 quickstart, Results).
- Exporting 100,000 polygons to GeoParquet takes ~2 s with no long tasks, and
  cancelling an export takes ~0.1 s (spec 005 quickstart, Results).
