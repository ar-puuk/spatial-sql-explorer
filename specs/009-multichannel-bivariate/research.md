# Research: Multi-Channel Styling and Bivariate Maps

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-10-12

Spikes ran against QGIS 4.2.3 (OSGeo4W, PyQGIS) and the current code. Their
scripts, outputs and the QGIS-written files are in [spikes/](./spikes/).

## 1. Style model: a size channel next to the renderer

**Decision**: `LayerStyle.renderer` stays the **color channel**, with a new
kind, `bivariate`. A new optional `LayerStyle.size` holds the **size
channel**. The earlier `GraduatedRenderer.vary/sizeMin/sizeMax` fields are
read by `sanitizeStyle` and migrated: a graduated renderer with `vary: 'size'`
becomes `renderer: single` plus `size: { mode: 'classed', column, method,
classCount, classes, noValue, sizeMin, sizeMax }`. The migrated style keeps
the same column, method, class overrides and sizes (FR-009). The old fields
are never written again.

**Rationale**: the renderer already carries everything the color channel
needs. A sibling field keeps every existing code path (resolve, expressions,
interchange) working for styles without a size channel, so they behave
byte-for-byte as today. The migration uses the sanitize pass that every
loaded style already goes through (sidecar, state, Mapbox metadata).

**Alternatives considered**:
- A `channels: []` array: more general, but it invites more channels than
  the spec allows (opacity, rotation), and every reader would need to change.
- Keeping `vary` on graduated: can't express color by one column and size
  by another, which is the point of US1.

## 2. Resolving two channels

**Decision**: `ResolvedStyle` keeps `classes` for the color channel. For
bivariate, they are the cells (`kind: 'cell'`, key `cell:<i>-<j>`, with
both ranges) plus "No value". `ResolvedStyle` gets two optional fields:
- `size`: a `ResolvedSizeChannel` with its own status, caption, and range
  classes (each with `size`) and "No value". In proportional mode it has
  `domain {min, max}` and 3–5 reference `samples`.
- `grid`: the bivariate axes (columns, methods, ranges and class counts).

Each channel resolves with the same code graduated uses today
(`rangesFrom`, the break methods, `classOf`). The size channel resolves like
a graduated renderer whose class colors are replaced by sizes. A bivariate
axis resolves like a graduated renderer with `classCount = 3` (fewer when
there are fewer distinct values: FR-015, the existing `perValue` rule).

**Rationale**: the legend, map and exports already consume `classes`. Size
and grid are additions that old consumers can ignore. Reusing the graduated
resolver keeps one source of truth for breaks, so SC-003 (map = legend)
holds per channel as it does today.

## 3. Map expressions

**Decision**:
- **Color** for bivariate: one `let` per axis computes the axis class index
  (the existing graduated index rules: null, boolean and "" are no value;
  upper-inclusive; the first class includes its lower bound). The cell
  position is `ix + nx * iy`, mapped to the class position by `match`.
  Either axis being no value gives the "No value" class.
- **Size**, classed: a separate size-class index expression (the graduated
  index on the size column), `match`ed to the class sizes. "No value" gets
  the single size.
- **Size**, proportional: `t = clamp((v − min) / (max − min), 0, 1)`.
  - Lines: `width = wMin + (wMax − wMin) · t`.
  - Points: `r = rMin + (rMax − rMin) · sqrt(t)`. This is exactly QGIS's
    size assistant "Area" scale (spike: QGIS `QgsSizeScaleTransformer.Area`
    gives 4, 12, 15.31, 20 for t = 0, .25, .5, 1 with sizes 4–20, exponent
    0.5).
  - Null values get the single size. A domain with min = max uses the
    largest size.
- **Hidden classes**: the visibility filter combines both channels:
  hidden if the color class is hidden **or** the size class is hidden (edge
  case in the spec).
- Shaped markers (icons): the icon is chosen by the color class only, and
  `icon-size` scales it per feature (`size / base radius`). Icons are drawn
  at the largest size the style uses, so they never upscale (the map-image
  2x rule from spec 008 §17 still holds).

**Rationale**: the per-channel expressions are independent, so either can
change without touching the other. Every piece is a standard MapLibre
expression (`let`, `match`, `sqrt`, `min`/`max`) that the unit tests can
evaluate with MapLibre's own evaluator, as spec 003 does. Matching QGIS's
"Area" formula keeps proportional symbols identical after a QML round trip
(SC-005).

**Alternatives considered**: area-exact scaling (`r = sqrt(rMin² + (rMax² −
rMin²)·t)`), which QGIS can't express without a custom expression, so it
was rejected for parity.

## 4. Engine classification for large results

**Decision**: `QuerySession.resolveStyle` gathers column data **per channel
column**, deduplicated: `ResolveInput.dataByColumn: Record<string,
ColumnData>`. The single `data` field stays as an alias for the color
column.
- **Small results** (≤ `jenksSample` rows): one `SELECT` streams every
  needed column together, not one pass per column.
- **Large results**: per numeric column, the existing totals and order
  statistics passes run. The totals of all channel columns are combined
  into one query (`numberTotalsSql` already returns min and max, so
  Proportional needs nothing extra).
- **Bivariate cell counts**: one scan, `GROUP BY` the two axis class
  indexes (`classCountsSql` with two CASEs), giving 9 counts plus "No
  value" exactly (SC-004).
- **Size class counts**: `classCountsSql` on the size column.

**Cost vs SC-007**: graduated today is 3 passes (totals, order statistics,
counts). Bivariate is 1 combined totals pass, 2 order-statistics passes and
1 joint counts pass: 4 passes, under the 2x budget. Color plus size is
the same shape.

## 5. QGIS QML: color + size

**Spike** ([spikes/qgis-dd-size.py.txt](./spikes/qgis-dd-size.py.txt),
[qgis-dd-linear.qml](./spikes/qgis-dd-linear.qml),
[qgis-dd-steps.qml](./spikes/qgis-dd-steps.qml),
[qgis-reload.log](./spikes/qgis-reload.log)):
- QGIS stores a data-defined size on each **symbol layer**, in
  `<data_defined_properties>`. For a line the property is `outlineWidth`;
  QGIS's API name is `StrokeWidth`.
- QGIS's size assistant form is property `type` 2 (field). It holds `field`
  plus a `transformer` (`t` = 1, size scale) with `minValue`, `maxValue`,
  `minSize`, `maxSize`, `nullSize`, `scaleType` and `exponent`.
- An expression form is property `type` 3, with an `expression` string such
  as a `CASE WHEN … END`.
- QGIS 4.2.3 reloads both as **active** data-defined widths.
- QGIS's own SLD export **drops** data-defined widths: it writes the static
  width. Our SLD export must not rely on QGIS's behavior (§7).

**Decision**:
- **Classed size** is written as an expression, `type` 3: `CASE WHEN "col"
  IS NULL THEN <single> WHEN "col" < <lower0> THEN <single> WHEN "col" <=
  <u0> THEN <s0> … ELSE <single> END`. This matches our upper-inclusive
  classes.
- **Proportional size** is written as a field with a size scale
  transformer, `type` 2:
  - lines: `scaleType` Linear, exponent 1;
  - points: `scaleType` Area, exponent 0.5;
  - `nullSize` = the single size.
- Markers use the `size` property and lines `outlineWidth`. The marker key
  must be confirmed by a QGIS write during implementation before the writer is
  final. QGIS sizes are diameters, so marker values are doubled, in
  `Pixel` units as today.
- The full size channel is also kept in a custom property,
  `spatialExplorer/size` (JSON), so it reloads losslessly here. Without it
  (a foreign QML), a transformer imports as Proportional with its
  parameters, and an expression size imports with a notice
  ("data-defined size expression not imported").
- **Render check**: evaluating the property outside a render returned
  placeholder values in the spike. The implementation therefore includes a
  QGIS render comparison: draw the QML in QGIS and compare widths per
  feature (SC-005).

## 6. QGIS QML: bivariate

**Spike** ([qgis-rule-based.qml](./spikes/qgis-rule-based.qml)): QGIS 4.2.3
has no bivariate renderer. Its registry lists `nullSymbol`, `singleSymbol`,
`categorizedSymbol`, `graduatedSymbol`, `RuleRenderer`, `pointDisplacement`,
`pointCluster`, `mergedFeatureRenderer`, `invertedPolygonRenderer`,
`heatmapRenderer`, `25dRenderer` and `embeddedSymbol`. A `RuleRenderer`
with 10 rules (9 cells and No value) and a layer custom property
(`spatialExplorer/bivariate`) both survive a save and reload.

**Decision**:
- Write `type="RuleRenderer"`. Each cell rule filters with both columns'
  bounds in our class semantics, e.g. `"x" > 1.5 AND "x" <= 3 AND "y" >=
  0 AND "y" <= 10` (the first class includes its lower bound).
- The "No value" rule is `"x" IS NULL OR "y" IS NULL`. Rule labels are the
  two range labels.
- Hidden cells are written with QGIS's unchecked state, `checkstate="0"`,
  not dropped, so they stay hideable in QGIS too.
- The custom property `spatialExplorer/bivariate` holds the renderer JSON
  (columns, methods, palette, hidden cells). Import treats a RuleRenderer as
  bivariate **only** when this property is present (FR-025). Otherwise it
  keeps today's single-symbol fallback with a notice.

## 7. SLD and Mapbox GL

**SLD**:
- **Color + classed size**: one rule per (color class × size class)
  combination. The filter ANDs both class tests; the symbolizer carries
  that class's color and width or size. At most (12 + 2) × (10 + 1) rules.
- **Proportional size**: written as 5 equal steps over the domain, and
  listed in the notice ("proportional sizes written as 5 steps").
- **Bivariate**: one rule per visible cell plus "No value". Hidden cells
  are left out (notice).
- **Import**: SLD has no place for our metadata. Our two-column rules
  import as the single symbol with a notice: "classes on two columns can't
  be read from SLD; use QML or Mapbox GL to keep them". This is FR-024's
  "where the format allows".

**Mapbox GL**:
- The paint uses the same expressions the viewer draws with (§3):
  bivariate `match`, `interpolate`/`sqrt` for proportional sizes.
- The full style is embedded in `metadata`, as today, so the round trip is
  lossless.
- A foreign data-driven width or radius (`interpolate` on a property)
  imports as a Proportional size channel when it is a linear interpolation
  with two stops. Anything else keeps today's "expressions not imported"
  note.

## 8. Bivariate palettes

The common published palettes (e.g. the R package biscale, GPL-3.0) can't
be copied (Constitution VIII).

**Decision**: generate our own palettes by **bilinear interpolation in
CIELAB** between four corners:
- low/low: a light neutral, `#e8e8e8`;
- high on axis 1;
- high on axis 2;
- high/high.

The corners come from the ColorBrewer anchors already in `rampData.ts`
(Apache-2.0). A generator, `scripts/bivariate-palettes.mjs`, writes
`packages/core/src/style/bivariateData.ts`; rerun it to change a palette.

**Acceptance** (checked by a unit test on the generated data): the smallest
CIE76 ΔE between any two of the 9 cells must be ≥ 15, and ≥ 12 under a
deuteranope simulation (Machado 2009). Lightness must decrease from
low/low to high/high.

**Spike scores** ([spikes/bivariate-palettes.mjs.txt](./spikes/bivariate-palettes.mjs.txt)):

| Palette (corners) | min ΔE | min ΔE (deuteranope) | Keep |
|---|---|---|---|
| Orange–Blue (Oranges × Blues), **default** | 22.3 | 22.3 | yes |
| Red–Blue (Reds × PuBu) | 25.6 | 20.1 | yes |
| Green–Purple (Greens × Purples) | 24.9 | 21.2 | yes |
| Pink–Blue (RdPu × Blues) | 21.1 | 12.8 | yes, marked "less distinct for red-green color blindness" |
| Purple–Teal (Purples × BuGn) | 17.6 | 15.1 | no (too close to Green–Purple) |

The default, Orange–Blue, is the most color-blind safe. The 2-class forms
(FR-015) take the grid's corner and middle rows and columns.

**Rejected**: multiply-blending two ramps (Stevens' manual method). It
scored well (ΔE up to 27), but the high/high corner was near-black
(`#26161b`), which is unreadable on dark basemaps.

## 9. Legend and panel UX

**Decision**:
- **Legend**: one group per channel, each with its own caption.
  - Color group: unchanged.
  - Size group: the size classes, or the Proportional reference sizes (3–5
    values rounded to 2 significant digits). Swatches are drawn in the
    single symbol's colors and kept to scale.
  - Bivariate: a 3×3 `grid` of cell buttons, with column 1 on the
    horizontal axis (low → high, left to right) and column 2 on the
    vertical axis (low → high, bottom to top), as in the usual convention.
    Axis labels are the column names with an arrow. Each cell is a button
    (toggle hide) whose accessible name holds both ranges and the count.
    Arrow keys move between cells (roving tabindex, FR-018).
- **Style panel**:
  - "Style" gets a fourth option, **Bivariate**.
  - A new **Size** section (points and lines only) holds:
    - a switch, "Size by column";
    - the column;
    - Classed | Proportional;
    - method and class count (classed);
    - smallest and largest size;
    - the size class list (classed: label, visibility, bounds; like
      `ClassList`).
  - It replaces the Graduated "Vary" radio added on 2026-10-12.
  - With Bivariate chosen, the Size section is replaced by a note that
    bivariate maps have no size channel (FR-007).
- **Map image**: `drawLegend` draws the groups one after another. The
  bivariate square is drawn as a 3×3 block with axis labels.

## 10. Limits carried over

- **Mixed layers**: points draw as dots (spec 007, recorded in 008 research
  §17), so the size channel has no visible effect on their points. That
  isn't new. The size channel still applies to their lines (FR-006).
- **Tiled (PMTiles) layers** keep no thematic styling (spec 007 US5).
