# Research: H3 and A5 grid cells

**Date**: 2026-10-17 · **Status**: spike done, nothing built. Branch `017-grid-cells`.

## 1. Both extensions exist for DuckDB-WASM 1.5.6 and load in our engine

- Hosts: **community-extensions.duckdb.org** (not extensions.duckdb.org, which 404s for both):
  `https://community-extensions.duckdb.org/v1.5.6/wasm_eh/{h3,a5}.duckdb_extension.wasm`. Sizes: h3 248 KB, a5 708 KB.
  (`fts` is the opposite: official host, `extensions.duckdb.org`, 200.)
- Spike (temporary hook in the web app, reverted): a fresh engine, `spatial` loaded as usual, then each extension's bytes
  loaded from a blob URL the way `loadExtensions` does it, **signature check left on**. Both: `LOAD` ok, `loaded = true`.
- h3: 76 functions. `h3_latlng_to_cell_string(47.0, 8.0, 7)` = `871f830dbffffff`; `h3_cell_to_boundary_wkt` returns a hexagon polygon (lon lat order).
- a5: 23 functions, including `a5_lonlat_to_cell`, `a5_cell_to_geometry`, `a5_cell_to_boundary`, `a5_cell_area`, `a5_geometry_to_cells`,
  `a5_grid_disk`, `a5_cell_to_parent`/`children`, `a5_compact`. Note the argument order differs: h3 takes (lat, lng), a5 takes (lon, lat).

## 2. What building it touches
- `scripts/engine-assets.mjs`: a second extension host (community) with the same SHA-256 pinning; `engineAssets.json`; the test mirror.
- `loadExtensions` (duckdbService.ts): optional, like excel/sqlite_scanner (the app works without them); loaded before the lockdown.
- CSP `connect-src` in both shells: add community-extensions.duckdb.org. Constitution v1.2.0 wording ("downloaded from pinned URLs") needs the host added.
- Tooling note: building the web app from Git Bash needs `MSYS_NO_PATHCONV=1` or `VITE_ENGINE_MIRROR=/engine-mirror` becomes `C:/Program Files/Git/engine-mirror`.
  Port 4173 may be held by another app; the Playwright config reuses it silently.

## 3. Spike 2 (2026-10-17, same temporary hook): signatures, sizes, edges, speed

Results from the real engine (Chrome, DuckDB-WASM 1.5.6) after step 1 shipped the extensions:

- **Signatures.** `h3_latlng_to_cell(lat, lng, res)` returns UBIGINT; `h3_h3_to_string(cell)` gives the text id (`871f830dbffffff`);
  `h3_cell_to_boundary_wkt(cell)` returns VARCHAR WKT, so it needs `ST_GeomFromText`. `a5_lonlat_to_cell(lon, lat, res)` returns UBIGINT;
  `a5_u64_to_hex(cell)` the text id (`516f688000000000`); `a5_cell_to_geometry(cell)` returns GEOMETRY directly.
  Size helpers take INTEGER, so a BIGINT `range()` column needs a cast: `h3_get_hexagon_area_avg(res, 'km^2')`, `a5_cell_area(res)`.
- **Result CRS.** `ST_SetCRS(geom, 'EPSG:4326')` types the column `GEOMETRY('EPSG:4326')`, so the result is tagged 4326 by the engine
  (`resolveResultCrs` precedence 2) and never depends on the "detected" guess for projected layers. A bare `ST_GeomFromText` is plain `GEOMETRY`.
- **Antimeridian.** H3 boundary WKT near lon 180 jumps from 179.84 to -179.68 inside one ring: drawn as-is it is a polygon across the whole
  map. A5's `a5_cell_to_geometry` near lon 180 returns a ring with longitudes to about -175 (unwrapped differently). Both need a split into
  a MultiPolygon at the date line before they are drawn (spike S2 below fixes the SQL).
- **Speed (1M random points, whole globe, GROUP BY cell).** H3 res 5: 0.47 s (741,117 cells). A5 res 5: 2.5 s (15,320 cells). A5 is about
  5x slower per point; both are fine, but A5 needs the progress/cancel path from the spec's quality rules.
- **Cell counts.** The same resolution number means very different sizes in the two systems (A5 res 5 gave 15,320 occupied cells where H3 res 5
  gave 741,117 for the same points), so the picker must show sizes, never numbers alone.

## 4. Spikes S2 and S4 (run 2026-10-17; S3 still to run, task T037)

Probe scripts: `spikes/dateline-split.py.txt` (builds the SQL), sizes: `spikes/cell-sizes.json`.

**S4, cell sizes.** The engine's average sizes for H3 resolutions 0..15 and A5 resolutions 0..30 are saved in `spikes/cell-sizes.json` (km and km^2;
A5's functions answer in meters and m^2 and were converted). The core tests compare the registry against this file. H3 res 5 is about 253 km^2
(edge 9.9 km); A5 res 10 is about 32 km^2; A5 areas fall by exactly 4x per step, H3 by about 7x.

**S2, the date line and the poles.**
- **A5** returns a continuous ring already unwrapped past the date line (longitudes such as 180.32 or -176 beside 179.5), so it needs no unwrapping.
- **H3** returns a wrapped ring (179.84 then -179.68). Unwrapping each vertex to the longitude nearest the cell centre works:
  `lon + 360 * round((cell_lng - lon) / 360)`, computed over the vertices parsed from `h3_cell_to_boundary_wkt` with `regexp_extract_all`.
- **The split (works for both):** on the unwrapped polygon `g`, if `ST_XMax(g) > 180`, the cell is `ST_Union(ST_Intersection(g, ST_MakeEnvelope(-180,-90,180,90)),
  ST_Affine(ST_Intersection(g, ST_MakeEnvelope(180,-90,540,90)), 1,0,0,1,-360,0))`; the mirror case for `ST_XMin(g) < -180` shifts by +360.
  Verified: H3 and A5 cells at lon 179.99 and -179.99 come out as valid MULTIPOLYGONs within [-180, 180]; ordinary cells are untouched POLYGONs.
- **Poles, A5:** the cell holding a pole has a vertex exactly at latitude 90; the planar polygon is valid and acceptable. A5 **resolution 0** (12 huge cells)
  fails the split with a GEOS "side location conflict"; resolutions 1 to 4 over a 15-degree grid of 325 positions produced no invalid result.
  Decision: offer A5 from resolution 1.
- **Poles, H3:** the cell holding a pole is **wrong but valid** with the recipe above (its unwrapped longitude span is far above 180, vertices end up
  at nonsense longitudes such as -213). They are two cells per resolution (one per pole). Detection is easy: unwrapped span > 180. The fix to build
  in T016: for those cells, wrap the vertices to [-180, 180], sort by longitude, close the ring along the date line at the interpolated latitude and
  up to the pole (a cap polygon). Test with `h3_latlng_to_cell(89.99, 10, r)` for r 0..5.
- `TRY()` cannot wrap a scalar subquery, so the generated SQL must not use `(SELECT ...)` for the unwrapped WKT; use plain expressions.
- Speed note: the unwrap-and-split runs per cell after the GROUP BY, so it costs per occupied cell, not per input point.
