# Data Model: Thematic Styling (spec 003)

All types live in `packages/core/src/style/model.ts`, extending spec 001's
`LayerStyle`. Persisted shapes are plain JSON (they travel through QML, SLD,
Mapbox metadata and `HostAdapter` state). Derived shapes are never saved.

## LayerStyle (persisted, CHANGED)

| Field | Type | Notes |
|---|---|---|
| `fillColor`, `fillOpacity`, `strokeColor`, `strokeOpacity`, `strokeWidth`, `pointRadius` | as spec 001 | The **symbol settings**, shared by every renderer. Thematic renderers replace only the fill color (polygons and points) or the line color (lines). |
| `renderer` | `Renderer` | NEW. Defaults to `{ kind: 'single' }`. Spec 001 sidecars without it import as single. |

## Renderer (persisted)

```ts
type Renderer = SingleRenderer | CategorizedRenderer | GraduatedRenderer

interface SingleRenderer { kind: 'single' }

interface RampRef { id: string; reversed: boolean }   // id from the ramp catalog

interface CategorizedRenderer {
  kind: 'categorized'
  column: string
  ramp: RampRef                      // qualitative palette
  cap: number                        // default 12 (spec Assumptions)
  manual: boolean                    // true after a value edit / add / delete (FR-009)
  /** Manual: the full class list. Otherwise: only overrides, matched by value. */
  classes: CategoryClassDef[]
  other: ClassOverride               // "Other" bucket: color, label, visible
  noValue: ClassOverride             // nulls
}

interface CategoryClassDef extends ClassOverride {
  /** String form of the value (§4 of research: matches MapLibre to-string). */
  value: string
}

interface GraduatedRenderer {
  kind: 'graduated'
  column: string
  method: 'equal' | 'quantile' | 'jenks' | 'manual'
  classCount: number                 // 2..10, default 5
  ramp: RampRef                      // sequential or diverging
  /** Manual: the full list with bounds. Otherwise: overrides keyed by class index. */
  classes: RangeClassDef[]
  noValue: ClassOverride
}

interface RangeClassDef extends ClassOverride {
  index: number
  lower?: number                     // required when method = 'manual'
  upper?: number
}

interface ClassOverride {
  color?: string                     // '#rrggbb'; absent = from the ramp
  label?: string                     // absent = generated
  visible?: boolean                  // absent = true
}
```

**Validation**
- `classCount` is between 2 and 10. `cap` is between 1 and 12.
- Manual ranges are sorted, non-overlapping and contiguous, and each has
  `lower < upper`. A manual edit that breaks this is rejected in the panel
  with an inline message.
- Colors are `#rrggbb`. Opacity comes from the symbol settings.
- Category values are unique, compared by their string form.

**Transitions (FR-009)**
- Changing a color, label or visibility keeps `method` and `manual`.
- Editing a value or bound, or adding or deleting a class, sets
  `manual = true` (categorized) or `method = 'manual'` (graduated) and
  stores the full class list.
- Choosing a method again (or turning categorized "auto" back on)
  recomputes the classes and keeps only the color, label and visibility
  overrides that still match.

## ResolvedStyle (derived, never saved)

What the map, legend and panel render. It is recomputed on every change to
the style, or to the layer's features and columns.

```ts
interface ResolvedStyle {
  status: 'ok' | 'fallback'          // fallback = FR-012: column missing / not numeric
  reason?: string                    // e.g. 'Column "value" is not in this result.'
  caption: string                    // legend header, e.g. 'value · Quantile, 5 classes'
  classes: ResolvedClass[]           // in legend order; "Other" and "No value" last
  notes: string[]                    // e.g. 'Only 3 distinct values: 3 classes.'
}

interface ResolvedClass {
  key: string                        // stable: category value, 'range:i', '__other', '__null'
  kind: 'value' | 'range' | 'other' | 'noValue'
  label: string
  color: string
  visible: boolean
  count: number                      // features of the displayed result in this class
  value?: string                     // kind 'value'
  lower?: number; upper?: number     // kind 'range' (lower < v <= upper; first includes lower)
  /** kind 'other': how many distinct values it groups (legend text). */
  groups?: number
}
```

## Ramp (catalog data)

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `viridis`, `brewer-blues`, `brewer-set2` |
| `name` | string | Display and accessible name |
| `kind` | `'sequential' \| 'diverging' \| 'qualitative'` | Filters the picker |
| `colors` | string[] or a per-class-count table | Anchors or ColorBrewer's n-class lists |
| `maxClasses` | number | Qualitative: the palette length |
| `license` | string | `Apache-2.0 (ColorBrewer)` or `CC0` |

## StyleNotice (derived)

`{ direction: 'export' | 'import' | 'apply'; format?: StyleFormat; items: string[] }`.
It is shown in the style panel, and for export before writing (FR-015).

## LegendPrefs (persisted via HostAdapter)

| Key | Value |
|---|---|
| `legend.collapsed` | `boolean` |

## Layer (CHANGED, spec 001/002 model)

| Field | Type | Notes |
|---|---|---|
| `columns` | `Array<{ name: string; type: string }>` | NEW. The result's attribute columns with DuckDB types, from the existing `DESCRIBE`. Decides which columns each renderer can use (research §5). |
