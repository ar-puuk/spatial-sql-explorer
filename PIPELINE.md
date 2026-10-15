# Pipeline: features after the current round

**Date**: 2026-10-15 · **Status**: research only, **nothing is scheduled or built**. Raise an item when the user asks what comes next.
Each item that adds scope needs an explicit user decision recorded in CLAUDE.md first (as was done for globe and extrusion).

## 1. File Geodatabase (.gdb): the user's main format

Full findings, spike scripts and numbers: `specs/013-file-geodatabase/research.md` (2026-10-14). Today both shells refuse `.gdb` with an `ogr2ogr` hint.

### Findings

- **The engine can't read it.** DuckDB-WASM 1.5.6 has no OpenFileGDB driver; folder, single table file and `.gdb.zip` all fail with "Could not open GDAL dataset". duckdb-spatial turns the driver off for WASM on purpose (`vcpkg_ports/gdal/portfile.cmake`, "Doesnt work on wasm32"; first skipped in deaa2ef, 2024-06-02, no reason given; 32-bit `off_t` is a guess, unverified).
- **GeoLibre reads it on desktop only**, through a Python sidecar with native DuckDB; its web build has no `.gdb`. Reusable UX rules: hide `GDB_*` system tables and non-spatial tables, ask for a CRS when a layer has none, fixed layer order.
- **gdal3.js (GDAL 3.8.4 in WASM) works.** On an 818 MB test GDB (UTM 12N, 444k and 4M parcels, one feature dataset): open and list layers 87 ms; 4M parcels to FlatGeobuf in 34 s written straight to disk through a NODEFS mount (about 500 MB RSS; in memory it peaked at 5.5 GB). Curves, Z and Pro 3.2+ Int64 fields read. 27 MB wasm + 12 MB data, LGPL-2.1+.
- **Limits:** compressed (CDF/SDC) geodatabases are unreadable by any open-source reader (message: "Uncompress File Geodatabase Data" in ArcGIS); 64-bit ObjectID tables need GDAL 3.9/3.10, so they are a risk with 3.8.4 (untested, needs a real Pro file).

### Recommendation

Convert the chosen layer once to a FlatGeobuf in a disk cache with gdal3.js, then open it through the existing FGB path (range reads, engine tiles over 100 MiB). VS Code first: gdal3.js in the extension host (works over Remote-SSH, WSL, containers). Web later: worker + WORKERFS/OPFS, not yet spiked. Assets pinned by URL + SHA-256 like the engine, downloaded on first `.gdb` open. Parallel track: ask duckdb-spatial to enable the driver for WASM (best end state, outside our control).

### Decisions needed (nothing is scheduled until answered)

1. Accept gdal3.js (about 40 MB on first `.gdb` open) and a conversion cache on disk. This amends the constitution and CLAUDE.md ("no native GDAL in the extension host" no longer holds).
2. Real GDB facts: size, ArcGIS Pro version, 64-bit OIDs, compressed or not, domains/subtypes that matter. A real sample closes the risks.
3. Web scope: same feature or VS Code first.
4. Should SQL reach unopened layers of the same `.gdb` (`ST_Read('x.gdb', layer='roads')`)?

## 2. Flow maps (OMX and any origin–destination table)

### Decision

Use **flowmap.gl** ([visgl/flowmap.gl](https://github.com/visgl/flowmap.gl), Apache-2.0, a deck.gl layer) to draw flows. The user chooses the flow style: **straight, curved, animated**, and others the library supports.

### Consequences to settle before the spec

- **deck.gl enters the project.** CLAUDE.md says "deck.gl only later, only if needed". This is that decision. Record it (CLAUDE.md, constitution) and keep deck.gl lazy-loaded so it costs nothing until a flow map is opened.
- **Integration with MapLibre**: deck.gl's MapLibre overlay (`MapboxOverlay` from `@deck.gl/mapbox`) draws the flow layer on the existing map. It must keep to "one layer on the map at a time" (spec 010): a flow map replaces the data layer, it does not stack.
- **No React.** The flowmap.gl repo has React, Svelte and plain-JS examples. Use the plain/Svelte path. Spike to confirm `@flowmap.gl/layers` has no React dependency.
- **Theming and CSP.** deck.gl draws on canvas/WebGL: colors come from `getComputedStyle`, like MapLibre paint. The webview CSP (`worker-src blob:`, `wasm-unsafe-eval`) must be checked against deck.gl and flowmap.gl workers.
- **Not verified yet** (read before planning): flowmap.gl's exact data accessors, which styles it ships (curvature, animation, clustering by zoom, outlines, adaptive scaling), the deck.gl version it pins versus the version we would use, and its license notices (add to THIRD-PARTY-NOTICES.md).

### Data model

flowmap.gl wants two tables (the convention in [flowmapblue](https://cran.r-project.org/web/packages/flowmapblue/refman/flowmapblue.html) and flowmap.blue):

- **flows**: `origin`, `dest`, `count` (optional `time`)
- **locations**: `id`, `lat`, `lon` (optional `name`)

That is the "two files" situation. Neither needs to share a name, a geography or column names, so **the join is by value, confirmed by the user, never by convention**.

### Inputs (all produce the same flows long table)

1. **O-D table + locations layer**: CSV, Parquet, or a SQL result for the flows; any open or workspace layer for the locations.
2. **OMX matrix + zones layer**: the matrix is flattened to `(o, d, value)`.
3. **One file with coordinates** (`o_lon, o_lat, d_lon, d_lat`): no join.

Build 1 first (no HDF5, most of the value), then 2 as another source feeding the same wizard.

### OMX specifics ([spec](https://github.com/osPlanning/omx/wiki/Specification))

- HDF5: root attrs `OMX_VERSION`, `SHAPE [rows, cols]`; matrices at `/data/<name>`; 1-D lookups at `/lookup/<name>` with optional `dim` (0 rows, 1 columns).
- **Not required to be square.** Row and column lookups can differ, so different origin and destination geographies are legal.
- Lookups are optional; without one the zone ID is the row/column position (decide 0- or 1-based in the wizard).
- Lookup values may be int, float or fixed-width byte strings: decode defensively.
- DuckDB has no HDF5 reader. A JS/WASM reader is needed (`h5wasm` is the likely candidate: not verified for size, CSP or range reads).
- Read only the chosen `/data/<name>`, not the whole file. A 3,000 × 3,000 matrix is 9M cells: drop zeros and the diagonal before inserting into DuckDB (Arrow, not JSON), and apply a top-N or minimum-value limit.

### The "Flows from table" wizard

1. **Source**: pick the flows file (or the OMX file, then the matrix and the row and column lookups; preselect when there is only one).
2. **Origin locations**: pick the layer, then the ID column. **Rank candidate columns by match rate**: distinct flow IDs found in the column ÷ distinct flow IDs, e.g. `TAZID 100% (2,881/2,881)`, `OBJECTID 3%`. Show unmatched counts. A string/number mismatch shows as 0%: offer a cast.
3. **Destination locations**: default "same as origins". Allow another layer and column.
4. **Point per location**: `ST_PointOnSurface` for polygons (safe for concave zones), the point itself for point layers; transform to EPSG:4326 (existing CRS rule).
5. **Style**: flow style (straight / curved / animated / …), width and color by value, minimum value or top N, clustering by zoom if flowmap.gl supports it.
6. **Zone totals**: optional choropleth of productions (row sums) and attractions (column sums), through the existing style panel.
7. **Remember the mapping** (flows source, matrix, lookups, layers, columns) in saved state keyed by the flows file path; reopening is one click.

DuckDB-native: the wizard also **emits editable SQL** (a join of the long table to the locations, with `ST_MakeLine` for the non-flowmap.gl fallback and export), in the same way multi-file work is already SQL.

### Interaction

- Click a location to show its outgoing or incoming flows (a `WHERE o = X` on the small long table).
- Direction must stay readable: curved arcs, or flowmap.gl's own direction encoding.
- Export: the flows table (CSV/GeoParquet), and a line layer (GeoJSON/GeoParquet via `ST_MakeLine`) so results can leave the app.

### Spike first (1–2 days)

1. Read one `/data` matrix and its lookups from a real regional-model OMX, via range reads in the webview (`h5wasm` or alternative). Record in a `research.md`.
2. Run `@flowmap.gl/layers` on the MapLibre map through the deck.gl overlay inside the VS Code webview (CSP, workers, theming), at 100k flows.
3. Confirm the real files: do they have row and column lookups? Is the zone layer already in the workspace?

## 3. Other candidates (in value-for-effort order)

Within the current scope (LOOK / QUERY / STYLE / EXPORT):

| Feature | Basis | Notes |
|---|---|---|
| Draw-to-query (box, polygon, circle) | MapLibre + small draw helper; fills `ST_Intersects` into SQL | Selection only, not editing. Strong data-science fit. |
| H3 / grid binning | `h3` extension (browser build exists for DuckDB 1.5.6), or grid math in SQL | Pairs with existing extrusion for 3D hex maps. Also `a5`, `fts` from the earlier note. |
| Time slider | `setFilter` on a date or numeric column | Cheap. |
| Map image export | Canvas with `preserveDrawingBuffer`; legend and scale bar | Check what already exists before specifying. |
| Measure (distance, area) | Geodesic math in core | Small. |
| Direction arrows on lines | `symbol-placement: line` | Networks and tracks. |
| Line gradient | `line-gradient` (needs `lineMetrics`) | Optional. |
| Saved views and queries | HostAdapter state | No bookmark code found. |
| SQL snippet library (buffer, spatial join, nearest, dissolve, point in polygon) | Data, not UI | Answers "processing toolbox" pressure without building one. |
| Dot-density maps | SQL-generated points inside polygons weighted by a count | Needs a spike for the right DuckDB function. |

Need a scope decision (excluded or ambiguous today):

- Raster / COG **viewing** (analysis is excluded; viewing is not addressed; DuckDB-WASM cannot read rasters).
- Hillshade / terrain / `color-relief`: conflicts with the 3D and stacked-basemap exclusions. Recommend skip.
- Animated trips from timestamped trajectories (deck.gl `TripsLayer`): becomes cheap once deck.gl is in for flows.
- Linked charts (histogram or scatter brushing the map): a histogram brush that sets a filter is modest; full cross-filtering is scope creep.
- Spatial statistics (Moran's I, hot spots), routing and isochrones: recommend decline.

## 4. Suggested order

1. File Geodatabase (§1): the user's main format, spiked, waiting on decisions.
2. Spikes in §2 (HDF5 read, flowmap.gl in the webview).
3. Generic flow map (table + locations, wizard, styles).
4. OMX source and zone totals.
5. Draw-to-query and time slider.
6. H3 binning, map image export, measure, snippet library.

Related: `specs/010-redesign/implementation-plan.md` Appendix C (earlier list), memory `project-future-ideas`.
