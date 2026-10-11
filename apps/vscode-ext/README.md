# Spatial Explorer: Spatial SQL & Map Viewer

Open a geospatial file in VS Code and see it on a map and in an attribute
table, without opening a desktop GIS.

## Features

- **Open GIS files directly in VS Code.** GeoPackage, FlatGeobuf, Shapefile,
  GeoParquet and PMTiles open in Spatial Explorer by default. GeoJSON, CSV, Parquet,
  GML and JSON offer it under **Open With…**, so text viewers aren't
  replaced. You can also right-click a file and choose
  **Open in Spatial Explorer**.
- **Map and table, in sync.**
  - Click a feature on the map to select its row and see all of its
    attributes. Double-click a row to zoom to the feature.
  - The table can be sorted, its columns resized, and it can be navigated
    from the keyboard.
- **Correct positions in any CRS.** The source coordinate system is read
  from the file and shown in the status bar, and the data is reprojected for
  display. Files with no CRS are clearly marked as "WGS84 assumed".
- **Looks like VS Code.** Every color comes from your theme, including
  high-contrast themes. The basemap follows the theme's light or dark mode.
  CRS, feature count and cursor coordinates appear in the native status bar.
- **Basemaps.** OpenFreeMap vector basemaps (Positron, Liberty, Bright,
  Dark, Fiord) or a blank background in a color you choose. If the network
  is unavailable, the map falls back to blank and your data still shows.
- **Thematic maps that QGIS understands.**
  - Pick a style type and a column, and the map is styled at once: color
    by category, or by numeric classes (equal interval, quantile, natural
    breaks). A chart of the column's values shows where the class breaks
    fall.
  - Browse color ramps and see each one on the map before you pick it.
    Opacity, outline and point size apply live, to the map and the legend.
  - Edit any class's color, label or bounds, or hide it from the map with
    its legend swatch.
  - **Save style (QML)** writes `<file>.qml` next to the data, which QGIS
    loads automatically, and it's applied when you reopen the file.
    Categorized and graduated styles open in QGIS with the same classes.
    The arrow next to it saves OGC SLD or Mapbox GL style JSON instead.
  - Import QGIS QML, OGC SLD, or Mapbox GL style JSON.
  - Styles follow your queries: classes are recomputed for each result.
- **Spatial SQL.** Press **Ctrl+Shift+Q** (**Cmd+Shift+Q** on macOS) to
  open the query panel, and query the file as the table `layer` with DuckDB
  spatial SQL. **Ctrl/Cmd+Enter** runs the statement under the cursor or the
  selection. Results go to the map and the table. Autocomplete covers your
  columns and the spatial functions, errors are underlined where they
  happen, and recent queries are kept per file.
- **Export.** Save the displayed result as GeoParquet, GeoJSON or CSV (or
  Parquet for tables) from the **Export** button above the table, or with
  **Spatial Explorer: Export Data…**. Exports keep the data's CRS (GeoParquet
  records it so QGIS reads it correctly) or reproject to WGS84, and a notice
  lists anything the format changes. The source file is never modified.
- **Local-first.** Files are read by an embedded DuckDB engine inside the
  editor and are never uploaded. The network is used only for the DuckDB
  spatial extension and basemap tiles.

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
| GeoJSON, Shapefile, CSV, GML, GeoPackage | Read in full, once; announced above 100 MB | 325 MB GeoJSON: ~34 s |
| PMTiles (vector) | Tiles in view only; view-only | Any size |

Opening can always be cancelled (within 3 s). Running out of memory (the
engine's limit is 3.1 GB) ends in a message, and the viewer stays usable.
For very large data, GeoParquet is the best format.

## Notes
- Output: **View → Output → Spatial Explorer** logs each open and each query
  with timings.
- Multi-layer files open their first layer.

## Supported formats

GeoJSON, GeoPackage, FlatGeobuf, Shapefile (with `.shx`, `.dbf`, `.prj`),
GeoParquet, Parquet with a WKB geometry column, GML, CSV with
`lon`/`lat`, `longitude`/`latitude` or `wkt` columns, and vector PMTiles
(view only). See **Large files** for how each is read.

Also available as a web app: https://ar-puuk.github.io/spatial-sql-explorer/
