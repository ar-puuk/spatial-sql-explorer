# Contract: core data access (`packages/core`)

This covers how core opens a source and answers the map, the table and styles
for spec 007. Types are in data-model.md.

## Engine

- `createDuckDb` opens the database with `filesystem: { reliableHeadRequests:
  true, allowFullHTTPReads: false, forceFullHTTPReads: false }`, before the
  spatial extension and the lockdown.
- **Guarantee**: a registered URL is read with Range requests or fails
  loudly. It is never downloaded whole silently (research §3).
- `recoverFromOom(session)`:
  - drops every `__se_` table;
  - re-registers the source with the same `FileSource`;
  - rebuilds `layer`;
  - resolves when `SELECT 1` works.

  It is called by the session on any "Out of Memory" error (research §1).

## `source/`

### `readModeFor(strategy, fileSize, platform): ReadMode`

Pure; reads the `READ_MODES` catalog.
- `platform.partialReads === false` (the VS Code fallback) maps every engine
  format to `whole`.

### `registerSource(db, source: FileSource): Promise<RegisteredSource>`

Registers the primary file and its sidecars under `/se-source/`:

| `source.kind` | Engine call |
|---|---|
| `handle` | `registerFileHandle(path, handle, BROWSER_FILEREADER, true)` |
| `url` | `registerFileURL(path, url, HTTP, false)` |
| `bytes` | `registerFileBuffer` |

- It returns the paths and a `reRegister()` used by OOM recovery.
- It never copies a `handle` or `url` source into memory.

### `readFacts(conn, registered, mode): Promise<DatasetFacts>`

| Mode | Source of facts | Spiked |
|---|---|---|
| `partial` | Parquet footer (`count(*)`), `parquet_kv_metadata` `geo` (extent, CRS, types), `DESCRIBE`; `spatialIndex` from the `covering` metadata or a struct column `bbox{xmin,ymin,xmax,ymax}` | under 50 ms |
| `partial-view` | `ST_Read_Meta` (FlatGeobuf header: count, CRS, fields), extent from the header | 38 ms |
| `whole` | after the parse: `count(*)`, `ST_Extent_Agg` over the bbox columns, the CRS as in spec 001. **Never `ST_Read_Meta` on GeoJSON** (it parses the whole file) | |
| `tiles` | handled by the UI's PMTiles source, not here | |

## `openFile` (changed)

```ts
openFile(db, source, hooks: { onPhase(phase: OpenPhase, detail?): void; confirmWholeRead(sizeBytes): Promise<boolean>; isCancelled(): boolean })
  : Promise<{ layer: Layer; session: QuerySession }>
```

The steps, in order:
1. `registerSource`.
2. `readFacts` (where the mode allows it before reading).
3. `onPhase('facts')`.
4. **`whole`**:
   - if the size is over `wholeReadThresholdBytes`, `await
     confirmWholeRead(size)`; `false` resolves as cancelled;
   - parse into `__se_layer`, with the hidden columns
     (`row_number() OVER ()` as `__se_rowid`, plus the bbox columns);
   - create an R-tree on the geometry;
   - define `layer` as a view over it, without the hidden columns.
5. **`partial`**: `layer` is a view over `read_parquet(path, file_row_number
   := true)`, with the hidden columns mapped from the covering struct.
   Without covering columns, start the background bbox index (`__se_bbox`:
   `rn`, `xmin`…, `ymax`) and set `spatialIndex: 'building'`. Views wait for
   it.
6. **`partial-view`**: `layer` is a view over `ST_Read(path)`. Views use
   `spatial_filter_box`. Whole-file work is refused with `NeedsLoad` until
   `session.loadWhole()` loads the file into memory.
7. Cancel at any step stops within 3 s (FR-002). The engine is left with no
   `__se_` objects for this source.

## `QuerySession` (changed)

All methods run on the session's exclusive, cancellable connection (spec 002).

### `run(sql)`

1. Apply the statement policy (spec 002).
2. **The default query `SELECT * FROM layer`**: `result = { relation:
   'layer', kind: 'view' }` and `rows = facts.rows`. Nothing is copied.
3. **Otherwise** run `SELECT count(*) FROM (<sql>)` (exact, FR-010):
   - **≤ 500,000 rows (tuned)**: `CREATE TEMP TABLE __se_result AS SELECT
     *, <hidden columns> FROM (<sql>)`. The hidden columns come from the
     query when present, otherwise they are computed from the geometry. Then
     create an R-tree.
   - **Larger**: `CREATE TEMP VIEW __se_result AS <sql>`. Set `reRuns` when
     the plan contains ORDER BY, a join or an aggregate over the source
     (detected by `EXPLAIN`).
4. **No more large-result prompt.** `pendingLargeResult` and
   `answerLargeResult` are removed (FR-009).

### `view(req: ViewRequest): Promise<ViewFeatures>`

- **SQL** (from `view/viewport.ts`):
  - the bbox predicate on the hidden columns, through the R-tree, the
    covering columns or the index join;
  - FlatGeobuf uses `spatial_filter_box`;
  - `count(*)` in view first;
  - if over `cap`: `DISTINCT ON (floor((x - x0) / cell), floor((y - y0) /
    cell))` with `cell = viewWidth / √cap`, ordered by `__se_rowid`;
  - geometry as `ST_AsGeoJSON(ST_Transform(…, 4326))`;
  - `LIMIT cap`.
- A new request **cancels** the running one.
- Results from an older `generation` are discarded.

### `page(req: TablePageRequest): Promise<TablePage>`

`SELECT <visible columns>, __se_rowid, <invalid flag> FROM <relation>
[ORDER BY col NULLS LAST, __se_rowid] LIMIT 200 OFFSET k`, cached in the LRU.

### `featureById(id): Promise<Feature | null>`

Fetches by `__se_rowid`. Used for selection outside the loaded view, the
inspector, and zoom-to (FR-008).

### `styleStats(renderer): Promise<StyleStats>`

The SQL from `view/stats.ts` (data-model.md):
- Jenks values: `USING SAMPLE 50000 ROWS (reservoir, 42)` when `rows >
  50,000`;
- class counts in one `CASE` aggregation over the whole result.

### `loadWhole()` (FlatGeobuf only)

1. Ask the shell for bytes (`FileSource` `bytes`, through
   `HostAdapter.getFileSource(ref, { whole: true })`).
2. Re-register them as a buffer, and rebuild `layer` as a table with the
   hidden columns.

It reports progress, and Cancel works.

### `exportData`

Unchanged. `displayLimited` is removed from the export plan.

## Errors

| Situation | Message (FR-014) |
|---|---|
| Out of memory while opening (whole-read) | "This file is too large to read in full here (out of memory). Convert it to GeoParquet or FlatGeobuf to open it at any size." |
| Out of memory in a query, view, page or style | "That ran out of memory (3.1 GB limit). Filter the result, or select fewer columns." Followed by recovery. |
| A partial read fails (network, server gone) | "The file could not be read (<reason>). Reopen it to try again." |
