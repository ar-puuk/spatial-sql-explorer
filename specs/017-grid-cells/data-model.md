# Data model: Grid cells

## BinSpec (what the dialog produces)

| Field | Type | Notes |
|---|---|---|
| system | `'h3'` or `'a5'` | registry key in `gridSystems.ts` |
| resolution | integer | H3 0..15, A5 0..30 (registry range) |
| measure | `{ kind: 'count' }` or `{ kind: 'sum' / 'avg' / 'min' / 'max' / 'median', column: string }` | the column must be numeric in the open layer |
| selectedOnly | boolean | default false |

Validation: resolution inside the system's range; the measure column exists and is numeric; the layer has a geometry column. An invalid spec
is never turned into SQL.

## GridSystem (registry row)

`id`, `label`, `minRes`, `maxRes`, `cellAreaKm2[res]`, `edgeKm[res]`, `argumentOrder` (`latlng` for H3, `lonlat` for A5), `cellIdSql`,
`cellGeometrySql` (with the date-line split), `equalArea` (A5: true; used only for the dialog's note).

## BinQuery (what the session returns)

`sql` (the text for the query panel), `valueLabel` (for example "Average of population"), `estimatedCells`, `usable` (false with a `reason` when
the layer has no geometry or an extension is missing).

## Result columns (the contract with the style and the table)

| Column | Type | Meaning |
|---|---|---|
| `cell_id` | VARCHAR | H3 string id or A5 hex id |
| `resolution` | INTEGER | the bin's resolution |
| `value` | DOUBLE | the measure (equals `n` for count) |
| `n` | BIGINT | features in the cell |
| `geom` | GEOMETRY('EPSG:4326') | cell polygon or MultiPolygon (split at the date line) |

## BinPreference (global, `saveState('binCells')`)

`{ system, measureKind }`. Normalized on read; an unknown system falls back to `h3`.

## State transitions (store)

`closed -> open(idle) -> previewing(running) -> open(idle)`; Apply keeps the result and closes; Cancel restores the previous query text and view.
