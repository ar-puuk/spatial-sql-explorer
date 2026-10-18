# Research: File Geodatabase (.gdb) support

**Date**: 2026-10-14 · **Status**: research only, nothing built. Supersedes spec 008 research §2 once a plan is approved.
**Trigger**: user request: most of their work is in File Geodatabases; today both shells refuse `.gdb` with an ogr2ogr hint.

## 1. The engine still can't read it (re-verified on DuckDB-WASM 1.5.6)

Spike `spikes/wasm-engine-gdb.spec.ts.txt`, result `spikes/wasm-engine-gdb-1.5.6.json` (installed Chrome, the app's own engine):
- `ST_Drivers()` has no `OpenFileGDB` (nor `FileGDB`). Present: Shapefile, GPKG, FlatGeobuf, SQLite, GeoJSON, CSV, KML, GML, ...
- With every file of `two.gdb/` registered under `/se-source/s/two.gdb/` (`glob()` lists them):
  `ST_Read_Meta` on the folder returns no rows; `ST_Read(folder, layer=…)`, `ST_Read(<a gdbtable>)` and `/vsizip/` on a `.gdb.zip` all fail with "Could not open GDAL dataset".
- **Why**: it is a deliberate build choice. duckdb-spatial `vcpkg_ports/gdal/portfile.cmake` (main, 2026-10-13):
  ```cmake
  # Doesnt work on wasm32
  if(NOT VCPKG_TARGET_ARCHITECTURE STREQUAL "wasm32")
      set(OGR_ENABLE_DRIVER_OPENFILEGDB ON)
  endif()
  ```
  (commit f0a803a, 2025-06-19, "add back openfilegdb driver"). History: it was first turned off for WASM in deaa2ef (2024-06-02,
  Carlo Piovesan, "Conditionally skip openfilegdb driver on wasm targets"), alongside 32-bit flags (`SIZEOF_OFF_T=4`,
  `SIZEOF_UNSIGNED_LONG=4`). No reason in the commit; the 32-bit `off_t` setting is a plausible cause, but that is unverified. gdal3.js compiles the same driver with Emscripten (§3), so the
  blocker is likely in DuckDB's WASM build or file system glue, not in the driver.

## 2. GeoLibre does it outside the browser

GeoLibre (`apps/geolibre-desktop/.../add-data/sources/GdbSource.tsx:83-108`) states the same limit ("the WASM spatial build lacks the OpenFileGDB
driver") and reads GDB **desktop only**, through its Python sidecar running native DuckDB spatial:
- folder picker (`*.gdb` only); layers from `st_read_meta('<gdb>/*.gdbtable')` (a bare folder returns nothing), `GDB_*` system tables dropped
  ("reading one through ST_Read crashes DuckDB spatial"), non-spatial tables hidden;
- the chosen layer is converted to a temp GeoJSON in EPSG:4326, loaded whole into memory, temp file deleted after the job finishes;
- fixes after launch: layers without a CRS are refused (or the user types one), the CRS override resets when the layer changes,
  listing and conversion share one CRS lookup, fixed layer order;
- no handling of large layers, compression, domains, subtypes, rasters. The web build has no GDB.

We have no sidecar and no native GDAL, so the transferable parts are the UX rules, not the runtime.

## 3. gdal3.js (GDAL 3.8.4 compiled to WASM) reads it, fast, from disk

`gdal3.js@2.8.1` (LGPL-2.1+, GDAL 3.8.4, Emscripten). Assets: 27 MB `.wasm` + 12 MB `.data` (PROJ db etc.) + 188 KB JS.
Spikes in Node (= the VS Code extension host), scripts in `spikes/gdal3js-*.cjs.txt`:

| Test | Result |
|---|---|
| `two.gdb` fixture | opens (driver "ESRI FileGDB"), lists `countries` (180), `cities` (2); converts to FlatGeobuf and GPKG. No Parquet/Arrow driver in this build. |
| `big.gdb` 818 MB, UTM 12N (EPSG:26912), 444k + 4M parcels, one in a feature dataset | open + layer list **87 ms**, RSS 119 MB (NODEFS reads lazily) |
| 444k parcels → FGB (in memory) | 2.1 s (8.2 s with `-t_srs EPSG:4326`), 174 MB |
| 4M parcels → FGB (in memory) | 21 s, 1.6 GB, **RSS 5.5 GB**: in-memory output does not scale |
| 4M parcels → FGB **written to a NODEFS mount** (`Gdal.Module.FS.mount(NODEFS, …)`, output name `../disk/…`) | 34 s, **RSS 498 MB** |
| ArcGIS Pro 3.2+ layout (`TARGET_ARCGIS_VERSION=ARCGIS_PRO_3_2_OR_LATER`, Int64 fields) | reads |
| Curves (CIRCULARSTRING, COMPOUNDCURVE) | read, linearized |
| POINT Z | reads, Z kept |

So: list layers in milliseconds, convert a layer once to a disk FlatGeobuf, and hand that to the pipeline we already have (FGB is a
supported format with range reads; over 100 MiB it draws from engine tiles). Reprojection is better left to the existing CRS path
(DuckDB `ST_Transform`), since `-t_srs` quadruples conversion time.

## 4. Format limits (GDAL OpenFileGDB driver docs, all versions)

- **Compressed geodatabases (CDF / SDC) are not readable** by OpenFileGDB at all, only by Esri's SDK (FileGDB driver). Needs a clear message:
  "Uncompress it in ArcGIS (Uncompress File Geodatabase Data)".
- 64-bit OBJECTIDs: GDAL ≥ 3.9 (sparse OIDs ≥ 3.10, read-only, incomplete). gdal3.js 2.8.1 is 3.8.4: **Pro 3.2+ feature classes created with
  64-bit OIDs are a risk** (not tested: GDAL can't write sparse 64-bit OIDs, needs a real ArcGIS file).
- Supported: curves, Z/M, feature datasets (3.4+), coded/range domains (3.3+, `ogr2ogr -resolveDomains` adds description columns; not
  spiked), relationships (3.6+), attribute (.atx) and spatial (.spx) indexes. Rasters (3.7+) are out of our scope (no raster analysis).
- `.gdb.zip` with the `.gdb` at its first level is read directly through `/vsizip/`.

## 5. Options

| | Option | Verdict |
|---|---|---|
| A | **gdal3.js as a converter**: GDB layer → FlatGeobuf cache, then the existing FGB pipeline | **Recommended.** Proven above. |
| B | Upstream: enable OpenFileGDB in duckdb-spatial's WASM build | Best end state (plain `ST_Read`, no extra 40 MB), but outside our control and the reason it was disabled is unknown. File an issue / try a PR in parallel; don't wait on it. |
| C | Build our own spatial WASM extension with the driver on | Rejected: unsigned extension loading, a vcpkg+Emscripten CI build per DuckDB upgrade. |
| D | Use a native `ogr2ogr`/QGIS found on PATH | Rejected as the main path (most users don't have it; breaks Remote/web). |
| E | Own TS/Rust reader | Rejected: the npm `fgdb` reader fails on current files (spec 008); `geonative-filegdb` (Rust, 0.4.0) is pre-release, 2D only, no compression. A correct reader is a project of its own. |

## 6. Sketch of option A (for the plan, not decided)

- **VS Code (priority)**: gdal3.js runs in the **extension host** (Node, so Remote-SSH/WSL/Containers read the files where they live).
  The existing `.gdb` folder command lists layers (name, geometry type, count, CRS, feature dataset; `GDB_*` and, by default, non-spatial
  tables hidden), converts the chosen layer to `globalStorage/gdb-cache/<hash of path + table file mtimes>/<layer>.fgb`, and opens it through the
  normal FGB path. Other layers convert on first use. The cache is invalidated when the `.gdbtable` changes.
- **Web**: gdal3.js in a worker, files mounted with WORKERFS (lazy, no copy) from a picked folder (`showDirectoryPicker` / `webkitdirectory`)
  or a `.gdb.zip` via `/vsizip/`. Output must go to OPFS, not memory, for large layers. **Not spiked yet**: the folder layout under WORKERFS.
- **vscode.dev**: no Node host; would need the web path inside the webview. Defer.
- **Assets**: like the engine (constitution v1.2.0): pinned URL + SHA-256 in `engineAssets.json`, kept by `HostAdapter.engineFile`,
  downloaded only the first time a `.gdb` is opened. LGPL: loaded unmodified as a separate file, notice in THIRD-PARTY-NOTICES.md.
- **SQL names**: as for GeoPackage, a schema named after the `.gdb` with one view per converted layer (`landbase.parcels`).
  Queries naming other layers (`ST_Read('data/x.gdb', layer='roads')`) need the path rewritten to the cache. Open question.
- **Messages**: compressed GDB, 64-bit OID tables, a layer with no CRS (GeoLibre's rule: ask for one).

## 7. Decisions needed from the user

1. Accept a new dependency (gdal3.js, ~40 MB downloaded on first `.gdb` open) and a conversion cache on disk (about the layer's size).
   This amends the constitution and CLAUDE.md ("Converting in the extension host: no native GDAL" no longer holds).
2. What real GDBs look like: size, ArcGIS Pro version, 64-bit OIDs, compressed or not, domains/subtypes that matter. A real sample would
   close the §4 risks.
3. Web scope: same feature, or VS Code first with web later.
4. Whether SQL must reach unopened layers of the same `.gdb`.

## 8. Spikes on a real geodatabase (2026-10-18, branch 013-file-geodatabase)

Sample: a Cube/Citilabs transit network, 111 MB, 406 files, UTM 12N (EPSG:26912), uncompressed, 14 feature datasets. Scripts and raw output in `spikes/`.

| Test | Result |
|---|---|
| gdal3.js 2.8.1 (GDAL 3.8.4) opens the folder | 160 ms, 56 layers (53 spatial, 3 non-spatial), driver OpenFileGDB |
| `ogrinfo -json` through `Gdal.ogrinfo` | 20 ms: per-layer geometry type, extent, CRS WKT, field list, `domains` and `relationships` keys. This sample has no domains (the key is empty), so domain reading is **still untested** |
| Link (58,195 lines) to FlatGeobuf on a NODEFS mount | 1.8 s, 109 MB, CRS kept |
| Node (21,964 points) | 0.26 s, 13 MB |
| Non-spatial table to FlatGeobuf | fails ("NULL geometry not supported with spatial index"); works with `-lco SPATIAL_INDEX=NO` (geometry "Unknown"); GPKG also works |
| `.gdb.zip` (the folder at the zip's first level) opened by path | 349 ms, 56 layers, converts identically. (`/vsizip/` prefix by hand fails; gdal3.js detects the zip itself.) |
| gdal3.js vector drivers (53) | OpenFileGDB, FlatGeobuf, GPKG, GeoJSON, Shapefile, CSV, SQLite, XLSX ... **no Parquet or Arrow writer**, so GeoParquet cannot be the intermediate without a second DuckDB step |
| DuckDB-WASM engine, `/vsizip/` on .shp.zip, .gpkg.zip, .geojson.zip, .gdb.zip | **All fail.** With the lockdown: "VSI prefix: External access is disabled". With the lockdown skipped: "Could not open GDAL dataset". The engine cannot read zips at all |

Consequence: zipped GIS files are the shell's job (unzip, register the inner files), or gdal3.js's job for geodatabases.

## 9. Domains and the browser (2026-10-18)

**Domains.** A test geodatabase with a coded-value domain and a range domain (built with GDAL 3.13: `spikes/make-domains-gdb.py.txt`). `Gdal.ogrinfo(ds, ['-json','-so','-al'])` in gdal3.js 3.8.4 returns:
`domains: { RoadClass: {type:'coded', fieldType:'Integer', codedValues:{"1":"Freeway","2":"Arterial","3":"Local"}}, Lanes: {type:'range', minValue:1, maxValue:12, ...} }`
and each field carries `domainName`. The FlatGeobuf conversion keeps only the raw codes (no domain), so the descriptions have to be stored beside the cache file (`<layer>.domains.json`) and applied by the app. Subtypes were not tested.

**Browser (Chrome, gdal3.js in our own Web Worker, `useWorker: false`, the real 111 MB sample, picked with `<input webkitdirectory>`).**

| Test | Result |
|---|---|
| Mount the picked files with `FS.mount(WORKERFS, {files}, '/input/<name>.gdb')` (a geodatabase is a flat folder, so flat is right; gdal3.js's own `Gdal.open(files)` is flat and unusable for this, and `open` only accepts paths under `/input` or `/output`) | 406 files, open 449 ms, 56 layers |
| Convert Link straight from WORKERFS | **33 s** (a Blob read per page) |
| Same, layer's files + every file under 2 MB first copied into memory (`File.arrayBuffer` into `/output/<name>.gdb`) | copy 0.2 s (98 MB), open 52 ms, convert **1.2 s**, 109 MB FlatGeobuf |
| Which files belong to a layer | `GDB_SystemCatalog` (open option `LIST_ALL_TABLES=YES`, `ogr2ogr -f CSV -sql "SELECT FID, Name FROM GDB_SystemCatalog"`): row id N is file `a<N in 8 hex digits>.*` (Link = `a0000000e`). 66 rows in 0.5 s |
| `.gdb.zip` mounted with WORKERFS (one File) and opened with the `vsizip` handler | open 6 s, convert 1.6 s |
| Result to OPFS (`createSyncAccessHandle`) | 109 MB in 0.3 s |

Heap stayed at 512 MB. The ceiling is memory: a layer's table files plus its FlatGeobuf must fit (about 3 GB of heap at most). A layer past that needs a streaming path (not spiked).
