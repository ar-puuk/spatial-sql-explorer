# Export fixtures (spec 005)

- `columns.json`: one column per DuckDB type family, so the export plan's
  notices can be tested without an engine.
- `geoparquet-utm12n.parquet`: the GeoParquet shape QGIS 4.2.3 / GDAL 3.13.3
  reads with the correct CRS (EPSG:26912). It has WKB `BLOB` geometry, no
  native Parquet geometry type, and one `geo` key with the full PROJJSON. It
  was produced by the spec 005 Phase 0 spike (`specs/005-export/research.md`
  §3).
