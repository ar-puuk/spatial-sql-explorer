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

## 6. Open measurements

- A large metro feed (5M+ stop_times): gdal3.js `trips` versus the SQL route. Rule so far: never request GDAL's `trips` unless the feed has trips with no shape.
- Browser path: worker memory and time for the same feed (the Node numbers above are not the web numbers).
- Feeds with `route_color` empty or white, BOM/CRLF, quoted fields, extended `route_type` codes (100–1700).
