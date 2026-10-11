# Data Model: UX Polish and Legacy Parity (spec 008)

New and changed entities only. Everything persisted is plain JSON, stored
through `HostAdapter.saveState`. Nothing persisted holds user data. Spec
references: FR-xxx = spec.md requirements; §n = research.md sections.

## FileLayer (new, core)

One named layer inside a file (§1). Produced by listing the file with
`ST_Read_Meta`. Single-layer formats produce exactly one.

| Field | Type | Notes |
|---|---|---|
| `name` | string | As stored in the file; may contain spaces or quotes |
| `geometryType` | `GeometryType \| null` | `null` for attribute-only tables |
| `featureCount` | number \| null | From the file's metadata; `null` if unknown |
| `crs` | `CrsInfo \| null` | From the layer's geometry field |
| `sqlName` | string | Quoted identifier used as the lazy SQL view name |

**Rules**:
- Active layer at open: the first with geometry, else the first.
- `DatasetFacts.layers?: FileLayer[]` is present only when there are 2 or
  more layers, and `DatasetFacts.activeLayer?: string` names the active one.
- `stateKey` for per-layer state is `<file stateKey>#<name>` when `layers`
  is present, else the file's `stateKey` (unchanged for single-layer
  files, so existing saved styles keep working).

## ColumnView (new, persisted per file/layer)

`saveState('columns:' + stateKey, ColumnView)`.

| Field | Type | Notes |
|---|---|---|
| `hidden` | string[] | Column names hidden in the table |

**Rules**:
- Names that no longer exist are ignored; new columns show (hidden-list
  semantics).
- At least one column stays visible: hiding the last one is refused, with a
  message.
- It applies to a query result only when the result's column set equals
  the source's. Otherwise the result starts with all columns shown, and
  the choice is not saved.

## ColumnFilter / FilterSet (new, session only)

| Field | Type | Notes |
|---|---|---|
| `column` | string | |
| `kind` | `'contains' \| 'eq' \| 'gte' \| 'lte' \| 'between' \| 'bool'` | Offered by column type (FR-010) |
| `value` | string \| number \| boolean | Text input as typed; parsed by type |
| `value2` | number \| string | `between` only |
| `valid` | boolean | False when the value doesn't parse; an invalid filter is not applied |

**Rules**:
- A FilterSet is the list of valid filters, combined with AND.
- It is cleared by a new query, a layer switch or reopening the file.
- It compiles to SQL in `core/query/filters.ts`. Literals are always quoted
  by core (no raw text). `contains` uses `ILIKE` with `%`, `_` and `\`
  escaped.

## Selection (new, session only)

```
type Selection =
  | { kind: 'ids'; ids: Set<number> }          // __se_rowid values
  | { kind: 'all-matching' }                   // everything the FilterSet matches
```

Plus `showSelectedOnly: boolean`.

**Transitions**:
- Ticking or Ctrl-clicking adds or removes an id (`ids`).
- The header checkbox moves to `all-matching`; unticking a row in that
  state converts to `ids`, but only when the matching count is ≤ 50,000.
  Above that, the header simply toggles.
- A plain click on the map replaces the selection with one id.
- Clear empties it.
- A filter change keeps `ids` (rows that no longer match are hidden, not
  dropped) and keeps `all-matching` as a rule.
- A new query, a layer switch or reopening clears it.

## ExportRequest (changed, spec 005)

Adds:

| Field | Type | Notes |
|---|---|---|
| `includeGeometry` | boolean | Default: true when the result has geometry |
| `scope` | `'all' \| 'filtered' \| 'selected'` | Offered only when filters or a selection exist (FR-014) |

`ExportFormat` gains:
- `group: 'spatial' | 'attributes'`, which replaces `geometry: 'required' |
  'optional' | 'none'` as the list filter;
- `writer: 'engine' | 'js'`;
- `limits?`: a max row count (xlsx 1,048,576), a max output size
  (GeoPackage 1.5 GB, Shapefile 2 GB per part), and `wgs84Only`.

`ExportPlan.forcedChanges` gains the format-specific changes (FR-021):
- Shapefile field renames, with the mapping listed;
- splitting a mixed result into one Shapefile per geometry type in the zip;
- DBF type coercions;
- reprojecting to WGS84 for KML;
- truncating at the xlsx row limit.

Formats:

| id | Label | Group | Writer |
|---|---|---|---|
| geoparquet | GeoParquet | spatial | engine |
| geojson | GeoJSON | spatial | js (existing) |
| geojsonseq | GeoJSON (newline-delimited) | spatial | js |
| flatgeobuf | FlatGeobuf | spatial | js |
| geopackage | GeoPackage | spatial | js (sql.js) |
| shapefile | Shapefile (.zip) | spatial | js |
| kml | KML | spatial | js |
| csv-wkt / csv-xy | CSV with geometry | spatial | engine (existing) |
| csv | CSV | attributes | engine |
| parquet | Parquet | attributes | engine |
| xlsx | Excel workbook | attributes | js |
| json | JSON | attributes | engine |

## LayerStyle (changed, spec 003)

Adds an optional `extrusion`:

```
extrusion?: {
  enabled: boolean
  source: { kind: 'column'; column: string } | { kind: 'constant'; meters: number }
  scale: number        // default 1; > 0
}
```

**Rules**:
- Polygon layers only. On other geometry types, `sanitizeStyle` drops it.
- Effective height is `max(0, value × scale)`. Missing, zero or negative
  values are flat, and are counted in `ResolvedStyle.flatCount`.
- In interchange (§5): QML `<renderer-3d>` and Mapbox `fill-extrusion`
  carry it. SLD drops it with a `StyleNotice`.

## LegendRange (new, session only)

`{ min: number; max: number }` per graduated style. It is null when it
equals the full range. It resets when the renderer, column, method, class
count or breaks change. It applies as a map filter only, never to the table
or export.

## MapViewPrefs (new, persisted per user)

- `saveState('projection', 'mercator' | 'globe')`.
- Pitch and bearing are session only. "Reset view" sets both to 0.

## ThemePreference (new, web shell only)

`saveState('theme', 'system' | 'light' | 'dark')`, default `system`. The
effective `ThemeKind` is fed to the existing `HostAdapter.getTheme` and
`onThemeChange`.

## ShareState (new, web only, §13)

| Field | Type |
|---|---|
| `v` | 1 |
| `source` | `{ kind: 'file'; name: string; size: number } \| { kind: 'sample' }` |
| `layer` | string? |
| `query` | string |
| `style` | LayerStyle? |
| `basemap` | string (catalog id) |
| `projection` | `'mercator' \| 'globe'` |
| `view` | `{ center: [number, number]; zoom: number; pitch: number; bearing: number }` |

**Rules**:
- Encoded as `#v1=` + base64url(deflate(JSON)). Decoding validates every
  field, and unknown or invalid fields are dropped and reported.
- Never holds rows, file paths or column values outside the query and the
  style the user wrote.

## BasemapEntry (changed: catalog rows only)

Adds `esri-imagery`, `opentopomap` and `osm` (type `raster`, `requiresKey:
false`, with attribution and `maxzoom`). No schema change.
