# Feature Specification: Thematic Styling

**Feature Branch**: `003-thematic-styling`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Thematic styling (STYLE pillar of Spatial Explorer). In both the VS Code extension and the web app, users style the displayed layer (the opened file or the current query result) by its data, not only with one flat color. Renderers: single symbol (today's fill/outline/width/point size), categorized (a color per distinct value of a chosen column, with a cap on the number of classes and an "other" bucket), and graduated (a numeric column split into classes by equal interval, quantile or natural breaks/Jenks, with a chosen class count). An inline color-ramp picker shows ramp previews (sequential, diverging, qualitative palettes; reversible). A map legend shows the active classes with their colors and labels, and stays in sync with the style. Classes are computed over the whole layer/result, not just the features drawn, and recompute when a new query result changes the data; a style whose column no longer exists degrades gracefully with a clear notice. Data colors are fixed and theme-independent; chrome follows the theme. The existing style persistence stays: the QML sidecar next to the data saves and auto-loads categorized and graduated styles, and QML, OGC SLD and Mapbox GL style JSON export/import carry them where the format allows (with a clear notice about anything that can't round-trip). Keyboard-accessible and theme-native like specs 001/002. Out of scope: labels/annotations, rule-based or expression styling, heatmaps/clustering, per-feature manual styling, multiple layers or layer ordering, raster styling, exporting data files (spec 005)."

## Clarifications

### Session 2026-10-10

- Q: Are classes computed over the displayed result or over the whole file
  (the initial view shows the first 1,000 rows)? → A: The displayed result.
  The legend matches the map and table exactly. Raising or removing `LIMIT`
  classifies more.
- Q: What can be edited for an individual class? → A: GeoLibre's model plus
  map visibility. Each class has an editable color, label and value or
  break, and classes can be added and deleted. Editing a value or break, or
  adding or removing a class, switches the method to Manual, while a color
  or label edit keeps it. A per-class visibility toggle hides that class's
  features on the map, not only its legend row.

## Context

Spec 001 shipped a single-symbol style (fill, outline, width, point size).
It is saved explicitly as a QGIS-readable sidecar next to the data, applied
automatically on open, and exchangeable as QGIS QML, OGC SLD and Mapbox GL
style files. Spec 002 made the displayed layer the result of an editable
query, with Reset restoring the original view and its saved style. This spec
adds the STYLE pillar proper: coloring features by the values in one column.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Color features by category (Priority: P1)

A planner opens a parcel file and wants to see zoning at a glance. They open
the style controls, choose "Categorized", pick the `zone` column, and every
parcel is colored by its zone. A legend on the map lists each zone with its
color and how many features fall in it.

**Why this priority**: coloring by a category is the most common reason to
style a layer at all, and on its own it already replaces the most frequent
"open it in QGIS to see the pattern" task.

**Independent Test**: open a file with a text column of a few distinct
values, choose Categorized on that column, and confirm each value gets its
own color on the map and a matching legend entry.

**Acceptance Scenarios**:

1. **Given** an opened layer with a column of 5 distinct values, **When** the
   user chooses Categorized on that column, **Then** features are colored
   with 5 distinct colors from the chosen palette, and the legend lists the
   5 values, each with its color and feature count.
2. **Given** a column with more distinct values than the class cap, **When**
   the user categorizes by it, **Then** the most frequent values each get a
   class, all remaining values share one "Other" class with its own color,
   and the legend says how many values "Other" holds.
3. **Given** a column with empty (null) values, **When** the user
   categorizes by it, **Then** features with no value get their own
   "No value" class, shown in the legend.
4. **Given** a categorized style, **When** the user switches back to Single
   symbol, **Then** every feature returns to the single symbol and the
   legend shows that one symbol.

---

### User Story 2 - Color features by a numeric range (Priority: P1)

An analyst wants to see which parcels are most valuable. They choose
"Graduated", pick the `value` column, choose 5 classes and a
classification method, and parcels shade from light to dark by value. The
legend shows each class's range.

**Why this priority**: graduated (choropleth) styling is the other core
thematic map type. Together with US1 it covers nearly all thematic maps.

**Independent Test**: open a file with a numeric column, choose Graduated
with 5 classes, and confirm features are shaded by range and the legend's
breaks match the chosen method.

**Acceptance Scenarios**:

1. **Given** a numeric column, **When** the user chooses Graduated with
   Equal interval and 5 classes, **Then** the range from the minimum to the
   maximum is split into 5 equal-width classes, and the legend shows each
   class's lower and upper bound.
2. **Given** the same column, **When** the user switches to Quantile,
   **Then** each class holds as close to the same number of features as the
   data allows, and the map and legend update.
3. **Given** the same column, **When** the user switches to Natural breaks,
   **Then** the classes group similar values together and separate dissimilar
   ones, and the map and legend update.
4. **Given** a graduated style, **When** the user changes the class count
   (between 2 and 10), **Then** the classes are recomputed and redrawn.
5. **Given** only non-numeric columns, **When** the user opens Graduated,
   **Then** no column can be picked, and a short message says that graduated
   styling needs a numeric column.

---

### User Story 3 - Pick a color ramp from previews (Priority: P2)

The user doesn't like the default colors. Next to the renderer settings,
they see a row of ramps drawn as small color strips. Choosing one recolors
the map immediately. A Reverse control flips it, so dark means low instead
of high.

**Why this priority**: the defaults make US1 and US2 usable without this.
A good ramp choice is what makes a thematic map readable and presentable.

**Independent Test**: with a graduated style applied, pick a different ramp
and press Reverse, and confirm the map and legend follow each change.

**Acceptance Scenarios**:

1. **Given** a graduated style, **When** the user opens the ramp picker,
   **Then** sequential and diverging ramps are offered, each drawn as a
   preview strip with an accessible name.
2. **Given** a categorized style, **When** the user opens the ramp picker,
   **Then** qualitative palettes are offered first.
3. **Given** any ramp, **When** the user presses Reverse, **Then** the class
   colors are applied in the opposite order on the map and in the legend.
4. **Given** a keyboard-only user, **When** they move through the ramp
   picker with the arrow keys and press Enter, **Then** the focused ramp is
   applied.

---

### User Story 4 - Save, reopen and exchange thematic styles (Priority: P2)

The user saves their categorized zoning style. The next time they open the
file, in Spatial Explorer or in QGIS, the same classes and colors appear.
They can also export the style as SLD for a map server or as Mapbox GL style
JSON for a web map, and import such files back.

**Why this priority**: without persistence the work is lost on close. The
sidecar format was chosen in spec 001 precisely so styles are shared with
QGIS.

**Independent Test**: save a categorized style, close and reopen the file,
and confirm the same classes and colors. Export it to each format, import
each file back, and compare.

**Acceptance Scenarios**:

1. **Given** a categorized or graduated style, **When** the user saves it,
   **Then** the sidecar next to the data holds that style, and reopening the
   file shows the same renderer, column, classes, colors and legend.
2. **Given** a saved thematic sidecar, **When** the file is opened in QGIS,
   **Then** QGIS shows the same categories or graduated classes with the
   same colors.
3. **Given** a thematic style, **When** the user exports it to QML, SLD or
   Mapbox GL style JSON and imports that file back, **Then** the classes,
   values or breaks, and colors are the same as before.
4. **Given** an imported file that contains something the viewer can't
   represent (for example rule-based rules, labels, or a size-by-value
   symbol), **When** it is imported, **Then** everything representable is
   applied, and a notice lists what was left out. Nothing is dropped
   silently.
5. **Given** a format that can't record part of a style (for example the
   classification method, which some formats keep only as fixed breaks),
   **When** the user exports to it, **Then** a notice says what will not
   round-trip.

---

### User Story 5 - Styles follow query results (Priority: P3)

The user has a graduated style on `value` and runs a query that keeps only
residential parcels. The classes are recomputed for the new result, and the
legend updates. They then run a query without the `value` column. The map
falls back to the single symbol with a clear notice instead of breaking.
When the column comes back, the thematic style returns.

**Why this priority**: queries (spec 002) change the data under the style.
The style must stay correct, but the basic thematic map is complete without
this story.

**Independent Test**: apply a graduated style, run a filtering query, and
check the recomputed classes. Then run a query without the column and check
for the notice and the fallback.

**Acceptance Scenarios**:

1. **Given** a categorized or graduated style, **When** a new query result
   arrives that still contains the styled column, **Then** classes are
   recomputed over the new result, and the map and legend update.
2. **Given** a thematic style, **When** a result arrives without the styled
   column (or with it no longer numeric, for a graduated style), **Then**
   features are drawn with the single symbol, and a notice names the
   missing column. The thematic settings are kept.
3. **Given** that fallback, **When** a later result contains the column
   again, **Then** the thematic style is applied again without the user
   re-choosing it.
4. **Given** a thematic style, **When** the user presses Reset (spec 002),
   **Then** the original view returns with the saved sidecar style (or the
   default single symbol if none was saved).

---

### Edge Cases

- **Every feature has the same value**: Categorized shows one class.
  Graduated shows one class covering the single value, with a short note
  that the range can't be divided. It does not fail or produce empty
  classes.
- **Fewer distinct numeric values than classes**: Graduated produces only as
  many classes as there are distinct values and says so. It never creates
  empty or duplicate classes.
- **Quantile ties**: when many features share a value, the class sizes may
  be uneven. Classes never split identical values across two classes.
- **Very many distinct categories** (e.g. an ID column): the class cap and
  the "Other" class keep the map and legend readable. The legend says how
  many values were grouped.
- **Nulls and non-finite numbers in a graduated column**: they are left out
  of the breaks and drawn as a "No value" class.
- **Mixed geometry layers**: points, lines and polygons each use the class
  color in their own way: marker fill, line color, polygon fill.
- **A layer with no attribute columns**: only Single symbol is available,
  and the renderer choice says why.
- **Large layers**: classes are computed over the whole displayed result, even when it
  holds tens of thousands of rows. While computing, the controls show
  progress, and the previous style stays on the map until the new one is
  ready.
- **Sidecar from a newer or foreign source** (e.g. a QML written by QGIS
  with a renderer type this viewer doesn't support): import what is
  representable, list the rest in a notice, and fall back to the single
  symbol if nothing is.
- **Theme change**: data colors don't change. Legend and control chrome
  follow the theme, including high contrast.
- **Styled column renamed by a query** (e.g. `SELECT value AS v`): this is
  treated as a missing column (US5, scenario 2). Columns are matched by
  name only.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to choose one of three renderers for the
  displayed layer: Single symbol, Categorized, or Graduated.
- **FR-002**: Single symbol MUST keep today's settings (fill, fill opacity,
  outline, outline opacity, outline width, point size) unchanged.
- **FR-003**: Categorized MUST assign one class per distinct value of a
  chosen column. Above a class cap, the most frequent values get classes
  and the rest share an "Other" class. Nulls get a "No value" class.
- **FR-004**: Graduated MUST split a chosen numeric column into 2–10 classes
  by Equal interval, Quantile, or Natural breaks (Jenks), or use Manual
  breaks (FR-009). Nulls and non-finite values get a "No value" class.
  Each class is defined by its lower bound and drawn as one flat color, so
  the map and the legend always agree on which class a value falls in.
  Duplicate breaks collapse into one class, never an empty one.
- **FR-005**: Class computation (distinct values, counts, minimum, maximum,
  and breaks) MUST cover every row of the displayed result and nothing
  else, so the legend always describes exactly what is on the map and in
  the table. For the initial view, that is the first 1,000 rows (spec 002).
  Users classify more of the file by raising or removing the query's
  `LIMIT`.
- **FR-006**: Thematic renderers MUST keep the single-symbol outline,
  opacity, width and point size settings, and vary only the class color.
- **FR-007**: A color-ramp picker MUST show previews of the available ramps:
  sequential and diverging ramps for Graduated, qualitative palettes for
  Categorized. Each ramp MUST be reversible and have an accessible name.
- **FR-008**: Ramps and palettes MUST be fixed data colors that don't change
  with the theme, and the default ramp for each renderer MUST read on both
  light and dark basemaps.
- **FR-009**: Users MUST be able to edit individual classes:
  - change a class's color or label (the method is kept);
  - change a category value or a graduated break, or add or delete a class,
    which switches the method to Manual (the classes no longer recompute
    from a method until the user chooses one again);
  - toggle a class's visibility, which hides that class's features on the
    map, dims its legend row, and keeps the class.

  Manual classes MUST still update their feature counts when the data
  changes.
- **FR-010**: A map legend MUST show the active renderer's classes: color
  swatch, label (category value or range), and feature count, headed by
  the column and, for Graduated, the method and class count (e.g.
  "value · Quantile, 5 classes"). It MUST
  update with every style or data change, MUST be collapsible, and MUST NOT
  block map interaction.
- **FR-011**: When new data arrives (a new query result, a file reload, or
  Reset), thematic classes MUST be recomputed over the new data.
- **FR-012**: When the styled column is missing, or a graduated column is no
  longer numeric, the layer MUST be drawn with the single symbol, with a
  notice naming the column. The thematic settings MUST be kept and
  re-applied when the column returns.
- **FR-013**: Saving MUST write categorized and graduated styles to the
  existing sidecar next to the data, in a form QGIS displays with the same
  classes and colors. Opening a file MUST apply such a sidecar
  automatically, as for single symbols today.
- **FR-014**: Export and import MUST carry categorized and graduated styles
  in QGIS QML, OGC SLD and Mapbox GL style JSON. Class values or breaks and
  colors MUST survive an export-then-import round trip in every format.
- **FR-015**: Any part of a style that a format can't hold (on export), or
  that the viewer can't represent (on import), MUST be reported in a notice
  listing each item. Nothing may be dropped silently. For example, hidden
  classes are kept in the QML sidecar, but are left out of formats that
  can't mark a class as hidden, with a notice.
- **FR-016**: Changing the renderer, column, method, class count, ramp or
  reverse MUST update the map and legend without a manual "apply" step. A
  change that needs recomputation MUST keep the previous style visible
  until the new one is ready.
- **FR-017**: Styles MUST NOT be saved automatically. Unsaved changes MUST
  be indicated, as for single symbols today, and Save MUST be explicit.
- **FR-018**: All style controls, the ramp picker and the legend MUST be
  keyboard-reachable, labeled, and theme-native (VS Code light, dark and
  high contrast; web brand light and dark), as for specs 001 and 002.
- **FR-019**: The selected-feature highlight MUST stay distinguishable from
  every class color in every ramp and palette offered.
- **FR-020**: Both shells MUST produce the same classes, colors and legend
  for the same file, query and style.

### Key Entities

- **Layer style**: the renderer (single, categorized or graduated) plus its
  settings. It is what is saved, exported and imported.
- **Symbol settings**: fill, outline, opacities, width and point size,
  shared by all renderers. Thematic renderers vary only the color.
- **Categorized renderer**: the column, the palette (and whether it is
  reversed), the class cap, whether the classes are Manual, and its
  classes. Each class has a value, a color, a label, a visibility flag and
  a feature count, plus the "Other" and "No value" classes when present.
- **Graduated renderer**: the numeric column, the method (equal interval,
  quantile, natural breaks or manual), the class count, the ramp (and
  whether it is reversed), and its classes. Each class has a lower bound
  (the next class's lower bound is its upper bound), a color, a label, a
  visibility flag and a feature count, plus a "No value" class when
  present.
- **Color ramp**: a named, fixed sequence of colors of one kind
  (sequential, diverging or qualitative) with a preview.
- **Legend**: the visible list of classes for the current style and data.
- **Style notice**: a list of items not exported, not imported, or not
  applied (e.g. a missing column), shown to the user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a ~10 MB file (about 22,000 features), applying or changing
  a categorized or graduated style updates the map and the legend within 1
  second.
- **SC-002**: For a reference data set, the computed breaks match published
  reference values for all three methods in 100% of cases (equal interval
  and quantile exactly; natural breaks matching a reference Jenks
  implementation).
- **SC-003**: A saved categorized or graduated style reopens with identical
  classes and colors in both shells and in QGIS, in 100% of the test styles.
- **SC-004**: Exporting to each of the three formats and importing back
  preserves classes, values or breaks, and colors in 100% of the test
  styles. Every loss is listed in a notice (zero silent losses).
- **SC-005**: A first-time user can color a layer by a column and read its
  legend within 1 minute, without documentation.
- **SC-006**: The legend matches the map, with the same classes, colors and
  counts, after every style change, query result and Reset in the test set.
- **SC-007**: Applying a thematic style to a 50,000-row result neither
  crashes nor freezes the viewer. The previous style stays visible until the
  new one is drawn.

## Assumptions

- **Class cap for Categorized** defaults to 12 classes plus "Other". This
  keeps the qualitative palettes distinguishable and the legend short.
- **Graduated styling varies color only.** Size by value (proportional
  symbols) is not part of this spec. On import, it is reported in the
  notice (FR-015).
- **Methods and class counts.** Equal interval, quantile, natural breaks and
  manual, with 2–10 classes and a default of 5. Standard deviation, pretty
  breaks, geometric and logarithmic scales are not included.
- **Categories are ordered most frequent first** (ties alphabetical), so
  the class cap keeps the most common values. The order can be changed in
  the legend by editing (FR-009), not by drag-reordering.
- **GeoLibre was the design reference** (decisions only, no code). Adopted:
  per-class editing that switches to Manual, lower-bound breaks with
  flat-color classes (GeoLibre fixed a map/legend mismatch caused by
  blending), and a method caption in the legend. Improved on: a real "No
  value" class (GeoLibre paints nulls in the first class's color), an
  "Other" class with a legend row (GeoLibre shows unmatched values in the
  flat color without one), counts in the legend, reversible ramps, a
  visibility toggle that affects the map, and live updates instead of an
  "Apply" button.
- **Ramps are a curated, fixed set** of commonly used, colorblind-aware
  sequential, diverging and qualitative ramps, chosen during planning.
  User-defined ramps are out of scope.
- **One displayed layer**, as in specs 001 and 002. Multiple layers and
  layer ordering are out of scope.
- **Columns are matched by name** across query results. A renamed column is
  treated as missing.
- **Imported thematic styles keep their fixed classes** when the format
  stores only breaks or values, not the method. The style is then shown as
  having fixed classes until the user re-chooses a method.
- **The legend** sits on the map, is collapsible, and remembers whether it
  is collapsed in the same place as other viewer preferences.
- **Out of scope**: labels and annotations, rule-based or expression
  styling, heatmaps and clustering, per-feature manual styling, multiple
  layers and layer ordering, raster styling, and exporting data files
  (spec 005).
- **Dependencies**: the single-symbol style, sidecar and interchange from
  spec 001, and the query result, Reset and history from spec 002.
