# Spec 024 tasks

- [x] T001 Research: engine driver spike, gdal3.js spike, real feed measured, GTFS-X style, license (AGPL: design only)
- [x] T002 Constitution 1.6.0
- [x] T003 Fixture feed (`scripts/fixtures-024.mjs`)
- [x] T004 Browser-side measurement of the real feed and a 10x feed; GDAL gets a header-only `stop_times.txt` (constant open), `trips` only for shape-less feeds (research §6)
- [x] T005 Detection + unit tests (core), including the feed-plus-inner-zip case (`gtfs/detect.ts`, `inspectZip` kind `gtfs`, tests/core/gtfs.test.ts; the open path says "not available yet" until T006)
- [x] T006 GDAL host gets `convertFeed(zip, layers)`: web worker op `feed`, extension host op `feed` + message `gtfsConvert` (stops and shapes_geom, trips only when a trip has no shape). Web verified in Chrome; the extension host path is typechecked and bundled but not yet run (T012)
- [x] T007 Routes and stops views, naming, `layer` (`gtfs/open.ts`, `gtfs/sql.ts`; routes = open layer built from a SQL reader, `schema.stops` with the routes serving each stop, every other table a text view). Verified on the fixture and the UTA feed
- [x] T008 One result for routes and stops: decided UNION. The open layer is the `network` (columns kind, id, name, routes, route_type, trips, route_count, color, geom); `layer` and `<schema>.network` are it; `routes` and `stops` are views with every column. No map-layer change (a mixed-geometry layer is already drawn)
- [x] T009 Default GTFS style (`gtfs/style.ts`): color as given from the `color` column, 3 px lines with arrows, white-outlined stop dots, labels from zoom 13 (new `LabelSettings.minZoom`), QML round trip tested. No ring-dot marker (see research §9)
- [x] T010 Open paths: web ("GTFS folder…" menu item, a dropped folder, loose .txt files chosen together: `gtfs/folder.ts` makes the zip, `apps/web/src/gtfsFolder.ts`); VS Code ("Open in Spatial Explorer" on a folder or on a feed table, `apps/vscode-ext/src/gtfsFolder.ts`; the feed travels to the extension host as base64 chunks). Verified in Chrome and in real VS Code (`tests/vscode-ext/src/suite/gtfs.test.ts`); a zip never shows the dataset chooser
- [x] T011 SQL fallback (Route B): `mode: 'sql'` in `gtfs/sql.ts` and `open.ts`, the notice (`feedNotice`), `?noGdal=1`; stops are SQL in both modes (GDAL's stops layer puts a blank coordinate at 0, 0). Same geometry as GDAL on the UTA feed
- [x] T013 (2026-10-19, user decision) Two layers drawn together instead of the combined network: `routes` and `stops` tables, layer picker, companion layer on the map (research §13)
- [x] T012 Browser and extension tests, a 10x feed measured (open 16 s with GDAL, 19 s without; queries in about 0.3 s), CHANGELOG, READMEs, CLAUDE.md
