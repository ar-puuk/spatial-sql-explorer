# Data Model: Large Files and Viewport Loading (spec 007)

Types live in `packages/core/src/models.ts` unless noted. "Changed" entries
list only what this spec changes.

## ReadMode

How the engine reaches a format (research §4). This is a data catalog
(`source/readModes.ts`), one row per format.

| Field | Type | Notes |
|---|---|---|
| `format` | `ReadStrategy` | The existing format ids (`geoparquet`, `parquet`, `flatgeobuf`, `geojson`, `shapefile`, `csv`, `gml`, `gpkg`, …) plus `pmtiles` |
| `mode` | `'partial' \| 'partial-view' \| 'whole' \| 'tiles'` | See below |
| `viewCap` | `number` | The display cap for views in this mode: 25,000, or about 2,500 for `partial-view` (tuned by measurement) |
| `wholeReadThresholdBytes` | `number \| null` | 100 MB for `whole` (the announcement, FR-004). For `partial-view`, the size up to which the file is loaded into memory at once |

The modes:
- `partial` (GeoParquet, Parquet): read in parts for everything.
- `partial-view` (FlatGeobuf): read in parts for facts and views. Whole-file
  work needs it loaded into memory.
- `whole` (the GDAL formats): parsed into a table.
- `tiles` (PMTiles): rendered by the map. No engine.

**Rule**: the platform can override the mode. With the VS Code fallback, every
engine format becomes `whole` (FR-015).

## FileSource (changed, `hostAdapter.ts`)

How a shell hands the primary file and its sidecars to core.

```ts
type FileSource =
  | { kind: 'handle'; name: string; size: number; handle: unknown; sidecars: Array<{ name: string; handle: unknown }> }   // web: opaque File
  | { kind: 'url'; name: string; size: number; url: string; sidecars: Array<{ name: string; url: string }> }            // VS Code: loopback
  | { kind: 'bytes'; name: string; size: number; bytes: Uint8Array; sidecars: Array<{ name: string; bytes: Uint8Array }> } // fallback / today
```

The handle is opaque to core: it is passed straight to the engine (no File API
use in core, Constitution II).

**New**: `HostAdapter.readRange(ref, offset, length): Promise<Uint8Array>`,
used by the PMTiles source.

## DatasetFacts

Whole-file facts shown at once, never derived from what's on screen (FR-001).

| Field | Type | Notes |
|---|---|---|
| `rows` | `number` | Exact: the footer, header or parsed table |
| `rowsEstimated` | `boolean` | True only while a count is pending (none of the spiked modes need it) |
| `extent` | `Bbox \| null` | From `geo` metadata, the FlatGeobuf header, the parsed table, or PMTiles bounds |
| `crs` | `CrsInfo` | As in spec 001 |
| `geometryType` | `GeometryType` | |
| `columns` | `Array<{ name; type }>` | Hidden `__se_` columns excluded |
| `readMode` | `ReadMode['mode']` | |
| `spatialIndex` | `'covering' \| 'built' \| 'building' \| 'file' \| 'rtree' \| 'none'` | Where views get their bbox: GeoParquet covering columns, a one-scan index, the FlatGeobuf index, or an R-tree |
| `fallback` | `string \| null` | Why the whole file is being read, when it is (FR-015) |

## Layer (changed)

- **Removes** `features: Feature[]`. Nothing holds the whole result in memory
  any more.
- **Gains** `facts: DatasetFacts`. `source` (totals) stays as an alias for
  compatibility with the status bar.
- **Removes** `truncated`. **Keeps** `totalRows`, which is now always the
  exact result count.
- Other fields are unchanged.

## Result (changed, `query/session.ts`)

What a query produced, held by the session.

| Field | Type | Notes |
|---|---|---|
| `relation` | `'layer' \| '__se_result'` | The default query uses `layer` directly |
| `kind` | `'view' \| 'table'` | A table when materialized (≤ 500,000 rows, tuned) |
| `rows` | `number` | Exact (FR-010) |
| `bboxColumns` | `boolean` | `__se_xmin/ymin/xmax/ymax` present |
| `rtree` | `boolean` | An index on the geometry (table results with geometry) |
| `reRuns` | `boolean` | A view over a heavy query: each view or page re-runs it, and a notice is shown once |
| `geometryColumn`, `resultCrs`, `columns` | as in spec 002 | |

**Hidden columns**, on `layer` and on every result that keeps them:
- `__se_rowid` (BIGINT): a stable feature id. It is `file_row_number` for
  Parquet, and the parse order for tables.
- `__se_xmin`, `__se_ymin`, `__se_xmax`, `__se_ymax`: in the layer's CRS.

They are never shown, exported or offered in autocomplete.

## ViewRequest / ViewFeatures

```ts
interface ViewRequest { generation: number; bbox: Bbox /* WGS84 */; zoom: number; cap: number }
interface ViewFeatures {
  generation: number
  features: Feature[]              // geometry in WGS84; id = __se_rowid
  inView: number                   // exact count of the result's rows intersecting the view
  thinned: boolean                 // inView > cap: one feature per grid cell
  ms: number
}
```

**Rules**:
- The view's bbox is transformed to the layer CRS for the predicate, not the
  features (spec edge case).
- A newer generation cancels and supersedes an older one (FR-007).
- Rows with invalid geometry never appear in views. They are counted in the
  result.

## TablePage

```ts
interface TablePageRequest { offset: number; limit: number /* 200 */; sort: { column: string; dir: 'asc' | 'desc' } | null }
interface TablePage { offset: number; rows: Array<{ id: number; attributes: Record<string, unknown>; invalidGeometry: boolean }> }
```

Pages are held in an LRU (about 50 pages) keyed by result, sort and offset.
Changing the result or the sort clears it.

## StyleStats

The input to classification. It replaces iterating features (spec 003 model
otherwise unchanged).

```ts
interface StyleStats {
  column: string
  rows: number
  nulls: number
  categories?: Array<{ value: unknown; count: number }>          // top 12 + other count
  otherCount?: number
  min?: number; max?: number
  quantiles?: number[]                                            // for the requested class count
  values?: number[]; sampled?: boolean                            // Jenks input: all if ≤ 50,000, else a deterministic sample
  classCounts?: number[]                                          // exact, computed after breaks
}
```

## OpenPhase (state, `viewerStore`)

```text
idle → registering → facts → (announce?) → reading|indexing → ready
                           ↘ cancelled / failed(oom|error)
```

- `announce`: whole-read files over the threshold wait for Continue or
  Cancel (FR-004).
- `reading`: a whole-read parse, or a FlatGeobuf "load for queries". It shows
  elapsed time and Cancel.
- `indexing`: a GeoParquet file without covering columns. Facts are already
  shown, and the map waits.
- `failed(oom)`: shows the FR-014 message. The viewer stays usable, and the
  source is re-registered.

## Notices (FR-006, FR-016)

| Where | When | Text (example) |
|---|---|---|
| Map | `ViewFeatures.thinned` | "Showing 25,000 of 310,412 in view. Zoom in to see all." |
| Map | `spatialIndex = 'building'` | "Indexing 4,000,000 features for the map…" |
| Map / status | `facts.fallback` | "Reading the whole file: partial reads aren't available in this window." |
| Table header | `result.reRuns` | "Large result: scrolling and map views re-run the query." |
| Legend | `stats.sampled` | "Breaks from a 50,000-value sample; counts are exact." |
| Query / table / style / export | FlatGeobuf in parts, not loaded | "Load the whole file (1.4 GB) to query it." |
| PMTiles panels | always | "PMTiles holds map tiles, not a table: SQL, table, styling and export aren't available." |
