# Quickstart: validating export (spec 005)

## Prerequisites

- The spec 001–003 setup.
- For the read-back checks: QGIS with PyQGIS (OSGeo4W
  `C:\OSGeo4W\bin\python-qgis.bat`). The new script is
  `tests/qgis/read_back.py <files…>`, which prints validity, CRS, feature
  count, fields and the first bounding box.

## Scenario 1: Convert a whole file (US1, FR-002)

1. Open the 22,000-parcel file and press **Export** right away.
   - **Expected**: "All 22,000 rows" is the default, with "Only the 1,000
     shown" as the alternative.
2. Choose GeoParquet and save.
   - **Expected**: a confirmation with 22,000 rows and the file size.
3. Read the file back in QGIS.
   - **Expected**: 22,000 features, the same fields, EPSG:4326.

## Scenario 2: Filtered result, three formats (US1)

1. Run `SELECT * FROM layer WHERE zone = 'R1'`.
2. Export GeoJSON, GeoParquet and CSV (WKT).
   - **Expected**: each holds the 4,400 R1 rows. GeoJSON is lon/lat. The CSV
     has a WKT `geom` column.
3. For a point file, CSV with X / Y.
   - **Expected**: `x`, `y` numeric columns and no WKT column.

## Scenario 3: CRS (US2)

1. Open `usa-utm12n.gpkg` and export GeoParquet with CRS "result".
   - **Expected**: QGIS reads **EPSG:26912**, with UTM metre coordinates.
2. Export again with WGS84.
   - **Expected**: QGIS reads EPSG:4326, with lon/lat coordinates.
3. Choose GeoJSON.
   - **Expected**: the CRS is fixed to WGS84, and the note says why.

## Scenario 4: Formats offered (US3)

- **Expected**: only GeoJSON, GeoParquet and CSV for geometry results, and
  CSV and Parquet for table results.
- **Expected**: no FlatGeobuf, GeoPackage, Shapefile or KML (research §2:
  GDAL writing fails in this engine build).

## Scenario 5: Large, cancel and failure (US4)

1. Export 100,000 polygons.
   - **Expected**: progress, and the viewer stays responsive.
2. Start again and cancel.
   - **Expected**: stopped in under 3 s, no file saved, and a following
     query still works.

## Scenario 6: Command palette (US5)

1. With a viewer active, run **Spatial Explorer: Export Data…**.
   - **Expected**: the same dialog opens.
2. With no viewer active, run it.
   - **Expected**: the message "Open a file in Spatial Explorer to export
     its data."

## Automated coverage

| Layer | Suite | Covers |
|---|---|---|
| Unit | `tests/core/export-plan.test.ts`, `export-formats.test.ts` | Row choice (default view → layer; first 50,000; user LIMIT), format availability, CRS forcing, every notice item, file names |
| Browser | `tests/web/specs/export.spec.ts` (+ accessibility, performance) | Scenarios 1–5 through downloads; read-back of the downloaded bytes in the page (row counts, GeoJSON parse, Parquet `geo` metadata via the engine); SC-003/SC-004 timings |
| Extension | `tests/vscode-ext/src/suite/export.test.ts` | Save next to the source; chunked transfer of a file over 32 MB; source path refused; the command with and without an active viewer; FR-016 parity with the web |
| QGIS (local) | `tests/qgis/read_back.py` | SC-002: QGIS reads each format's rows, fields, CRS and extent |

## Definition of done

- [x] Scenarios 1–6 pass in both shells (automated: `export.spec.ts` for
      the web, `export.test.ts` for VS Code; Scenario 6 is VS Code only).
- [x] SC-002 is checked in QGIS for GeoJSON, GeoParquet (UTM and WGS84) and
      CSV.
- [x] SC-003 (100,000 polygons to GeoParquet in under 15 s) and SC-004
      (cancel in under 3 s) are measured.
- [x] SC-007: the source checksum is unchanged after every export test.
- [x] All spec 001–003 suites still pass (T034).

## Results (2026-10-10)

| Criterion | Result | Evidence |
|---|---|---|
| SC-002 QGIS read-back | **Pass.** QGIS 4.2.3 reads every offered format with all rows, the same fields and types, and the stated CRS; the projected GeoParquet reads as EPSG:26912 (DuckDB's default output read as EPSG:4326, research §3). | research.md, "SC-002 read-back"; `tests/qgis/read_back.py` |
| SC-003 100,000 polygons → GeoParquet | **Pass.** 2,033 ms from Export to the download (18.6 MB); longest task 0 ms. Limit: 15 s, no task ≥ 1 s. 100,000 polygons to GeoJSON also streams with "rows written" progress. | `performance.spec.ts` (headless Chromium, production build) |
| SC-004 cancel | **Pass.** 93 ms on a 1,000,000-row GeoJSON export (limit 3 s); no download, no file left in the engine, and the next query runs. | `performance.spec.ts`, `export.spec.ts` (US4) |
| SC-005 notices | **Pass.** Unit tests cover every forced change: invalid/missing geometry, nested values (JSON text), big integers and dates (GeoJSON), blobs (base64 / text), extra geometry columns (WKT), reprojection, an assumed CRS. GeoParquet keeps every type and gets no type notices. Long names and mixed types don't apply: no offered format limits names (Shapefile is not offered), and GeoParquet, GeoJSON and CSV all hold mixed geometry types. | `export-plan.test.ts`, "notices known in advance" |
| SC-006 parity | **Pass.** `world-boundaries.geojson` → GeoJSON: 180 features, 1 null geometry in both shells. `usa-utm12n.gpkg` → GeoParquet: PROJJSON `id` EPSG:26912 in both. | `export.spec.ts` (US1, US2); `export.test.ts` (US1, US2) |
| SC-007 source unchanged | **Pass.** SHA-256 of the source before and after every checksummed export is identical; choosing the source as the target in VS Code is refused. | `export.spec.ts` (US1), `export.test.ts` (US1, T030) |
| Accessibility | **Pass.** axe finds no violations in light or dark for the dialog (geometry result, CSV options, table result, running, cancelled); Tab reaches every control, focus stays in the dialog, Esc returns focus to Export. | `accessibility.spec.ts` (T028) |
| Large transfer in VS Code | **Pass.** An 80,000-row GeoJSON (more than 32 MB, several base64 chunks) is saved with exactly the reported size and parses with every row. | `export.test.ts` (T030) |
