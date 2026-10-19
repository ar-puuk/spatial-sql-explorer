# Spec 024 plan

Keep the work in its own places, as spec 013 did (the reader may be deleted if the engine reads GTFS itself): `packages/core/src/gtfs/`, an extension of the web worker in `apps/web/src/gdb/` and of the two `apps/vscode-ext/src/gdb*.ts` files, plus a few lines marked "Spec 024".

## Pieces
1. **Detection** (`gtfs/detect.ts`): from entry names (`listZipNames` / `inspectZip`, central directory only) find the feed root (top level, else one wrapper folder; inner zips ignored); confirm with the first line of `stops.txt` and `routes.txt` (inflate those two entries only, BOM tolerated). Folders: same test on the file list. `inspectZip` gets a `{kind:'gtfs', root}` result before the dataset scan.
2. **Reader** (`gtfs/reader.ts`): write the feed's text files to a flat in-memory folder (strips a wrapper, drops the inner zip), then through the existing gdal3.js host (`HostAdapter.gdb`, generalized to a GDAL host: `list`, `convert`) convert `stops` and `shapes_geom` to FlatGeobuf (`trips` only for a feed with trips lacking shapes), cached by file size and mtime like geodatabase layers. The plain tables (`routes`, `trips`, `stop_times`, `calendar`, `agency`, …) are registered as text files and read by the engine (`read_csv`, all columns text, cast on use).
3. **Layers in SQL** (`gtfs/sql.ts`): view `gtfs.routes` (GDAL `shapes_geom` joined to the distinct `(route_id, shape_id)` of `trips.txt` and to `routes.txt`, merged per route with `ST_Collect`/`ST_LineMerge`), `gtfs.stops` (stops joined to the list of routes serving them, from `stop_times` and `trips`), plus the raw tables. `layer` = the combined result. Decide in the first slice whether it is one UNION result with a `kind` column drawn by two style rules (preferred: no map-layer change) or a mixed-geometry result (spec 011 already draws mixed layers).
4. **Style** (`style/gtfsDefault.ts`): channels from spec 011: line color `{source: route_color, scale: as is}` with fallback; width 3; arrows (spec 019: along, 80 px, size 12); labels `route_short_name`. The two-ring stop dot may need a marker shape the channels lack: check `style/channels.ts`, else add one "ring dot" shape (QML writes it as a simple marker with outline).
5. **Shell wiring**: web open/drop path with `OpenHooks.chooseDataset` skipped for a confirmed feed; VS Code "Open in Spatial Explorer" on a `.zip` and a folder. Both go through `openFile.ts` next to the geodatabase branch (`gtfs/integration.ts` is the only glue).
6. **Fallbacks**, in order: (a) engine GDAL (closed today, recheck on engine upgrades; one function so a flip is cheap), (b) gdal3.js (primary), (c) pure SQL: `read_csv` + `ST_Point` / `ST_MakeLine` over `shapes.txt` (the same view names), used when gdal3.js is unavailable (blocked download, memory). Tests run (b) and (c) against the same fixtures and compare row counts and geometry types.

## Tests
- Core unit: detection matrix (valid, nested wrapper, feed plus inner zip like `D:\GTFS.zip`, missing `routes.txt`, shapefile zip, CSV zip named like GTFS, BOM/CRLF headers); SQL generation; default style from `route_color` (empty, short, lowercase, `#` prefix).
- Browser (web): open `gtfs-mini.zip` and `gtfs-mini-nested.zip`; route colors equal the data; 5 stops, one unserved; `gtfs.stops` works in SQL; export routes to GeoJSON.
- Extension: open from the explorer menu.
- Real data, optional: runs when `SE_GTFS_SAMPLE` names a feed zip (like `SE_GDB_SAMPLE`), expecting the UTA counts when it is that feed.
- Fixtures: `node scripts/fixtures-024.mjs` (committed outputs under `tests/vscode-ext/fixtures`).

## Risks
Large feeds (research §6); GDAL's `trips` join cost; extended `route_type` codes; routes sharing shapes; `shape_dist_traveled`-only feeds; poor-contrast colors (the white halo keeps labels readable).
