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
