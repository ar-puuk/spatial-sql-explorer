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
- **Local-first.** Files are read by an embedded DuckDB engine inside the
  editor and are never uploaded. The network is used only for the DuckDB
  spatial extension and basemap tiles.

## Notes

- Large files: up to 1,000 features are drawn at a time. The feature count
  and the map extent always cover the whole file.
- Output: **View → Output → Spatial Explorer** logs each open with timings.
- Multi-layer files open their first layer.

## Supported formats

GeoJSON, GeoPackage, FlatGeobuf, Shapefile (with `.shx`, `.dbf`, `.prj`),
GeoParquet, Parquet with a WKB geometry column, GML, and CSV with
`lon`/`lat`, `longitude`/`latitude` or `wkt` columns.

Also available as a web app: https://ar-puuk.github.io/spatial-sql-explorer/
