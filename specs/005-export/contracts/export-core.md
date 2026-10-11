# Contract: export service (packages/core/src/export)

```ts
// formats.ts: catalog data (research §2)
export const EXPORT_FORMATS: readonly ExportFormat[]

// plan.ts: pure; what the dialog shows (data-model ExportPlan)
export function planExport(
  request: ExportRequest,
  ctx: {
    layer: Pick<Layer, 'rowCount' | 'invalidGeometryCount' | 'truncated' | 'columns' | 'geometryType'>
    geometryColumn: string | null
    otherGeometryColumns: string[]
    resultCrs: { label: string; srid: number | null; assumed: boolean }
    defaultView: boolean            // the untouched initial view (spec 002)
    totalRows: number               // __se_result row count (or the file's, for the default view)
  }
): ExportPlan

// projjson.ts: research §3; cached per EPSG code per engine
export function projjsonFor(db: AsyncDuckDB, conn: AsyncDuckDBConnection, srid: number): Promise<object>

// run.ts: on QuerySession's exclusive connection (spec 002)
export interface ExportHooks {
  onProgress?(rowsWritten: number | null): void   // null = indeterminate (engine COPY)
}
export function runExport(session: QuerySession, plan: ExportPlan, request: ExportRequest, hooks: ExportHooks): Promise<{ bytes: Uint8Array; rows: number; notices: string[] }>
// QuerySession gains: exportData(...) (wraps runExport in `exclusive`), and cancel() also cancels exports.
```

## Guarantees

1. **Only verified formats** are in `EXPORT_FORMATS` (FR-004).
2. **The lockdown is unchanged.** Files are written only to
   `/se-source/__se_export-<n>.<ext>` (and `__se_crs_<code>.geojson`
   probes), and the target is dropped in `finally` on every outcome.
3. **GeoParquet** always has exactly one `geo` key, with the full PROJJSON
   of the output CRS (or none, for WGS84 lon/lat) and WKB geometry. QGIS
   reads the stated CRS (SC-002).
4. **GeoJSON** is RFC 7946: WGS84 lon/lat, no `crs` member, and
   `"geometry": null` for rows without valid geometry.
5. **Rows**: `rows = 'all'` exports the complete query result (`layer` for
   the untouched default view). `'shown'` exports exactly the displayed rows
   (FR-002).
6. **Cancel**: `QuerySession.cancel()` stops a running export within 3 s,
   leaves the connection usable, and the promise rejects with
   `QueryCancelledError`.
7. **No silent change**: every transformation the export applies is in the
   plan's `notices` or the returned `notices` (FR-009).
