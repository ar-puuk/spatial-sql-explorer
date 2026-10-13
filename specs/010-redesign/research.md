# Spec 010 research

## Engine upgrade (phase 1b): DuckDB-WASM 1.33.1-dev65.0, DuckDB 1.5.6

Installed `@duckdb/duckdb-wasm@1.33.1-dev65.0` (npm tag `next`); `version()` reports
`v1.5.6`. `scripts/engine-assets.mjs` now pins the v1.5.6 `wasm_eh` builds of spatial,
parquet and json. No other file hard-coded the engine version (the copy scripts don't).

### What broke, and the fixes

| Symptom | Cause | Fix |
|---|---|---|
| Every GeoParquet whose CRS is OGC:CRS84 fails to open: `Invalid Error: stoi: no conversion` at `DESCRIBE SELECT * FROM read_parquet(…)` (31 web tests: large-open, viewport, export read-back, wide-50, buildings-10k, …). | DuckDB-WASM 1.5 bug, [duckdb-wasm#2199](https://github.com/duckdb/duckdb-wasm/issues/2199) (open). A CRS-registration timing problem between spatial and PROJ that only shows in the WASM build. Affects a GeoParquet with no `crs` member (the spec default) and one with `{"authority":"OGC","code":"CRS84"}`; `EPSG:4326` and `crs: null` read fine. Native DuckDB 1.5.6 (CLI) reads the same files. | `SELECT count(*) FROM duckdb_coordinate_systems()` **before** `LOAD spatial` (`loadExtensions` in `duckdbService.ts`), the workaround from the issue. Order matters: after LOAD it is the bug. |
| Query result CRS chip says `(engine)` where the test expected `(layer)` (query.spec FR-014). | Intended 1.5 change: GDAL layers are typed `GEOMETRY('EPSG:26912')`, so precedence step 2 of `resolveResultCrs` (the engine says) now applies, as its comment anticipated. `ST_Transform(g, 'EPSG:a', 'EPSG:b')` still returns untyped GEOMETRY, so extent detection still applies there. | Test updated to expect `engine` for the first query; `detected` kept for the second. |
| GeoParquet is now typed `GEOMETRY('OGC:CRS84')`. | 1.5 types GeoParquet's default CRS. | `epsgFrom` (one shared copy in `source/facts.ts`; openFile's duplicate removed) maps `CRS84` / `OGC:CRS84` to 4326; used by `resolveResultCrs` too. Unit test added. |
| `DESCRIBE cubedb__BY__link` shows `OGC_FID` (sqlite-sources.spec). | 1.5's `ST_Read` returns GDAL's synthetic `OGC_FID`. `layer` already dropped it; the other layers' views didn't. | Layer views select `COLUMNS(c -> c <> 'OGC_FID')`. |
| A GeoPackage layer shows `fid` twice in exports (`fid`, `fid_1`); found by the QGIS read-back, not by a test. | 1.5's `ST_Read` returns the real feature id under its own name: GeoPackage `fid` with gaps (gapped-ids.gpkg: 101, 103, …), Cube's `n`. Checked with the native 1.5.6 CLI and in the app. The sql.js key restore (spec 008 §16) then added a second copy. | `planSqliteSource` skips restoring a key whose column the reader already returns (DESCRIBE of the reader). sqlite-sources.spec now asserts exactly one `fid` column. |

Approaches that did NOT work for the GeoParquet bug (recorded so nobody retries them):
- `SET ignore_unknown_crs = true` before the lockdown: same error.
- `SET enable_geoparquet_conversion = false`: same error. The reader parses the `geo` key
  regardless; even `parquet_kv_metadata()` fails.
- DuckDB-WASM 1.33.1-dev57.0 (DuckDB 1.5.4, npm `latest`): same bug.

Evidence: `spikes/engine-geoparquet.spec.ts.txt` (writes GeoParquet with each `crs`
variant through the app's engine and reads it back).


**Consequence for phase 6 (to raise with the user):** the plan's S5/option A (a `fid` made
from `row_number()`, because GDAL hides the id) is based on 1.4.3 behavior. On 1.5.6 GDAL
gives the real id, gaps and all, for streamed GeoPackage layers and for SQLite tables.
sql.js is then needed only to list a SQLite file's attribute-only tables (and for GeoPackage
export), unless S8 (`sqlite_scanner`) replaces that too.

### Gates after the upgrade

- lint (1 existing warning), all typechecks, `test:core` 492 passed.
- `test:web` (full suite, last two runs on 1.5.6): 157 passed, 1 skipped, 3 failed, 14 not run.
  - Not run: the `performance` project, which depends on `chromium` passing. Run alone
    (`--no-deps`): 6 of 7 passed; SC-003 city views (0.88–1.26 s, limit 2 s) failed once
    under load and passed alone. Per-pan views are removed in phase 4.
  - The 3 failures are timing tests that fail only under the full six-worker load:
    `sample.spec` (drawn in 3.2 s, limit 3 s), the large-open cancel during open, and the
    engine-reset cancel (and once, out of memory then reopen). Isolated
    (`--workers=1 --repeat-each=3`, same machine) they are the same on both engines:

  | | DuckDB 1.4.3 (1.32.0) | DuckDB 1.5.6 (dev65) |
  |---|---|---|
  | SC-008 sample drawn | 882–914 ms | 906–919 ms |
  | Cancel during open | 112–137 ms | 64–141 ms |
  | Cancel with engine reset | 2.40 s (spec 007 record) | 2.39–2.40 s |

  The upgrade did not slow them; they are load-sensitive on this machine (software
  WebGL, six workers) and pass on every isolated run. Left unchanged.
- `test:vscode-ext`: 81 passing, 3 pending (unchanged).
- QGIS 4.2.3 read-back (`tests/qgis/read_back.py`) of every spatial export of
  world-boundaries.geojson and usa-utm12n.gpkg made by the upgraded web build
  (`spikes/engine-qgis-exports.spec.ts.txt`): all valid; CRS EPSG:26912 kept for
  GPKG/FGB/SHP/GeoParquet, EPSG:4326 for GeoJSON/GeoJSONSeq/KML; 1 and 180 features;
  geometry types as before. In a GeoPackage export of a layer with a `fid` attribute, the
  writer's own primary key is `fid` and the attribute becomes `fid_1` (as before the upgrade).

## Phase 2 spikes (DuckDB 1.5.6)

All spikes ran in the real web build (headless Chromium, software WebGL) except S2 (VS Code
test host). Spike tests: `spikes/*.spec.ts.txt`, `spikes/vscode-tiles.test.ts.txt`; the
temporary harness (test hooks, a tile render helper, a stub tile protocol): `spikes/harness.patch`.

| Spike | Result | Path taken |
|---|---|---|
| S1 ST_AsMVT | **Pass.** Builds tiles; MapLibre decodes them; `__id` promotes; properties decode. Median ms per tile on parcels-230k (20 tiles around the data center; the same with or without `LIMIT 50000`): z8 275 (p95 539, ~917 KB/tile), z10 16 (p95 109), z12 4, z14 2–3. | Phase 3 as planned. |
| S2 vector tiles in the VS Code webview | **Pass.** A custom-protocol vector source renders (717 features), `promoteId` works, `setFeatureState` applies. No CSP or worker issue. | Phase 4 as planned. |
| S3 basemap swap keeps data | **Pass for both approaches**, 12 swaps (raster↔raster, raster↔vector, vector↔vector with different sprite and glyphs, ↔blank): 0 metadata reloads of the GeoJSON source, 0 repeated tile calls of a vector data source, data stays drawn and on top. | Proposed: approach (a) for every swap (see below). |
| S4 `file_search_path` | **Fail.** `SET GLOBAL file_search_path = '/se-source/ws'` takes (a plain `SET` did not reach other connections), but relative paths still fail: read_parquet/read_csv are refused by the access check on the raw relative path; GDAL ignores the setting. Absolute `/se-source/ws/...` paths work. | Phase 9 fallback: rewrite literals to absolute paths with an offset map. |
| S5 GeoPackage fid (revised) | **Engine returns the real ids.** Every layer GDAL streams returns `fid` equal to the file's key (9 layers in 5 files, incl. attribute tables). Layers with ids not 1..N still fail in WASM ("thread constructor failed": gapped-ids `zones`, `notes`); through the SQLite-driver copy they return the real `fid` too (101…123; 7, 9, 11). `ST_Read_Meta` has no FID field (keys: name, feature_count, geometry_fields, fields). | Phase 6 changes (see below): no row-number fid, no sql.js for ids. |
| S6 CARTO without key | ~~**Pass.**~~ **Corrected in phase 7: fail.** `light_all`, `dark_all`, `voyager` answer 200 OK with and without `?key=`, but every tile without a valid key (or with a fake one) is the same 2,049-byte "API KEY REQUIRED" image; the spike checked only the status. | CARTO is "key required". |
| S7 GDAL `COPY … (FORMAT GDAL)` | **Fail by the plan's rule, but close.** GPKG: `sqlite3_exec(CREATE TABLE gpkg_spatial_ref_sys …)` IO error. FlatGeobuf, Shapefile, KML, GeoJSONSeq, GeoJSON now write to a plain `/se-source/` path (new since 1.4.3/1.5.4), but every file has **one garbage byte prepended** (differs per file), so the engine can't read its own output. With that byte dropped, GeoJSON, FlatGeobuf and KML are byte-identical to native DuckDB 1.5.6 output. `/vsimem/` is now refused by the lockdown; a pre-registered buffer gets 0 bytes. | JS writers kept for now; decision asked (see below). |
| S8 sqlite_scanner | **Pass with a workaround.** It refuses registered files ("its -journal sidecar holds a hot rollback journal") unless an empty `<file>-journal` is registered next to the database. Then `sqlite_scan` and `ATTACH … (TYPE sqlite, READ_ONLY)` read GeoPackage and SQLite: `sqlite_master` lists every table; real ids (incl. the gapped `zones` GDAL can't stream; Cube `n`). `duckdb_tables()` on the attached SpatiaLite file fails (`no such module: VirtualSpatialIndex`): list through `sqlite_master`. The lockdown still refuses other paths. | Phase 6: list tables with sqlite_scanner; keep sqlite_scanner in EXTENSIONS. |
| S9 excel | **Reads well; writes with the same stray first byte.** `COPY … (FORMAT xlsx)` writes 180 rows; the engine and openpyxl read it (zip readers tolerate a prefix), but the bytes start with one garbage byte before `PK`. `read_xlsx` reads an openpyxl workbook with types (lon/lat DOUBLE → ST_Point works). | Decision asked (see below). |

Where the stray byte comes from (`spikes/straybyte.spec.ts.txt`): the engine itself sees it
(`read_blob`), so the extension writers put it there. DuckDB's own CSV, Parquet and JSON
writers are clean.

Engine start (page load to "SQL engine ready", warm, 5 reloads, median): base 3.31–3.51 s;
with sqlite_scanner + excel 3.51–3.52 s. No measurable cost (plan limit: 1.5 s). The VS Code
warm start will be measured when phase 6 adds the extension.

How GeoLibre handles the same points (checked at the user's request):
- Basemap swap: `MapController.applyStyleToMap` calls `setStyle(url, { diff: false })` and
  rebuilds every own layer and source in `style.load`, so its data reloads on every swap.
  Only maplibre-gl-basemap-control uses `transformStyle` (to rewrite Mapbox styles).
- Vector export in the browser: pure-JS writers, plus a separate ~18 MB WASI GDAL tool
  (`geolibre-wasm`, `vector_convert`) for FlatGeobuf and others. It does not use DuckDB's
  GDAL `COPY` in the browser.

## Engine export writers (Option B, user decision 2026-10-12)

The user chose option B for S7/S9: move exports to the engine where it works, dropping the
stray first byte only when the format's signature starts at byte 1
(`packages/core/src/export/engineFile.ts`). Measured in the real web build before switching
each format (`spikes/export-*.spec.ts.txt`):

| Format | Engine writer | Result | Kept |
|---|---|---|---|
| FlatGeobuf | GDAL `COPY` | 100,000 polygons in 1.36 s (GeoParquet: 1.38 s); 1M-row cancel in 0.88 s; QGIS reads WGS84 (180 features) and EPSG:26912 (1) correctly | **Engine**, with a spatial index. A result with a row without geometry is written without the index (GDAL: "NULL geometry not supported with spatial index"). DuckDB's own FlatGeobuf reader can't read a file with a null or empty geometry back, from GDAL or from the former JS writer (0 rows; QGIS reads 180), so that case is checked by its header only. |
| xlsx | excel `COPY … (FORMAT xlsx)` | 100,000 rows in 0.86 s; openpyxl reads header and rows; dates and times are real Excel dates | **Engine**. The JS xlsx writer is deleted. |
| GeoJSON | GDAL `COPY` | 100,000 polygons did not finish in 5 min; a 1M-row cancel took 346 s | JS writer (0.55 s for 100,000 in spec 005) |
| KML | GDAL `COPY` | 100,000 polygons did not finish in 5 min | JS writer |
| Shapefile | GDAL `COPY` | Corrupt: the .dbf header says 0 records, the .shx size is wrong (GDAL rewrites headers at the end; those writes don't land right in the WASM file layer) | JS writer |
| GeoPackage | GDAL `COPY` | IO error (S7) | JS writer |

Also found while switching:
- **Axis order.** Without `geometry_always_xy`, GDAL writes EPSG:4326 in authority order
  (latitude first): the S7 KML had `40.7,-111.896`. The engine now sets
  `SET GLOBAL geometry_always_xy = true` before the lockdown; export-formats.spec checks
  that KML coordinates are longitude first.
- GDAL refuses HUGEINT and INTERVAL columns; the plan casts them to text for FlatGeobuf,
  nested values to JSON text and blobs to base64 (as the JS writers did).

Also from S9: `.xlsx` opens as an input format (`read_xlsx`, like CSV: lon/lat, longitude/
latitude or WKT columns), and `excel` is a pinned extension (no measurable start cost, S8/S9).

## Phase 4–5 checkpoint (new map drawing; FlatGeobuf read whole)

Measured in the web build (headless Chromium, software WebGL), `spikes/measure.spec.ts.txt`:

| Case | Mode | Facts | Drawn | Engine calls while panning | 5 pans at 6× CPU: long tasks / longest | Pan phase |
|---|---|---|---|---|---|---|
| parcels-10k.geojson | GeoJSON | 0.98 s | 2.0 s | 0 | 9 / 238 ms | 6.1 s |
| parcels-77k.geojson | GeoJSON | 3.0 s | 7.9 s | 0 | 13 / 1,970 ms | 34.6 s |
| parcels-230k.geojson | tiles | 12.7 s | 14.6 s | 2 tiles | 6 / 209 ms | 4.7 s |

Spec 007's per-pan views re-queried on every pan; now GeoJSON mode does no engine work
while panning, and tiles mode builds only the tiles that come into view (S1: ~16 ms each).

**Tiny features at overview zoom (decision asked).** MapLibre's GeoJSON tiler
(geojson-vt) drops features smaller than its simplification tolerance: parcels-10k drew
**0 features** at its fit-to-extent zoom (5.4). Spec 007 hid this with per-view "dots".
Phase 4 sets `tolerance: 0` on our GeoJSON source (everything drawn), at a cost in pans:

| GeoJSON source | 10k: drawn at overview / longest task 6× | 77k: drawn / longest task 6× |
|---|---|---|
| default tolerance (GeoLibre, maplibre-gl-vector) | 0 / 0 ms | 0 / 0 ms |
| `tolerance: 0` (committed) | 10,005 / 238 ms | 77,001 / 1,970 ms |

Engine tiles have the same blind spot (`ST_AsMVTGeom` drops polygons that collapse on the
tile grid: 876 of 10,000 parcels drawn at z5), as maplibre-gl-vector's tiles do.

**Option C (user decision 2026-10-13): dots for features too small to see.** The GeoJSON
load also reads each line or polygon's center and the zoom below which it spans under 2 px
(`log2((2·360/512) / max(width, height))`); the center goes to the source as a point with the
same id, `__se_dot` and `__se_dotz`, and the circle layer draws it only below that zoom. The
GeoJSON source is back to the default tolerance. Engine tiles send a line or polygon under
2 px of the tile (tile width / 256) as its center with `__se_dot` (all 230k parcels show at
the overview, against a sparse scatter before). The shared feature id keeps hover, selection
and ticks on the dot.

Measuring it found the real cost in the earlier pans: MapView counted the rendered features
(`queryRenderedFeatures`) on every idle for the tests, and with every parcel drawn that count
was the longest task (77k: 1.8 s at 6×; tiles: 2.5 s). The count is now published only with
test hooks on (`data-se-test-hooks`: web `?e2e` or `navigator.webdriver`, VS Code outside
Production mode); the measurement removes it before panning:

| Case (option C, no count) | Drawn at overview | 5 pans at 6× CPU: long tasks / longest | Pan phase |
|---|---|---|---|
| parcels-10k.geojson | 10,000 | 0 / 0 ms | 4.0 s |
| parcels-77k.geojson | 76,924 | 0 / 0 ms | 4.1 s |
| parcels-230k.geojson (tiles) | 123,187 rendered | 0 / 0 ms | 4.5 s |

Heavy geometry: 72,000 detailed country polygons (`SELECT a.* FROM layer a, range(400) b`
on world-boundaries) draw in GeoJSON mode in 18–20 s with ~1.5 s long tasks, whatever the
tolerance; the cost is handing ~72k complex features to MapLibre's worker.

VS Code (Extension Development Host, `npm run screenshots --file parcels-230k.fgb`):
parcels-230k as FlatGeobuf is read whole, drawn from engine tiles, the status bar shows
"Tiles · Load all", a clicked parcel opens in the inspector and is highlighted
(`screenshots/p230k/`).

A livelock found by the accessibility export test: user work cancelled the running tile,
then the tile provider retried the moment the engine was idle and started first, forever.
Fix: while user work waits for the engine, new tiles and views are skipped (they retry
after). maplibre-gl-vector (GeoLibre) runs every engine call through one FIFO queue
without preemption, so it can't hit this; our engine lets user work preempt tiles.

## Phase 6: GeoPackage and SQLite without sql.js (as amended, user decision 2026-10-12)

- The plan's option A (a `fid` from `row_number()`) is not used: DuckDB 1.5's `ST_Read`
  returns the real id (S5), also through the SQLite-driver copy for layers GDAL can't
  stream (gapped `zones`: 101…123; `notes`: 7, 9, 11). The key restore (sql.js read of
  the INTEGER PRIMARY KEY, key tables, POSITIONAL JOIN) is removed.
- A SQLite file's attribute-only tables are listed with `sqlite_scanner` (S8): an empty
  `<file>-journal` is registered next to the database, then `sqlite_master` and a
  `count(*)` per table. The extension is pinned and hash-checked like the others and is
  optional: if it is missing or fails, the spatial layers still open (logged).
- The whole file is copied into memory only for a GeoPackage with a layer GDAL can't
  stream; a failure there gives "This GeoPackage layer can't be read in this engine
  without loading the file into memory, and that failed: …".
- sql.js now serves GeoPackage export only. Test: opening `gapped-ids.gpkg` and
  `cube-network.sqlite` makes no request for sql.js.
- The plan's `corrupt-key.gpkg` fixture is skipped: it tested "sql.js fails while GDAL
  opens", and sql.js is no longer on the open path.

VS Code open of the 10 MB performance file with sqlite_scanner loaded at start (3 runs, median):
1,949 ms, against 2,047 ms without it: no measurable cost.

## Phase 7: basemaps

- **One swap path (S3 approach a, user decision).** A basemap change removes the old
  basemap's layers and sources and adds the new ones under our first `se-` layer, then
  sets glyphs and sprite; there is no `setStyle`. Tests: six quick switches leave only
  the last basemap (one raster source, under the data); across raster, vector and blank
  swaps our GeoJSON source is never loaded again (`metadata` events), and in tiles mode
  MapLibre asks for no tile again (no engine call, no cache hit).
- **Gallery** (`scripts/basemap-catalog.mjs` → `basemapGallery.json`): 82 of the package's
  142 basemaps after the exclusions and dropping the featured duplicates; 22 CSP hosts.
  Two upstream MapTiler URLs lack the `{api-key}` placeholder (`?key`, `?key=`) and answer
  403 without a key: the script fixes them. The plan's search example ("esri imagery") is
  the featured Satellite row, so the gallery test searches "esri topographic"; Esri's
  entries are named "World …" (provider "ESRI").
- **CARTO needs a key** (S6 corrected above): no entry is "key optional" now; the code
  path stays for providers that are.
- Opening the gallery and typing a search at 6× CPU: longest task 63–68 ms (limit 100).

## Phase 8: layout Option A

Built as the plan says (activity rail, side panel, bottom panel with Table and SQL tabs,
floating search and layer select, the web status bar as a full-width row under the panels,
the layout remembered through `saveState('layout')`). Departures and findings:

- **The map keeps its top-left corner when a panel opens or closes.** A MapLibre resize
  keeps the center, so opening the 300 px side panel slid every feature 150 px under the
  cursor (a Ctrl-click after the Details panel opened hit the wrong feature). After a
  resize the map pans by half the size change, unless the app moved the camera itself in
  the last second (fit, zoom to a feature, a restored link): those views keep their center.
- **The inspector keeps its id and Zoom row** inside the Details panel (the plan said no
  header); the style panel keeps its "Default · modified" line. Escape in the SQL editor no
  longer closes the side panel (Escape closes it when focus is inside it).
- **The style type choice wraps to two rows** in a side panel under 330 px (container query);
  four labels didn't fit 300 px.
- **A completion list left open by Ctrl+Enter** stayed over the hidden SQL tab once the
  result switched to the Table tab, and the editor could not be clicked again: running now
  closes it.
- **Engine scheduling livelock (found while chasing that, fixed):** background work
  preempted by user work retried at once, restarted while the user work was still
  cancelling it, and could spin without leaving the microtask queue. Background work now
  waits while user work is waiting, as views and tiles already did, and `whenIdle()` waits
  until no user work is waiting.
- Links (`--se-link`) had no value in either shell; the web's amber accent fails AA on the
  side panel's cream: amber-800 there; VS Code uses `textLink.foreground`.
- Screenshot tool: after 72,000 detailed polygons were drawn, a later style change on a
  180-row result spent ~1.9 s in WebGL `bufferData` and a screenshot took 7–42 s, in
  headless Chromium's software WebGL only (the source held the 184 new features; VS Code
  took the same scene in time). The 72k scene now runs after the style and export scenes.

### Basemap gallery, revised (user feedback 2026-10-13)

The user found 82 basemaps not exhaustive (no CARTO vector styles, no OpenFreeMap in the
gallery, Protomaps hidden behind keys) and chose to lift the provider exclusions. How
GeoLibre does it: a short curated picker (OpenFreeMap incl. Liberty 3D, Protomaps, ArcGIS,
Mapbox, regional, custom URL) plus the full maplibre-gl-basemap-control panel with nothing
excluded (it stacks overlays). Now:

- 129 basemaps from 26 providers, grouped in collapsible provider sections with counts, a
  Vector/Raster filter, and the featured basemaps listed in their providers' sections
  (choosing one chooses its featured row).
- Added keyless vector styles the package lacks: CARTO GL (Positron, Voyager, Dark Matter,
  each with a no-labels variant; styles, tiles, sprites and fonts answer without a key) and
  VersaTiles (Colorful, Colorful Dark, Gray, Gray Dark, Muted).
- Google: keyless public tiles, or with a key Map Tiles API sessions (`createSession`,
  cached per key and map type). Mapbox: the style's mapbox:// sprite, font and tileset URLs
  are rewritten with the token. Amazon Location: key and AWS region (a saved setting).
  Amap and Tencent carry a GCJ-02 offset warning. All adapted from the package (MIT).
- Still out: overlays meant to stack on another basemap (labels-only, traffic, transparent
  overlays tagged as such) and Liberty 3D (the Liberty style with a saved tilted camera;
  Liberty's own `building-3d` extrusions are in the Liberty style we draw).
- Overture Maps: PMTiles themes but no MapLibre style, and "not designed to be a
  production-ready cartographic basemap" (docs); not added (user: not needed).
- Gallery open + search at 6× CPU: rendered progressively (8 rows, then 12 per task);
  longest task 73–86 ms over five runs (the flat virtualized list: 69–79 ms).

## Phase 9: SQL across workspace files

- S4 failed, so the fallback is in place: `referencedPaths` finds relative data-file
  literals (tokenizer-based, so comments are skipped), the host resolves them, the session
  registers each under `/se-source/ws/<path>` and rewrites the literal; an engine error's
  offset is mapped back through the rewrite, so positions point at the user's text and
  messages never show `/se-source/`.
- A literal that can't be resolved refuses the statement only when it is read as a file
  (the argument of a reader such as `ST_Read`/`read_parquet`/`read_csv_auto`, or a
  `FROM`/`JOIN` file table). `WHERE name = 'x.csv'` still runs.
- VS Code: files are served by the loopback server under the viewer's existing token as
  `ws/<path>` (one encoded URL segment; `handle()` already decoded it whole), with
  same-basename sidecars. Paths are refused when absolute, with `..`, backslashes or a
  scheme, and when they resolve outside the root. Non-`file:` workspaces get a clear error.
  The list follows the folder (a watcher on the data glob, 500 ms debounce).
- Web: the workspace is the open file plus added files (Add files… or a drop on the Files
  list). Found in testing: grouping by basename merged `sample.gpkg` and `sample.shp` into
  one entry; now each data file is its own entry, with the sidecars of its basename.
- Paths are suggested inside string literals (completion), the open file excepted (it is
  `layer`).
- How GeoLibre handles it (apps/geolibre-desktop/src/lib/sql-workspace.ts): every loaded
  layer is copied into a DuckDB TEMP TABLE named after the layer, so SQL names layers, not
  files; URL arguments of native readers are registered as HTTP file handles (range reads);
  bare paths/URLs after FROM/JOIN are wrapped in the matching reader. Our single-layer rule
  (spec 010) keeps other files off the map, so they are named by path and read in place
  (no copy), which matches how DuckDB users write `read_parquet('…')` outside the tool.
  Bare unquoted paths after FROM are not wrapped here (not in the plan).

## Phase 10: one search box

- Layer values and coordinates follow the typing (values debounced 200 ms, one background
  query; a search overtaken by a newer one before it runs returns nothing). Places do
  **not**: the plan's "on input" would send typed text to Nominatim, which spec 008 FR-033
  and Nominatim's policy forbid (place-search.spec.ts checks typing sends nothing). Places
  are one option away, `Search places for "…"` (Enter when it is the highlighted option),
  after the one-time notice, as before.
- Values: one hit per column and value with its row count (the plan's per-row hits showed
  "Africa" eight times on a continent column), exact matches first, then prefixes, then
  shorter values; table filters apply. Choosing one selects its first row, opens Details
  and zooms (in tiles mode the row is fetched by id).
- Coordinates: `lon, lat` by default; `lat, lon` when only that fits (a pasted Google Maps
  pair); both offered when both fit; hemisphere letters and degree signs fix the order.
- PlaceSearch.svelte is gone; SearchBox.svelte is always on the map (places only when the
  setting allows them).
- How GeoLibre does it (components/panels/LayerPanelPlaceSearch.tsx, lib/feature-search.ts,
  lib/coordinates.ts): one combined box too, with the same grouping (data matches by layer
  first, then places) and the same exact > prefix > contains ranking, one row per feature
  (ours: one per value, with a count). Differences: it geocodes while typing (debounce
  max(500 ms, the provider's minimum interval)), which our FR-033 rules out; a bare pair
  is read lat, lon first (ours lon, lat, the plan's example, with the other order offered
  too when it fits); it also reads MGRS/UTM grid references and H3 cells (not added: not
  in the plan).
- Responsiveness at 6× CPU throttle (parcels-10k.geojson, typing `P0000765` at 120 ms per
  key): values shown 226 ms after the last key in GeoJSON mode and 214 ms in tiles mode
  (`tileRows=1000`), 200 ms of it the debounce; no long tasks while typing.
