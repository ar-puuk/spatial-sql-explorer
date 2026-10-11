// Export formats (spec 005 FR-003/FR-004, research §2). DATA: only formats
// verified end to end (engine write + QGIS read-back) appear here. Every
// GDAL-backed format fails to write in DuckDB-WASM 1.32.0, so FlatGeobuf,
// GeoPackage, Shapefile and KML are absent until re-verified.

export type ExportFormatId = 'geojson' | 'geoparquet' | 'csv' | 'parquet'

export interface ExportFormat {
  id: ExportFormatId
  label: string
  extension: string
  /** 'required': needs a geometry column. 'optional': with or without. 'none': only for results without geometry. */
  geometry: 'required' | 'optional' | 'none'
  /** GeoJSON is always WGS84 (RFC 7946). */
  crs: 'wgs84-only' | 'any'
  /** True when rows are written by our streaming writer (progress in rows); false for engine COPY. */
  streams: boolean
}

export const EXPORT_FORMATS: readonly ExportFormat[] = [
  { id: 'geoparquet', label: 'GeoParquet', extension: '.parquet', geometry: 'required', crs: 'any', streams: false },
  { id: 'geojson', label: 'GeoJSON', extension: '.geojson', geometry: 'required', crs: 'wgs84-only', streams: true },
  { id: 'csv', label: 'CSV', extension: '.csv', geometry: 'optional', crs: 'any', streams: false },
  { id: 'parquet', label: 'Parquet', extension: '.parquet', geometry: 'none', crs: 'any', streams: false },
]

export function exportFormat(id: ExportFormatId): ExportFormat {
  return EXPORT_FORMATS.find((f) => f.id === id) ?? EXPORT_FORMATS[0]
}
