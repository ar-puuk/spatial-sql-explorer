# Research: Style by Channels, and Labels (spec 011)

Date: 2026-10-13.

- Background research (ggplot2, ArcGIS Pro, the ArcGIS SDK, QGIS, Tableau,
  Kepler.gl, GeoLibre) is in [proposal.md](./proposal.md) §3.
- This file records the spikes and the decisions the plan builds on.
- Spike sources are in `spikes/`. They ran in Playwright Chromium with
  SwiftShader WebGL and MapLibre 6.13.0 from `node_modules`, and in PyQGIS 4.2.3.

## §1 Which MapLibre properties can vary per feature

**Decision**: every channel maps to a MapLibre paint or layout property that can
vary per feature (a data expression). No channel needs a separate layer for each
class.

**Evidence**: MapLibre's style spec (`@maplibre/maplibre-gl-style-spec` `latest`)
marks these properties `data-driven`:
- `line-color`, `line-width`, `line-opacity`;
- `circle-radius`, `circle-stroke-width`;
- `fill-opacity`, `fill-extrusion-height`;
- `icon-image`, `icon-size`, `icon-rotate`, `icon-opacity`;
- `text-field`.

`line-dasharray` is `cross-faded-data-driven`.

In the spike (`spikes/maplibre-channels.html.txt`, "lines" mode), a
`match` over a feature property drew four different dash patterns on four
lines in one layer, including solid as `[1, 0]`. No errors were reported.

**Tracked check (implementation)**: dashes that vary per feature on the engine's
vector tiles. The spike used GeoJSON. MapLibre evaluates the same expression for
both kinds of source, but it hasn't been seen on tiles.

## §2 Shapes with independent color, outline, size, rotation and opacity

**Question**: markers today are raster icons, one per class, whose id carries
everything drawn (`markerIconId`). When shape and color come from different
columns, should we keep per-look icons, or switch to SDF icons (one per shape,
tinted by `icon-color`, outline from `icon-halo-*`)?

**Spike** (`spikes/maplibre-channels.html.txt`, "markers" mode):
- triangle, square and star, at sizes 0.6, 1 and 1.6, rotated 0, 30 and 60
  degrees;
- drawn as SDF with a halo next to raster icons drawn as `markerIcon.ts` does
  (fill, then an outline centered on the edge, miter joins);
- SDF distances encoded as TinySDF does: alpha 0.75 at the edge, 1/8 per
  texel.

**Findings**:
- **Raster icons:** crisp, and the outline is centered on the edge with sharp
  corners. That is QGIS's simple marker.
- **SDF:**
  - the outline sits outside the shape, and the star's corners come out rounded
    and blobby;
  - the halo's width is limited by the SDF buffer (about 6 texels divided by
    `icon-size`);
  - at size 0.6 the halo filled the whole icon box (a grey square);
  - one shared opacity covers fill and halo, so fill and outline can't fade
    separately.
- **Rotation** (`icon-rotate`) and **size** (`icon-size`) work per feature with
  both kinds.

**Decision**: keep per-look raster icons. `icon-image` becomes an expression
that builds the icon id per feature from the shape, fill color, outline color
and outline width channels. The id format is unchanged:
`se-marker|shape|fill|fo|stroke|so|sw|r`. `styleimagemissing` draws any id the
map asks for, so the set of looks doesn't need listing ahead of time.

- **Circles** stay on the circle layer, whose every property can vary per
  feature. The marker layer's filter excludes features whose shape evaluates to
  `circle`, and the circle layer's filter includes only them.
- **Rotation** goes to `icon-rotate`, **opacity** to `icon-opacity` (or
  `circle-opacity` and `circle-stroke-opacity`), and **size** to `icon-size`
  as today.
- **Bounding the number of icons**:
  - Categories, Classes, Conditions and Bivariate color give a fixed set of
    outputs.
  - **Continuous** color on non-circle markers is drawn in **32 steps** of the
    ramp (a `step` expression). Circles and every other drawing keep smooth
    interpolation. The panel says so in one line. QML export writes the smooth
    ramp. At 32 steps the gap between neighbours is below what the eye can tell
    apart on a 7-color ramp.
  - **As is** colors on non-circle markers: at most 256 distinct colors are
    drawn as given. Beyond that, extra values use the fixed color, with a note.
    Circles have no limit.

**Rejected**: SDF icons (fidelity, see above); one symbol layer per shape
(more layers, more filters, and the same icons anyway).

## §3 Label fonts

**Question**: labels need glyphs.
- Basemaps bring their own glyph URL (OpenFreeMap: `.../fonts/{fontstack}/{range}.pbf`).
- Blank and raster basemaps have none.
- The extension must work offline after first start (Constitution IV).

**Code reading**: MapLibre 6.13's `GlyphManager` draws a glyph locally with
TinySDF, using the font stack as a CSS family, in three cases:
- the style has no `glyphs` URL;
- the grapheme is a cluster;
- a range fails to download ("Rendering codepoint U+0050 locally instead").

The new `font-faces` root property can also pin a downloaded font file to a
stack.

**Spike** (`spikes/maplibre-channels.html.txt`, "lines" mode, with labels on
lines and points):

| Case | Result |
|---|---|
| no `glyphs`, no `font-faces` | labels drawn, local font |
| `glyphs` URL returning 404, no `font-faces` | labels drawn, local font (one 404 per 256-codepoint range, then cached) |
| dead `glyphs` + `font-faces` (a TTF) | labels drawn from the file |
| `text-font: ['serif']` vs `['sans-serif']` | the generic family is honored (serif rendered serif) |
| OpenFreeMap `glyphs`, stack `sans-serif` | the server returns 404 for unknown stacks (checked with curl: 404 vs 200 for `Noto Sans Regular`), so labels draw locally |

Latin with diacritics (Ålesund, Ünïcode) and Greek (Δέλτα) drew correctly.

**Decision**: labels use `text-font: ['sans-serif']` and are always drawn from
the system's fonts.
- No font file is bundled.
- Nothing new is downloaded. A basemap's glyph server gets at most one failing
  request per range used.
- Works offline and on every basemap, including Blank.
- The spec's assumption about fonts being downloaded is withdrawn (spec updated).

**3D**: MapLibre doesn't place symbol layers on top of `fill-extrusion`.
Labels on 3D polygons stay on the ground at each feature's label point, which
is the map's default. The spec's edge case is settled this way. Labels may be
hidden behind tall extrusions when the map is tilted.

**Tracked checks (implementation)**:
- In the spike, a faint mark sometimes appeared at word gaps in labels along
  lines (`Route•dash`), in every case. Check it in VS Code's webview with a real
  GPU. If it shows there, try `text-letter-spacing` or a `font-faces` file
  instead.
- The saved map image includes labels with no extra work: `MapView` reads the
  map's own frame inside a render (`mapImage.ts` composes it), and labels are
  part of that frame. A browser test still checks this (US8).

## §4 QGIS: every channel as a data-defined property, and labels

**Spike** (`spikes/qgis-channels.py.txt`, output in `qgis-channels.log` and
`qgis-channels-*.qml`). Three layers were set up as below, saved to QML,
reloaded into a fresh layer, evaluated per feature, and rendered.

**Points** (single symbol):
- fill: `ramp_color(create_ramp(...), scale_linear(...))`;
- outline color: `CASE`;
- outline width: `CASE`;
- shape (`name`): `CASE`;
- rotation (`angle`): `"deg"`;
- symbol opacity: `scale_linear(..., 30, 100)`.

**Lines:**
- color: `"hex"`;
- width: `scale_linear`;
- pattern (`outlineStyle`): `CASE` returning `solid`, `dash` or `dot`.

**Polygons:** a categorized renderer, plus data-defined outline color and
width on every class symbol.

**Labels:**
- points: a field, placed around the point;
- lines: an expression, curved along the line;
- polygons: a field, over the centroid.

**Findings**:
- Everything reloads, and per-feature values are as written. The points'
  fills are `255,255,204`, `192,128,121` and `128,0,38`. Shapes are triangle,
  star and square. Angles are 0, 45 and 90. Opacities are 30, 65 and 100 (QGIS
  symbol opacity is in **percent**).
- In the render, the shapes, rotation, fading, outline widths, line colors,
  widths and dash styles, polygon outlines and all three label placements are
  visible as intended.
- QML keys QGIS writes:
  - marker layer: `fillColor`, `outlineColor`, `outlineWidth`, `name`, `angle`;
  - symbol: `alpha`;
  - line layer: `outlineColor`, `outlineWidth`, `outlineStyle`;
  - labels: `<labeling type="simple">` with `fieldName` and `isExpression`,
    the text buffer, and `placement` 0 (around point), 1 (over point) or
    3 (curved).
- Rotation is clockwise in QGIS (`angle`) and in MapLibre (`icon-rotate`).

**Color interpolation**: MapLibre's `interpolate` evaluated at the middle of
`#ffffcc` to `#800026` gives `192,128,121`, the same as QGIS's `ramp_color`. A
continuous color ramp therefore exports as the same stops with no
approximation.

**Decision** (QML):
- **The primary renderer.** Color, if it varies, becomes QGIS's renderer
  (categorized, graduated, rule-based, or the bivariate rule set as today).
  Otherwise the first varying channel in panel order becomes it.
- **Every other channel** is written as a data-defined property on each class
  symbol:
  - Categories and Conditions: `CASE`;
  - Classes: `CASE` on the bounds (spec 009's form for size);
  - Continuous colors: `ramp_color(create_ramp(map(...)), scale_linear(...))`;
  - Continuous numbers: `scale_linear`, or spec 009's area transformer for
    marker size;
  - As is: the field itself.
- **Opacity** goes on the symbol's `alpha`, in percent.
- **The full model** rides in a `spatialExplorer/style` custom property, so it
  re-imports exactly.
- **Import** reads the forms we write and, from other QGIS styles, a field,
  `scale_linear` of a field, and a simple `CASE` over one field. Any other
  expression keeps the fixed value and adds a note.

## §5 SLD

SLD 1.1 has no per-property data-driven styling.

**Decision**:
- Combinations of up to two classed or categorized channels are written as one
  rule per combination, capped at **100 rules**. Spec 009 already writes color ×
  size that way.
- A third varying channel, or more than 100 combinations, keeps the first
  channel's classes and the others' fixed values, with a note.
- Continuous scales are written as 10 equal classes.
- Labels are written as a `TextSymbolizer`:
  - `Label` with `PropertyName`;
  - `Font` with `font-size`;
  - `Fill`, and `Halo` with its radius and fill;
  - `LabelPlacement`: `PointPlacement` with an anchor and displacement, or
    `LinePlacement`.
- An expression label keeps only the first column it names, with a note.

## §6 Mapbox GL

Every channel is a native paint or layout expression, the same ones the map
uses. Labels become a `symbol` layer with `text-field`, `text-size`,
`text-color`, `text-halo-*`, `symbol-placement` and `text-anchor`/`text-offset`.

Shapes keep today's note: Mapbox GL has no marker shapes without a sprite.

## §7 Where channel data comes from (both drawing modes)

**Today**:
- `styleDataColumns` lists the columns that map views (GeoJSON) and engine
  tiles carry;
- `dataByColumn` holds the engine's per-column statistics;
- rules are computed into `__se_cls`, and graduated expressions into `__se_val`.

**Decision**: generalize, one computed column per channel:
- `__se_cls_<channel>` for Conditions;
- `__se_val_<channel>` for an expression source;
- `__se_lbl` for an expression label.

`styleDataColumns` returns every channel's column plus the label column.
Statistics stay per column, keyed by column, so two channels on the same
column share one query, as color and size do today. Turning labels on with a
column already in the view adds that column to the view's SELECT; it does not
reload the layer. **Tracked check:** with tiles, a new column changes the tile
URL. That is a re-request of tiles, not a reload of data, and is the same path
the size channel takes today.

## §8 Mixed-geometry layers (spec edge case revised)

The spec's first draft gave each part of a Mixed layer (markers, lines, fills)
its own properties. That would triple the model and the panel for a rare case
(Constitution X).

**Decision**: channels are keyed by property, and each applies to the parts it
fits:
- **Color**: marker fill, line color and polygon fill, as today;
- **Outline color** and **Outline width**: markers and polygons;
- **Size**: markers;
- **Width**: lines;
- **Pattern**: lines and polygon outlines, as today;
- **Opacity**: all parts;
- **Rotation**: markers;
- **Height**: 3D polygons.

The panel lists the properties of every part present. The spec's Mixed edge
case is updated to match.

## §9 Migration

Old styles reach the app in two ways:
- QML sidecars and imports, read by `qml.ts`;
- in-session `LayerStyle` objects, plus test fixtures, read by
  `sanitizeStyle`.

`sanitizeStyle` already upgrades spec 001 and 2026-10-12 shapes. It gains one
more step:
- **`renderer`** becomes the `color` channel:
  - categorized: Categories;
  - graduated: Classes, with an expression source when it had one;
  - rules: Conditions;
  - bivariate: Bivariate;
  - heatmap: `draw.points = 'heatmap'` plus `heatmap` settings;
  - single: nothing.
- **`size`** becomes `size` **and** `width`, both with the same encoding,
  because today one size channel sizes markers and lines. The legend's merge
  rule (§10) shows them as one group, as today.
- **`extrusion`** (on) becomes `draw.polygons = '3d'` plus `height`: As is with
  its multiplier, or a fixed height.
- **The flat symbol fields** stay as the fixed values, unchanged.
  `strokeWidth` stays the fixed width for lines and outlines alike, unless the
  new fixed `lineWidth` is set.

**Proof of identity (SC-002)**: before the paint builder is replaced, the
current `paintFor`/`layoutFor` output is recorded as JSON for the existing
fixture styles, every renderer kind × size × shape × dash × extrusion
(`tests/core/fixtures/style/pre-011-snapshot.json`, styles as raw JSON in `pre-011-styles.ts`). The new builder must produce
expressions that evaluate equal, through MapLibre's evaluator, on a feature
grid. QML files saved by the previous version are re-imported, and the result
must save to a QML that QGIS draws the same, checked with `check_009.py` and
the 010 checks.

## §10 Legend merging

Two channels merge into one legend group when all of these hold:
- the same source (column or expression);
- the same scale kind;
- the same classes: the same category values or the same range bounds, with
  the same hidden classes.

A merged entry draws one swatch showing every merged channel's output. A
marker, for example, gets its color, size and shape together. Continuous scales
merge only with each other, over the same domain. They show the gradient bar,
with size samples at the minimum, middle and maximum.

## §11 Recipes

Recipes are functions in core that take the current style and the layer's
columns and return a new style. They aren't stored.

| Recipe | Effect | Unavailable when |
|---|---|---|
| Categorized | `color` by Categories of the first text-like column | no columns |
| Graduated | `color` by Classes of the first measure column | no numeric columns |
| Proportional symbols | `size` (points) or `width` (lines) Continuous on the first measure column | polygons only |
| Bivariate | `color` Bivariate on the first two measure columns | fewer than 2 numeric columns |
| Rules | `color` by Conditions with suggested rules, as today | — |
| Heatmap | `draw.points = 'heatmap'` | no points |
| Flow / network | `color` by Categories of a text column, plus `width` by Classes of a numeric column | not lines, or a text or numeric column is missing |

The columns chosen follow today's `startRenderer` and `measureColumns`
heuristics.

## Slice 1 outcomes (2026-10-13)

**What was built.**
- **Storage is channels.** `sanitizeStyle` turns every pre-011 shape into
  `draw`, `channels`, `heatmap` and `height` (research §9). A legacy key that
  is present (`renderer`, `size`, `extrusion`) wins over the channels it maps
  to, so patches from the pre-011 panel and raw test styles still work. The
  store always sanitizes, so it only ever holds channel-shaped styles.
- **A bridge for the code that isn't rebuilt yet.** `packages/core/src/style/legacy.ts`
  converts both ways: `rendererOf`, `sizeOf` and `extrusionOf` read, and
  `withRenderer`, `withSize` and `withExtrusion` write. `legacyView(style)`
  fills in the old fields at the entry points of resolve, the paint builders,
  the interchange helpers and the three file writers.
  - This replaced the plan's T013/T014 rewrite for slice 1. Identity then holds
    by construction, and slice 3 rewrites those paths per channel when new
    scales exist.
  - `resolveStyle` also fills `resolved.channels` (color, size, width and
    height), from the same classes, each with its `output`.
- **QML** writes the whole model in `spatialExplorer/style`, and reads it in
  preference to the renderer. The 0.3.0 properties are still written, for
  older builds.
- **Fixed 3D height** keeps meters and scale apart (`height: { meters, scale }`),
  so the panel's "Constant height" field shows what was typed.

**Bugs found by the suites and fixed.**
- **Classification cache key.** The session's cache key (`styleDataKey`)
  drops presentation fields by name, `color` among them. A channel map has a
  key named `color`, so the whole color channel vanished from the key, and
  different styles shared one cached classification. The browser specs showed
  one class, zero rule counts and missing expression values. The key is now
  built from the pre-011 view. A unit test covers it (`style-cache.test.ts`).
- **Size curve.** A classed size channel lost its marker curve
  (`scale: 'area'`), which spec 009 sets when sizing starts. `ClassesScale`
  now keeps `curve`.

**Deferred, on purpose.**
- **T017**: per-channel engine columns. In slice 1 only the color channel can
  have conditions or an expression, and it keeps spec 010's columns
  (`__se_cls`, `__se_val`). The per-channel columns arrive with T043.
- **T020**: the edit functions still return the pre-011 keys. The store's
  sanitize turns them into channels. Channel-scoped edits are T025.

**Results.**
- Core: 673 passed, 5 skipped.
- **SC-002**: all 23 pre-011 styles resolve, paint, lay out, filter and pick
  icons exactly as recorded on the pre-011 build. All 22 sidecars saved by
  0.3.0 import and draw exactly as the 0.3.0 import did, and still do after
  being saved again.
- Web (style, accessibility, 3D and map-image specs): 65 of 65 after the
  cache-key fix. The first run had 13 failures, all from that bug, and the
  3D constant height.
- Extension (style, map image, layers, query): 29 passing.
- PyQGIS on files the new code wrote:
  - `check_009`: 0 mismatches;
  - `check_010_rules`: OK;
  - `check_heatmap`: densest pixels `#b20026` and `#b10026` against the
    ramp end `#b10026`.
- Lint: 0 errors. Typecheck: 0 errors.

## Phase 4 outcomes (US1, 2026-10-13)

**What was built.**
- **Every property by its own column.** Outline color and width, shape,
  pattern, opacity and rotation (and size or width by categories) resolve
  generically. They use the categorized or graduated classification, so they
  have the same classes, keys, counts and labels as a color would.
- **Outputs.** Each class's output is its own, or comes from the ramp, the
  range (spread evenly, as spec 009's class sizes), or the shape and pattern
  lists (6 shapes + Other, 4 patterns + Other).
- **Engine data.** The engine fetches these columns' values (small results)
  or statistics (big ones, with exact class counts), in a cached step after
  the color and size resolution. Map views and tiles carry the columns.
- **Map.**
  - one expression per property;
  - marker icon ids built per feature (research §2);
  - circles stay on the circle layer when the shape varies;
  - a class hidden in any property hides its features;
  - MapView resets paint and layout properties a style no longer sets.
- **Panel.**
  - property rows (`ChannelRow`), with a scale editor (`ScaleEditor`) for
    the generic properties;
  - Color, Size and Width keep their existing editors inside their rows;
  - the style type dropdown stays until T037.
- **Legend.** One group per property (`channelLegendGroups`). Swatches show
  each class's output. Rotation uses a triangle when the shape is a circle.
  The single symbol's row is dropped once other groups exist.
- **Deviations from contracts/ui.md:**
  - a class list inside `ScaleEditor`, instead of extending `ClassList` with
    an `outputKind`, which kept `ClassList` unchanged for color and size;
  - set-aside encodings live in a session map in the panel's module script,
    keyed by file and property, not in `viewerStore`.

**Bugs found and fixed.**
- **Store patch merge.** The store merged every edit into the style as a
  patch, so a key an edit removed survived: Outline color back to Fixed kept
  its column. The store now replaces the style when an edit hands it a whole
  one, and merges only partial patches. Edits also write `undefined` rather
  than deleting.
- **Mixed line endings** from appended code blocks (`edit.ts`, `resolve.ts`):
  normalized to CRLF.

**Measurements (T032).** 3,000 points, with shape, outline color and rotation
by column, at 6× CPU throttle in Chromium:
- Opacity to By column: 325 ms;
- Opacity class count changed (engine reclassification): 1,121 ms;
- ten Point size slider steps: 2,044 ms, about 200 ms a step (about 33 ms at
  normal speed);
- Shape back to Fixed: 478 ms.
No slider step re-queries the engine: the cache key leaves presentation out.

**Tests.**
- Core: 685 passed.
- Web: `style-channels-011` 5 of 5, and twice over 10 of 10. Style,
  accessibility, 3D and map-image specs: 69 of 70. The one failure was the
  new spec's own race, then fixed.
- Earlier runs had 3 timing failures under parallel load (map image 8.5 s
  against 5 s; layers 8.0 s against 6 s; the export dialog's Cancel button
  detached because the export finished first). Each passed in a rerun.

## Panel revision (2026-10-13)

The user saw the property-row panel with Draw as and recipes built and chose
the proposal's other design instead: keep the style type, Appearance and 3D,
and add "Vary by attribute" under them. What changed:
- **UI only.** The channel model, migration (SC-002), per-property resolution
  and paint, engine data, legend groups and the store fix all stay.
- **Restored from the slice 1 commit:** the panel, the style type dropdown and
  the migrated web specs.
- **Removed:** `ChannelRow`, `recipes.ts` and their tests.
- **New:** `VaryRow` and `AddVaryMenu`. The spec 009 size editor became the Size
  or Width row.
- **Fix found while reviewing the screenshots:** the Add menu floated and was
  cut off at the bottom of the panel's scroll area. It now opens in the flow
  of the panel.

## Merged legend and wording (2026-10-13)

- **`legendGroups`** (`packages/core/src/style/legend.ts`) collects the color's
  classes (categorized, graduated, rules), spec 009's classed size, and the
  generic properties' classes. Groups whose column, kind of scale, classes
  (values, or bounds) and hidden classes all match merge into one.
  - Each entry carries one toggle per merged property, so hiding it hides
    the class everywhere and the group stays merged.
  - Bivariate squares, heatmap ramps and proportional sizes stay apart.
- **The on-map legend and the map image** both draw the merged groups. Groups
  without a size are drawn at a readable size while another group shows sizes,
  as spec 009 did.
- **Wording (user decision).** The style type's heading is **Color**, the
  dropdown is named "Color: <type>", and "Single" is **Single color**,
  because it sets only the color.
- **Tests:**
  - core `style-legend-011` (6), covering merged, different breaks, a hidden
    class in one property only, color with shape by the same categories,
    groups in panel order, and hidden from the legend;
  - web `legend-011` (1);
  - the web style suites, 70 of 70.

## SC-003: QGIS parity of Vary by attribute (2026-10-14)

- **Export (T053).** Every property that varies by a column, other than color
  and spec 009's size, is written as a QGIS data-defined property: a `CASE`
  over the same classes as the map (No value first, upper-inclusive ranges with
  the first including its lower bound, categories by their string form, then
  Other as the fixed value).
  - Keys on the symbol layer: `outlineColor`, `outlineWidth` (also a line's
    width), `name`, `angle`, `outlineStyle`.
  - The symbol's own `alpha`: opacity in percent; a class hidden in any
    property sets it to 0.
  - Our "x" is QGIS's filled cross turned 45°: a shape by data adds 45 to
    the angle for those features.
  - The fixed rotation and opacity are written as the symbol's values, and a
    line's own width as its `line_width`.
  - Properties read from an SQL expression have no column in the file. They
    keep the fixed value and get a note.
- **Run (T057), QGIS 4.2.3, `check_011.py`.** Four cases of 72 features:
  - points with color by class, shape by 9 kinds (Other included), outline
    color, rotation classes and opacity classes with one hidden;
  - polygons graduated with outline color by 9 kinds and outline width by a
    number with nulls;
  - lines with pattern and opacity;
  - a rule-based style with a fixed shape and rotation and outline width by
    class.

  All load, with 0 mismatches. Values vary across features (6 shapes, 10
  angles, 9 outline colors, 6 outline widths, 3 patterns), so the check is not
  trivial.
- **Known, not new.** QGIS's graduated renderer draws null values in no class
  (spec 008). The graduated color in these cases uses a column without nulls.
  A No value class in another property is tested (outline width by `num`).
- T052 asks for a PNG per case as well. It was not written: the per-feature
  property values are the comparison.

## US7 outcomes: files (2026-10-14)

- **QML import (T054).** QGIS's own `CASE` forms are read back on outline
  color and width, shape, angle, pattern and the symbol's opacity:
  - categories by value;
  - classes with both bounds, or upper bounds after the first;
  - opacity 0 hides the class.

  A fixed marker angle is the style's rotation. A plain field and
  `scale_linear` keep the fixed value, with a note naming the property, until
  Continuous and As is (US4). Our own files come back whole from
  `spatialExplorer/style`.
- **SLD (T055).**
  - One rule per combination of the visible classes of at most two
    properties, capped at 100 rules. Beyond that, the first property alone,
    with a note naming the rest.
  - **Fixed in review:** properties on the same column with the same classes
    (color and shape by `cls`) were crossed into impossible combinations
    ("A · B"). They now share one rule per class, as the legend merges them.
  - Fixed rotation, opacity and line width are written.
  - Import reads per-class outline, shape, pattern and rotation on one column,
    and a mark's rotation. A square at 75° is read as a square at 75°, the
    same drawing as a diamond at 30°.
- **Mapbox GL (T056).** Paint uses `symbolExpressions`, the map's own, and
  hidden classes share the map's filter. Exports pass MapLibre's
  `validateStyleMin`. Import reads `match`/`step` over one `get` on outline
  color and width, line width and opacity. Shapes by attribute get a sprite
  note.
- **Tests:**
  - core 711;
  - the web style, export and legend suites, 61 of 61;
  - the VS Code style suite, 25, with the new sidecar test (T058, channels
    part).

## US6 outcomes: labels (2026-10-14)

- **Placement.**
  - **The rail:** Labels has its own button on the right rail, between Style
    and Details (user decision), and its own panel (`LabelsPanel`).
  - **The map:** two symbol layers, `label` and `label-line`. A symbol
    layer places all its labels one way, so points and polygons share one
    layer (`text-anchor` and `text-offset` chosen per geometry) and lines get
    the other.
  - **Skipped:** dots that stand in for small features, features hidden
    through the legend, and empty text.
  - **Expressions:** an expression label is checked by the engine (any type,
    shown as text) and computed as `__se_lbl`, in both drawing modes.
- **The word-gap mark (T067, research §3), explained.** Enlarged screenshots
  show it is not a glyph artifact. It is the line itself, seen through each
  word gap: every glyph has a halo, and a space has no glyph. So letter
  spacing or a font file wouldn't change it.
  - **Fix:** line labels sit just above the line (`text-anchor: bottom`,
    0.2 em up), which is QGIS's default for lines ("Above line"). Checked in
    the web build's screenshots.
  - The VS Code GPU check is no longer needed for this: the cause is
    geometry, not rendering.
- **Short or sharply bent lines get no label.** MapLibre places one label at
  the middle of a line shorter than the label spacing, and needs room and a
  bend under 45° there. `roads-los.geojson` (two-segment zigzags, bent in
  the middle) has none at any zoom; real roads are fine. The browser test
  uses straight lines.
- **Files (T066).**
  - **QML:** QGIS's simple labeling with the `Labeling` category and
    `labelsEnabled`. Points use OverPoint with a quadrant and distance,
    lines are curved above the line (flags 10), and polygons use OverPoint
    centered.
  - **QGIS 4.2.3 reads the three label cases back exactly:** field or
    expression, 16 px, color, buffer, placement 1/3, quadrant 7, distance 6.
  - **SLD:** a TextSymbolizer in every rule, so hidden classes stay
    unlabeled.
  - **Mapbox GL:** the map's own label layers, reading a column. A style file
    can't run SQL, so an expression label shows its first column, with a note.
  - **Glyphs:** other tools need a glyph server, so the file names
    OpenFreeMap's `Noto Sans Regular`, with a note. This departs from the
    contract's `sans-serif`, which only MapLibre's local fallback draws.
    Exports pass `validateStyleMin`.
  - **Import:** all three formats read labels back (QGIS's rule-based labels
    use their first rule).
- **Tests:**
  - core: `style-labels` (8) and `style-labels-interchange` (7), 727 in all;
  - web: `labels.spec.ts` (3), and layout and accessibility (29 together);
  - QGIS: `check_011.py`, 7 cases, 0 mismatches.

## US4 slice A: Continuous and As is on Vary by attribute (2026-10-14)

- **Where they apply.** Outline color, outline width, opacity and rotation
  get Continuous and As is. Size and width get As is; their Continuous was
  already spec 009's proportional size. The scale list follows FR-010 and the
  column: classes and continuous need numbers, and as is reads colors from
  text and the rest from numbers.
- **Continuous.**
  - The domain is the column's minimum to maximum, or the user's ("Values",
    with Auto).
  - Colors run through 7 ramp stops in RGB, as QGIS mixes them. Numbers run
    from the range's minimum to maximum, linear or by area.
  - The legend shows a bar from min to max for colors, and three samples
    (not toggles) for numbers. Only "No value" can be hidden.
- **As is.**
  - Colors: `#rgb`/`#rrggbb` pass; other values get the fixed color, counted
    in a note (the engine counts them for big results).
  - Numbers: px, degrees, and opacity clamped to 0–1.
  - Shaped markers: at most 256 distinct colors (each is an icon); more fall
    back, with the reason.
- **Shaped markers, continuous colors:** a 32-step `step` in the icon id;
  outline widths in quarter pixels. Circles stay smooth.
- **Bugs caught by tests.**
  - MapLibre's `interpolate` needs color-typed outputs, and `case` takes its
    type from the first branch. The paint's cases start with plain hex
    selection colors, so these colors are built as colors and returned as
    text (`to-string`), which the paint coerces back, like every other color.
  - An as-is color's "No value" test must be the text one: the numeric test
    took every hex string for missing.
  - Legend ends now show exact values (at most 2 decimals), not 3
    significant digits (3,648 showed as 3,650).
- **Files.**
  - **QML:** `scale_linear`, or `scale_exp(…, 0.5)` by area; colors as the
    ramp's segments with `color_mix_rgb`; as is, the field (colors only when
    hex). QGIS 4.2.3 (`check_011.py`): 9 cases, 0 mismatches, colors within
    ±2 per channel (QGIS's own rounding of the mix). Opacity 0 counts as
    drawn when both sides are 0.
  - **SLD:** continuous as 10 equal classes; as is stays fixed. Both with a
    note.
  - **Mapbox GL:** the map's expressions.
  - **Import:** QML `scale_linear`/`scale_exp`/field, and Mapbox's two-stop
    linear `interpolate` (T054's deferred forms).
- **Tests:**
  - core `style-scales-011` (8), 737 in all;
  - web `style-scales-011` (2), and the style, export, legend and label
    suites (68).

## US4 slice B: Conditions on any property (2026-10-14)

- **What.** Spec 010's rules, per property: SQL conditions in order, the first
  that holds wins, then "Everything else". Every Vary-by property can use
  them (shape and pattern included); size and width too, from the size row.
- **Engine.**
  - Each property's conditions are checked (a refused one shows its reason
    and matches nothing) and counted in one pass.
  - The counts are cached by the conditions' text, not their outputs.
  - The map reads the computed `__se_cls_<property>`; hidden rules filter it.
- **Legend.** One group per property, titled with the property ("Outline
  width · 2 conditions"), since conditions read no single column.
- **Size and width.** Conditions and As is set only the property the
  geometry draws (Width on lines, Size on points). They had shared spec 009's
  encoding, so their defaults (marker size vs. line width) drifted into two
  legend groups. Classed and Proportional keep the shared encoding. The size
  row offers all four as one radiogroup.
- **Files.**
  - **QML:** a QGIS `CASE` in order, without the refused conditions, and a
    note that SQL-only functions may need adjusting. QGIS 4.2.3: shape and
    outline width by conditions with a hidden rule, 0 mismatches (10 cases
    in all).
  - **Mapbox GL:** the rule index becomes a `case` over the data's own
    columns when every condition is a simple comparison; otherwise
    everything takes Everything else's output, with a note. Exports pass
    `validateStyleMin`.
  - **SLD:** the fixed value, with a note.
- **Tests:**
  - core `style-scales-011` (11), 740 in all;
  - web `style-scales-011` (4), and the style suites (70).

## US4 slice C: Color by Continuous and As is (2026-10-14)

- **Panel.** Two more Color types, "Continuous" (colors along a ramp, by a
  number; it starts on the first measure column, ids last) and "As is"
  (colors read from a text column, name-like columns first). Each shows
  "Color by" with the same scale editor as Vary by attribute. Neither has a
  pre-011 renderer: the style keeps the single symbol, plus a color encoding
  that resolves like the other properties (`isGenericChannel` admits color
  for these two scales). Map, legend, engine data and files work through
  the same path.
- **Legend.** The first color group normally takes the layer's heading.
  A bar or an as-is note now keeps its own title ("age_days ·
  Continuous").
- **Fixed for every data-defined color (also slice 2's outline colors).**
  A QGIS data-defined color replaces alpha too, so QGIS drew those fills
  opaque. They are now wrapped in `set_color_part(…, 'alpha', fill or
  outline opacity)`; the importer unwraps it.
  - `check_011.py` reads the data-defined fill color and compares the fill's
    alpha. 12 cases, 0 mismatches (continuous polygon colors, 66 distinct;
    as-is point colors, 58; alpha 115 for a 45% fill).
- **Tests:**
  - core 740;
  - web `style-scales-011` (5), and the style, export, legend, label and
    accessibility suites (90; the export dialog's Cancel race failed once and
    passed on rerun, as before).

## US8 outcomes: map image (2026-10-14)

- **Labels** are in the captured frame, as research §3 expected.
  - Web: the saved PNG has 200+ more label-text pixels in the map's upper
    half than without labels.
  - VS Code: the PNG with every country's name is over 5% bigger than
    without.
- **Legend groups in the image** (`mapImage.ts`): the merged severity group
  (colors and shapes together), a continuous outline color's bar with "0 →
  3,648" (viridis ends found in the legend box), and opacity samples.
- **Fixes:**
  - samples had printed their internal count (-1);
  - image swatches ignored the property opacity and rotation (the on-map
    legend applied them);
  - two groups on one column by the same scale had the same title ("age_days
    · Continuous" twice). Such groups now name their properties ("Outline
    color · age_days · Continuous"), in the live legend and the image.

## Polish: performance, SC-004 and SC-005 (2026-10-14)

`tests/web/specs/performance-011.spec.ts` measures the following in the web
build, in headless Chromium with software WebGL:
- the time from a change to the map's next settled frame (`idle`);
- the longest main-thread tasks during panel edits at 6× CPU.

Test hooks are off, as in spec 010's benchmark: the rendered-feature count on
each idle was itself the 1–2 s long task, as spec 010 had found.

| Case | Repaint only | Fixed value, plain style (pre-011 path) | Fixed value, 2 properties varying | Property by a column | Continuous | Longest task at 6× |
|---|---|---|---|---|---|---|
| tiles, 100,000 parcels | 67 ms | 342 ms | 374 ms | 1,082 ms | 1,178 ms | 391 ms |
| GeoJSON, 77,000 parcels | 45 ms | 613 ms | 640 ms | 616 ms | 1,007 ms | 386 ms |

- **Fixed in this pass:** categories took 3.6 s to order the 77,000 distinct
  values of an id column, twice per change, because `compareCategories` used
  `localeCompare` with options, which builds a collator on every call. One
  cached `Intl.Collator` gives the same order. The first property by a column
  on 77k parcels went from 3.8 s to 0.62 s (an id column: from 7.8 s to
  1.3 s). Categorized color gains the same.
- **SC-004 is not met in full here:**
  - A fixed value takes 340–640 ms to a settled frame, against 200 ms. The
    pre-011 path costs the same on a plain style (fixedPlain), so spec 011
    adds 30 ms. The cost is MapLibre re-evaluating data-driven paint over
    every feature (no tile is requested again: 0 engine calls), not the
    style code.
  - A property by a column in tiles mode is 1.08 s, against 1 s: the tiles
    are rebuilt to carry the new column (by design since spec 010).
  - The longest task during edits at 6× is about 390 ms.
  - These are recorded, not asserted, as spec 010's benchmark does.
- **SC-005 is met** (230k parcels, tiles):
  - A label setting reloads nothing (`sourceLoads` unchanged).
  - Turning labels on rebuilds the tiles once (they carry the text column),
    and the layer is not opened again.
  - Panning at 6×: longest task 57 ms with labels, 0–64 ms without (spec
    010's budget: 200 ms).

## Polish: patterns per feature on engine tiles (T072, research §1) (2026-10-14)

- **Seen working.** `dash-tiles-011.spec.ts` checks two horizontal 4 px
  lines in tiles mode (`tileRows=1`), the pattern by their category. Along
  the solid line the line color is one unbroken run; along the dashed one it
  breaks more than 10 times. The `match` on `line-dasharray` evaluates on
  vector tiles as on GeoJSON.
- **Fixed, seen in the same screenshot.** The legend drew both lines solid.
  Swatches scaled the dash by the shown line width, so a 4 px dash pattern
  was 16 px long in an 18 px swatch. The dash unit is now at most 2 px, in
  the live legend and the map image.

## Polish: themes, high contrast and keyboard (T073) (2026-10-14)

- **Coverage.** `accessibility-011.spec.ts` runs axe in light, dark and forced
  colors (the browser's high contrast) over:
  - Vary by attribute with Continuous, As is, and Conditions showing an
    error;
  - Color Continuous;
  - the Labels panel, off and on with an expression error.

  A keyboard pass covers the rail (arrows to Labels, Enter), every Labels
  setting in Tab order, placement by arrow keys, and adding and writing a
  condition.
- **Fixed:** the legend's group titles were `h4` with nothing between them and
  the page's `h1`, a heading-order violation as soon as the first group has
  a title of its own (a continuous or as-is color). They are now `h2`.
- **Forced colors:** nothing opts out (`forced-color-adjust`), so the browser
  paints system colors. axe's contrast rule reads the author's colors under
  the emulation and isn't run there.
- **Environment, 2026-10-14:** a Windows Application Control policy started
  blocking Playwright's downloaded browsers (`spawn UNKNOWN`; "An Application
  Control policy has blocked this file"). The installed Google Chrome 155
  is allowed. From here, the web suites run through a local config
  (`playwright.chrome.local.config.ts`, not committed) with
  `channel: 'chrome'`.
  - On that Chrome, `accessibility.spec.ts` "keyboard: Cancel opening…"
    fails every time (the empty state doesn't return within 3 s after
    Cancel). It passed on the downloaded Chromium earlier today, and this
    branch doesn't touch opening. Left as is.
