# Contract: Bin into cells

## 1. Generated SQL (shape; H3, count, resolution 7, a point layer in EPSG:4326)

```sql
SELECT
  h3_h3_to_string(cell)                                                    AS cell_id,
  7                                                                        AS resolution,
  count(*)::DOUBLE                                                         AS value,
  count(*)                                                                 AS n,
  ST_SetCRS(<cell polygon from cell, split at the date line>, 'EPSG:4326') AS geom
FROM (
  SELECT h3_latlng_to_cell(ST_Y(p), ST_X(p), 7) AS cell
  FROM (SELECT <point of geom, in lon/lat> AS p FROM layer WHERE <current filters>)
  WHERE p IS NOT NULL
)
GROUP BY cell
```

- A5 swaps the cell function (`a5_lonlat_to_cell(ST_X(p), ST_Y(p), res)`, `a5_u64_to_hex`) and the polygon function.
- A projected layer: `<point>` is `ST_Transform(ST_Centroid(geom), '<layer CRS>', 'EPSG:4326')`; a point layer already in 4326 skips the transform.
- A measure other than count adds `<aggregate>(column)` as `value` and keeps `count(*)` as `n`; nulls are ignored by the aggregate.
- The text is plain SQL the user may edit; the dialog never depends on parsing it back.

## 2. Session (core)

- `binQuerySql(spec: BinSpec): BinQuery | null` - null when there is no layer or no geometry.
- `binSkippedRows(spec: BinSpec): Promise<number>` - rows excluded for having no location; shown after a run.
- `layerFactsForBin(): { geometryType, extentWgs84, rows, numericColumns }`.

## 3. Store (ui)

- `openBinDialog()` and `closeBinDialog()`; `binDialog: { open, spec, estimate, previewing, error }`.
- `setBinSpec(patch)`: updates the spec, recomputes the estimate, previews if the estimate is under 5,000.
- `applyBin()`: puts `binQuerySql` in the query panel, runs it, applies the default style when the previous result was not a bin, closes.
- `cancelBin()`: restores the previous query text and view.

## 4. Dialog behavior

- Opens with H3, count and the suggested resolution; focus lands on the grid-system control; Esc cancels; Enter applies.
- Every control has a label; the estimate and warnings are in a live region; sizes use metric or imperial as the Measure tool does.
- Disabled (not hidden) with a reason when no geometry exists or an extension did not load.
- Above 100,000 estimated cells a warning with a "Run anyway" step; the run is cancellable.
