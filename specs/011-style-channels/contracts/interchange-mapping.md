# Contract: interchange mapping (QML, SLD, Mapbox GL)

Every row was spiked or exists today (research §4–§6). "Note" means a message
in the export or import notice (FR-030).

## QML (QGIS 4.2)

### Primary renderer

| Style | QGIS renderer |
|---|---|
| no varying channels | `singleSymbol` |
| `color` categories | `categorizedSymbol` (today) |
| `color` classes | `graduatedSymbol` (today; an expression as `attr`, spec 010) |
| `color` conditions | `RuleRenderer` (spec 010) |
| `color` bivariate | `RuleRenderer` with nine rules + `spatialExplorer/bivariate` (spec 009) |
| `color` continuous / identity | `singleSymbol` + data-defined `fillColor` (`lineColor` → `outlineColor` for lines) |
| `color` fixed, another channel varies | `singleSymbol` + data-defined properties (no class list in QGIS's panel; full model in the custom property) |
| draw.points = heatmap | `heatmapRenderer` (today) |

### Data-defined properties (on every class symbol's layer, or the symbol)

| Channel | Marker layer key | Line layer key | Fill layer key | Expression form |
|---|---|---|---|---|
| color (non-primary or continuous/identity) | `fillColor` | `outlineColor` | `fillColor` | categories/classes/conditions: `CASE … END`; continuous: `ramp_color(create_ramp(map(t0,c0,…)), scale_linear(col,min,max,0,1))`; identity: `"col"` |
| strokeColor | `outlineColor` | — | `outlineColor` | as color |
| size | `size` (symbol `dataDefinedSize`, spec 009) | — | — | classes: `CASE`; continuous: size transformer (Area/Linear); categories/conditions: `CASE`; identity: `"col"` |
| width | — | `outlineWidth` | — | as size; continuous `scale_linear` |
| strokeWidth | `outlineWidth` | — | `outlineWidth` | as width |
| shape | `name` | — | — | `CASE … THEN 'triangle' …` (QGIS names as today's `qgisMarker`: `cross` → `cross_fill`, `x` → `cross_fill` turned 45°, so a varying shape that can be `x` adds 45 to `angle` for those features) |
| dash | — | `outlineStyle` | `outlineStyle` | `CASE … THEN 'dash' …` (Qt pen names, as today's fixed export) |
| opacity | symbol `alpha` (percent) | symbol `alpha` | symbol `alpha` | `scale_linear(col,min,max,omin*100,omax*100)` / `CASE` |
| rotation | `angle` | — | — | `"col"` ×/+ as given; classes/conditions: `CASE` |
| height | `<renderer-3d>` extrusion (today) | — | — | `"col" * k` (identity), else `CASE` / `scale_linear` |

Hidden classes in non-primary channels: the `CASE` gives size 0 or alpha 0 for
the hidden class, as spec 009 does for size.

### Labels

`<labeling type="simple">` holds `<settings>` with:
- `text-style`: `fieldName`, `isExpression`, `fontSize` in pixels, `textColor`;
- `text-buffer`: enabled, size in px, color;
- `placement`:

| Our placement | QGIS |
|---|---|
| point above / below / left / right / center | `placement=1` (OverPoint) with `quadOffset` 1 / 7 / 3 / 5 / 4, and `dist`, unit px |
| line | `placement=3` (Curved) |
| polygon | `placement=1` (OverPoint) |

An expression label is written as given, as a QGIS expression. When it uses
functions, a note says it may need adjusting in QGIS (the same treatment as
rules, spec 010).

### Custom property

`spatialExplorer/style` holds the whole `channels` + `draw` + `labels` JSON.
On import it takes precedence over everything else, as the existing
`spatialExplorer/*` properties do. The older properties (`spatialExplorer/size`,
`/bivariate`, `/heatmap`, `/symbol`, `/expression`) are still read, then
migrated.

### Import from QGIS's own styles

- **Renderer**: as today.
- **Data-defined properties**: these forms become encodings:
  - a field: identity, or categories for `name` and `outlineStyle`;
  - `scale_linear("f", a, b, c, d)`: continuous;
  - a size transformer: continuous (spec 009);
  - `CASE WHEN "f" = 'v' THEN x … ELSE y END`: categories;
  - `CASE WHEN "f" <= b THEN x …`: classes (manual).
  Anything else keeps the fixed value, with a note naming the property.
- **Labeling**: `simple` is read. `rule-based` labeling uses its first rule,
  with a note.

## SLD 1.1

| Style | SLD |
|---|---|
| 0 or 1 classed/categorized varying channel | one Rule per class (today) |
| 2 classed/categorized channels | one Rule per combination (spec 009 cross product), ≤ 100 rules |
| > 100 combinations, or a 3rd channel | the primary channel's rules; others at their fixed value + note |
| continuous | 10 equal classes + note |
| identity | fixed value + note |
| conditions | spec 010's portable rules (`portableRules`) |
| shape / dash per class | `WellKnownName` / `stroke-dasharray` in each rule's symbolizer |
| rotation per class | `<Rotation>` in the point symbolizer |
| opacity per class | `fill-opacity` / `stroke-opacity` multiplied in |
| labels | `TextSymbolizer`: `Label/PropertyName`, `Font` (`font-family` sans-serif, `font-size`), `Fill`, `Halo` (`Radius`, `Fill`), `LabelPlacement` (`PointPlacement` with `AnchorPoint` + `Displacement`, or `LinePlacement`) |
| expression label | the first column it names + note |

## Mapbox GL style JSON

- Every channel becomes the paint or layout expression the map uses.
  `channelExpression` is shared with `paintFor`, so file and map can't differ.
- Labels become a `symbol` layer, `<id>-labels`, with `text-field`,
  `text-font: ["sans-serif"]` (a note says a glyph server needs a font it has),
  `text-size`, `text-color`, `text-halo-color`, `text-halo-width`,
  `symbol-placement` (`line` for lines), and `text-anchor` with `text-offset`.
- Shapes keep `MAPBOX_SHAPE_NOTE`.
- **Import** reads back what we write. A single `match` or `step` over one
  `get` per property becomes categories or classes, and
  `interpolate linear` over one `get` becomes continuous.
