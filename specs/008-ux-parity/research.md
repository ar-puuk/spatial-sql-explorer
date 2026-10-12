# Research: UX Polish and Legacy Parity (spec 008)

Phase 0 of `/speckit-plan`, 2026-10-11. The risky items were spiked against
the **real** runtime:
- DuckDB-WASM 1.32.0 (DuckDB v1.4.3) with spatial, in the production web
  build (headless Chromium, software WebGL);
- MapLibre GL JS 6.13.0, the version the app ships;
- QGIS 4.2.3 / GDAL 3.13 (OSGeo4W) for read-back.

**Evidence** is in `spikes/`:
- `s1-s2-engine.json`: engine reads (multi-layer) and writes;
- `js-writers.mjs.txt`: the FlatGeobuf, GeoPackage and FileGDB checks in JS;
- `qml3d.py.txt` and `extrude.qml`: the QGIS 3D round trip;
- `map-spike.html.txt` and `web-map-spikes.spec.ts.txt`: the map checks
  (globe, extrusion, image capture, tile CORS, place search);
- `harness.patch`: the temporary `?e2e=1` hook (an unlocked second engine);
- `make-data.bat.txt`: the test data (a 3-layer GeoPackage, a 2-layer File
  Geodatabase).

To re-run: apply the patch, copy the specs back under `tests/web/specs/`,
copy `map-spike.html.txt` to `apps/web/public/spike008/index.html` with
MapLibre's `dist/*.mjs`, and run Playwright with `SPIKE_DIR` set to the data
folder.

---

## 1. Multi-layer GeoPackage: listed by the engine, read one layer at a time

**Finding** (`S1`):
- `ST_Read_Meta('<file>')` lists every layer in about 50 ms without reading
  them: name, feature count, geometry type and CRS (auth name/code, WKT,
  PROJJSON), plus fields. It includes attribute-only tables (geometry
  fields `[]`).
- `ST_Read('<file>', layer='city points')` reads one named layer. Spaces in
  names work, and attribute-only layers read as plain tables.
- `ST_Read` without `layer` reads the first layer: that is today's
  behavior, and why only `countries` opened (spec 001 deferred the picker).

**Decision**:
- At open, a GeoPackage is listed with `ST_Read_Meta`. The **active layer**
  is the first one with geometry, else the first. It is read exactly as a
  GeoPackage is today (whole read, spec 007). Other layers are not read.
- Switching layer re-runs the open for that layer. The file stays
  registered, so it is not transferred again.
- In SQL, `layer` stays the active layer (no change to spec 002). Every
  layer is also a lazy view named after it (quoted identifier), defined as
  `ST_Read(<file>, layer=<name>)`. It is read only when a query uses it, and
  the catalog and autocomplete see it.
- Per-layer state (style, column choice) is keyed by
  `<file stateKey>#<layer name>`.

**Alternatives considered**:
- Materializing every layer at open: wasteful. Most users look at one
  layer, and a GeoPackage can hold dozens.
- sql.js to read GeoPackage (GeoLibre's choice): unnecessary, since the
  engine reads it fine (spec 001 spike).

## 2. File Geodatabase: not readable in this runtime

**Finding**:
- `ST_Drivers()` in the WASM build has no `OpenFileGDB` (or `FileGDB`)
  driver. Opening the folder's files gives "not recognized as a supported
  file format"; `/vsizip/` on a zip gives "does not exist".
  `ST_Read_Meta` returns no rows.
- The only JS reader on npm (`fgdb` 1.0.0, 2022) fails on a GDB written by
  current GDAL: "RangeError: Start offset … is outside the bounds of the
  buffer" (`js-writers.mjs.txt`).

**Decision**:
- File Geodatabase is **not supported** in spec 008 (FR-018's "otherwise"
  branch).
- VS Code: a `.gdb` folder gets the "Open in Spatial Explorer" context
  command anyway. It shows a clear message ("File Geodatabase isn't
  supported yet: convert it to GeoPackage, for example with `ogr2ogr -f GPKG
  out.gpkg in.gdb`"), so the user isn't left guessing.
- Web: a chosen `.gdb` zip or folder gets the same message.
- Revisit when a DuckDB-WASM release ships OpenFileGDB. A one-line check is
  in the T-list (re-verify `ST_Drivers()`).

**Alternatives considered**:
- Writing an OpenFileGDB reader in JS: the format is documented by GDAL,
  but a correct reader (compressed geometries, CDF, spatial index) is a
  project of its own. That breaks constitution X for one format.
- Converting in the extension host: there is no native GDAL there, and
  shipping one breaks the "DuckDB runs in the webview" decision.

## 3. Export writers: the engine writes JSON; spatial formats need JS writers

**Finding** (`S2`, consistent with spec 005 research §2):

| Engine write | Result |
|---|---|
| GDAL GPKG | "file is not a database" |
| GDAL FlatGeobuf | "Maximum call stack size exceeded" |
| GDAL ESRI Shapefile | "cannot start a transaction within a transaction" |
| GDAL KML | reports success, but the file is **1 byte** |
| GDAL GeoJSONSeq | "Cannot write feature" |
| `COPY … (FORMAT json)` / `ARRAY true` | ✓ newline-delimited / array JSON |
| `excel` extension, `FORMAT xlsx` | writes, but the file starts with a stray byte; openpyxl and GDAL reject it |
| `sqlite` extension, `ATTACH … (TYPE sqlite)` | "unable to open database file" (no writable VFS) |

The spatial extension also has no KML or Shapefile serializer (`ST_As*` is
GeoJSON, HEXWKB, MVT, SVG, Text, WKB).

JS writers, checked against GDAL 3.13 (`js-writers.mjs.txt`):
- **FlatGeobuf**: `flatgeobuf`'s `geojson.serialize(fc, 4326)` (already a
  dependency) wrote 50 polygons (70 KB, 4 ms). `ogrinfo` reads 50 features
  with EPSG:4326.
- **GeoPackage**: `sql.js` 1.14.2 (MIT, 650 KB wasm) built a GeoPackage in
  34 ms:
  - the three required tables (`gpkg_spatial_ref_sys`, `gpkg_contents`,
    `gpkg_geometry_columns`);
  - `application_id`/`user_version`;
  - geometry blobs in the GPKG binary header with WKB.
  `ogrinfo` reads 50 features with EPSG:4326. SQLite `integrity_check` is
  ok, and `ST_IsValid` flags only the one geometry that is invalid in the
  source (Antarctica).

**Decision**:
- Exports split into **engine-written** formats (today's GeoParquet, CSV,
  Parquet, plus **JSON** via `COPY … FORMAT json`) and **JS-written**
  formats. The JS writers stream rows out of the engine in pages, as the
  GeoJSON writer already does (spec 005), with geometry from `ST_AsWKB`
  (FlatGeobuf, GeoPackage, Shapefile) or `ST_AsGeoJSON` (KML).
  (Outcome: GeoJSONSeq is engine-written too; see Implementation outcomes.)
- **FlatGeobuf**: the `flatgeobuf` library's feature serializer, written
  without a spatial index. Header feature count is known from the result
  count.
- **GeoPackage**: `sql.js`, with tables written by our code. Its database
  lives in memory, so GeoPackage export is capped at 1.5 GB of output, and
  the dialog says so for larger results.
- **Shapefile (zipped)**: our own writer for `.shp/.shx/.dbf/.prj/.cpg` (a
  small, fixed binary format), zipped with `fflate`, which is already
  installed via `pmtiles`/`flatgeobuf` and becomes a direct dependency.
  Format limits (10-character field names, one geometry type per file, 2 GB,
  DBF types) are planned in `export/plan.ts` and shown before export
  (FR-021).
- **KML**: our own streaming writer (WGS84 only, like GeoJSON).
- **GeoJSONSeq** (newline-delimited GeoJSON): planned as our streaming
  GeoJSON writer. Outcome: the engine writes it (`COPY … (FORMAT JSON)` over
  a select shaped as Features), per the DuckDB-native-first rule.
- **Excel**: our own minimal `.xlsx` writer (inline strings, one sheet,
  zipped with `fflate`). That avoids loading the `excel` extension at
  startup (the lockdown forbids loading it later) and its stray-byte bug.
  Row limit 1,048,576, stated by the dialog.
- Each format is offered only after it reads back in QGIS (spatial) or
  openpyxl/a JSON reader (attribute), in both shells. That is the gate from
  spec 005 research "Re-verifying a GDAL format later".

**Alternatives considered**:
- `@ngageoint/geopackage` (13 MB unpacked, pulls in sql.js anyway):
  far heavier than the three tables we need.
- `@sqlite.org/sqlite-wasm` (Apache-2.0): equivalent. `sql.js` was chosen
  for `db.export()` to bytes, with no OPFS or worker setup.
- `@mapbox/shp-write`: BSD, but depends on JSZip, buffers everything,
  and is unmaintained since 2023. A streaming writer is about the same size.
- Loading `excel`/`sqlite` before the lockdown: adds ~0.9 s and a CDN fetch to
  every engine start, and both outputs failed anyway.

## 4. Globe and extrusion in MapLibre 6.13

**Finding** (`web-map-spikes.spec.ts.txt`, 800×600 canvas):
- `projection: { type: 'globe' }` renders, and `fill-extrusion` draws on the
  globe (70,552 extrusion-colored pixels), with no errors.
- **Hit-testing**: on the globe, `queryRenderedFeatures({ layers })` with
  no geometry returns **0** for a fill-extrusion layer (Mercator: 48). A
  **point** query does return the feature (`extrPoint: 1`). Fill layers
  return results either way, even at opacity 0.

**Decision**:
- **Projection**: `map.setProjection({ type: 'globe' | 'mercator' })`. The
  choice lasts for the session only (user decision, 2026-10-11: the map
  always opens flat; earlier it was kept with `saveState('projection')`). MapLibre transitions to
  Mercator at high zoom on its own, which is fine.
- **Extrusion**: a `fill-extrusion` layer per polygon layer, replacing the
  fill when on.
  - Height: `coalesce(get(col), 0) * scale`, clamped at 0 (flat for
    missing, zero or negative values), or a constant.
  - Base: 0.
  - Color: the same resolved expression as the fill.
  - Opacity: the fill opacity, applied layer-wide. MapLibre extrusion
    opacity can't be data-driven.
- Clicks use point queries, which work on the globe. The e2e
  "rendered features" hook queries a hidden (opacity 0) fill kept under the
  extrusion, so tests and `data-rendered-features` stay right on the globe.
- Turning extrusion on eases to pitch 50 if the map is flat. "Reset view"
  eases to pitch 0, bearing 0. MapLibre's keyboard handler already supports
  Shift+arrows for tilt/rotate; the spec 001 map keyboard help lists it.

## 5. Extrusion in style files

**Finding** (`qml3d.py.txt`): QGIS stores polygon extrusion in the QML's
`<renderer-3d type="vector">`, as a `<symbol type="polygon">`. That symbol
has `extrusion-height` and an `extrusionHeight` data-defined property (an
expression such as `"pop_est" * 0.001`). QGIS 4.2.3 reloads it as a
`QgsVectorLayer3DRenderer` with the expression intact (`extrude.qml`).

**Decision**:
- QML: write and read that block. Only the forms we write are recognized
  on import: `"col" * k`, `"col"`, or a constant. Any other expression
  imports as "extrusion off" with a notice.
- Mapbox GL: a `fill-extrusion` layer, its height expression
  `["*", ["get", col], k]`, read back the same way.
- SLD: no 3D. The save says "3D extrusion isn't part of SLD and was left
  out" (FR-027).

## 6. Map image (PNG)

**Finding**: reading the canvas inside a `render` event works without
`preserveDrawingBuffer` (globe and Mercator). Tiles from Esri World Imagery,
OpenTopoMap and OSM all allow capture (CORS), as does OpenFreeMap.

**Decision**:
- Export = `map.once('render', …)` + `triggerRepaint()`, then draw the
  map canvas onto a 2D canvas. Add the legend (drawn from
  `ResolvedStyle` with 2D canvas calls, not a DOM screenshot) and the
  attribution text, then `toBlob('image/png')`.
- 2× scale: temporarily set `pixelRatio` 2 with `map.setPixelRatio(2)`,
  wait for idle, capture, then restore. Fall back to 1× if the canvas
  would exceed the device's max texture size (edge case).
- A `SecurityError` on `toDataURL` (a tainting basemap) is retried with
  the basemap hidden, and the user is told why (FR-030).
- VS Code: bytes go through `saveFile(name, bytes, { kind: 'image' })`.
  Web: a download.

## 7. Raster basemaps

**Finding**: all three draw and capture without errors (above).

**Decision**: add catalog rows (data only, CLAUDE.md):
- **Esri World Imagery**: attribution "Esri, Maxar, Earthstar Geographics,
  and the GIS User Community".
- **OpenTopoMap**: attribution "© OpenStreetMap contributors, SRTM | ©
  OpenTopoMap (CC-BY-SA)". Max zoom 17.
- **OpenStreetMap Standard**: attribution "© OpenStreetMap contributors".
  The catalog row notes the OSMF tile policy (no heavy use); it is never the
  default.

The VS Code CSP adds `img-src`/`connect-src` for these hosts.

## 8. Place search (Nominatim)

**Finding**: `https://nominatim.openstreetmap.org/search?format=jsonv2` answers
cross-origin from the page (200).

**Decision** (constitution v1.1.0, Principle IV):
- Requests go out only on Enter or the search button, never as the user
  types: Nominatim's usage policy forbids autocomplete, and allows at most
  1 request per second.
- Results: up to 5. Picking one fits its bounding box.
- First use shows a one-time notice ("Searches are sent to OpenStreetMap
  Nominatim. Only the text you type is sent.") and remembers it.
- Attribution "Search © OpenStreetMap contributors (Nominatim)" is shown
  with results.
- VS Code: the setting `spatialExplorer.placeSearch.enabled` (default true)
  hides the control. The CSP adds `connect-src
  https://nominatim.openstreetmap.org`. Browsers can't set a custom
  `User-Agent`; the `Referer` the browser sends satisfies the policy's
  identification rule for web apps.

## 9. Table filters, selection and column choice

No new engine risk: the table and map already run SQL over the result (spec
007 §10–§11).

**Decision**:
- **Filters** compile to a `WHERE` over the current result: `ILIKE '%…%'`
  with escaping for text, comparisons and `BETWEEN` for numbers and dates,
  `= true/false` for booleans. Values are always passed as SQL literals
  produced by our quoting, never as raw text.
  - The filtered result is a view, so table pages, map views, counts,
    styles and export read through it. This is the same mechanism as a
    user's WHERE, so large files keep spec 007 behavior: whole-file work
    gets progress and cancel.
  - The count "N of M" comes from one `count(*)`.
  - Filter edits are debounced (300 ms).
- **Selection** is a set of `__se_rowid`s, or the rule "all matching the
  filters", which keeps a select-all on a big result cheap. "Show selected
  only" adds `__se_rowid IN (…)` (or keeps the rule).
  - The map highlight uses a feature-state on drawn features.
  - Zoom to selection: the selection's extent in SQL
    (`ST_Extent_Agg`), or the result's extent for the rule.
  - Ctrl/Cmd-click on the map toggles membership.
- **Export scope**: "filtered" or "selected" wraps the export source in the
  same `WHERE`.
- **Column choice**: `saveState('columns:<stateKey>[#layer]', { hidden:
  string[] })`. Hidden lists, not visible ones, so new columns show.
  Results whose columns equal the source's use the source's choice; other
  results start with all columns shown.

## 10. Style panel: value distribution and live ramp preview

**Decision**:
- **Distribution chart**: one SQL `histogram`-style query of 40 equal-width
  bins (`width_bucket`) over the classed column. Large results use the
  existing style-statistics path (spec 007 §11, `jenksSample`), and the
  chart says "sample" when it is one.
  - Breaks are drawn as lines over the bars. It is drawn with SVG in
    Svelte (no chart library).
- **Live ramp preview**: focusing a ramp in the picker applies a temporary
  style (not saved or undoable). Leaving the picker without choosing
  restores the previous style.
- **Legend range filter** (graduated): two-handle slider on the legend. It
  hides features outside `[lo, hi]` with a map filter expression (no
  re-query). It resets when the renderer, column or breaks change.
- The split Save button follows the WAI-ARIA "menu button" pattern: the
  main action is Save; a separate arrow opens a `menu` with the three
  formats. The separate "Export style" button goes away.

## 11. Theme toggle (web) and the attribution icon

**Decision**:
- Web shell only: `ThemeKind` comes from the user's choice (`system` |
  `light` | `dark`, `saveState('theme')`). `system` follows
  `prefers-color-scheme` live. `getTheme`/`onThemeChange` already exist on
  the HostAdapter, so `ui` needs no change beyond a control slot.
  - The toggle lives in the web header (it is shell chrome), not in
    `packages/ui`.
  - The default basemap follows the effective theme (positron/dark) unless
    the user picked a basemap.
- **Attribution "i" icon**: MapLibre draws the compact attribution
  button's icon as a dark SVG background image. We restyle it with a CSS
  `mask-image` of the same glyph painted in `--se-text-secondary`, so it
  follows light, dark and high contrast. Zoom/compass icons already use our
  own buttons.

## 12. Sample data

**Decision**:
- Bundle `sample/us-counties.parquet`: US counties generalized to about
  1 MB, from US Census cartographic boundary files (public domain), with
  name, state, population, area and density.
  - It suits graduated, categorized and extrusion demos (density as
    height).
  - GeoParquet shows the fast path.
- Web: a "Try sample data" button in the empty state. VS Code: the command
  "Spatial Explorer: Open Sample Data", which opens the bundled file from
  the extension folder. No network.
- The share link marks the sample with `src=sample`.
- The source and license are recorded in `THIRD-PARTY-NOTICES.md`.

## 13. Share link (web)

**Decision**:
- `#v1=<base64url(deflate(JSON))>`, holding the query, style (the
  `LayerStyle` JSON), basemap id, projection, center/zoom/pitch/bearing,
  the layer name, and `file: { name, size }` or `src: 'sample'`. Never data
  or paths.
- `fflate` deflate keeps typical links under 2 KB. Over 8,000 characters,
  the app offers "Copy query" instead (edge case).
- Opening a link:
  - with `src=sample`, the sample opens;
  - otherwise a banner asks for the named file;
  - after open, the query runs, then the style and view are applied.
  - Each part that fails is reported and skipped, never fatal.

## 14. Panel reset

**Decision**: the resize handles in `ViewerLayout.svelte` reset their
panel's size to the default on double-click or Enter, and the reset size is
saved.

---

## Residual risks

- **GeoPackage export memory**: the sql.js database is in memory, capped at
  1.5 GB of output with a message. Measure a 500 MB export in both shells
  during implementation.
- **Extrusion performance** with 10,000 polygons on software WebGL (CI):
  SC-006 is measured on real hardware. CI asserts correctness only.
- **Nominatim availability/policy changes**: degrade to "can't reach the
  place search service".
- **File Geodatabase** remains unsupported. Re-check `ST_Drivers()` on each
  DuckDB-WASM upgrade.

---

## Implementation outcomes (US4, 2026-10-11)

### COPY TO GDAL, re-tested at the user's request

The user prefers the engine's `COPY … (FORMAT GDAL)` over custom writers, so it
was spiked again before keeping the JS writers. Evidence:
`spikes/gdal-writers-1.32.json`, `spikes/gdal-writers-1.33.json`,
`spikes/gdal-writers.spec.ts.txt`, `spikes/gdal-opfs.spec.ts.txt`.

| Target | GPKG | FlatGeobuf | Shapefile | KML | GeoJSONSeq |
|---|---|---|---|---|---|
| engine path (1.32.0, DuckDB 1.4.3) | "file is not a database" | stack overflow | "Failed to write .shp header" | axis order (fixed with `SRS 'OGC:CRS84'`) | "Cannot write feature" |
| pre-registered buffer, layer options | same | same / "I/O failure" | same | same | same |
| `opfs://` (registered) | SQLite error | stack overflow | 0 bytes | 0 bytes | "Cannot write feature" |
| 1.33.1-dev57 (DuckDB 1.5.4) | same as 1.32 | same | same | same | same |
| `/vsimem/` (GDAL's memory) | ✓ reads back 20/20 | ✓ | ✓ | ✓ | ✓ |

Writes succeed only into GDAL's own `/vsimem/`, and nothing reaches those
bytes from outside: `read_blob`, `read_text` and `glob` on `/vsimem/` return
nothing. The DuckDB-WASM file layer can't take GDAL's random-access writes.
**Decision (user, 2026-10-11): ship the JS writers now; re-run the GDAL spike
on every DuckDB-WASM upgrade and move each format to the engine as soon as it
writes.**

### Verified formats (SC-010)

Every format offered was written by the real web build, then read back:

- in the browser engine (GDAL, `inspectExport` hook, `export-formats.spec.ts`):
  - GeoPackage, FlatGeobuf, KML, GeoJSONSeq: 500 of 500 rows, POLYGON;
  - Shapefile: the UTM test file, EPSG:26912 kept;
  - GeoPackage and FlatGeobuf exports reopen in the app;
- in QGIS 4.2.3 (`tests/qgis/read_back.py`):

| File | CRS | Count |
|---|---|---|
| UTM test file → GPKG, FGB, SHP zip | EPSG:26912 | 1 |
| UTM test file → KML, GeoJSONSeq | EPSG:4326 | 1 |
| world (180 countries) → GPKG, FGB, SHP zip, KML, GeoJSONSeq | EPSG:4326 | 180 |

- Excel: openpyxl reads the header and 180 rows. QGIS's XLSX driver takes an
  all-text header row as data, as it does for any all-text sheet.
- JSON: 180 objects (`JSON.parse`). It isn't a GDAL vector format (no
  geometry), as intended.
- VS Code: all seven formats save through the host
  (`export.test.ts`, "Spec 008 US4").

### Found while verifying

- **GeoPackage needs `gpkg_ogr_contents`.** Without GDAL's feature-count
  table, the WASM build's GDAL counts features on a worker thread and fails
  ("thread constructor failed: Resource temporarily unavailable"). Our first
  exports didn't reopen in the app. The writer adds the table.
  - The same applies to **reading** GeoPackages from tools that don't write
    it (e.g. ArcGIS): they fail to open in this runtime. This is a
    pre-existing reading gap, listed under residual risks.
- **JSON** is the engine's `COPY … (FORMAT JSON, ARRAY true)`. The lockdown
  refuses to autoload extensions, so `json` is now loaded before it (about
  230 ms, during prewarm; not fatal if it fails, which only disables JSON
  export).
- **Checked at the user's prompt:** `COPY … (FORMAT SHAPEFILE)` and
  `(FORMAT FGB)` don't exist ("Copy Function with name shapefile does not
  exist", native DuckDB 1.5.6). Native DuckDB does write GPKG and FlatGeobuf
  through `FORMAT GDAL` (read back 1/1); only the WASM build can't (above).
- **KML** puts the first text column in `<name>`; QGIS shows the attribute
  as `name2` next to KML's own `Name`. That's standard KML behavior, left as is.

### Residual risks (US4)

- GeoPackages without `gpkg_ogr_contents` don't open (above). Possible fix
  to spike: a GDAL open option, or adding the table to a copy before opening.
- GeoPackage output is built in memory (capped at 1.5 GB with a message).

### Export to any CRS (user request, 2026-10-11)

- The dialog offers the result's CRS, WGS 84, Web Mercator, or any EPSG code.
  The plan reprojects with `ST_Transform(geom, 'EPSG:from', 'EPSG:to',
  always_xy := true)` (`crs.ts` `reprojectSql`), and every writer takes the
  plan's SRID (PROJJSON for GeoParquet, WKT for Shapefile and GeoPackage).
- A typed code is checked by the engine before export
  (`QuerySession.describeCrs`: PROJ's PROJJSON for the code, background work).
  Unknown codes (e.g. 999999) get a message, and Export stays disabled.
- Verified: `usa-utm12n.gpkg` exported to EPSG:5070 as GeoPackage reads back
  with CRS 5070 and 1 row (export-formats.spec).

- CRS list (user request): the WASM build has no CRS-listing function
  (`duckdb_functions()` shows only `DuckDB_Proj_Version`, 9.1.1) and PROJ's
  database isn't reachable, so the list is data: `scripts/crs-catalog.py`
  reads QGIS's proj.db (EPSG v12.029, PROJ 9.8.1; 5,957 geographic 2D and
  projected CRSs), and `tests/web/specs/crs-catalog.tool.spec.ts` keeps the
  5,625 the engine transforms to (332 newer codes dropped, e.g. 10178
  IGS20). Grouped like ArcGIS (UTM, US State Plane from the "SPCS" area
  names, Gauss-Krüger, World) and QGIS (projection method families);
  GeoLibre's picker (Geographic/Projected split, search by name or code)
  was the reference. 567 KB, 119 KB gzipped, loaded on first open of the
  picker.

## Implementation outcomes (US6, 2026-10-11)

- Map: a `fill-extrusion` layer replaces the fill while extruded; the fill
  stays at opacity 0 for hit tests, outline and halo hide. Extrusions are
  solid (opacity = the layer opacity), like QGIS 3D: at the fill's default
  45 % they read as ghosts. Colors follow Single, Categorized and Graduated.
- Height: `max(0, to-number(coalesce(col, 0)) * scale)`, or a constant;
  the flat count is DuckDB's `count(*) WHERE coalesce(TRY_CAST(col AS DOUBLE), 0) * k <= 0`
  over the displayed result (600 of 10,000 in buildings-10k).
- Map views carry the height column (styleColumns), as they do the
  thematic column.
- Tilt and rotate (right-drag, Shift+arrows) are on only while extruded;
  turning extrusion on eases to pitch 50; "Reset view" shows while tilted
  or rotated.
- QGIS check (T072): `check_sidecar.py` on a QML the app saved
  (`"height_m" * 1.5`, layer opacity 0.8) prints
  `QgsVectorLayer3DRenderer`, symbol `polygon`, height expression
  `"height_m" * 1.5`, opacity 0.8 (QGIS 4.2.3). QGIS's own spike file
  (`extrude.qml`, `"pop_est" * 0.001`) imports as column `pop_est`, scale
  0.001.

## Globe in space (user request, 2026-10-11)

- Design after GeoLibre's effects (decisions only, no code): deep-space
  radial backdrop and a seeded starfield on a canvas behind the map (the
  globe projection leaves space transparent), drifting with the view's
  center and bearing; a soft blue halo just outside the globe's outline
  (outline from 24 points 88° from the center, projected); MapLibre's own
  `sky` atmosphere (`atmosphere-blend` 1 → 0 between zoom 5 and 7). Fixed
  colors, decorative, not in exports.
- A Blank basemap now has a `background` layer, so the globe's sphere takes
  the theme's (or the user's) blank color instead of MapLibre's gray.
- User report: a click in space beside the globe opened a far-limb feature
  (Uzbekistan; reproduced with Myanmar). `queryRenderedFeatures` answers for
  points in space on the globe. Fix: a point is on the surface only if
  screen → lng/lat → screen returns within 2 px (public API; MapLibre's
  `isPointOnMapSurface` is internal and not reachable). Clicks and hover
  off the surface select nothing.
- User report: green patches in space while spinning a Satellite globe.
  Not reproduced in screenshots; raster cross-fade draws stretched tile
  borders past the limb, so raster basemaps now have
  `raster-fade-duration: 0`.

## Implementation outcomes (US7, 2026-10-11)

- Map image: the frame is read inside a `render` event; 2× sets the pixel
  ratio and waits for idle (capped by MAX_TEXTURE_SIZE/MAX_RENDERBUFFER_SIZE);
  the legend (from the resolved style) and the basemap attribution are drawn
  with canvas calls; on the globe the night sky is included (it is what the
  user sees). 1× and 2× PNGs in about 1 s (SC-007), web and VS Code.
- Tainting: MapLibre loads tiles with `fetch` (CORS) into ImageBitmaps, so
  a server without CORS headers fails its tiles instead of tainting the
  canvas; the basemap falls back to blank, and the image says the basemap
  isn't in it. The SecurityError path (export without the basemap) stays
  as a guard.
- Share link: a typical link (graduated style with extrusion, globe, view)
  is ~1 KB. Applying waits for the result's fit before moving the camera;
  the hash is cleared once applied, so a reload doesn't ask again. A link
  made with another file warns and still applies; failed parts are listed.

## Implementation outcomes (US8, 2026-10-11)

- Place search: `packages/ui/src/placeSearch.ts` fetches
  `nominatim.openstreetmap.org/search?q=<text>&format=jsonv2&limit=5` with no
  credentials and an origin-only referrer: the typed text and nothing else.
  Only on Enter or the button, at most one per second. The first search shows
  the privacy notice (`saveState('placeSearchNoticeShown')`). Hidden when the
  VS Code setting is off; the setting now notifies the webview live
  (`HostAdapter.onPreferenceChange`).
- Sample data: web (landing page, `/sample/us-counties.parquet`) and VS Code
  (`spatialExplorer.openSample`, copied to the extension's global storage
  first: the install folder may be read-only, and exports and styles save
  next to the data). Draws in ~1 s (SC-008).
- Open risk (SC-008 "with no network"): the engine downloads its spatial
  extension from extensions.duckdb.org at start-up, so with no internet at
  all the engine never becomes ready, for the sample or any file. The sample
  test goes offline after the engine has loaded, as T086 specifies. Making
  the app fully offline means bundling the extension (.duckdb_extension.wasm)
  with the app and pointing `custom_extension_repository` at it: a separate
  decision (size, both shells).

## 15. Engine from a CDN, hash-checked (user decision, 2026-10-11)

**Decision (user)**: don't bundle DuckDB-WASM (35 of the web build's 39 MB,
and most of the 8.7 MB VSIX). Load it from jsDelivr at a pinned version,
and check every downloaded piece of engine code against a SHA-256 recorded
at build time: the DuckDB worker and wasm, the spatial, parquet and json
extensions (until now fetched by DuckDB itself, unchecked), and sql.js.

**Spike** (Chromium, the web preview server):
- jsDelivr's `@duckdb/duckdb-wasm@1.32.0/dist` files are byte-identical to
  the npm package (worker `f8ab72b6…`, wasm `4c221bfa…`), so their hashes
  come from `node_modules` at build time.
- The engine starts from verified bytes: `new Worker(blobUrl)` of the
  checked worker text and `db.instantiate(blobUrl)` of the checked wasm
  (~0.9 s here, downloads included).
- Extensions: `LOAD '<blob url>'` fails (DuckDB names the extension after
  the file: "expected entrypoint `<uuid>_duckdb_cpp_init`"); a registered
  buffer fails too (extensions are fetched with XHR). `LOAD
  '<blob url>#/spatial.duckdb_extension.wasm'` works: the fetch ignores the
  fragment, DuckDB reads the name from it. Signature checks stay on
  (`allow_unsigned_extensions` false). spatial 23.5 MB, `04b77694…`.
- DuckDB's own autoload/autoinstall are turned off, so nothing else is
  fetched behind the check.

**Outcome** (implemented, constitution v1.2.0):
- `scripts/engine-assets.mjs` writes `packages/core/src/engineAssets.json`
  (URLs, SHA-256, sizes); a core test fails if it drifts from node_modules,
  and the script refuses an extension whose bytes changed for the same
  DuckDB release. `fetchVerified` (core `engineAssets.ts`) refuses a
  mismatch with "refused to run its SQL engine: … does not match".
- Sizes: web build 39 MB → 4.0 MB; VS Code webview 38 MB → 3.5 MB; VSIX
  8.7 MB → 1.4 MB.
- VS Code: works in the webview (75 tests, real CDNs): the worker reads
  verified extension bytes from blob URLs (CSP `connect-src blob:` plus
  `cdn.jsdelivr.net`).
- Tests: web test builds serve the same files from `/engine-mirror`
  (ENGINE_MIRROR=1, VITE_ENGINE_MIRROR); `engine-integrity.spec` checks a
  tampered engine and extension are refused and that only the 5 pinned
  files are fetched. The production build was also run against the real
  CDNs (GeoPackage export through the CDN's sql.js, GeoParquet through the
  parquet extension).
- Offline: still needs a connection the first time (as before, for the
  extensions); after that the browser's HTTP cache serves the pinned files.

**Local copy, offline after first use** (user request, 2026-10-11): the
files still come from jsDelivr and extensions.duckdb.org, but each shell
keeps them, so later starts need no network.
- `HostAdapter.engineFile(file, { refresh })` returns a file's bytes from the
  host's copy, downloading it once from its pinned URL; the core checks the
  SHA-256 of whatever comes back and asks for a fresh download once on a
  mismatch. `pruneEngineFiles(keep)` drops other versions after the engine
  starts.
- VS Code: the extension host downloads (Node `fetch`, hash-checked, written
  as `.part` then renamed) into `globalStorage/engine/<sha256>-<name>`; the
  webview reads it as a local resource, and its CSP no longer lists the
  CDNs. VS Code's `http.fetchAdditionalSupport` (default on; checked in the
  1.141 build) gives that `fetch` the editor's proxy and system-certificate
  settings. Remote: the copy lives where the extension host runs.
- Web: Cache Storage (`spatial-explorer-engine`, keyed by hash), not the
  HTTP cache (which the browser evicts freely); `navigator.storage.persist()`
  is requested. The page itself still needs the network to load (no service
  worker).
- Tested: web, with the engine servers unreachable after the first start
  (0 requests, opens fine) and a damaged cached wasm (only that file is
  downloaded again); VS Code, a second open downloads nothing and a damaged
  copy on disk is replaced.
