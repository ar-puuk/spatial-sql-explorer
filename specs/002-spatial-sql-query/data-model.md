# Phase 1 Data Model: Spatial SQL Query (002)

This extends spec 001's model (`specs/001-quick-look/data-model.md`). `Layer`,
`Feature`, `LayerStyle` and `ViewerSession` stay. A query result is presented
through the same `Layer` shape, so the map, table, inspector, style panel and
status bar need no second code path.

## QueryableTable (one per viewer)

The opened file as SQL sees it.

| Field | Type | Notes |
|---|---|---|
| `name` | `'layer'` | Always available (FR-002). It is a **view**, so writes to it fail in the engine itself (research §2). |
| `alias` | string \| null | The file name without its extension, if it is a valid unquoted identifier and not a keyword, e.g. `parcels`. A second view over the same data. |
| `columns` | `{ name, type }[]` | Spec 001's attribute rules: the source geometry is exposed as `geom`; GDAL `OGC_FID` is dropped; GeoPackage `fid` is kept. |
| `crs` | `CrsInfo` | The file's original CRS (FR-014). `geom` stays in it. |
| `totalRows` | number | All rows in the file, for "N of total" displays. |
| `backing` | `'materialized' \| 'streamed'` | Files up to 64 MB are parsed once into an internal table; larger files stream from `/se-source/`. |

## Query

| Field | Type | Notes |
|---|---|---|
| `text` | string | The statement actually executed: the selection, or the statement at the cursor (FR-004). |
| `editorOffset` | number | Where `text` starts in the editor, used to map error positions back (research §8). |
| `kind` | `'query' \| 'utility' \| 'tempDdl'` | From the statement policy (`contracts/statement-policy.md`). Refused statements never become a Query. |
| `state` | see transitions below | |
| `startedAt` / `durationMs` | number | Shown in the UI and logged (FR-010). |

### State transitions

```text
idle ──run──▶ checking ──refused──▶ failed(refused)
                 │
                 └─allowed──▶ running ──cancel──▶ cancelled
                                │
                                ├─engine error──▶ failed(error: message, hints, position?)
                                ├─tempDdl ok────▶ succeeded(ddl summary)          [display unchanged]
                                └─query ok──────▶ measuring ──rows ≤ 50,000─────▶ fetching ──▶ succeeded(result)
                                                       │
                                                       └─rows > 50,000──▶ awaitingConfirm
                                                              ├─show all / first 50,000──▶ fetching ──▶ succeeded
                                                              └─cancel────────────────────▶ cancelled
```

- Only one query runs at a time; Run is disabled while one is in flight.
- A query in `fetching` can still be cancelled.
- `failed` and `cancelled` never replace the displayed result (FR-008,
  FR-009).

## QueryResult

The displayed result. It replaces the view until Reset or a new query.

| Field | Type | Notes |
|---|---|---|
| `rowCount` | number | Rows the query returned. All of them are listed in the table. |
| `mappedCount` | number | Rows with valid geometry drawn on the map. Shown as "180 rows · 179 mapped". |
| `invalidGeometryCount` | number | `rowCount − mappedCount` among rows that have a geometry column. |
| `geometryColumn` | string \| null | The first `GEOMETRY` column, which is the one mapped. `null` means a table-only result (FR-006). |
| `otherGeometryColumns` | string[] | Shown in the table as truncated WKT. |
| `resultCrs` | `{ crs: CrsInfo; source: 'override' \| 'engine' \| 'detected' \| 'layer' }` | Resolution order in research §4. Displayed on the Result CRS chip. |
| `truncatedTo` | number \| null | Set when the user chose "Show first 50,000" (FR-012). |
| `layer` | `Layer` | Spec 001's shape: `features` (all rows; geometry null when invalid or missing), `extent`, `geometryType` and `sourceCrs = resultCrs.crs`. |

**Validation rules**:
- `mappedCount ≤ rowCount`.
- `truncatedTo` is only set when `rowCount > 50,000`.
- When `geometryColumn` is null, the map keeps the previous layer dimmed
  and shows a "no geometry to map" note.

## DefaultQuery

`SELECT * FROM layer LIMIT 1000`. FR-003 and Reset (FR-011) reproduce the
initial view from it.

## QueryHistoryEntry

| Field | Type | Notes |
|---|---|---|
| `text` | string | The executed statement text. |
| `ranAt` | ISO 8601 string | |
| `outcome` | `{ ok: true; rows: number } \| { ok: false; error: string }` | The error is the first line only. |

- **Scope**: per file, keyed by `history.<OpenedFileRef.stateKey>`.
- **Retention**: at most 20 entries, newest first. Re-running an identical
  text moves it to the top instead of duplicating it.
- **Storage**: `HostAdapter.saveState`; local only (FR-018).

## CatalogSnapshot

For autocomplete (FR-015). Rebuilt after open and after each `tempDdl`.

| Field | Source |
|---|---|
| `tables` | `layer`, the alias and user temp tables/views, each with `{ name, type }` columns, from `duckdb_tables()`, `duckdb_views()` and `duckdb_columns()`. Internal `__se_*` objects are hidden. |
| `functions` | `duckdb_functions()`: name, overload signatures (parameters, return type) and description. `ST_*` is ranked first. |
| `keywords` | `duckdb_keywords()` |

## Changes to existing entities

- **`OpenedFileRef`** gains `stateKey: string`: a stable per-file key for
  persisted state. VS Code uses the document URI; the web uses
  `name|size|lastModified`.
- **`Layer.featureCount`**: for query results, this is `mappedCount`. The
  table uses `rowCount`. Spec 001's file-open path keeps its meaning, the
  valid-feature count, now with the invalid rows also in `features` (plan
  "Spec amendments").
