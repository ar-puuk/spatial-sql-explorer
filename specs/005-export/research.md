# Research: Export (spec 005)

Phase 0 of `/speckit-plan`. Every item was spiked against the **real** engine
on 2026-10-10: DuckDB-WASM 1.32.0 (DuckDB v1.4.3) with spatial, in the
production web build, **after the spec 002 lockdown**. Read-backs used
QGIS 4.2.3 / GDAL 3.13.3 (OSGeo4W). Evidence is in `spikes/`:
- `engine-report.json`: drivers, write paths, metadata;
- `scale.json`: 100,000-polygon timings and cancel;
- `geoparquet-utm12n.parquet`: the GeoParquet shape QGIS reads correctly.

---

## 1. Where the locked-down engine can write

**Decision**: write each export into the engine's in-memory file system,
under the already-allowed source directory, as
`/se-source/__se_export-<n>.<ext>`. Then read the bytes out with
`copyFileToBuffer` and always `dropFile` it afterwards, on success, cancel or
failure. The spec 002 lockdown stays exactly as it is: no new allowed
directory, and no setting changes.

**Evidence**:
- `COPY … TO 'out.parquet'` and `TO '/se-export/out.parquet'` are both
  refused: "Permission Error: … file system operations are disabled by
  configuration".
- `COPY … TO '/se-source/out.parquet'` succeeds, and `copyFileToBuffer`
  returns the bytes.
- These files exist only in the page's memory: nothing reaches the user's
  disk until the host saves the bytes (§6).

**Safety**: user SQL still can't `COPY`, because the statement policy refuses
it (spec 002 FR-013). The export code is the only writer, and the
`__se_export` prefix is protected like every other `__se_` name.

**Alternatives**:
- Adding `/se-export/` to `allowed_directories` would change the verified
  lockdown for no gain.
- Streaming rows out and encoding every format in JS would rebuild what
  DuckDB already writes, fast.

---

## 2. Which formats the engine can write (FR-003, FR-004)

**Decision**:

| Format | How | Verified |
|---|---|---|
| **GeoParquet** | DuckDB `COPY … (FORMAT PARQUET)`, with the geometry as WKB `BLOB` and our own `geo` metadata (§3) | ✅ QGIS reads rows, attributes, geometry and **CRS** |
| **CSV** | DuckDB `COPY … (FORMAT CSV, HEADER)`, with geometry as `ST_AsText` WKT, or `ST_X`/`ST_Y` for points | ✅ QGIS reads it (WKT as text, as for any CSV) |
| **Parquet (table)** | DuckDB `COPY … (FORMAT PARQUET)` | ✅ for results without geometry |
| **GeoJSON** | **Our own writer** (§4): streamed `ST_AsGeoJSON`, assembled in JS | ✅ QGIS reads it as EPSG:4326 lon/lat |
| FlatGeobuf, GeoPackage, Shapefile, KML, any GDAL driver | ✗ **not offered** | ✗ GDAL writing fails in this build |

**Evidence**: `ST_Drivers()` lists `can_create` for GeoJSON, FlatGeobuf,
GPKG, ESRI Shapefile, KML and others, yet **every GDAL write failed** in
DuckDB-WASM 1.32.0, even for a single `ST_Point(1, 2)`:

| Driver | Error |
|---|---|
| GeoJSON | `GDAL Error (3): Cannot write feature` |
| FlatGeobuf | `Maximum call stack size exceeded` |
| GPKG | `TransactionContext Error: cannot start a transaction within a transaction` |
| ESRI Shapefile | `GDAL Error (1): Failed to write .shp header` |
| KML | "succeeds", but writes a **1-byte** file |
| CSV (GDAL) | `It seems no file system object called … exists` |

So FR-004 holds: none of the candidate extra formats is offered. If a later
DuckDB-WASM release fixes GDAL writing, each format is re-verified the same
way (`tests/qgis/read_back.py`) before it is offered. That is a separate,
small slice; this spec's code keeps formats as data, so adding one is a row
plus its tests.

**Spec impact**: US3 ("more formats, only where they truly work") is
satisfied by offering none of them. Its scenario 3 holds: unverified formats
don't appear. Shapefile-specific behavior (US3 scenario 2) has no format to
apply to and is deferred with the formats.

---

## 3. GeoParquet must carry the real CRS (FR-006, SC-002)

**Decision**:
- Write the geometry as **plain WKB** (`ST_AsWKB(geom)::BLOB`).
- Turn off DuckDB's own GeoParquet metadata (`GEOPARQUET_VERSION 'NONE'`).
- Write our own `geo` key with `KV_METADATA`, following GeoParquet 1.1:
  - `primary_column`, `encoding: "WKB"`;
  - `geometry_types` from the result's stats, and `bbox`;
  - `crs` = the full **PROJJSON** of the output CRS, omitted for WGS84
    longitude/latitude, which GeoParquet's default `OGC:CRS84` already
    means.

**Evidence** (QGIS 4.2.3 / GDAL 3.13.3 reading UTM 12N data):

| How it was written | QGIS reads CRS as |
|---|---|
| DuckDB default (native Parquet `GeometryType(crs=<null>)`, `geo` without `crs`) | **EPSG:4326**: wrong, so UTM metres are labelled degrees |
| Plus our `geo` with an id-only `{"id":{"authority":"EPSG","code":26912}}` | EPSG:4326: wrong |
| Native geometry type plus our `geo` with full PROJJSON | EPSG:4326: wrong (the native type's null CRS wins) |
| **WKB BLOB + `GEOPARQUET_VERSION 'NONE'` + our `geo` with full PROJJSON** | **EPSG:26912 ✓** |

DuckDB 1.4's default GeoParquet output would have **silently mislabeled
every projected export**, which is exactly what this spike exists to catch.

**PROJJSON source**: spatial has no CRS-to-PROJJSON function, but GDAL and
PROJ are in the build. Registering a tiny GeoJSON that declares the CRS (a
`crs` member with `urn:ogc:def:crs:EPSG::<code>`, and no features) under
`/se-source/__se_crs_<code>.geojson` and reading
`ST_Read_Meta(…).layers[1].geometry_fields[1].crs.projjson` returns PROJ's
full PROJJSON. This was verified for EPSG 26912, 4326, 3857 and 2056 (2–4 KB
each). It is cached per code per viewer.

**Alternatives**:
- A hand-maintained PROJJSON table would be incomplete.
- Post-editing the Parquet footer means fragile Thrift surgery.
- Leaving the CRS out would mislabel the data (shown above).

---

## 4. GeoJSON: our own writer (FR-003, FR-006)

**Decision**: stream `SELECT <attributes>, ST_AsGeoJSON(<geometry in WGS84>)`
on the cancellable streaming connection (spec 002 research §1). Each batch
is assembled as JSON text chunks with RFC 7946 structure (a
`FeatureCollection` with no `crs` member). The batches yield to the UI.

- Coordinates are WGS84 longitude/latitude, reprojected with the same
  expression the map uses (`reprojectToWgs84Sql`).
- Rows with missing or invalid geometry get `"geometry": null`.
- Properties are JSON values:
  - BIGINT beyond 2^53 becomes a string;
  - DATE and TIMESTAMP become ISO strings;
  - lists, structs and maps are written as JSON;
  - BLOB becomes base64 text.

  Each of these is listed in the notice (FR-009).
- **Precision**: full double precision. The spec's assumption of about 1 cm
  is amended: rounding would change values the user didn't ask to change,
  and file size is acceptable (47 MB for 100,000 polygons, about the size of
  the source).

**Evidence**: 100,000 parcel polygons were written in **553 ms** (47.4 MB),
and QGIS reads the result as EPSG:4326 with the right extent.

---

## 5. Which rows (FR-002), CRS (FR-006) and columns (FR-007)

**Rows**:
- The query's complete result is already materialized as `__se_result`
  (spec 002: the CTAS runs the user's SQL once; display limits apply only
  when fetching).
- **Display-limited cases**, where the dialog asks "All N" or "Only the M
  shown":
  - the untouched initial view: its result is `LIMIT 1000` by SQL, so
    "all" exports `layer`, the whole file;
  - "Show first 50,000": `__se_result` holds the full result, so "shown"
    is `LIMIT 50000`.
- A user-written `LIMIT` or `WHERE` is the query, so `__se_result` is
  exported as-is.

**CRS**:
- "Result CRS" (the default) exports the geometry as stored, which is in
  the resolved result CRS (spec 002 FR-014).
- "WGS84" applies `reprojectToWgs84Sql(geom, srid)`.
- An unknown CRS (WGS84 assumed) is exported as-is and labeled WGS84, with
  a notice when assumed.

**Columns**:
- Other geometry columns are exported as WKT text (`ST_AsText`).
- Every column keeps its name and order. Parquet keeps every DuckDB type.
  The CSV writer renders nested types as their DuckDB text form.

---

## 6. Getting the bytes to the user (FR-005, FR-012)

**Decision**: use `HostAdapter.saveFile(name, bytes)`, which already takes
`Uint8Array | string`.
- **Web**: the existing Blob download, with the default name
  `<source>-export.<ext>`.
- **VS Code**: today's `saveFile` message carries text only. It gains a
  **binary, chunked** form: the webview posts `Uint8Array` chunks of 32 MB
  (the same size spec 001 uses host→webview), and the host joins them after
  the save dialog. The host writes with `workspace.fs.writeFile` only once
  all bytes have arrived, so a cancelled or failed export never creates a
  file (FR-010).
- The save dialog defaults next to the source.
- **FR-012**: the host refuses a destination equal to the source document
  URI.
- VS Code's own save dialog already confirms overwriting an existing file.

---

## 7. Progress, cancel and memory (FR-010, FR-011, SC-003, SC-004)

**Evidence** (100,000 polygons; 10 MB-class parcels × 10):

| Step | Time |
|---|---|
| GeoParquet `COPY` | 253 ms |
| `copyFileToBuffer` | 17 ms (18.6 MB) |
| CSV (WKT) | 604 ms (34.3 MB) |
| GeoJSON (ours) | 553 ms (47.4 MB) |
| Cancel a running `COPY` (`send` + `cancelSent`) | 169 ms; the connection works afterwards |

**Decision**:
- Exports run on the query session's exclusive, cancellable connection
  (spec 002), so a query and an export never interleave.
- **Progress**: GeoJSON reports rows written (it streams). Engine `COPY`
  formats show an indeterminate bar (row progress isn't exposed), plus the
  elapsed time after 1 s.
- **Cancel** uses `cancelSent()`.
- **Cleanup**: a cancelled `COPY` **leaves a partial file** in the in-memory
  file system (4.6 MB in the spike). The export always `dropFile`s its
  target in a `finally`. The partial file never reaches disk, since saving
  happens only after success (§6).
- **Memory**: an export holds the encoded file once in the engine and once
  as the copied buffer. An engine OOM or a buffer allocation failure is
  caught and reported as: "The export ran out of memory. Filter the result
  or choose GeoParquet (smallest)." The viewer and its data are untouched,
  because the export reads from `__se_result` and never replaces it.

---

## Residual risks

- **GDAL writing** may start working in a later DuckDB-WASM. Re-verification
  is cheap (§2); until then, only the four formats above are offered.
- **Very large GeoJSON** (several hundred MB) could exceed browser string or
  heap limits. Mitigation: chunked assembly (an array of strings, never one
  giant concatenation before the Blob) and the OOM message.
- **The VS Code message channel**: binary `postMessage` from the webview is
  supported (VS Code serializes `ArrayBuffer`s). The 32 MB chunks mirror the
  proven host→webview direction, and the VS Code suite exports a file larger
  than one chunk to prove it.
