# Spec 024: GTFS transit feeds

Status: proposal, 2026-10-19. User decisions: Route A first, then the GTFS-X approach, then SQL; routes and stops only; the one-layer rule is waived for this case; constitution amended to 1.6.0.

## Goal
Open a GTFS feed (a `.zip` or a folder of `.txt` files) in either shell and see the transit network at once: routes as colored lines, stops as dots, looking like GTFS-X by default, with everything else (SQL, filters, table, export, print) working as it does for any layer.

## User stories
1. **Open a feed.** I drop or open `google_transit.zip` (any name, even `GTFS.zip` or `data.zip`); the app recognizes it as GTFS by its contents, not its name, and shows routes and stops.
2. **See it the way transit people expect.** Each route is drawn in its own `route_color` (grey where the feed gives none), with direction arrows and route names when zoomed in; stops are white-centered dots in the colors of the routes that serve them, named when zoomed in.
3. **Query it.** `routes`, `stops`, `trips`, `stop_times`, `shapes`, `calendar`, … are SQL tables named after the file (`gtfs.stops`); the layer on the map is `layer`.
4. **Not fooled, not stuck.** A zip that merely contains `.txt` files is not treated as GTFS; a zip that holds a feed and another zip opens the feed; a feed whose files sit one folder down opens; a broken or partial feed says what is missing.
5. **Export** the routes or stops like any layer (GeoJSON, GeoParquet, CSV, …).

## Scope
In: routes layer (lines) and stops layer (points), drawn together as one styled result; detection; both shells; the GTFS-X default style; QML round trip of that style.
Out (this spec): timetables, service-day filter, validation, headway analysis, editing, GTFS-Realtime (`.pb`) feeds, GTFS-Flex, demographics or coverage. A service-day filter on the time slider (spec 020) is a later idea.

## Requirements
- **FR-1 Detection by content.** A zip or folder is a GTFS feed when it holds `stops.txt`, `routes.txt`, `trips.txt` and `stop_times.txt` at its top level (or under one wrapper folder), and the headers of `stops.txt` (`stop_id`) and `routes.txt` (`route_id`) confirm it. Names and extensions are never used. A zip nested inside is ignored. Anything else follows today's zip rules.
- **FR-2 Opens by default only when sure.** A confirmed feed opens without the dataset chooser. `.zip` remains an "Open With" editor and a context-menu entry in VS Code; the web app takes it by pick or drop.
- **FR-3 Layers.** The open layer is the network: one row per route (a line, its shapes merged) and per stop (a point), with `kind, id, name, routes, route_type, trips, route_count, color`. `routes` (every `routes.txt` column, a line each, and the number of trips) and `stops` (every stop column and the routes that serve it) are layers of their own, and every other table is a view; SQL names are the feed as a schema (`gtfs.routes`, `gtfs.stops`, `gtfs.network`).
- **FR-4 Default style** as in research §4: route color as is, fallback `#888888`; width 3 with round caps; arrows from zoom 12; names from zoom 13; stops as two-ring dots 3 to 6 px over zoom 10–14, `#8B7E74` when unserved; stop names from zoom 13; clusters on large feeds. The style is editable like any other.
- **FR-5 Missing pieces degrade.** No `shapes.txt`: route lines join a representative trip's stops in order, and the layer card says so. Routes without trips, and stops without coordinates, are left out and counted. Missing required files are named in the message.
- **FR-6 Bounded.** A feed that cannot fit in memory says so (spec 013's limits apply); large `stop_times` are read by the engine, not held in JavaScript.
- **FR-7 Private.** Nothing leaves the machine; the only download is the existing pinned gdal3.js, first use only.

## Success criteria
- The real UTA feed (86 routes, 5,425 stops, 466,857 stop times) opens and draws within a few seconds after the engine and gdal3.js are ready.
- A zip of shapefiles, a zip of CSVs named `stops.zip`, and a GTFS zip named `shapes.zip` are each classified correctly; `D:\GTFS.zip` (feed plus inner zip) opens the feed.
- Every route's line color equals its `route_color`.
