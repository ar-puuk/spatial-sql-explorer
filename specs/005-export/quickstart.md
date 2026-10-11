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

- [ ] Scenarios 1–6 pass in both shells.
- [ ] SC-002 is checked in QGIS for GeoJSON, GeoParquet (UTM and WGS84) and
      CSV.
- [ ] SC-003 (100,000 polygons to GeoParquet in under 15 s) and SC-004
      (cancel in under 3 s) are measured.
- [ ] SC-007: the source checksum is unchanged after every export test.
- [ ] All spec 001–003 suites still pass.
