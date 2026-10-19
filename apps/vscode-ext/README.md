# Spatial Explorer: Spatial SQL & Map Viewer

Open a geospatial file in VS Code and see it on a map and in an attribute
table, query it with spatial SQL, style it, and export it, without opening a
desktop GIS.

Also available as a web app: https://ar-puuk.github.io/spatial-sql-explorer/

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=arpuuk.spatial-explorer)
or [Open VSX](https://open-vsx.org/extension/arpuuk/spatial-explorer)
(`arpuuk.spatial-explorer`). Source: https://github.com/ar-puuk/spatial-sql-explorer

## Features

- **Open GIS files directly in VS Code.** GeoPackage, FlatGeobuf, Shapefile,
  GeoParquet and PMTiles open in Spatial Explorer by default. GeoJSON, CSV,
  Parquet, GML, JSON and SQLite (`.sqlite`, `.db`) offer it under **Open
  With…**, so text and database viewers aren't replaced. You can also right-click a file and choose **Open in Spatial
  Explorer**. A GeoPackage with several layers lists them, and each one can be
  shown. A **File Geodatabase** (the `.gdb` folder, or a `.gdb.zip`) opens the
  same way (experimental, see below), and so does any of these files inside a
  `.zip`. A **GTFS transit feed** (a `.zip`, or a folder of its `.txt` files)
  opens as a map of its routes and stops (see below). No file at hand? Run **Spatial Explorer: Open Sample Data (US
  Counties)**.
- **Map and table, in sync.**
  - Click a feature to select its row and see all of its attributes;
    double-click a row to zoom to it.
  - Choose which columns to show, filter any column from its header, and tick
    rows to **Zoom to selection** or **Show selected only**.
  - Sort, resize and navigate the table from the keyboard.
- **Correct positions in any CRS.** The source coordinate system is read from
  the file and shown in the status bar, and the data is reprojected for
  display. Files with no CRS are clearly marked as "WGS84 assumed".
- **Map views.** The **Basemap** panel shows the featured basemaps
  (OpenFreeMap, Satellite, Topographic, OpenStreetMap, or a blank background
  in a color you choose) as a grid of real previews, follows your theme until
  you pick one, and searches all 129 basemaps from 26 providers. **More
  basemaps…** opens the full gallery, grouped by provider. Keyed providers
  (MapTiler, Stadia, Protomaps, Google, Mapbox and others) use your own key,
  kept in VS Code's secret storage. Switch to a **globe**, set against the
  real stars; tilt and rotate with a right-drag, so a basemap's 3D buildings show.
- **One search box** on the map: values in the layer (choose one to select
  and zoom to its feature), coordinates (`-111.9, 40.7`), and places.
- **Map tools.**
  - **Map controls** (the sliders button on the right rail): switch each map
    control on or off and choose where it sits (a corner, or the middle of the
    top or bottom edge for the coordinates readout). Search, zoom, zoom to
    layer, reset view, globe, terrain, the drawing tools, export image, legend,
    coordinates, scale bar and the MapLibre logo are all yours to place.
  - **Draw, Measure and Select by shape**: points, lines, polygons,
    rectangles, circles and freehand shapes. Distances (along the great
    circle) and areas show live, in metric or imperial. A finished shape
    selects the rows it covers, narrows the table to them as a standing filter,
    or becomes the SQL table `drawn`. They are scratch geometry: save them as
    GeoJSON or show them as a layer to export them, and the data is never
    edited.
  - **Terrain** on and off, with relief shading and an exaggeration slider;
    the status bar shows the elevation under the cursor.
  - An optional **hover tooltip**, an on-map **coordinates** readout, and a
    right-click menu that copies the position you pointed at (lat, lon, lon,
    lat or WKT).
- **Thematic maps that QGIS understands.**
  - Single, categorized or graduated (equal interval, quantile, natural
    breaks), with a chart of the column's values and ramps previewed on the
    map as you browse them: about 50 ramps (Viridis and its kin, ColorBrewer,
    color-blind-safe sets), searchable, and a themed color picker.
  - **Graduated by expression**: classify a SQL expression such as
    `gdp_md * 1e6 / pop_est` instead of a column.
  - **Rules**: color by SQL conditions (`continent = 'Africa'`), the first
    match wins, with a count per rule. QGIS draws the saved rules the same.
  - **Bivariate maps**: two numeric columns colored from a grid of 2 to 4
    classes along each axis (3 by 3 by default), with a legend (a square, or a
    diamond) whose cells hide their features.
  - **Vary by attribute**: more properties, each by its own column, so one map
    shows several variables (roads colored by level of service and widened
    by traffic). Points: size, outline color and width, shape, opacity,
    rotation; lines: width, pattern, opacity; polygons: outline color and
    width, opacity. Each takes categories, classes, a continuous scale, SQL
    conditions, or the column's values as they are (colors, pixels,
    degrees). Properties that share a column and classes share a legend
    group.
  - **Continuous** and **As is** colors: along a ramp without classes, or
    the colors a column holds.
  - **Heatmap**: points as a density surface, optionally weighted by a
    column, with a radius in pixels or meters and automatic intensity.
  - **Clusters**: nearby points grouped into bubbles colored and sized by
    their count (after the R package mapgl); a click on a bubble zooms in.
    Large files are grouped by the engine.
  - Layer opacity, fill, outline and point size, live on the map and legend.
    Edit any class's color, label or bounds, or hide it from its legend
    swatch.
  - **3D extrusion**: raise polygons by a numeric column or a constant height,
    and tilt or rotate the map (right-drag or Shift+arrows).
  - **Labels**, from their own side-rail button: text from a column or a SQL
    expression, size, color, halo and placement. Lines are labeled along the
    line, polygons once inside their largest part, and labels never overlap.
    Drawn with your system's font, with nothing downloaded.
  - **Save style (QML)** writes `<file>.qml` next to the data, which QGIS loads
    automatically, and it's applied when you reopen the file. The arrow next to
    it saves OGC SLD or Mapbox GL style JSON. **Load…** imports any of the
    three. The QML carries every property, heatmaps, clusters and labels in
    forms QGIS draws the same (checked in QGIS).
- **Spatial SQL.** Press **Ctrl+Shift+Q** (**Cmd+Shift+Q** on macOS) to open
  the query panel, and query the file by its own name (`us-counties.parquet` is
  `us_counties`, a GeoPackage's layers are `us_boundaries.counties`) or as
  `layer`, with DuckDB spatial SQL. **Ctrl/Cmd+Enter** runs the statement under the cursor or the selection.
  Results go to the map and the table. Autocomplete covers your columns and the
  spatial functions, errors are underlined where they happen, recent
  queries are kept per file, and a **Copy** button copies the query. A query can read **other files in the
  workspace** by their path from the workspace root, listed beside the editor.
- **Snippets.** The library button in the query panel's header lists 24 ready-made queries
  for the open layer (buffer, dissolve, area in km², value per km², nearest feature in another
  file, clip, and more), filled with the layer's own table and column names. Choosing one fills
  the editor; **Tab** moves between the values to change, **Ctrl+Z** brings your old query back.
- **Grid cells.** **Bin into cells** (a button on the map)
  turns the layer into a grid of H3 hexagons or A5 equal-area pentagons, colored by the
  number of features or by the sum, average, minimum, maximum or median of a number column.
  Choose a size (shown in km or miles, with about how many cells it gives) and the map
  previews it; **Keep** puts the SQL it wrote in the query editor for you to change and
  rerun. It follows your column filters and shape filter, can use only the selected rows,
  and a clicked cell shows its id. For lines and polygons, **Every cell touched** counts a
  feature in each cell it touches, and for H3, **Smooth** gives each cell the value of its
  neighbors within up to 9 rings. The result styles and exports like any other.
- **Dot density.** **Dot density…** (a button on the map, for polygon layers) draws a count as
  dots placed at random inside each polygon: choose up to six number columns (each its own
  color) and what one dot stands for. The same layer always gives the same dots, and the SQL is
  in the query editor to change and rerun.
- **Time slider.** A window over a date or timestamp column filters the map, table and
  counts, and **Play** moves it across time.
- **Search by words.** In the search box, **Words** ranks the rows whose text has every word
  you type, in any form ("bridges" finds "bridge"), best match first. Lines can show
  **arrows** in their direction (style panel), and function names are colored in the query editor.
- **Export.** From the **Export** button above the table, or **Spatial
  Explorer: Export Data…**:
  - with geometry: GeoParquet, GeoPackage, GeoJSON, newline-delimited GeoJSON,
    FlatGeobuf, Shapefile (zipped), KML or CSV;
  - attributes only: CSV, Parquet, Excel workbook or JSON;
  - all, filtered or selected rows, in the data's CRS or any EPSG CRS from a
    searchable list, under the file name you choose.

  A notice lists anything the format changes (field renames, reprojection).
  The source file is never modified.
- **Print map.** **Print map…** composes the view as a page, with a live
  preview: paper or screen sizes, a title and subtitle, the legend (rename,
  hide or reorder its classes), a scale bar and north arrow, a colorbar, an info
  block, an attribute table and a chart of the rows, a 1:N scale, and a print
  extent you draw on the map. Save it as a PNG, PDF or SVG (text and legend stay
  editable), or copy it. An **atlas** makes one page per feature, or a page for
  each stretch of a line, as one multi-page PDF or a zip of pictures. The layout
  follows GeoLibre's Print Layout.
- **Looks like VS Code.** Every color comes from your theme, including
  high-contrast themes. CRS, feature count and cursor coordinates appear in the
  native status bar.

## Query examples

```sql
-- Filter (the initial view is SELECT * FROM <file name>: the whole file; `layer` is the same table)
SELECT * FROM layer WHERE name LIKE 'S%';

-- Measure: areas in the layer's own CRS units
SELECT name, round(ST_Area(geom)) AS area, geom FROM layer ORDER BY area DESC;

-- Buffer by 100 CRS units (meters in a projected layer) and keep the result
CREATE TEMP TABLE near AS SELECT name, ST_Buffer(geom, 100) AS geom FROM layer;
SELECT count(*) FROM near;

-- Join another workspace file (its path from the workspace root)
SELECT a.*, b.name AS district
FROM layer a JOIN ST_Read('data/districts.shp') b ON ST_Intersects(a.geom, b.geom);
```

Queries are read-only. Only `TEMP` tables and views can be created, and they
live in that viewer only. Writes, `COPY`/export, extensions and settings are
refused with a reason.

## Large files

Results under 100,000 rows are read once and drawn from memory, so panning
does no work. Bigger ones are drawn from vector tiles the engine builds as they
come into view (**Load all** in the status bar draws everything). Queries, the
table, styles and export always work on the whole data. Measured on a laptop in
the web build:

| Format | How it's read | Measured |
|---|---|---|
| GeoParquet / Parquet | In parts, any size | 1.1 GB (6M rows): facts 2.2 s, overview 5.1–5.4 s, city views 0.9–2.5 s. 5 GB (27M rows): facts 2.3 s, overview 5.8 s; a 135,191-row filter in 17 s |
| FlatGeobuf | Read whole, then drawn from tiles; announced above 100 MB | 1.45 GB (4M rows): 26 s to open, overview at 28 s |
| GeoJSON, Shapefile, CSV, GML, GeoPackage, SQLite, Excel | Read whole, once; announced above 100 MB | 172 MB GeoJSON (235k rows): 11–13 s. 325 MB GeoJSON: 24 s |
| PMTiles (vector) | Tiles in view only; view-only | Any size |

Opening can always be cancelled (within 3 s). Running out of memory (the
engine's limit is 3.1 GB) ends in a message, and the viewer stays usable.
For very large data, GeoParquet is the best format.

## Supported formats

GeoJSON, GeoPackage (several layers), SQLite and SpatiaLite databases such as
Cube 7 networks (several layers; attribute tables can be queried by name),
FlatGeobuf, Shapefile (with `.shx`, `.dbf`, `.prj`), GeoParquet, Parquet with a WKB geometry column, GML, CSV with
`lon`/`lat`, `longitude`/`latitude` or `wkt` columns, and vector PMTiles (view
only). Any of these inside a `.zip` opens as if unzipped (a zip never opens by
itself: right-click it, or use **Open With…**; one with several datasets asks
which).

### File Geodatabase (experimental)

Right-click a `.gdb` folder (or a `.gdb.zip`) and choose **Open in Spatial
Explorer**. Its layers are listed, grouped by feature dataset, and each layer
is a table in the geodatabase's schema (`network.roads`), so a query can join
layers. A layer is read the first time it is opened or named, and kept, so
opening it again is immediate.

- Columns with a coded **domain** show their description ("Freeway"); a switch
  in the table toolbar shows the stored code instead. SQL, filters and exports
  always use the code.
- The reader (gdal3.js, GDAL in WebAssembly, about 40 MB) is downloaded once
  the first time you open a geodatabase, checked against a recorded hash, and
  kept for offline use. The extension runs it in a separate process.
- Converted layers are cached in the extension's storage (up to
  `spatialExplorer.gdb.cacheLimitMB`, 2 GB by default; the least recently used
  go first). **Spatial Explorer: Clear Geodatabase Cache** removes them.
- Limits: a compressed geodatabase can't be read by any open-source reader (the
  message says to run *Uncompress File Geodatabase Data* in ArcGIS), and tables
  with 64-bit ObjectIDs (ArcGIS Pro 3.2 and newer) are untested.

### GTFS transit feeds

Right-click a feed's `.zip`, its folder, or one of its `.txt` files (`stops.txt`,
`routes.txt`, ...) and choose **Open in Spatial Explorer**. A feed is recognized
by its content (stops, routes, trips and stop times, then their columns), not by
its name. The map shows every route as a line in its `route_color` and
every stop as a dot in the color of a route that serves it; names appear from
zoom 13. Direction arrows are off until you choose them in the style panel.

- The feed is a schema named after it: `network` is the open layer (routes and
  stops together), `routes` and `stops` have every column (a stop lists the
  routes serving it), and every other table (`calendar`, `stop_times`, ...) can
  be queried too (`SELECT * FROM gtfs.routes WHERE route_type = 0`).
- Lines are read by GDAL's GTFS driver through the same reader a File
  Geodatabase uses (downloaded once). Without it they are built in SQL from the
  feed's own tables.
- A route whose trips name no shape is drawn through the stops of one trip, and
  a notice over the map says so, with the count of routes that have no trips
  and stops that have no coordinates.
- Not included: timetables, service-day filters, GTFS-Realtime, analysis.

## Commands

| Command | What it does |
|---|---|
| Spatial Explorer: Open in Spatial Explorer | Opens the file, a `.gdb` folder or a `.zip` (also in the Explorer and editor-tab context menus) |
| Spatial Explorer: Clear Geodatabase Cache | Deletes the converted geodatabase layers kept on disk |
| Spatial Explorer: Export Data… | Exports the displayed result |
| Spatial Explorer: Open Sample Data (US Counties) | Opens a bundled sample, no workspace file needed |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `spatialExplorer.placeSearch.enabled` | `true` | Offers place results in the map's search box. Off: it searches the layer and coordinates only. |

## Privacy and network

Your files never leave your machine: they are read by an embedded DuckDB
engine inside the editor. The network is used only for:

- **The SQL engine, once.** DuckDB-WASM and sql.js from jsDelivr, and the
  spatial, parquet, json and the other extensions from extensions.duckdb.org (the
  H3 and A5 grids from community-extensions.duckdb.org), at pinned versions. Each file is checked against a SHA-256 recorded at build time and
  refused if it doesn't match. A checked copy is kept in the extension's
  storage, so later starts work offline. Downloads follow VS Code's proxy
  settings.
- **Basemap tiles**, from the basemap you pick (or none with Blank).
- **Place search**, only when you search: the typed text alone is sent to
  OpenStreetMap Nominatim, after a one-time notice. Turn it off with
  `spatialExplorer.placeSearch.enabled`.

No telemetry is collected.

## Notes

- **View → Output → Spatial Explorer** logs each open, query and engine
  download with timings.

## Acknowledgements

Inspired by, and built with constant reference to,
[GeoLibre](https://github.com/opengeos/GeoLibre) by
[Qiusheng Wu](https://github.com/giswqs) (MIT). Parts are adapted from it and
from his maplibre-gl-vector and maplibre-gl-basemap-control; see the notices in
the extension. Also inspired by
[Kyle Walker's Spatial SQL Explorer](https://personal.tcu.edu/kylewalker/urbangis/sql-explorer/).
