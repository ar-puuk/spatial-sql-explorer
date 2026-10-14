# Proposal: Style by channels (spec 011, draft)

Status: proposal, for the user's decision. Nothing here is built.
Date: 2026-10-13.

## 1. The question

Users should be able to map different variables to different visual properties
at once. For example, line width shows traffic volume and color shows level of
service. Points could be colored by one column, sized by another and shaped by a
third. How should styling be redesigned so this is the normal way to style,
rather than an add-on?

## 2. Where we are today

The model is one **color channel** (the "style type"), plus a few extras that
were added later:

| Piece | What it varies | Where it lives |
|---|---|---|
| Style type: Single, Categorized, Graduated, Bivariate, Rules, Heatmap | fill/line color (Heatmap replaces the whole drawing) | `LayerStyle.renderer` |
| Size by (spec 009) | marker size or line width, classed or proportional | `LayerStyle.size` |
| 3D (spec 008) | polygon height from a column | `LayerStyle.extrusion` |
| Appearance | everything else, one fixed value per layer | flat fields on `LayerStyle` |

The user's example already works today. Choose Categorized by `los` and turn on
Size by `volume` (spec 009, user story 1). But the design shows its limits:

- **Only color and size can vary.** You can't vary shape, line pattern,
  opacity, outline color, outline width or rotation by data.
- **Color is privileged.** "Style type" sounds like a choice about the whole
  map, but it only sets color. Size is a different-looking section further
  down, and height is a third, separate idea.
- **Each channel has its own set of scales.** Color can be categorized,
  classed or rules-based, but not continuous. Size can be classed or
  proportional, but not by category. Height can only be continuous.
- **Every new channel means new code in five places:** model, resolve, paint,
  legend, and three file formats.

## 3. What other tools do

| Tool | Model | What can vary by data | Notes |
|---|---|---|---|
| **ggplot2** | Every visual property is an *aesthetic*, mapped to a variable or set to a constant. A *scale* per aesthetic turns data into visuals. | colour, fill, size, linewidth, shape, alpha, linetype (and label) | Scales: discrete, continuous, binned, manual, identity. Aesthetics that use the same variable and breaks merge into one legend. The geom (point, line, polygon, density) is chosen separately from the aesthetics. |
| **ArcGIS Pro** | One *primary symbology*, plus a *Vary symbology by attribute* tab | Points: color, size, transparency, rotation. Lines: color, transparency. Polygons: color, transparency, outline width. | Primary types: single, unique values, graduated colors and symbols, bivariate, unclassed, proportional, dot density, charts, heat map, dictionary. This is almost exactly our current shape, with more secondary variables. |
| **ArcGIS Maps SDK (JS)** | A renderer plus a list of `visualVariables` | color, size, opacity, rotation | Each variable can be shown in or hidden from the legend. Esri warns that "adding more than one at a time may cause confusion". |
| **QGIS** | One renderer, plus a *data-defined override* on any symbol property | anything (any property can take an expression) | Very powerful but hard to find. The legend ignores overrides, except for the size assistant. |
| **Tableau** (Marks card) | Drag a field onto Color, Size, Shape, Label, Detail or Tooltip | color, size, shape, label | The clearest UI: every channel is equal, and the chart type ("mark") is chosen separately. |
| **Kepler.gl** | Per layer type, a fixed list of channels, each with "by field" | color, stroke color, radius/size, height | Like Tableau, applied to maps. |
| **GeoLibre** (`../_refs/GeoLibre`) | Renderer (single, graduated, categorized, rule-based, expression) plus a proportional size section | color, size | The same shape as ours today. No model to borrow here. |

**Takeaway.** The tools that make multi-variable maps easy (ggplot, Tableau,
Kepler) share one idea. The *mark* (what geometry is drawn: markers, lines,
fills, heatmap, 3D) is separate from the *channels* (which properties of that
mark vary). Every channel works the same way: a fixed value, or a column plus
a scale. ArcGIS and QGIS keep a primary renderer and make every other variable
secondary. That is what we have now, and what the user is asking to move past.

Sources:
- [ArcGIS Pro: Symbolize feature layers](https://pro.arcgis.com/en/pro-app/latest/help/mapping/layer-properties/symbolize-feature-layers.htm)
- [ArcGIS Pro: Single symbol (vary symbology by attribute)](https://pro.arcgis.com/en/pro-app/3.5/help/mapping/layer-properties/single-symbol.htm)
- [ArcGIS Maps SDK: Visual variables](https://developers.arcgis.com/javascript/latest/visualization/data-driven-styles/visual-variables/)
- ggplot2's aesthetics and scales documentation (ggplot2.tidyverse.org)

## 4. Proposal

### 4.1 Two choices: Draw as, then channels

**Draw as** is the mark, chosen from geometry-aware options. The
`StyleTypePicker` dropdown is reused, with its one-line descriptions:

| Geometry | Draw as options |
|---|---|
| Points | Markers; Heatmap |
| Lines | Lines |
| Polygons | Fills; 3D (extruded) |
| Mixed | Each part with its own default |

**Channels** are the visual properties of that mark. Each row in the panel
reads "*Channel*: Fixed ▾ | By column ▾":

| Mark | Channels |
|---|---|
| Markers | Color, Outline color, Size, Shape, Opacity, Rotation |
| Lines | Color, Width, Pattern, Opacity |
| Fills | Color, Outline color, Outline width, Opacity |
| 3D | Color, Height, Opacity |
| Heatmap | Weight (with its own radius and intensity settings, as built) |

"Single symbol" is no longer a type. It is simply every channel being fixed.
The current Appearance section becomes the Fixed values of those same rows,
so there is one place per property instead of two.

### 4.2 Every channel works the same way

A channel is **fixed**, or **by** a *source* through a *scale*.

- **Source.** A column, or a SQL expression (graduated-by-expression exists
  already; DuckDB evaluates it). Bivariate color takes two numeric sources.
- **Scales**, following ggplot's set. Each channel offers the ones that make
  sense for it:

| Scale | Data | Output | Today | Channels |
|---|---|---|---|---|
| Categories | any value | one output per value, plus Other and No value | Categorized (color) | all |
| Classes | number | equal, quantile, Jenks or manual breaks; ramp or min–max | Graduated (color), classed (size) | color, size, width, opacity, height |
| Continuous (unclassed) | number | smooth ramp, or min–max with a linear, square-root/area or log curve | Proportional (size), 3D height | color (**new**), size, width, opacity, rotation, height |
| Conditions | SQL rules, first match wins | one output per rule | Rules (color) | all |
| As is (identity) | the value *is* the output: `#hex` colors, degrees, meters | — | 3D height in meters | color, rotation, height |
| Bivariate | two numbers | 3×3 grid | Bivariate | color only |

This adds:
- unclassed color, ArcGIS's "Unclassed colors";
- size or width by category, for example road class to width;
- shape, pattern and outline color by category;
- opacity by number;
- rotation, for flow direction;
- colors stored in a column.

### 4.3 Legend

Each varying channel gets one legend group, titled with its column name.
Fixed channels have no group.

Following ggplot, **channels that use the same column with the same breaks
merge into one group**. Graduated color plus classed size on `pop`, for
example, becomes one list of swatches that are colored and sized. Spec 009
draws two groups for this today.

A continuous color scale gets a gradient bar; the heatmap legend already has
one. Continuous size gets three nested sample circles or widths.

### 4.4 Shortcuts, so the common case stays one click

A blank list of channels is harder to start from than "Graduated". The
dropdown keeps a short list of **recipes**. Each one sets channels and then
gets out of the way, as ArcGIS's primary types do:

| Recipe | Sets |
|---|---|
| Categorized | Color by categories |
| Graduated | Color by classes |
| Proportional symbols | Size, continuous |
| Bivariate | Color by two columns |
| Rules | Color by conditions |
| Heatmap | Draw as Heatmap |
| Flow / network | Color by categories, Width by classes (the user's LOS and volume example) |

Once a recipe is applied, the panel just shows the channels it set.

### 4.5 Guardrails

- **Shape** by categories warns past 7 values; ggplot stops at 6. Values
  beyond that fall into "Other".
- **A third varying channel** shows a one-line note that maps reading more
  than two variables are hard to read. This is advice only, never a block.
  Esri gives the same advice.
- **Polygons** have no Size, as today. Outline width is offered instead.

### 4.6 Model sketch (packages/core)

```ts
interface LayerStyle {
  mark: 'auto' | 'heatmap' | 'extruded'          // auto: markers / lines / fills by geometry
  channels: Partial<Record<ChannelId, Encoding>> // absent: the fixed value below
  fixed: FixedSymbol                             // today's Appearance values
  heatmap?: HeatmapSettings                      // radius, units, intensity, ramp (as built)
  layerOpacity?: number
}
type ChannelId = 'color' | 'strokeColor' | 'size' | 'strokeWidth' | 'shape' | 'dash' | 'opacity' | 'rotation' | 'height'
interface Encoding { source: Source; scale: Scale; legend?: { title?: string; hidden?: boolean } }
type Source = { column: string } | { expression: string } | { columns: [string, string] } // pair: bivariate
type Scale = CategoriesScale | ClassesScale | ContinuousScale | ConditionsScale | IdentityScale | BivariateScale
```

`resolve()` resolves each channel independently, using the existing classify,
ramp, rules and bivariate code. It produces `ResolvedChannel[]`. The paint
builder turns each one into its MapLibre property. Everything the map needs is
**data-driven in MapLibre 6.13**, checked against its style spec:

- data-driven: `line-width`, `line-opacity`, `circle-radius`,
  `circle-stroke-width`, `icon-image`, `icon-size`, `icon-rotate`,
  `icon-opacity`, `fill-opacity`, `fill-extrusion-height`;
- cross-faded data-driven: `line-dasharray`.

Saved styles are migrated on load:
- `renderer` becomes the `color` channel;
- `size` becomes `size` or `strokeWidth`;
- `extrusion` becomes `mark: 'extruded'` plus `height`;
- old flat fields become `fixed`.

`sanitizeStyle` already does this kind of upgrade (spec 001 to 003), so old
sidecars and saved state keep working.

### 4.7 Files (QML, SLD, Mapbox)

- **QML.** QGIS has one renderer plus data-defined overrides.
  - On export:
    - the main classed channel (color if it varies, otherwise the first
      channel that varies) becomes the QGIS renderer's classes;
    - every other channel becomes a data-defined property expression
      (`CASE WHEN … END`, `scale_linear(…)`, `"field"`);
    - spec 009 already does this for size. It extends to `fillColor`,
      `strokeColor`, `outlineWidth`, `name` (shape), `customdash` and
      `angle`, and to opacity through the color's alpha.
  - The full model rides along in a `spatialExplorer/style` custom property,
    so it reloads exactly.
  - Each channel gets a QGIS parity check, as `check_009.py` does for size.
- **Mapbox GL.** Native: one expression per paint property.
- **SLD.** Has no data-defined overrides.
  - Two varying classed or categorical channels are written as their cross
    product of rules (n × m), capped at about 100 rules.
  - Continuous channels are written as 10 classes.
  - Each of these approximations comes with a note.

### 4.8 Performance

Each column used as a source is already carried in GeoJSON and tile features.
Classification runs once per channel (one engine query each, cached as today).
Two to four channels means two to four small aggregate queries, no worse than
graduated plus size now. Nothing is re-queried while panning or zooming.

## 5. Risks and spikes (before building)

1. **Shape plus color on markers.** Markers today are icons generated for
   each class (`symbol.ts`). Independent shape and color channels need either
   one icon per (shape × color) combination, or SDF icons with a data-driven
   `icon-color`. A continuous color scale needs SDF, because there is no fixed
   set of colors. SDF draws an outline as a halo, which is not quite QGIS's
   stroke. **Spike:** SDF markers against QGIS-rendered markers for a filled
   triangle with an outline.
2. **Data-driven `line-dasharray`.** It is cross-faded data-driven. Check it
   renders per feature on GeoJSON and on tiles.
3. **QGIS import of other people's data-defined overrides.** Read back the
   simple forms (`"field"`, `scale_linear`, simple `CASE`). Anything else keeps
   the fixed value and shows a note, as foreign QML does today.
4. **Panel length.** Up to six rows for markers. Each fixed row is one line
   (label plus swatch or number). Only rows that vary by data expand. This
   needs a 6× CPU throttle check for the panel, per the UI-responsiveness rule.

## 6. Delivery in slices

Each slice ships on its own and keeps every existing test passing.

1. **Model.** Channels in core, migration from today's model, and resolve and
   paint per channel. No UI change, and identical map output: the snapshot
   tests prove it.
2. **Panel.** "Draw as" plus channel rows; Appearance merges into the fixed
   values; recipes in the dropdown. Covers the channels that exist today
   (color, size, height, heatmap).
3. **New scales and channels.**
   - Unclassed color; size and width by category.
   - Outline color, outline width, opacity.
   - Shape and pattern by category; rotation; identity colors.
   - The legend merges groups and gets gradient and continuous-size legends.
4. **Files.** QML data-defined properties for each new channel, with QGIS
   parity checks; Mapbox; SLD cross product.
5. **Later, optional.** Labels as a channel (out of scope in spec 009; needs a
   scope decision). Line offset for two-way flows.

## 7. Decisions for the user

1. **Channels replace "style type"** (recommended), with the dropdown keeping
   recipes and Draw as. The alternative is ArcGIS's model: keep the style
   type and add a "Vary by attribute" list beneath it. That is smaller, but it
   keeps color privileged.
2. **Rules.** Conditions as a scale on any channel (recommended). Or rules that
   set the whole symbol at once (color, width and shape per rule), as QGIS's
   rule-based renderer does.
3. **New channels in slice 3.** All of them (recommended), or only some:
   outline color, opacity, shape, pattern, rotation, identity color.
4. **Labels.** Stay out of scope, or become a channel later (slice 5)?
5. **Process.** Turn this into `spec.md`, then plan and tasks, as for specs 009
   and 010. Slice 1 first.
