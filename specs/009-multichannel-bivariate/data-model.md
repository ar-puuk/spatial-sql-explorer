# Data Model: Multi-Channel Styling and Bivariate Maps

Persisted shapes are plain JSON and are always passed through `sanitizeStyle`
on load (sidecar QML custom properties, saved state, Mapbox `metadata`).
Derived shapes (`Resolved*`) are never saved. Units are screen pixels.

## LayerStyle (extended)

| Field | Type | Notes |
|---|---|---|
| `renderer` | `Renderer` | The **color channel**. Adds `BivariateRenderer`. |
| `size` | `SizeChannel?` | **New.** Absent: every feature uses `pointRadius` / `strokeWidth`. Ignored for polygons and with bivariate (FR-006, FR-007). |
| …existing fields | | `fillColor`, `strokeWidth`, `pointRadius`, `markerShape`, `lineDash`, `layerOpacity`, `extrusion`, unchanged. |

`Renderer = SingleRenderer | CategorizedRenderer | GraduatedRenderer | BivariateRenderer`.

### Migration (FR-009)

A stored `GraduatedRenderer` with `vary: 'size'` (written 2026-10-12)
becomes:
- `renderer: { kind: 'single' }`, and
- `size: { column, mode: 'classed', method, classCount, classes, noValue,
  sizeMin, sizeMax }`, taken from the graduated renderer (overrides keep
  label, visibility and bounds; colors are dropped).

`vary`, `sizeMin` and `sizeMax` are no longer written on `GraduatedRenderer`.

## SizeChannel (new)

| Field | Type | Rules |
|---|---|---|
| `column` | `string` | A numeric column of the displayed result. May equal the color column. |
| `mode` | `'classed' \| 'proportional'` | Default `classed`. |
| `method` | `GraduatedMethod` | Classed only. Default `quantile`. |
| `classCount` | `number` | Classed only. 2–10, default 5. |
| `classes` | `RangeClassDef[]` | Classed only. As graduated: manual = the full list with bounds; otherwise overrides by index. The `color` override is not allowed. |
| `noValue` | `{ label?, visible? }` | Classed and proportional. |
| `sizeMin`, `sizeMax` | `number` | 0.5–100 px, `sizeMin ≤ sizeMax`. Marker **radius** for points, **width** for lines. Defaults: points 2–10, lines 1–6. |
| `scale` | `'linear' \| 'area'`? | Proportional only. Set from the geometry when the channel starts: `area` for points, `linear` for lines; absent means linear. QGIS's transformer `scaleType` (1 / 0). Added in implementation (T022), because resolve doesn't know the geometry. |

**Validation**: as graduated (bounds contiguous and increasing when manual),
plus the size range rule. These errors block the edit with a message, as
today.

**Transitions**:
- Changing the method or class count recomputes the classes and keeps
  overrides by index (as graduated). A bound edit switches to manual.
- Changing the mode keeps the column and sizes. Classed → proportional
  drops the class overrides; proportional → classed starts with fresh
  classes.
- Turning the channel off deletes `size`.

## BivariateRenderer (new)

| Field | Type | Rules |
|---|---|---|
| `kind` | `'bivariate'` | |
| `x` | `{ column: string; method: 'quantile' \| 'equal' \| 'jenks' }` | Axis 1 (legend horizontal). Numeric. |
| `y` | same | Axis 2 (legend vertical). Numeric; `y.column ≠ x.column`. |
| `palette` | `string` | An id from `BIVARIATE_PALETTES`; unknown ids fall back to the default. |
| `hidden` | `string[]` | Hidden cell keys, `'<i>-<j>'` (i = x class, j = y class, 0-based). |
| `noValue` | `{ label?, visible? }` | |

**Validation**: two different numeric columns, otherwise "Choose two
different numeric columns".

**Transitions**:
- Choosing the other axis's column for an axis swaps the two columns,
  rather than being refused (T043).
- Swapping axes exchanges `x` and `y` and transposes `hidden`.
- Changing a method reclassifies that axis only. `hidden` keys are kept;
  keys outside a smaller grid are ignored.

## BivariatePalette (generated data)

| Field | Type |
|---|---|
| `id`, `name` | `string` |
| `cells` | `string[9]`, `#rrggbb`, row-major from low/low: index `i + 3 * j` |
| `note` | `string?` (e.g. "less distinct for red-green color blindness") |

The "No value" color is the existing `NO_VALUE_COLOR`. Smaller grids
(FR-015) use corner and middle indexes: 2 classes on an axis → indexes 0
and 2.

## ResolvedStyle (extended, derived)

| Field | Notes |
|---|---|
| `classes` | The color channel. Bivariate: one `ResolvedClass` per cell (`kind: 'cell'`, `key: 'cell:i-j'`, `col: i`, `row: j`, `x: {lower, upper}`, `y: {lower, upper}`), then `noValue`. Counts include every row (SC-004). |
| `grid` | **New**, bivariate only: `{ x: AxisInfo, y: AxisInfo }`, where `AxisInfo = { column, method, ranges: {lower, upper, label}[] }`. `nx`, `ny` (1–3) are the range counts. |
| `size` | **New**, when a size channel applies: a `ResolvedSizeChannel`. |

### ResolvedSizeChannel

| Field | Notes |
|---|---|
| `status`, `reason` | `'fallback'` when the size column is missing or not numeric. The channel is then off for drawing, with a notice. The color channel is unaffected. |
| `caption` | e.g. `aadt · Quantile, 5 classes` or `aadt · Proportional`. |
| `mode` | `classed` or `proportional`. |
| `classes` | Classed: `ResolvedClass` items (`kind: 'range'`, `size` set) and `noValue`. Proportional: only `noValue` when present. |
| `domain` | Proportional: `{ min, max }` of the column over the displayed result. |
| `samples` | Proportional: 3–5 `{ value, size }` legend references, including min and max. |

## Map-side derived values (not stored)

- **Color class index** per feature: existing graduated or categorized
  index. Bivariate: `ix + nx * iy` mapped to a position in `classes`.
- **Size** per feature: a classed `match` on the size class index, or the
  proportional formula (research §3).
- **Visibility**: hidden if the color class **or** the size class is hidden.

## ColumnData input (extended)

`ResolveInput.dataByColumn?: Record<string, ColumnData>` holds the engine's
statistics for every channel column. `ResolveInput.data` stays as an alias
for the color column, for callers that don't change. Bivariate cell counts
and size class counts are filled in after resolving, from the engine's
`GROUP BY` passes (research §4), as graduated counts are today.
