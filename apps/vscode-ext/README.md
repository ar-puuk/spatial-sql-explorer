# Spatial Explorer: Spatial SQL & Map Viewer

Open a geospatial file in VS Code and see it on a map and in an attribute
table, without opening a desktop GIS.

## Features

- **Open GIS files directly in VS Code.** GeoPackage, FlatGeobuf, Shapefile
  and GeoParquet open in Spatial Explorer by default. GeoJSON, CSV, Parquet,
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
- **Layer styles that QGIS understands.**
  - Set fill, outline, width and point size.
  - **Save** writes `<file>.qml` next to the data, which QGIS loads
    automatically, and it's applied when you reopen the file.
  - Export or import QGIS QML, OGC SLD, or Mapbox GL style JSON.
- **Spatial SQL.** Press **Ctrl+Shift+Q** (**Cmd+Shift+Q** on macOS) to
  open the query panel, and query the file as the table `layer` with DuckDB
  spatial SQL. **Ctrl/Cmd+Enter** runs the statement under the cursor or the
  selection. Results go to the map and the table. Autocomplete covers your
  columns and the spatial functions, errors are underlined where they
  happen, and recent queries are kept per file.
- **Local-first.** Files are read by an embedded DuckDB engine inside the
  editor and are never uploaded. The network is used only for the DuckDB
  spatial extension and basemap tiles.

## Query examples

```sql
-- Filter (the initial view is SELECT * FROM layer LIMIT 1000)
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

## Notes

- Large files: the initial view shows up to 1,000 features. Raise or remove
  the `LIMIT` in the query panel to see more. Results over 50,000 rows ask
  first. The feature count and the map extent always cover the whole file.
- Output: **View → Output → Spatial Explorer** logs each open and each query
  with timings.
- Multi-layer files open their first layer.

## Supported formats

GeoJSON, GeoPackage, FlatGeobuf, Shapefile (with `.shx`, `.dbf`, `.prj`),
GeoParquet, Parquet with a WKB geometry column, GML, and CSV with
`lon`/`lat`, `longitude`/`latitude` or `wkt` columns.

Also available as a web app: https://ar-puuk.github.io/spatial-sql-explorer/
