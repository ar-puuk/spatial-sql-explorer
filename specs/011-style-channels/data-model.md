# Data Model: Style by Channels, and Labels (spec 011)

All types live in `packages/core/src/style/`. Persisted shapes are plain JSON,
and `sanitizeStyle` validates and migrates them. Resolved shapes are derived on
every style or data change, and never saved.

## LayerStyle (persisted)

```ts
interface LayerStyle {
  // --- Fixed values (unchanged from spec 008/009: every old style keeps them) ---
  fillColor: string          // Color, fixed (marker and polygon fill)
  fillOpacity: number
  strokeColor: string        // Outline color, fixed; also the fixed line Color when no lineColor
  strokeOpacity: number
  strokeWidth: number        // Outline width, fixed; also the fixed line Width when no lineWidth
  pointRadius: number        // Size, fixed
  markerShape?: MarkerShape  // Shape, fixed (absent: circle)
  lineDash?: LineDash        // Pattern, fixed (absent: solid)
  layerOpacity?: number      // the whole layer's opacity (not a channel)
  lineWidth?: number         // NEW: line Width, fixed, when it differs from strokeWidth
  rotation?: number          // NEW: Rotation, fixed, degrees clockwise (absent: 0)
  opacity?: number           // NEW: Opacity, fixed, 0..1 per feature (absent: 1)

  // --- New ---
  draw?: DrawAs              // absent: markers / lines / fills
  channels?: Channels        // absent or empty: every property Fixed (the old "single")
  heatmap?: HeatmapSettings  // the old HeatmapRenderer minus `kind`; used when draw.points = 'heatmap'
  height?: HeightFixed       // 3D fixed height, when no height channel
  labels?: LabelSettings

  // --- Legacy: read by sanitizeStyle, then removed (research §9) ---
  renderer?: Renderer
  size?: SizeChannel
  extrusion?: Extrusion
}

interface DrawAs {
  points?: 'markers' | 'heatmap'
  polygons?: 'fills' | '3d'
}

interface HeightFixed { meters: number }  // ≥ 0; default 0 (flat until a channel or value is set)
```

`lineColor` is not a separate fixed field: the line Color channel shares
`color`, as today (the renderer colored lines). The fixed line color stays
`strokeColor`, as today: an unclassed line is drawn in the stroke color. This
preserves spec 001's single-symbol look.

## Channels

```ts
type ChannelId =
  | 'color'        // marker fill, line color, polygon fill
  | 'strokeColor'  // marker and polygon outline
  | 'size'         // marker radius, px
  | 'width'        // line width, px
  | 'strokeWidth'  // marker and polygon outline width, px
  | 'shape'        // marker shape
  | 'dash'         // line and polygon-outline pattern
  | 'opacity'      // per-feature opacity, 0..1, times fill/stroke/layer opacity
  | 'rotation'     // marker rotation, degrees clockwise
  | 'height'       // 3D polygon height, meters

type Channels = Partial<Record<ChannelId, Encoding>>

/** The order properties appear in the panel and the legend. */
const CHANNEL_ORDER: ChannelId[] = ['color', 'strokeColor', 'size', 'width', 'strokeWidth', 'shape', 'dash', 'opacity', 'rotation', 'height']
```

Which channels a geometry lists (panel, legend, map):

| Part | Channels |
|---|---|
| Markers | color, strokeColor, size, shape, opacity, rotation, plus strokeWidth (Outline width, shown inside the Outline color row's fixed editor; it can also vary) |
| Lines | color (label "Color"), width, dash, opacity |
| Fills | color, strokeColor, strokeWidth, opacity (and dash for outlines, shown in the Outline row as today) |
| 3D | color, height, opacity |
| Heatmap | none (its settings) |

The spec lists Markers without Outline width. It is in the model because QGIS
and the map both treat a marker's outline width separately. The panel shows it
in the Outline row, as today's Appearance section does.

### Encoding

```ts
interface Encoding {
  source: Source
  scale: Scale
  legend?: { title?: string; hidden?: boolean }
  /** Set aside when the property is switched to Fixed, for the session (FR-007). Never saved. */
}

type Source =
  | { kind: 'column'; column: string }
  | { kind: 'expression'; expression: string; label?: string }   // SQL; the engine computes __se_val_<channel>
  | { kind: 'pair'; x: string; y: string }                        // bivariate only
```

Whatever was set aside by FR-007 (the previous encoding, the previous
`draw`) is UI session state in `viewerStore`, keyed by layer. It is not part of
`LayerStyle`.

### Output values

```ts
/** What a channel draws: a color, a number (px, degrees, 0..1, meters), a shape or a pattern. */
type Output = string | number   // validated per channel: HEX color, finite number in range, MarkerShape, LineDash
```

| Channel | Output | Range |
|---|---|---|
| color, strokeColor | `#rrggbb` | — |
| size, width, strokeWidth | px | 0.5–100 (SIZE_LO..SIZE_HI, as spec 009) |
| shape | MarkerShape | 7 shapes |
| dash | LineDash | 5 patterns |
| opacity | 0..1 | — |
| rotation | degrees | any finite; drawn mod 360 |
| height | meters | ≥ 0 |

### Scales

```ts
type Scale = CategoriesScale | ClassesScale | ContinuousScale | ConditionsScale | IdentityScale | BivariateScale

interface ClassDef { label?: string; visible?: boolean; output?: Output }   // replaces ClassOverride (color → output)

interface CategoriesScale {
  kind: 'categories'
  auto: boolean                       // as CategorizedRenderer
  categories: Array<ClassDef & { value: string }>
  other: ClassDef
  noValue: ClassDef
  cap: number                         // DEFAULT_CATEGORY_CAP for color; 7 shape, 5 dash, 12 numbers
  ramp?: RampRef                      // color channels: the palette that fills unset outputs
  range?: { min: number; max: number } // numeric channels: unset outputs spread evenly (classSizes)
}

interface ClassesScale {
  kind: 'classes'
  method: GraduatedMethod             // equal | quantile | jenks | manual
  classCount: number                  // 2..10
  classes: Array<ClassDef & { lower?: number; upper?: number }>   // as RangeClassDef
  noValue: ClassDef
  ramp?: RampRef                      // color channels
  range?: { min: number; max: number } // numeric channels
}

interface ContinuousScale {
  kind: 'continuous'
  domain?: { min: number; max: number } // absent: the column's min..max
  ramp?: RampRef                        // color channels (smooth, all stops)
  range?: { min: number; max: number }  // numeric channels
  curve?: 'linear' | 'area'             // numeric; 'area' default for marker size (spec 009 research §3)
  noValue: ClassDef
}

interface ConditionsScale {
  kind: 'conditions'
  rules: Array<{ id: string; where: string; label?: string; output: Output; visible?: boolean }>  // as RuleDef, color → output
  else: ClassDef & { output: Output }
}

interface IdentityScale {
  kind: 'identity'
  multiply?: number                   // height: the old extrusion scale; others: absent (1)
  noValue: ClassDef
}

interface BivariateScale {             // color only
  kind: 'bivariate'
  x: BivariateAxis
  y: BivariateAxis
  palette: string
  cells: Record<string, { visible?: boolean }>
  noValue: ClassDef
}
```

Scales allowed per channel: spec FR-010. The function `scalesFor(channel)` in
core is the one source for this; the panel and `sanitizeStyle` both read it.

Default scale when a channel is set by a column (`startEncoding(channel, column, layer)`):

| Channel | Text column | Numeric column |
|---|---|---|
| color, strokeColor | categories | classes (quantile, 5) |
| size, width, strokeWidth | categories | classes (quantile, 5) |
| shape, dash | categories | categories |
| opacity | categories | continuous (0.3–1) |
| rotation | — | identity |
| height | — | identity |

A text column whose values all parse as colors (more than 90% of a sample)
starts color channels as identity instead.

## Label settings

```ts
interface LabelSettings {
  enabled: boolean
  source: { kind: 'column'; column: string } | { kind: 'expression'; expression: string }
  size: number                        // px, 6..48, default 12
  color: string                       // #rrggbb, default #1f2937
  halo: { enabled: boolean; color: string; width: number }   // width px 0.5..5; default on, #ffffff, 1.5
  placement: LabelPlacement
}

type LabelPlacement =
  | { kind: 'point'; anchor: 'above' | 'below' | 'left' | 'right' | 'center'; offset: number }   // offset in px, 0..20
  | { kind: 'line' }        // along the line
  | { kind: 'polygon' }     // inside (at the label point)
```

The placement defaults by geometry: point, above, offset 4; line; polygon.
Mixed layers use the placement for each part. The UI shows the point anchor
only when points are present.

## Resolved (derived; never saved)

```ts
interface ResolvedStyle {
  status: 'ok' | 'fallback'           // kept: overall status for callers that only need one
  draw: Required<DrawAs>
  channels: Partial<Record<ChannelId, ResolvedChannel>>
  heat?: ...                          // unchanged
  labels?: ResolvedLabels
  legend: LegendGroupModel[]          // merged groups, in CHANNEL_ORDER (research §10)
  notes: string[]
  // Kept for one slice as aliases of channels.color, then removed:
  caption: string; classes: ResolvedClass[]; grid?: ...; size?: ResolvedSizeChannel
}

interface ResolvedChannel {
  channel: ChannelId
  status: 'ok' | 'fallback'           // fallback: drawn with the fixed value; `reason` says why
  reason?: string
  scale: Scale['kind']
  caption: string                     // 'los · Categories', 'volume · Quantile, 5 classes'
  classes: ResolvedClass[]            // categories/classes/conditions/bivariate: as today, with `output`
  domain?: { min: number; max: number }   // continuous
  samples?: Array<{ value: number; output: Output; label: string }>  // continuous legends
  dataColumn: string                  // the property the map reads (column, __se_val_x, __se_cls_x)
  notes: string[]
}

interface ResolvedClass {             // existing type gains:
  output?: Output                     // replaces `color` and `size` for non-color channels (color kept for color channels)
}

interface LegendGroupModel {
  key: string                         // e.g. 'color+size'
  channels: ChannelId[]
  title: string
  kind: 'classes' | 'gradient' | 'samples' | 'bivariate'
  entries: Array<{ key: string; label: string; count?: number; visible: boolean; symbol: SymbolSpec }>
  hidden: boolean                     // legend.hidden of its channels
}
```

`SymbolSpec` (symbol.ts) gains `rotation` and `opacity`. One `SymbolSpec` per
legend entry still drives swatches, map-image rows and file export, so none of
them can disagree.

## Validation and migration (`sanitizeStyle`)

1. **Legacy fields** (research §9):
   - `renderer` becomes `channels.color`, or `draw.points = 'heatmap'` plus
     `heatmap`;
   - `size` becomes `channels.size` and `channels.width`, with the same encoding;
   - `extrusion.enabled` becomes `draw.polygons = '3d'`, plus
     `channels.height` (identity × scale) or `height.meters`;
   - a disabled extrusion with a column keeps its column as a set-aside
     encoding, as session state, and is dropped from the saved shape.
2. **Each encoding**: an unknown channel id or scale kind drops the encoding,
   with a note on import. A scale not allowed for its channel (FR-010) falls
   back to that channel's default scale for the source, and keeps its outputs
   where they fit.
3. **Outputs** are validated per channel (table above). Invalid outputs are
   dropped, and unset outputs are filled from the ramp or range when resolved.
4. **Labels**:
   - size, halo width and offset are clamped;
   - colors are checked against HEX;
   - an unknown placement takes the geometry default;
   - `enabled` without a source becomes off.
5. **Fields from newer versions** are ignored silently, and a note is added on
   import (edge case).

**State transitions**:
- **Fixed to By column:** `startEncoding` builds a new encoding, or the UI
  restores the set-aside one.
- **By column to Fixed:** the encoding is removed from `channels` and set aside
  for the session.
- **Changing `draw`:**
  - `points: heatmap` keeps `channels` intact (they apply again on return to
    markers);
  - `polygons: 3d` shows `height`;
  - `fills` hides it but keeps the encoding.
