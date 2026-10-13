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
