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
| S6 CARTO without key | **Pass.** `light_all`, `dark_all`, `voyager` 200 OK with and without `?key=`. | CARTO is "key optional". |
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
