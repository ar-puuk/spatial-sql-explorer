// Export formats (spec 005 FR-003/FR-004, research §2; spec 008 FR-019–FR-021,
// research §3). DATA: only formats verified end to end (written here, read
// back by QGIS or a reader) appear here.
//
// Spec 010 (DuckDB 1.5.6, research.md S7/S9): the engine writes Parquet/
// GeoParquet, CSV, JSON and GeoJSONSeq (DuckDB's own COPY), FlatGeobuf
// (GDAL's COPY) and xlsx (the excel extension). GDAL's other writers fail in
// WASM (GeoPackage errors; a Shapefile's headers come out wrong; GeoJSON and
// KML take minutes for 100,000 rows), so those four are written in JS
// (export/writers/*, geojson.ts) from rows streamed out of the engine in batches.

export type ExportFormatId = 'geoparquet' | 'geojson' | 'geojsonseq' | 'flatgeobuf' | 'geopackage' | 'shapefile' | 'kml' | 'csv' | 'parquet' | 'xlsx' | 'json'

export interface ExportFormat {
  id: ExportFormatId
  label: string
  extension: string
  /**
   * Spec 008 FR-019: which list the format is in. 'spatial': with geometry
   * ("Include geometry" on); 'attributes': without; 'both': either (CSV).
   */
  group: 'spatial' | 'attributes' | 'both'
  /** GeoJSON, GeoJSONSeq and KML are always WGS84. */
  crs: 'wgs84-only' | 'any'
  /** 'engine': DuckDB's own COPY; 'gdal': COPY … (FORMAT GDAL); 'excel': COPY … (FORMAT xlsx); 'js': our writer, fed the result's rows. */
  writer: 'engine' | 'gdal' | 'excel' | 'js'
  /** True when rows are written by our streaming writer (progress in rows); false for engine COPY. */
  streams: boolean
}

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { id: 'geoparquet', label: 'GeoParquet', extension: '.parquet', group: 'spatial', crs: 'any', writer: 'engine', streams: false },
  { id: 'geopackage', label: 'GeoPackage', extension: '.gpkg', group: 'spatial', crs: 'any', writer: 'js', streams: true },
  { id: 'geojson', label: 'GeoJSON', extension: '.geojson', group: 'spatial', crs: 'wgs84-only', writer: 'js', streams: true },
  { id: 'flatgeobuf', label: 'FlatGeobuf', extension: '.fgb', group: 'spatial', crs: 'any', writer: 'gdal', streams: false },
  { id: 'shapefile', label: 'Shapefile (zip)', extension: '.shp.zip', group: 'spatial', crs: 'any', writer: 'js', streams: true },
  { id: 'kml', label: 'KML', extension: '.kml', group: 'spatial', crs: 'wgs84-only', writer: 'js', streams: true },
  { id: 'geojsonseq', label: 'GeoJSON (newline-delimited)', extension: '.geojsonl', group: 'spatial', crs: 'wgs84-only', writer: 'engine', streams: false },
  { id: 'csv', label: 'CSV', extension: '.csv', group: 'both', crs: 'any', writer: 'engine', streams: false },
  { id: 'parquet', label: 'Parquet', extension: '.parquet', group: 'attributes', crs: 'any', writer: 'engine', streams: false },
  { id: 'xlsx', label: 'Excel workbook', extension: '.xlsx', group: 'attributes', crs: 'any', writer: 'excel', streams: false },
  { id: 'json', label: 'JSON', extension: '.json', group: 'attributes', crs: 'any', writer: 'engine', streams: false },
]

export function exportFormat(id: ExportFormatId): ExportFormat {
  return EXPORT_FORMATS.find((f) => f.id === id) ?? EXPORT_FORMATS[0]
}

/** Excel's sheet limit, header row included. */
export const XLSX_MAX_ROWS = 1_048_576
/** A Shapefile part (.shp or .dbf) can't pass 2 GB. */
export const SHAPEFILE_MAX_BYTES = 2 * 1024 ** 3
/** GeoPackage is built in memory (sql.js): exports over this size stop with a message. */
export const GEOPACKAGE_MAX_BYTES = 1.5 * 1024 ** 3
