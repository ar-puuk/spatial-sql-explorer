# Issue 1: "Transformation cannot be formatted as WKT1 TOWGS84 parameters"

A GeoPackage in EPSG:27700 (British National Grid) did not open in the web app. Findings, 2026-10-26, DuckDB 1.5.6, spatial
extension `v1.5.6/wasm_eh`, PROJ 9.1.1 (the same in the native and the WebAssembly builds: `DuckDB_Proj_Version()`).

## What fails
- `ST_Read_Meta` fails for the file in the browser engine; `ST_Read` (typed `GEOMETRY('EPSG:27700')`) and `ST_Transform` work.
- It is the coordinate system, not the file: a GeoPackage native DuckDB writes in 27700 fails the same way. Of 14 common systems
  only 27700 and 31467 (DHDN / Gauss-Krüger 3) failed. GeoJSON, Shapefile and FlatGeobuf in those systems open (their CRS comes from
  the typed column); GML and GeoPackage failed (they are listed with `ST_Read_Meta`).
- `ST_Read_Meta` builds a struct per layer (`gdal_module.cpp`: `GetAuthorityName`, `exportToWkt`, `exportToProj4`,
  `exportToPROJJSON`), so selecting only `auth_code` still runs the failing export.
- The nightly spatial build (2026-10-01) fails the same way. gdal3.js (GDAL 3.8.4 in WebAssembly, the spec 013 reader) opens both
  files and exports WKT1 without TOWGS84. Native DuckDB 1.5.6 is fine, with or without the OSTN15 grid in `PROJ_DATA`.

## Why the browser build differs from the native one
Not a different datum transformation: both builds ask PROJ for the same thing. The difference is what happens to the error.
- Native: `ST_Read_Meta(...).crs.proj4` for 27700 has no `+towgs84`, and for a bad CRS `ST_Transform` says
  "Could not create projection: EPSG:99999 -> EPSG:4326". PROJ's C API catches its own C++ exception, returns null, and the caller
  carries on (or raises its own error).
- Browser: the same `ST_Transform` says "Invalid Error: crs not found", PROJ's own exception text with DuckDB's generic prefix.
  The C++ exception is not caught by PROJ's C API and reaches DuckDB. So PROJ's attempt to write the 27700 datum shift as WKT1
  TOWGS84 (which it cannot) is fatal in the browser build and silently dropped in the native one.
- Why the exception is not caught in the WebAssembly build is not established (it is compiled into the extension; a side module
  mixing exception handling is one candidate). It cannot be changed from this repository: the engine files are used unmodified
  (constitution v1.2.0, `engine-assets.mjs`).

## What the app does
`openFile` lists layers with `ST_Read_Meta` and, when it throws, logs it ("[open] ST_Read_Meta failed ...") and reads what `ST_Read`
can: a GeoPackage's layers from its own catalog tables (`listGeoPackageLayers`), another format as its first layer. Remove that
branch, and `listGeoPackageLayers`, when `ST_Read_Meta` works for these systems: try 27700 and 31467 files on each engine upgrade.
