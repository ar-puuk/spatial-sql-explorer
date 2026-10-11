# Contract: core (spec 008)

APIs `packages/ui` and the shells rely on. Names are binding; signatures may
gain optional fields. Entities are defined in [data-model.md](../data-model.md).

## Layers (`source/layers.ts`)

```ts
listLayers(conn, sourcePath: string): Promise<FileLayer[]>
```
- Runs `ST_Read_Meta`. Returns `[]` for formats it doesn't apply to (Parquet,
  CSV, FlatGeobuf, PMTiles).
- Must not read layer contents.

`openFile(ref, hostAdapter, assets, options: OpenOptions)` changes:
- `options.layer?: string` reads that layer; it defaults to the active-layer
  rule.
- `facts.layers` and `facts.activeLayer` are set when there are 2 or more
  layers.

`QuerySession` changes:
- Registers one lazy view per non-active layer: `CREATE VIEW "<name>" AS
  SELECT * FROM ST_Read('<path>', layer='<name>')`.
- Skips names that collide with `layer` or reserved `__se_` names, and logs
  the skip.

**Errors**:
- A `.gdb` source (folder, zip or file inside one) is rejected with
  `UnsupportedFormatError` and the message: "File Geodatabase isn't
  supported yet. Convert it to GeoPackage, for example: ogr2ogr -f GPKG
  out.gpkg in.gdb".

## Filters (`query/filters.ts`)

```ts
filterKindsFor(columnType: string): ColumnFilter['kind'][]
parseFilter(f: ColumnFilter, columnType: string): ColumnFilter   // sets .valid
filtersToSql(filters: ColumnFilter[], columns: ColumnInfo[]): string | null   // "WHERE …" body or null
```
- Identifiers are always double-quoted and escaped; literals are always
  produced by core.
- Text uses `"c"::VARCHAR ILIKE '%…%' ESCAPE '\'`.
- Dates are compared as `DATE` or `TIMESTAMP` literals.
- `QuerySession.setFilters(filters)` re-points the displayed result at a
  filtered view. Pages, map views, counts, style statistics and export all
  read it.
- It returns `{ total, matching }` once counted; the count is cancellable
  background work.

## Selection (`query/selection.ts`)

```ts
selectionPredicate(sel: Selection): string | null          // "__se_rowid IN (…)" or null (all-matching)
selectionExtent(session, sel): Promise<Extent | null>       // ST_Extent_Agg over the selection
```
- `ids` lists over 50,000 are sent as a temporary table join, not an `IN`
  literal.

## Export (`export/*`)

- `EXPORT_FORMATS`: the table in data-model.md. Formats are exported only
  after read-back verification (tests list each one).
- `planExport(request, result)` honors `includeGeometry`, `scope` and
  format limits, and fills `forcedChanges` with the Shapefile, KML and xlsx
  rules.
- `runExport(plan, sink)`: engine formats are unchanged (COPY). JS formats
  pull pages from `rows.ts`:
  ```ts
  exportRows(session, plan, { geometry: 'wkb' | 'geojson' | 'none', pageSize }): AsyncIterable<RowPage>
  ```
  and stream to `sink.write(chunk)`. Progress is reported in rows; cancel
  stops between pages.
- Writers have the shape `(pages, schema, opts) => AsyncIterable<Uint8Array>`.
  `geopackage` dynamic-imports `sql.js`. The `.wasm` URL is supplied by the
  shell through `assets.sqlWasmUrl`, the same pattern as DuckDB.

## Style (`style/*`)

- `LayerStyle.extrusion?` (data-model.md).
- `resolveStyle` adds `extrusion: { heightExpr, flatCount } | null`.
- `toQml` / `fromQml`: `<renderer-3d type="vector">` with a polygon symbol;
  `extrusionHeight` data-defined `"col" * k`, `"col"` or a constant.
- `toMapbox` / `fromMapbox`: `fill-extrusion` layer;
  `fill-extrusion-height` is `["*", ["get", col], k]` or a number.
- `toSld`: returns a `StyleNotice` `{ code: 'extrusion-dropped' }` when
  extrusion is on.
- `valueHistogram(session, column, bins = 40): Promise<{ edges: number[];
  counts: number[]; sampled: boolean }>` in `view/stats.ts`.

## Share (`share.ts`)

```ts
encodeShareState(s: ShareState): string            // "v1=…"
decodeShareState(hash: string): { state: Partial<ShareState>; dropped: string[] } | null
```
- Encoding is deflated with `fflate`, then base64url.
- Callers check the length; over 8,000 characters is "too long".

## Basemaps

- Three new catalog rows; no API change.
