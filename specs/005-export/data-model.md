# Data Model: Export (spec 005)

All types live in `packages/core/src/export/`. Nothing here is persisted
except the user's last choices (format, CRS and CSV geometry mode), which
are remembered per viewer through `HostAdapter.saveState('export.prefs')`.

## ExportFormat (catalog data)

| Field | Type | Notes |
|---|---|---|
| `id` | `'geojson' \| 'geoparquet' \| 'csv' \| 'parquet'` | Only verified formats exist (research §2). |
| `label` | string | e.g. "GeoJSON (.geojson)" |
| `extension` | string | `.geojson`, `.parquet`, `.csv`, `.parquet` |
| `geometry` | `'required' \| 'optional' \| 'none'` | GeoJSON and GeoParquet need geometry; CSV is optional; Parquet is for table results. |
| `crs` | `'wgs84-only' \| 'any'` | GeoJSON is `wgs84-only` (RFC 7946). |
| `streams` | boolean | GeoJSON: our writer reports rows. Others: engine `COPY` (indeterminate progress). |

## ExportRequest

```ts
interface ExportRequest {
  format: ExportFormat['id']
  rows: 'all' | 'shown'              // FR-002: 'shown' only when the display is limited
  crs: 'result' | 'wgs84'            // FR-006: forced to 'wgs84' for GeoJSON
  csvGeometry: 'wkt' | 'xy'          // FR-003: 'xy' only for point geometry
  fileName: string                   // default `<source base>-export.<ext>`
}
```

## ExportPlan (derived, shown before exporting)

What the dialog shows, and what the run uses.

```ts
interface ExportPlan {
  source: 'result' | 'layer'         // research §5: the untouched default view exports `layer` for 'all'
  rowCount: number                   // rows that will be written
  displayLimited: { shown: number; total: number } | null
  formats: Array<{ id: ExportFormat['id']; available: boolean; reason?: string }>  // e.g. no geometry
  crsChoice: { result: string; resultIsWgs84: boolean; forced?: 'wgs84'; reason?: string }
  notices: string[]                  // FR-009: predictable changes, known before running
  sql: string                        // the SELECT to export (geometry/WKT/CRS projections applied)
}
```

**Notice items known in advance** (FR-009):
- `GeoJSON is always WGS84 (longitude, latitude): coordinates are reprojected from EPSG:26912.`
- `N rows have no valid geometry: written with an empty geometry.` (all formats)
- `Other geometry columns are written as WKT text: geom2, centroid.`
- `Values of "big" larger than 2^53 are written as text.` (GeoJSON)
- `"tags" (VARCHAR[]) is written as JSON text.` (GeoJSON) / `… as text.` (CSV)
- `"payload" (BLOB) is written as base64 text.` (GeoJSON, CSV)
- `CRS assumed WGS84 (the file has none).` (when the result CRS is assumed)

## ExportOutcome

```ts
type ExportOutcome =
  | { kind: 'saved'; location: string; rows: number; bytes: number; notices: string[]; durationMs: number }
  | { kind: 'notSaved' }                            // the user dismissed the save dialog
  | { kind: 'cancelled'; durationMs: number }
  | { kind: 'failed'; message: string }             // FR-011: OOM gets an actionable message
```

## GeoParquet `geo` metadata (written by us, research §3)

```json
{
  "version": "1.1.0",
  "primary_column": "geom",
  "columns": {
    "geom": {
      "encoding": "WKB",
      "geometry_types": ["MultiPolygon"],
      "bbox": [minx, miny, maxx, maxy],
      "crs": { "...": "full PROJJSON; omitted when the output is WGS84 lon/lat (OGC:CRS84)" }
    }
  }
}
```

## Persisted preferences (HostAdapter state)

| Key | Value |
|---|---|
| `export.prefs` | `{ format, crs, csvGeometry }`: the last choices, as the dialog's defaults |
