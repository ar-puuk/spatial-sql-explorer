# Spatial Explorer: Spatial SQL & Map Viewer

Open a geospatial file in VS Code and see it on a map and in an attribute
table, query it with spatial SQL, style it, and export it, without opening a
desktop GIS.

Also available as a web app: https://ar-puuk.github.io/spatial-sql-explorer/

## Features

- **Open GIS files directly in VS Code.** GeoPackage, FlatGeobuf, Shapefile,
  GeoParquet and PMTiles open in Spatial Explorer by default. GeoJSON, CSV,
  Parquet, GML, JSON and SQLite (`.sqlite`, `.db`) offer it under **Open
  With…**, so text and database viewers aren't replaced. You can also right-click a file and choose **Open in Spatial
  Explorer**. A GeoPackage with several layers lists them, and each one can be
  shown. No file at hand? Run **Spatial Explorer: Open Sample Data (US
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
- **Map views.** OpenFreeMap vector basemaps (Positron, Liberty, Bright, Dark,
  Fiord), Satellite, Topographic and OpenStreetMap, or a blank background in a
  color you choose. Switch to a **globe**, set in a night sky. **Search
  places** to jump to a city or address.
- **Thematic maps that QGIS understands.**
  - Single, categorized or graduated (equal interval, quantile, natural
    breaks), with a chart of the column's values and ramps previewed on the
    map as you browse them.
  - **Bivariate maps**: two numeric columns colored from a 3×3 square, with
    a keyboard legend square whose cells hide their features.
  - **Size by a column**: line width or marker size by another numeric
    column, in classes or proportional, next to the class colors. Marker
    shapes and dashed lines too.
  - Layer opacity, fill, outline and point size, live on the map and legend.
    Edit any class's color, label or bounds, or hide it from its legend
    swatch.
  - **3D extrusion**: raise polygons by a numeric column or a constant height,
    and tilt or rotate the map (right-drag or Shift+arrows).
  - **Save style (QML)** writes `<file>.qml` next to the data, which QGIS loads
    automatically, and it's applied when you reopen the file. The arrow next to
    it saves OGC SLD or Mapbox GL style JSON. **Load…** imports any of the
    three.
- **Spatial SQL.** Press **Ctrl+Shift+Q** (**Cmd+Shift+Q** on macOS) to open
  the query panel, and query the file as the table `layer` with DuckDB spatial
  SQL. **Ctrl/Cmd+Enter** runs the statement under the cursor or the selection.
  Results go to the map and the table. Autocomplete covers your columns and the
  spatial functions, errors are underlined where they happen, and recent
  queries are kept per file.
- **Export.** From the **Export** button above the table, or **Spatial
  Explorer: Export Data…**:
  - with geometry: GeoParquet, GeoPackage, GeoJSON, newline-delimited GeoJSON,
    FlatGeobuf, Shapefile (zipped), KML or CSV;
  - attributes only: CSV, Parquet, Excel workbook or JSON;
  - all, filtered or selected rows, in the data's CRS or any EPSG CRS from a
    searchable list, under the file name you choose.

  A notice lists anything the format changes (field renames, reprojection).
  The source file is never modified.
- **Map image.** **Export map image…** saves the view as a PNG at 1x or 2x,
  with the legend and the basemap's attribution.
- **Looks like VS Code.** Every color comes from your theme, including
  high-contrast themes. CRS, feature count and cursor coordinates appear in the
  native status bar.

## Query examples

```sql
-- Filter (the initial view is SELECT * FROM layer: the whole file)
SELECT * FROM layer WHERE name LIKE 'S%';

-- Measure: areas in the layer's own CRS units
SELECT name, round(ST_Area(geom)) AS area, geom FROM layer ORDER BY area DESC;

-- Buffer by 100 CRS units (meters in a projected layer) and keep the result
CREATE TEMP TABLE near AS SELECT name, ST_Buffer(geom, 100) AS geom FROM layer;
SELECT count(*) FROM near;
```

Queries are read-only. Only `TEMP` tables and views can be created, and they
live in that viewer only. Writes, `COPY`/export, extensions and settings are
refused with a reason.

## Large files

Files of several GB open without being loaded into memory where the format
allows it. The map draws the features in view (up to 25,000; above that an
even sample, with a notice); queries, the table, styles and export always
work on the whole data. Measured on a laptop in the web build (VS Code is
similar):

| Format | How it's read | Measured |
|---|---|---|
| GeoParquet / Parquet | In parts, any size | 1.1 GB (6M rows): facts 2 s, overview 4.9 s, city views < 2 s. 5 GB (27M rows): overview 9.5 s, engine memory < 60 MB |
| FlatGeobuf (with index) | In parts, any size; queries need **Load** (into memory) | 1.45 GB (4M rows): facts 2 s, overview 2.7 s, city views 0.4 s |
| GeoJSON, Shapefile, CSV, GML, GeoPackage, SQLite | Read in full, once; announced above 100 MB | 325 MB GeoJSON: ~34 s |
| PMTiles (vector) | Tiles in view only; view-only | Any size |

Opening can always be cancelled (within 3 s). Running out of memory (the
engine's limit is 3.1 GB) ends in a message, and the viewer stays usable.
For very large data, GeoParquet is the best format.

## Supported formats

GeoJSON, GeoPackage (several layers), SQLite and SpatiaLite databases such as
Cube 7 networks (several layers; attribute tables can be queried by name),
FlatGeobuf, Shapefile (with `.shx`, `.dbf`, `.prj`), GeoParquet, Parquet with a WKB geometry column, GML, CSV with
`lon`/`lat`, `longitude`/`latitude` or `wkt` columns, and vector PMTiles (view
only). File Geodatabase folders can't be read; the extension offers an
`ogr2ogr` command to convert one to GeoPackage.

## Commands

| Command | What it does |
|---|---|
| Spatial Explorer: Open in Spatial Explorer | Opens the file (also in the Explorer and editor-tab context menus) |
| Spatial Explorer: Export Data… | Exports the displayed result |
| Spatial Explorer: Open Sample Data (US Counties) | Opens a bundled sample, no workspace file needed |

## Settings

| Setting | Default | What it does |
|---|---|---|
| `spatialExplorer.placeSearch.enabled` | `true` | Shows the place search on the map. Turn it off to hide it. |

## Privacy and network

Your files never leave your machine: they are read by an embedded DuckDB
engine inside the editor. The network is used only for:

- **The SQL engine, once.** DuckDB-WASM and sql.js from jsDelivr, and the
  spatial, parquet and json extensions from extensions.duckdb.org, at pinned
  versions. Each file is checked against a SHA-256 recorded at build time and
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
