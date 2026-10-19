# Spec 024 research: reading GTFS (2026-10-19)

## 1. Can DuckDB-WASM's own GDAL read a feed? No (today)

Spike: `spikes/wasm-engine-gtfs.spec.ts.txt`, result `spikes/wasm-engine-gtfs.json` (DuckDB-WASM 1.5.6, fixture `tests/vscode-ext/fixtures/gtfs-mini`).

| Attempt | Result |
|---|---|
| `ST_Drivers()` | `GTFS` is built in and `can_open` |
| `ST_Read('<registered feed>.zip', layer='stops')` | "GTFS: required .txt files missing" (the driver recognizes the zip, then cannot list or read what is inside) |
| `ST_Read('GTFS:<registered folder>', layer='stops')`, the same without the prefix, with `allowed_drivers=['GTFS']`, or `GTFS:/vsizip/…` | "Could not open GDAL dataset" |
| `ST_Read('<folder>/stops.txt')` | "Could not open GDAL dataset" (the CSV driver does not take `.txt`) |
| `glob('<folder>/*')` | lists all seven files (so the files are registered correctly) |
| `read_csv` + `ST_Point`, `ST_MakeLine(list(… ORDER BY shape_pt_sequence))` | works |

Same finding as spec 013 §8: the engine's file bridge to GDAL does not serve directory listings of registered files, and `/vsizip/` is refused. "Route A in the engine" is closed until that changes. Recheck after an engine upgrade.

## 2. The same GDAL driver outside the engine: yes (gdal3.js)

Spike: `spikes/gdal3js-gtfs.cjs.txt` (gdal3.js, GDAL 3.8.4, already shipped for spec 013). The `GTFS` driver is present and opens the zip. Layers: `agency, stops, routes, trips, stop_times, shapes, calendar, …, shapes_geom`. `stops` is Point; `trips` is a LineString per trip (first to last stop when the trip has no shape); `shapes_geom` is a LineString per shape. A feed with its files one folder down (`feed/stops.txt`, shipped by some agencies) is NOT opened: detection and unzipping must be ours.

Consequences:
- Geometry comes from GDAL (Route A, driver unchanged) running in gdal3.js (extension host child process, web worker), converted to a FlatGeobuf per layer, as the geodatabase reader does.
- GDAL has no routes geometry and no `route_color`. The route layer is a SQL join of GDAL's `shapes_geom` with the plain tables `trips.txt` and `routes.txt`. Those are ordinary CSV, which the engine reads itself (`read_csv`), so only geometry needs GDAL.

## 3. Order of fall-backs (user decision 2026-10-19)

1. Route A: the GDAL GTFS driver. In the engine: closed (§1). In gdal3.js: works (§2). So A is gdal3.js.
2. Then "what GTFS-X does": parse the text files in JavaScript (it uses JSZip + PapaParse) and build lines and points. We would do this with fflate and the engine's own `read_csv`, so in practice it merges with 3.
3. Route B: geometry in SQL from the plain tables (`ST_Point`; `ST_MakeLine` over `shapes.txt` ordered by `shape_pt_sequence`; with no shapes, the stops of one trip in `stop_sequence` order). Needed when gdal3.js is unavailable (blocked download, memory) and for a nested feed if we choose not to rewrite it.

## 4. GTFS-X look (design reference only: it is AGPL-3.0, no code is copied)

Read from `src/components/map/RouteLayer.tsx` and `StopLayer.tsx` (its README says nothing about styling):

- Routes: line color `#<route_color>`, fallback `#888888`; width 3 (5 when selected); round join and cap; opacity 0.7 (1 when selected). Arrows `▸` along the line every 80 px, size 12 (16 selected), from zoom 12, white halo 1. Labels: route name along the line, bold 13, route color with a white 2 px halo, from zoom 13.
- Stops: two circles. Outer: radius 3 at zoom 10 to 6 at zoom 14, route-colored border, white stroke. Inner: radius 1.5 to 3.5, white fill. Unassigned stops `#8B7E74`. Opacity 0.9. Labels from zoom 13: 11 px, `#3D2E22`, white halo 2. Clusters `#3E7C8B` on large feeds.
- Its palette (cream, sand, coral, teal, gold) is its own app theme; we keep our basemap and chrome.

## 5. Real feeds (user's `D:\GTFS.zip` and `D:\GTFS_RT.zip`, 2026-10-19)

Utah Transit Authority, feed version 2026 AUG_20261008. Both zips hold the same data (86 routes, 5,425 stops, 11,078 trips, 466,857 stop times, 94,957 shape points in 212 shapes). Measured with gdal3.js under Node (`spikes/gdal3js-gtfs.cjs.txt` pattern, 244 MB resident):

| Step | Time |
|---|---|
| Open the zip, list layers | 1.8–1.9 s |
| `stops` to FlatGeobuf (1.4 MB) | 36–55 ms |
| `shapes_geom` to FlatGeobuf (1.5 MB) | 5 ms |
| `trips` to FlatGeobuf (9.8 MB, one line per trip: 11,078 mostly overlapping lines) | 150 ms |

Findings that change the design:
- **A zip can hold a feed and another zip.** `GTFS.zip` has the ten `.txt` files at its top level AND `GTFSOct_1_Google.zip` (a second copy of the feed). Detection must look only at the top level (or one wrapper folder), take the text files, and never open the inner zip.
- **The feed and a same-named zip are indistinguishable by name** (`GTFS.zip`, `GTFS_RT.zip`): another reason detection is by content only. `GTFS_RT` here is the static feed, not GTFS-Realtime protobuf; real-time files (`.pb`) are out of scope and must not be mistaken for it.
- Route-level lines are required: 212 distinct shapes serve 85 routes, while GDAL's `trips` gives 11,078 lines. One route (86 routes, 85 with trips) has no trips and therefore no line: count and report it.
- Every route has a `route_color` (lowercase hex, no `#`) and none is white; types are 81 bus, 4 tram (0), 1 rail (2). Every trip has a `shape_id`. Other feeds will not (keep the fallbacks).
- `stop_times.txt` has padded times (`" 4:15:00"`); times can pass 24:00:00, so they stay text. Not needed for routes and stops, but the SQL tables must not choke on them (read all columns as text, cast on use).
- 23 MB of stop_times, 4 MB of shapes: well inside the 3 GB ceiling; the large-feed question (millions of stop_times) is still open but this feed is a typical mid-size agency.

## 6. Browser worker, and scale (T004, 2026-10-19)

Spike: `spikes/browser-*.txt` (a Chrome page, a Web Worker, gdal3.js 2.8.1 from `dist/package`, the zip's bytes written to in-memory files; Chrome stable via Playwright). The UTA numbers match Node's (§5): init 0.18 s, open 1.8–1.9 s, stops 36–51 ms, shapes_geom 4 ms, trips 145 ms; the wasm heap is 512 MB (the module's fixed start size, not growth).

Scale test: the same feed with trips and stop_times repeated 10 times (110,780 trips, 4.67M stop times, 33 MB zip):

| | Open | stops | shapes_geom | trips |
|---|---|---|---|---|
| Full feed | 14.9 s | 52 ms | 3 ms | 1.4 s (99 MB FlatGeobuf, 110k lines) |
| `stop_times.txt` cut to its header line | 1.0 s | 51 ms | 3 ms | fails ("hDS is NULL"), as expected |

So the driver reads all of `stop_times.txt` when it opens (about 3 s per million rows), and `stops` and `shapes_geom` do not depend on it at all.

Decision (T004): the reader gives GDAL a flat in-memory folder in which `stop_times.txt` is replaced by its header line. Opening is then constant (about 1 s for any feed), the routes and stops layers need nothing from it, and the real `stop_times.txt` is registered for the engine (`read_csv`) to answer "which routes serve this stop". GDAL's `trips` layer is requested only for a feed that has trips without a `shape_id`; that one case pays the full open (about 3 s per million stop times) and shows progress. A nested wrapper is flattened by us before GDAL sees it (the driver does not look into folders: §2).

## 7. Still open

- Real-feed check of the SQL route (route lines merged per route) in the engine, and the memory the engine needs for the real `stop_times` (T006/T007).
- Feeds with `route_color` empty or white, extended `route_type` codes (100–1700), `shape_dist_traveled`-only shapes.
- Firefox and the extension host's child process (the numbers above are Chrome and Node).

## 8. As built (T006, T007)

- `HostAdapter.gdb.convertFeed(zip, layers)` (optional member of `GdbHost`): the light zip in, one FlatGeobuf per layer out. Web: worker op `feed`, files in the module's memory. Extension host: the light zip is written to the cache (`feed-<sha1>/feed.zip`), the child process converts into `feed-<layer>.fgb` files there (so a repeat open is instant), and the webview fetches them over the loopback server.
- The open layer is not a file but a SQL expression (`routesReaderSql`): the file opened is the shapes FlatGeobuf (or the trip lines, for a feed with no shapes), and the engine reads everything else registered beside it as `se-gtfs-*` sidecars. Routes are `ST_Collect` of their distinct shapes (MULTILINESTRING); routes whose trips have no shape take GDAL's trip line with the most points (LINESTRING). Routes with no trips have no line and are not in the layer.
- Verified (Chrome, `tests/web/specs/gtfs-024.spec.ts`): the fixture gives `R1:MULTILINESTRING:2, R2:LINESTRING:1, R3:LINESTRING:1`, the data's colors, and stops with their routes (`S2` served by `1, L`); `D:\GTFS.zip` gives 85 routes (86 in `routes.txt`, one has no trips), 5,425 stops, 466,857 stop times, no route without a color, in about 4 s with the queries.
- Memory: the real `stop_times.txt` is inflated in the webview and registered with the engine (the one big file). A 10x feed (230 MB of text) is the limit to measure next (T012); streaming it into the engine in pieces is the fix if it matters.

## 9. The network and the look (T008, T009)

- One result, decided by what is already built: a mixed-geometry layer is drawn today, so the open layer is a `UNION ALL` of the routes and the stops (`networkReaderSql`) and nothing in the map changed. `color` is `#RRGGBB` computed in SQL (the feed's `route_color` when it is six hex digits, else GTFS-X's `#888888` for a route and `#8b7e74` for a stop no colored route serves); a stop takes the lowest color of the routes that serve it. The style reads `color` as given (an identity color channel), so editing the SQL or filtering keeps the colors.
- Default style (`gtfs/style.ts`): 3 px lines with round-ended arrows (spec 019, size 0.6 of its default), white-outlined stop dots of radius 3.5, labels in `#3d2e22` with a white halo from zoom 13. Checked on the UTA feed in Chrome (screenshots at the fitted extent, zoom 11 and 14): colors per route, arrows along lines, names along routes and beside stops from zoom 13.
- Not copied from GTFS-X, on purpose: (a) its two-ring stop (colored ring, white center): one color channel paints a mixed layer's lines and dot fills together, so a white center would need a second channel on stops only. (b) zoom-dependent sizes (stop radius 3 to 6 from zoom 10 to 14, arrows from zoom 12): sizes are fixed pixels in this style model; only label text got a minimum zoom. Both are small additions if wanted later.
- `LabelSettings.minZoom` (new, optional): the label layers' `text-size` is `['step', ['zoom'], 0, minZoom, size]`. It rides along in QML's `spatialExplorer/style`.
- The feed is WGS84 by definition (`knownSrid`), so the status bar no longer says the CRS is assumed.

## 10. Folders, and two bugs the VS Code run found (T010)

- A folder of text files is turned into a zip (stored, flat) and then opens like any zip. The web shell does it in the page from the picked or dropped files; the extension host does it into `globalStorage/gtfs-folders/<key>.zip` (key: the files' names, sizes and times; the five newest are kept) when a table of the feed is opened. The folder's name is the zip's name, so it is the SQL schema (`gtfs.routes`).
- VS Code opens files, not folders: the explorer entry on a folder opens its `stops.txt` with the Spatial Explorer editor (`vscode.openWith` with the view type works although `.txt` is not in the editor's selector, so `.txt` is not claimed by the extension). The entries appear on a feed's table files and on folders whose name has gtfs, transit or feed; the command checks the folder by content.
- Bug 1: webview messages are JSON, so the feed sent as an ArrayBuffer arrived empty and GDAL said "not a readable geodatabase". It travels as base64 chunks (the way an export goes the other way).
- Bug 2 (older than this spec): data sidecars were found by file name without checking they were files, so a folder named like the data (`feed/` beside `feed.zip`) was registered and its request crashed the loopback server (`createReadStream` with `end = -1`). Only files are sidecars now.

## 11. The SQL fallback, stops, and scale (T011, T012)

- **Stops are always SQL.** The probe on a stop with blank coordinates showed GDAL's `stops` layer gives it `stop_lat` 0.0 and the point (0 0): drawn at null island and stretching the map's extent over the globe. The stops are now made from the text columns (`TRY_CAST` to numbers, a point only when latitude is within ±90 and longitude within ±180; the others are in the table, not on the map, and counted in the notice). GDAL is used for what it adds: the lines.
- **Fallback geometry** (`mode: 'sql'`): shapes by `ST_MakeLine(list(ST_Point ... ORDER BY shape_pt_sequence))`; a route with shape-less trips by the stops of its longest such trip in `stop_sequence` order. A feed with no `shapes.txt` and no `shape_id` column works in both modes (fixture `gtfs-noshapes.zip`). The notice says why GDAL was not used (no reader, an error such as an offline first download, too large for the browser); only a cancelled open stops the fallback.
- **Agreement:** on the UTA feed both modes give 85 routes, 94,957 line points and 5,425 stops (`tests/web/specs/gtfs-024.spec.ts`, needs `SE_GTFS_SAMPLE`). The fixture `gtfs-gaps.zip` (a route with no trips, a stop with no coordinates, a color that is not one) checks the notice and the grey fallback.
- **Scale** (the 10x feed, 4.67M stop times, 230 MB of text, in Chrome): the whole open takes 16 s with GDAL and 19 s in SQL mode, then `SELECT count(*) FROM gtfs.stop_times` takes 0.15 s and a count over the network 0.3 s. The real `stop_times.txt` is still inflated whole in the page before the engine takes it (about 230 MB in JavaScript for a moment): fine at this size; a feed ten times larger would need it streamed into the engine, not built here.
- **Not done:** an automated accessibility pass over the new notice (it is the existing notice component, a status region); GTFS-X's two-ring stops and zoom-dependent sizes (research §9); a service-day filter.

## 12. No arrows by default (user decision 2026-10-19)

The default GTFS style no longer draws direction arrows (GTFS-X does, at zoom 12 and up, but here a line is drawn in the direction of its shape or of its trip, which for a two-way route says little). They are the style panel's Arrows control, as for any line layer.

## 13. Two layers, drawn together (user decision 2026-10-19; replaces §9's network)

The combined `network` result gave one table for two kinds of thing. The feed is now two layers, `routes` and `stops`, each its own table, both on the map.

- **How:** the viewer still has one result with a table (the open layer). The other layer is a companion: its features (`QuerySession.companionFeatures`, the other layer's view with row numbers, through the same `allFeaturesSql` the map uses) go to a GeoJSON source of their own, and MapView draws it with the same paint, filter and layout as the open layer's, one layer of ours after each of the open layer's lines, arrows, markers and labels (`se-c-*`, never interactive). So a feed's two layers share one style, which is what a mixed layer already did (line settings for lines, marker settings for points), and a change in the style panel moves both.
- **What the companion does not have:** a table, filters, selection, hover, counts, a legend of its own. To work on it, choose it in the layer picker: the feed is opened again with that layer as `layer` and the other as the companion (a few seconds: the feed is read again). Tiles mode (very large results) draws no companion; a feed is far below that size.
- **Why not two full layers:** the viewer's core (selection, filters, the table's pages, tiles, the legend) is one result at a time; two results at once would touch all of it. The companion keeps that and still shows both layers on the map.
- **Columns:** both layers have `color` and `name` so the one style (identity color, labels) reads either; the table lists the data columns first and `geom` last.
- **Verified:** the fixture (stops in the companion source: S1 to S5; after switching, routes R1 to R3), the real UTA feed (85 routes, 5,425 stops), exports of the open layer and of the other layer as a result.
