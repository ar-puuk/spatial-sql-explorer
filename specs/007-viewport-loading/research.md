# Research: Large Files and Viewport Loading (spec 007)

Phase 0 of `/speckit-plan`. Every item was spiked on 2026-10-10/11 against the
**real** engine: DuckDB-WASM 1.32.0 (DuckDB v1.4.3) with spatial, after the
spec 002 lockdown. The web spikes ran in the production web build (headless
Chromium). The VS Code spikes ran inside a real custom-editor webview (VS Code
1.141.0, `@vscode/test-electron`).

**Evidence** is in `spikes/`:
- `s*.json` hold the measurements;
- `harness.patch` holds the temporary hooks;
- `web-spikes.spec.ts.txt` and `vscode-spike.test.ts.txt` are the spike tests.

To re-run: apply the patch, copy the two tests back as
`tests/web/specs/zz-spike-007.spec.ts` and
`tests/vscode-ext/src/suite/zz-spike007.test.ts`, generate the data (below),
and run them. `SE_TEST_GLOB` (now in `tests/vscode-ext/src/suite/index.ts`)
selects one VS Code test file.

## Test data

`scripts/large-data.sql`, run by the native DuckDB 1.5.5 CLI, writes synthetic
parcels across Utah into the gitignored `tests/.large-data/`:
- 12-vertex polygons;
- 80% are clustered into 20 "cities", the rest scattered;
- 6 attributes, plus a GeoParquet 1.1-style `bbox` struct column;
- Hilbert-sorted, in row groups of 100,000.

The other files are derived with OSGeo4W's GDAL 3.13 (`ogr2ogr`):

| File | Size | Features | Notes |
|---|---|---|---|
| `parcels-4m.parquet` | 762 MB | 4,000,000 | 40 row groups, `bbox` covering column |
| `parcels-4m-nobbox.parquet` | 651 MB | 4,000,000 | geometry only (no covering column) |
| `parcels-4m.fgb` | 1.45 GB | 4,000,000 | packed Hilbert R-tree (`SPATIAL_INDEX=YES`) |
| `parcels-460k.fgb` | 158 MB | 444,445 | with index |
| `parcels-77k / 230k / 460k.geojson` | 56 / 172 / 325 MB | 76,924 / 235,295 / 444,445 | |

The derivation commands are `ogr2ogr -f FlatGeobuf out.fgb in.parquet -lco
SPATIAL_INDEX=YES` and `ogr2ogr -f GeoJSON out.geojson in.parquet -sql "… WHERE
parcel_id % k = 0"`.

---

## 1. The memory ceiling is 3.1 GiB, not ~512 MB

**Finding**: `current_setting('memory_limit')` is **3.1 GiB** in both shells.
- In both shells, two full in-memory copies of the 4M-parcel file (about 2.5
  GB) succeed.
- A third copy fails cleanly: "Out of Memory Error: failed to allocate data of
  size 16.0 MiB (3.1 GiB/3.1 GiB used)". The engine survives (`SELECT 42`
  works) (`s6-engine.json`, `s5-vscode.json`).
- The ~512 MB OOM noted in CLAUDE.md and the constitution was observed in
  omx-viewer, likely from JS-side copies (base64 strings, `ArrayBuffer`s). It
  is not the engine's limit.

**One trap**: after the OOM, the registered `File` handle read as empty ("too
small to be a Parquet file").

**Decision**:
- Budget against 3.1 GiB. Keep the source out of engine memory wherever
  possible (§2–§4).
- After any out-of-memory error, recovery drops `__se_` tables and
  **re-registers the source** before the viewer continues (FR-014).

**Follow-up**: CLAUDE.md's "~512 MB" line should be updated to this measured
figure. Proposed to the user, not edited here.

## 2. Web: register the picked `File` as a lazily read handle

**Decision**: the web shell registers the picked file with
`registerFileHandle(path, file, BROWSER_FILEREADER, true)`. The worker reads
slices with `FileReaderSync`. Nothing is copied into memory up front.
Registration takes 0 ms whatever the size.

**Evidence** (`s1-parcels-4m.parquet.json`, 762 MB GeoParquet):

| Operation | Time |
|---|---|
| Row count (Parquet footer) | 17 ms |
| `DESCRIBE`, `geo` metadata (extent, CRS, types) | 5–6 ms |
| City view via `bbox` columns (49 rows) | 56–86 ms |
| Region view, cap 50,000 | 303 ms |
| Same city view via `ST_Intersects(geom, …)` (no covering column) | **4,775 ms** (full scan) |
| `count(*) WHERE value > …` over all 4M | 66 ms |
| `GROUP BY zone` over all 4M | 175 ms |
| Quantiles over all 4M | 125 ms |
| `ORDER BY value LIMIT 100` | 143 ms |
| `ORDER BY value LIMIT 100 OFFSET 2,000,000` | 1,309 ms |
| `LIMIT 100 OFFSET 3,500,000` (no sort) | 21 ms |
| Materialize all 4M rows | 4,934 ms, 1.44 GB |

**Alternatives**:
- `registerFileBuffer` (today) copies the whole file into memory first, and
  doesn't scale.
- OPFS copies the whole file to disk, and CLAUDE.md rules out browser
  storage.

## 3. VS Code: a loopback range server in the extension host, reached as `localhost.`

**The problem**: spec 001 found that a worker in a VS Code webview can't fetch
the webview resource host. The cause is now pinned down in VS Code's webview
service worker (`pre/service-worker.js`, 1.141.0):
- Requests from **worker** clients to the resource host, and to any host
  matching `/^(localhost|127.0.0.1|0.0.0.0):(\d+)$/`, wait on a reply the
  outer frame never sends to workers.
- Each request stalls for the service worker's 30 s internal timeout.
- Measured: a full download that took 33 s, and stalls after 1–3 Range
  requests (`s5-vscode.json` history in the spike log).

**Decision**: the extension host serves each opened file from a loopback HTTP
server with single-range `HEAD`/`GET` support. The engine registers it with
`registerFileURL(path, url, HTTP, false)`.
- **Host name**: the URL uses **`localhost.`** (trailing dot), which the
  service worker's pattern doesn't match. Chromium still resolves it to
  loopback on every OS.
- **Engine config**: the engine is opened with `filesystem: {
  reliableHeadRequests: true, allowFullHTTPReads: false }`. With the defaults,
  DuckDB-WASM silently downloaded the whole file instead of using ranges.
- **The server must**:
  - answer `HEAD` with a `Range` header as **206** with the full length;
  - expose `Content-Range` and `Content-Length` (CORS);
  - allow `Range`;
  - send `Access-Control-Allow-Private-Network`.
- **CSP**: `connect-src` gains `http://localhost.:*`.

**Evidence**, in the real VS Code webview:

| Probe | Result |
|---|---|
| Worker, 50 sync Range XHRs to `localhost.` | 50 × 206 in **107 ms** |
| Same to `127.0.0.2` | 73 ms (Windows/Linux only; macOS has only 127.0.0.1) |
| Same to `[::1]` | refused: `NetworkError` on send (most likely the CSP, which has no clean IPv6 host form) |
| Engine: count (762 MB GeoParquet) | 10 ms |
| Engine: city view / region view (50,000) | 39 ms / 88 ms |
| Engine: `count(*) WHERE value > …` over 4M | 202 ms |
| Bytes read for all of the above | ~36 MB of 762 MB |
| Main-thread `fetch(asWebviewUri, Range)` | 206 in 3 ms (used for PMTiles, §8) |

The web build gave the same numbers through the same design (`s4-http.json`):
count 37 ms reading 47 KB, and the filter count read only the needed column
chunks (13.8 MB). The lockdown still refuses `read_parquet('http://…')` typed
directly, so user SQL can't reach the server or anything else.

**Security**:
- The server binds loopback only.
- It serves only files the user opened (plus shapefile sidecars), each under
  an unguessable per-document token path.
- It checks the `Origin` (`vscode-webview://…`), and stops when the last
  viewer closes.
- File bytes never leave the machine (Constitution IV).

**Remote-SSH / WSL / Containers** (not verifiable here: no remote host):
- The extension host and the server run remotely; `vscode.env.asExternalUri`
  forwards the port to a local `localhost:<p>`, and we rewrite the host to
  `localhost.`.
- **Unverified.** The viewer therefore probes with one `HEAD` (3 s timeout)
  and falls back (§7).
- vscode.dev has no Node server, so it always falls back.

**Alternatives**:
- `postMessage` of whole files (today): measured as the cause of the 50 MB
  GeoJSON taking more than 45 s; §5 shows parsing is fast.
- A synchronous worker↔main-thread bridge: needs `SharedArrayBuffer`, which
  isn't available.
- `127.0.0.2`: not portable.
- Port mapping through `webview.options.portMapping`: the service worker
  never consults it for workers.

## 4. Per-format read modes

**GeoParquet / Parquet: read in parts.**
- Facts come from the footer and the `geo` metadata.
- Views use the covering columns: the GeoParquet 1.1 `covering.bbox`, or a
  struct column named `bbox` with `xmin/ymin/xmax/ymax`.
- **Without covering columns**, one background scan builds a bbox index
  table (`file_row_number`, xmin, ymin, xmax, ymax): **6.9 s and 215 MB for
  4M rows**. Views then take 4 ms (index) plus 10 ms (fetch by
  `file_row_number`) (`s6-engine.json`). Until it is ready the map shows
  "Indexing…".

**FlatGeobuf: views in parts, whole-file work from memory.**
- Facts come from the header (`ST_Read_Meta`): count, CRS and fields in
  38 ms for 1.45 GB.
- Index-filtered views are fast while small (city view: 47 ms).
- But GDAL reads each feature separately, so through a handle or HTTP it
  costs about **0.74 ms per feature**:
  - 50,000 features take 37 s;
  - a full scan of 4M did not finish in 14 min;
  - a scan of 444k took 348 s.
- From a memory buffer, the same scan takes **232 ms** and the region view
  12 ms (`s7-fgb-buffer.json`).

**Decision for FlatGeobuf**:
- Files up to the whole-read threshold are loaded into memory: everything is
  fast.
- Larger files open in parts. The view cap is lowered to keep updates under
  2 s (about 2,500 features; tuned in implementation). The overview uses the
  index's leaf boxes (see §6).
- SQL, the table, styles and export ask once to load the file into memory
  ("Load 1.4 GB for queries"), with progress and Cancel. If it can't fit, the
  message suggests GeoParquet.

**Whole-read formats** (GeoJSON, Shapefile, CSV, GML, GeoPackage, the rest):
- Parsed once into a table, with bbox columns and an R-tree index.
- R-tree on 1M polygons: built in 492 ms; a view takes 3 ms instead of 305 ms
  (`s6-engine.json`).
- GeoJSON parse through a handle (web): 56 MB in 4.0 s, 172 MB in 12.0 s,
  325 MB in 22.7 s, using 25 / 74 / 140 MB of engine memory. Over the
  loopback server (VS Code): 172 MB in 8.6 s (`s3-*.json`, `s5-vscode.json`).
- **Avoid `ST_Read_Meta` on GeoJSON**: it parses the whole file (9 s for
  325 MB). Take the facts from the parsed table instead.
- GeoPackage is classified whole-read without a spike, as the spec says.
  SQLite pages arrive like FlatGeobuf features (many small reads), so the same
  per-read cost is expected. A partial GeoPackage mode would need its own
  spike later.
- **Whole-read threshold**: **100 MB** on disk, which is about 7 s of parsing
  at the measured ~70 ms/MB. Above it the viewer announces the read first
  (FR-004).

**PMTiles**: view-only, read by the map, not the engine (§8).

## 5. The 50 MB GeoJSON delay was the transfer, not the parse

Spec 005 saw a 50 MB GeoJSON fail to open in VS Code within 45 s. The parse
itself takes about 4 s (§4), so the time went to the transfer:
- the whole file is base64-encoded in the host;
- it is posted in chunks;
- it is decoded on the main thread;
- it is copied again into the engine.

The loopback server removes all four steps.

## 6. The map: queries per view, capped and thinned

**Decision** (revised during implementation; see "Implementation outcomes"):
- On `moveend` (debounced 150 ms), the store queries the result for the
  view's bbox: exact count first (16 ms on the 4M file, through the bbox
  columns), then the features. A result that fits under the cap skips the
  count: fetching everything in view gives it.
- **At or below the cap**, every feature in view is drawn.
- **Above the cap**, the drawn subset is a **proportional, deterministic
  sample**: each row in view is kept with probability ~cap / inView, decided
  by `hash(row id)`.
  - Density stays visible: dense areas stay dense, sparse areas sparse. This
    is what "an overview of the whole dataset's distribution" means.
  - A feature is in or out by its id, so panning doesn't shuffle features.
  - The final `LIMIT` cuts in hash order, not file order, so the subset is
    spread across the view.
- **At overview zoom, no geometry is read.** A sampled feature under ~2 px is
  drawn as a dot at its bbox center, taken from the bbox columns. Only the
  few larger features have their geometry fetched.
- **Stale views**: an older view's query is cancelled (`cancelSent`), and its
  result is dropped by generation number.
- **Notice**: "Showing 25,000 of 310,412 in view. Zoom in to see all."

**Display cap**: the design doesn't depend on its value, so it is set by
measurement in implementation (MapLibre `setData`, polygons, in both
shells).
- Starting point: **25,000**. Spec 002 already draws 50,000 rows in
  acceptable time, and the cap leaves room for pan responsiveness.
- FlatGeobuf in parts uses about 2,500 (§4).

**Alternatives**:
- **One feature per grid cell** (`DISTINCT ON (cell)`, the first design):
  rejected after screenshots of the 4M-parcel file. It equalized density, so
  20 dense "cities" vanished into uniform countryside, and it left many cells
  empty on clustered data (807 of a 1,000 cap).
- `USING SAMPLE … (system)`: 8 ms, but it picks whole vectors, which are
  spatial clumps on Hilbert-sorted files.
- Row-number modulo: even only when the file happens to be spatially sorted.
- **Vector tiles through `ST_AsMVT`**: available in the WASM build
  (`ST_AsMVT`, `ST_AsMVTGeom`, `ST_TileEnvelope`, `ST_Hilbert`, `ST_QuadKey`
  all exist). Deferred: per-view GeoJSON already meets SC-003 on the test
  files, and tiles would mean a second rendering path (Constitution X). It
  stays the fallback if the cap proves too low.

## 7. Fallback when the platform can't read in parts (FR-015)

When the loopback probe fails (vscode.dev, a remote host whose forwarding
doesn't work, a firewall), the VS Code shell falls back to today's chunked
whole-file transfer into a memory buffer.
- The viewer says why once: "Reading the whole file: partial reads aren't
  available in this window".
- Whole-read limits then apply to every format (FR-004).

The web shell has no fallback case: `File` handles always work.

## 8. PMTiles: the `pmtiles` library on the map, view-only

**Decision**: add the `pmtiles` package (BSD-3-Clause; the reference
implementation; about 15 KB). Register its protocol with MapLibre
(`addProtocol`), using a custom source:
- **web**: `File.slice()` reads;
- **VS Code**: main-thread `fetch(asWebviewUri(file), { Range })`, verified as
  206 in 3 ms.

The engine is not involved. Facts come from the archive header and metadata:
bounds, zoom range, layers. SQL, the table, styling and export are disabled
with a reason (FR-009a).

**Verified**: the transport (Range on the resource host). Still to verify in
implementation: the library against a real archive, in both shells, before
the format is listed (Constitution VI).

**Alternatives**:
- Reading PMTiles in SQL: there's no engine support.
- Writing our own reader: duplicates a small, maintained reference library.

## 9. The result model: views until they must be tables

**Decision**:
- `layer` stays the user-facing name. For read-in-parts formats it is a view
  over the reader. For whole-read formats it is the parsed table.
- **Hidden columns**: both carry `__se_rowid` (a stable feature id) and bbox
  columns `__se_xmin/ymin/xmax/ymax`. They are hidden from the table, the
  inspector, `DESCRIBE`-based autocomplete and exports.
- **The default query** `SELECT * FROM layer` uses `layer` directly: no
  copy.
- **Other queries**: the session counts the result first (exact, FR-010).
  - If it has at most **500,000 rows** (tuned by measurement), it is
    materialized into `__se_result`, with bbox columns and an R-tree when it
    has geometry. Every later view, page or style is then fast.
  - Larger results stay a view (`__se_result` as SQL). For filters that read
    in parts this is fast (§2). For heavy queries (whole-file sorts, joins)
    each view or page re-runs the query, and the viewer says so once.
- **Bbox columns that disappear**: results that drop `__se_*` (for example
  `SELECT name, geom …`) get them recomputed with `ST_XMin(geom)` and so on.
  When materialized this is free. For large view-results it costs a scan per
  map view, which the "re-runs" notice covers.

**Alternatives**: always materializing costs about 5 s and 1.4 GB per 4M
rows, and would make large filters slow and memory-bound.

## 10. The table: pages from SQL

**Decision**: the attribute table keeps its virtual scroller. Instead of an
in-memory array, it asks the session for row windows:
- `SELECT … LIMIT n OFFSET k`, with `ORDER BY` for a sorted column;
- an LRU of pages of 200 rows;
- placeholder rows while a page loads.

Measured on the 4M file: an unsorted page takes 21 ms anywhere, and a sorted
deep page 1.3 s, shown with a loading state.

Sorting is always over the whole result (FR-011). No result size was found to
need disabling sort; an out-of-memory sort fails with the FR-014 message.

## 11. Styles: statistics in SQL

**Decision**: classification moves from JS over features to SQL over the
result:

| Style | SQL |
|---|---|
| Categorized | `GROUP BY value ORDER BY count DESC LIMIT 13` |
| Equal interval | `min`/`max` |
| Quantile | `quantile_cont` |
| Legend counts | one `CASE` aggregation |

Measured: GROUP BY 175 ms and quantiles 125 ms on 4M.

**Natural breaks (Jenks)** stays the exact algorithm, run on at most 50,000
values. Spec 003 measured 191 ms on 50,000. Above that, it runs on a
deterministic sample, and the legend says "breaks from a 50,000-value sample"
(FR-012). Counts stay exact.

## 12. What changes in specs 002 and 005

- **Spec 002**: the default query loses its `LIMIT 1000`, and the
  large-result prompt ("Show first 50,000") is removed with its state, hooks
  and tests (FR-009).
- **Spec 005**: the "All N rows / Only the M shown" choice no longer arises.
  `displayLimited` is removed, and export always writes the complete result.
  The writers are unchanged; they already stream from `__se_result`.

## Implementation outcomes (US1–US2, 2026-10-11)

What changed from the plan while building, with the measurement behind each.

- **The overview reads no geometry.** Fetching the geometry of 25,000
  sampled features spread over the 762 MB file touched nearly every row
  group: **19.6 s**. Dots built from the bbox columns, plus geometry only for
  features of 2 px or more: **4.0 s** to a drawn overview, including engine
  start-up and facts. A 155,000-feature region view: 0.9 s; a city of
  5,865 parcels, all drawn: 0.9 s.
- **Features under ~2 px are drawn as dots** (`__se_dot`, radius 1.75 px).
  MapLibre doesn't rasterize sub-pixel polygons, so an overview of parcels
  was an empty map (0 features rendered). It also cuts the data sent at low
  zoom.
- **The proportional sample replaces grid thinning** (§6).
- **The first view of a new file or result is progressive.** A 2,000-feature
  preview is drawn first, and the full view replaces it at once. Drawing all
  22,000 features of spec 001's 10 MB file took warm open from 1,594 ms
  (1,000 rows drawn) to 2,309 ms. With the preview it takes **1,644 ms**
  (SC-009), and the full view follows.
- **Views skip `ST_IsValid` when the open counted no invalid geometry**
  (view query 300 → 196 ms on 22,000 polygons).
- **Views yield to user work.** A query, export or autocomplete load
  interrupts or skips a view, and the store asks again once the engine is
  free. Without this, a 1,000,000-row export failed with "A query is already
  running", and the map kept the pre-query features.
- **Hidden columns**: `__se_layer` (internal) carries `__se_rowid` and the
  bbox columns. The public `layer` reads the same source directly, so user
  queries never pay for a row-number window or lose filter pushdown. Query
  results get the temp table's free `rowid` pseudo-column.
- **Engine bug, FlatGeobuf (DuckDB-WASM 1.4.3):** an `ST_Read` with a
  `spatial_filter_box` that matches **no** feature returns one full batch
  (2,048 rows) of stale data instead of none; parsing it fails with "Could
  not parse WKB input". The native 1.5.5 CLI has dropped the parameter, so
  this can't be compared there. The guards:
  - tiles outside the header envelope are skipped;
  - rows are re-checked against the tile bbox;
  - a WKB parse error in a tile counts as an empty tile.
- **No `OGC_FID` in DuckDB-WASM 1.4.3's `ST_Read`** (the native 1.5.5
  exposes it). FlatGeobuf features read in parts are identified by a hash of
  their geometry, reduced to the JS safe-integer range.
- **FlatGeobuf extent from the header bytes.** `ST_Read_Meta` gives the count
  and CRS but no extent. A small FlatBuffers reader
  (`source/fgbHeader.ts`, from the FlatGeobuf specification) reads the
  envelope from the first ~1 KB through `HostAdapter.readRange`.
- **Small whole-read files stay in memory.** Reading a 10 MB GeoJSON through
  a `File` handle, in many small reads, was slower than one buffer (2,106 vs
  1,616 ms warm). Whole-read files up to 64 MB, and FlatGeobuf files up to
  the whole-read threshold, are fetched as bytes. Memory is no concern at
  that size.
- **Invalid geometry is counted only when cheap.** Files read in parts up to
  64 MB get an exact feature count. Larger ones report rows: the status bar
  says "4,000,000 rows", never claiming "features" it hasn't checked
  (FR-016).
- **The VS Code webview registers its test-message listener before
  opening.** It used to register it after the open and the first render, so
  a hook message sent at "ready" was lost.

### MVP checkpoint on the 762 MB file (2026-10-11)

| | Web (File handle) | VS Code (loopback) |
|---|---|---|
| Facts shown | 2.1 s | 2.1 s |
| Overview drawn (25,000 of 4,000,000) | 4.0 s | 4.2 s |
| City view (all parcels in view) | 0.9 s | under 1 s |
| Bytes read for open + overview | n/a | 237 MB of 762 MB |

Times include engine start-up.

- **Only the style's columns.** Map views read only the attribute columns the
  style draws from: none for a single symbol, one for a thematic style. The
  inspector fetches a clicked feature's full record by id. Reading every
  attribute made one overview cost 148 MB in VS Code; now a repeat overview
  reads 0 bytes, because the bbox columns are cached.
- **What the 237 MB is.** Most of it is DuckDB-WASM's HTTP read-ahead: about
  4 MB after each row group's bbox columns, spilling into the next row group's
  attribute and geometry columns. The bbox columns themselves are the other
  part. The read-ahead isn't settable from SQL; `disable_parquet_prefetching`
  changed nothing. Over the local loopback it costs little time.
- **No preview step for files read in parts.** The progressive preview runs
  only for files held in memory, where drawing dominates. For files read in
  parts it would double the I/O of the overview.
- **The preview is painted before the full view is requested.** The map
  reports each paint (`onPainted`; a monotonic `data-paints` counter on the
  canvas host), and the store waits for it, at most 1 s. Otherwise a fast full
  view replaced the preview unseen. The 10 MB warm first paint is now 1,588 to
  1,612 ms over three runs (spec 001 baseline: 1,594 ms).

## Implementation outcomes (US3, 2026-10-11)

What changed from §9–§12 while building, with the evidence behind each.

- **A query replaces the result only once it has succeeded.** The capped run
  goes into a staging table (`__se_result_next`). After it succeeds, the old
  result is dropped and the staging table renamed (`ALTER TABLE … RENAME`), or
  replaced by a view when it is over the cap. A failed query keeps the
  previous result, as spec 002 requires. Without staging, a query after a
  view result failed: `CREATE OR REPLACE TABLE` refuses to replace a view
  ("Existing object __se_result is of type View").
- **Engine quirk (DuckDB-WASM 1.32.0 / v1.4.3):** after `ALTER TABLE x RENAME
  TO y`, `duckdb_tables()` no longer lists the table as `y`, though `SELECT`
  and `DROP TABLE y` work. Probed in the real build: the catalog check
  reported "no result" on the second cycle, and the rename then failed with
  "another entry with this name already exists". The result is therefore
  dropped by trying `DROP TABLE`, then `DROP VIEW` when the engine says it is
  a view; the catalog is never consulted.
- **Three kinds of engine work.** `exclusive()` now distinguishes three kinds:
  - map views, which anything interrupts;
  - background work (table pages, style statistics, distinct counts, a
    feature by id), which user work interrupts; it then raises
    `WorkPreemptedError` and the store retries it after `whenIdle()`.
    Views wait behind it instead of interrupting it: when they did, the views
    fired while a file opens kept a style from finishing (11 web failures);
  - user work (queries, exports), which nothing interrupts.

  Before this change, a 1,000,000-row export failed with "A query is already
  running" while a page or style statistic was computing over the view.
- **Jenks keeps spec 003's sampling, not a 50,000-value reservoir.** Style
  values are fetched and classified exactly up to 200,000 rows
  (`JENKS_SAMPLE` = `JENKS_EXACT_LIMIT`). Above that, the engine returns the
  same evenly spaced order statistics that spec 003's `sampleSorted` picks,
  so the breaks equal spec 003's own breaks. A unit test checks this on
  300,000 values. Quantile breaks come from the two exact order statistics
  around each break, and class counts come from one exact `CASE`
  aggregation. The legend keeps spec 003's caption, "(estimated from N
  values)". The `jenksSample` test override lowers N, so a 10,000-row
  fixture can exercise the sampled path.
- **FlatGeobuf in parts needs Load (T044).** Whole-file statements over
  `ST_Read` through the file handle are slow, and DuckDB can't interrupt them
  midway. On `parcels-10k.fgb` read in parts, a table page plus distinct
  counts held the engine for about 14 s, and the first map view waited
  behind them (open ready at 2.4 s, first view at 24 s). The session now
  refuses whole-file work while `needsLoad` is set: queries are refused,
  pages are empty, and there are no style statistics and no export. The UI
  shows "Load the whole file (size) to …" with a Load button. Load re-opens
  the file with `loadWhole` (bytes, then a table); it took 176 ms on the 10k
  fixture. It keeps the current style. Load is a re-open rather than
  `session.loadWhole()`: that reuses the whole-read path, with its progress
  and Cancel, unchanged.
- **The style and table resolve asynchronously.** Tests that read a legend
  or a swatch right after a change now wait for the expected content. A
  legend from the previous column can briefly satisfy a row-count check.

## Residual risks

| Risk | Mitigation |
|---|---|
| Remote-SSH port forwarding through `localhost.` is unverified here. | HEAD probe plus the whole-read fallback (§7); a manual check on a remote host is listed in quickstart.md. |
| A future VS Code may change the service-worker pattern. | The probe detects any breakage and falls back; a VS Code integration test guards the path. |
| The display cap in software WebGL (CI) is pessimistic. | The cap is measured, and the SC-003 timing excludes GPU-bound frame time. |
| The registered handle broke after an OOM. | Recovery re-registers the source (§1), with a test. |
| GDAL's cancel granularity during a whole-read parse. | Verified by the SC-005 test in implementation; if a parse can't be interrupted, the worker is terminated and the engine re-created. |
