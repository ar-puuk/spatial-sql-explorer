# Changelog

All notable changes to Spatial Explorer are documented here. The VS Code
extension and the web app share one engine (`packages/core`, `packages/ui`)
and are versioned together. The pre-rebuild single-page app is tagged
`legacy-v1`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
    previews in the picker.
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
- **Web app.** Branded header, drop zone, and a status bar docked to the map;
  light and dark follow the OS.
- **Developer tooling.** `npm run screenshots` captures the real VS Code
  extension (three themes) and the web app (light and dark).
- **Spatial SQL query (spec 002).** A query panel docked beside the
  attribute table (Ctrl/Cmd+Shift+Q). It runs DuckDB spatial SQL against the
  opened file, in both the extension and the web app.
  - The file is the ready-made table `layer`, also aliased by its file name,
    in its original CRS. The initial view is the editable query
    `SELECT * FROM layer LIMIT 1000`: remove or raise the `LIMIT` to see more.
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
  - Cancel a running query with the Cancel button or Esc. Results over 50,000
    rows ask first: show the first 50,000, show all, or cancel.
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

### Performance

- About 10 MB opens in ~1.2 s with the engine already started. DuckDB starts
  in the background (pre-warm) and is reused between opens. Each file is
  parsed once, then its memory is released.

- At most 1,000 features are drawn at a time by default. Feature counts and
  the map extent always cover the whole file.
- A filtering query on a ~10 MB file returns in ~0.1 s, and cancelling takes
  ~0.1 s (spec 002 quickstart, Results).
- Restyling 22,000 features takes ~0.1 s, and natural breaks on 50,000 values
  take ~0.2 s with no long tasks (spec 003 quickstart, Results).
