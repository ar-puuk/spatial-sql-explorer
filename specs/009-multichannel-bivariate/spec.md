# Feature Specification: Multi-Channel Styling and Bivariate Maps

**Feature Branch**: `009-multichannel-bivariate`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Multi-channel thematic styling and bivariate maps. (1) Style a layer by several things at once: a color channel (single, categorized, or graduated, as today) plus an optional, independent size channel — line width for lines, marker size for points — driven by its own numeric column (the same column or a different one). The size channel is classed by default (2–10 steps, equal interval / quantile / natural breaks / manual, like graduated colors) with a "Proportional" option that scales size smoothly between a minimum and maximum. This replaces the current Graduated "Vary: Color | Size" switch; existing styles that vary size must keep working. Polygons have no size channel. Legend shows both channels (color classes and size classes as separate legend groups). (2) Bivariate choropleth: two numeric columns, each split into 3 classes (quantile by default, equal interval / natural breaks optional per axis), colored from a 3x3 grid chosen from a few curated bivariate palettes; the legend is a 3x3 square with axis labels; cells can be hidden like classes. Works for polygons, lines and points. Large results classify in the engine as today. Style files: QGIS QML (QGIS 4.2.3 has no bivariate renderer: a rule-based renderer with one rule per cell, reloadable here as bivariate; color + size as a categorized/graduated renderer with a data-defined size), OGC SLD and Mapbox GL style JSON, with notices for anything a format can't hold. Scope: still only STYLE; no new renderers beyond these (no heatmap, clustering, rule-based editing)."

## Clarifications

### Session 2026-10-12

- Q: Is the size channel stepped or continuous? → A: Both. Classed
  (stepped) by default, with a "Proportional" option for smooth scaling.
- Q: Which bivariate grids? → A: 3×3 only, with a few curated palettes.
- Q: Process? → A: This spec first, then plan and tasks. Build in two
  slices: channels (US1–US3), then bivariate (US4–US6).

## Context

Spec 003 colors features by one column: categorized or graduated. A change
made after spec 008 (2026-10-12) added marker shapes, line patterns and a
Graduated "Vary: Color | Size" switch. That switch varies size *or* color,
never both, and only by the one styled column. Analysts often need two
variables on one map. Two common cases:

- a road network colored by road class and drawn wider with more traffic;
- a county map showing two rates at once: a bivariate choropleth, read
  from a 3×3 color square.

QGIS has no bivariate renderer (checked in QGIS 4.2.3), so users today
build one by hand from nine rules. This spec adds both cases to the STYLE
pillar.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Color by one column, width by another (Priority: P1)

A transportation planner opens a road network. They categorize the roads by
`functional_class`, then turn on **Size by** and pick `aadt` (daily traffic).
Each road keeps its class color and is drawn wider the more traffic it
carries. The legend shows two groups: the class colors, and the widths with
their traffic ranges.

**Why this priority**: two variables on one line or point layer is the most
requested map that the current one-column styling can't draw, and it builds
directly on the existing renderers.

**Independent Test**: open a line layer with a text column and a numeric
column, categorize by the text column, add a size channel on the numeric
column, and confirm colors follow the categories while widths follow the
numeric classes, with both shown in the legend.

**Acceptance Scenarios**:

1. **Given** a line layer categorized by a text column, **When** the user
   turns on Size by a numeric column, **Then** every line keeps its category
   color and gets the width of its size class, and the legend lists the
   color classes and the size classes as two separate groups.
2. **Given** a point layer graduated by color on column A, **When** the user
   adds Size by column B, **Then** markers are colored by A's classes and
   sized by B's classes, independently.
3. **Given** a size channel, **When** the user picks the same column as the
   color channel, **Then** both channels classify that column independently
   (each with its own method and class count).
4. **Given** a size channel, **When** the user changes its method (equal
   interval, quantile, natural breaks), class count (2–10), or smallest and
   largest size, **Then** the map and legend update live, with no Apply step.
5. **Given** a size channel, **When** the user turns Size by off, **Then**
   every feature returns to the layer's single size or width, and the color
   channel is unchanged.
6. **Given** a polygon layer, **When** the user opens the style controls,
   **Then** no size channel is offered, and the controls say that polygons
   have no size.

---

### User Story 2 - Proportional sizes (Priority: P2)

An analyst mapping transit ridership wants marker sizes that follow the
numbers smoothly, not in steps. They switch the size channel from Classed to
Proportional. Markers then scale continuously between the smallest and
largest size, and the legend shows a few reference sizes with their values.

**Why this priority**: proportional symbols are the standard way to map
counts and flows. Classed sizes cover most needs, so this follows.

**Independent Test**: on a point layer with a numeric column, set the size
channel to Proportional and confirm that a feature with a value halfway
between the minimum and maximum is drawn at the halfway size, with
reference sizes in the legend.

**Acceptance Scenarios**:

1. **Given** a Proportional size channel, **When** the map draws, **Then**
   the feature with the lowest value gets the smallest size, the feature with
   the highest value gets the largest, and the others scale smoothly between
   them, by width for lines and, for point markers, by QGIS's size
   assistant "Area" scale (radius = smallest + (largest − smallest) × √t,
   t the value's place between the minimum and maximum).
2. **Given** a Proportional size channel, **When** the legend shows, **Then**
   it lists 3 to 5 reference sizes labeled with the values they stand for.
3. **Given** a feature with no value in the size column, **When** the map
   draws, **Then** it is drawn at the layer's single size and counted under
   "No value" in the size legend group.

---

### User Story 3 - Existing size styles keep working (Priority: P1)

A user saved a style with the earlier Graduated "Vary: Size" switch. When
they reopen the data, the map looks the same, and the style controls show it
as a single color with a classed size channel on the same column.

**Why this priority**: saved styles must never silently change. This story
replaces the earlier switch without breaking existing work.

**Independent Test**: open data whose saved style varies size by graduated
classes, and confirm the drawn sizes and legend match the earlier version
exactly, with the controls showing the new size channel.

**Acceptance Scenarios**:

1. **Given** a saved style that varies size by graduated classes, **When**
   it is opened, **Then** each feature is drawn at the same size as before,
   with the same classes, sizes and labels.
2. **Given** that style opened and then saved again, **When** the file is
   read back here or in QGIS, **Then** the sizes are unchanged.

---

### User Story 4 - Bivariate map of two numeric columns (Priority: P1)

A public-health analyst opens a county layer and wants to see where poverty
and obesity rates are both high. They choose **Bivariate**, pick `poverty_rate`
for the first axis and `obesity_rate` for the second, and every county is
colored from a 3×3 color square. The legend is that square, labeled with the
two column names, low to high. Counties high on both stand out in the corner
color.

**Why this priority**: the bivariate choropleth is the user's second
explicit ask. Building one by hand in QGIS takes nine hand-written rules.

**Independent Test**: open a polygon layer with two numeric columns, choose
Bivariate on them, and confirm each feature's color is the cell of its
first-axis class and second-axis class, with a 3×3 legend whose cell counts
add up to the feature count.

**Acceptance Scenarios**:

1. **Given** a layer with two numeric columns, **When** the user chooses
   Bivariate and picks both columns, **Then** each column is split into 3
   classes (quantile by default), every feature takes the color of its cell
   (column 1 class × column 2 class), and the legend shows a 3×3 square
   labeled with both column names and a low-to-high direction on each axis.
2. **Given** a bivariate style, **When** the user changes either axis's
   method (quantile, equal interval, natural breaks), **Then** only that
   axis is reclassified, and the map and legend update live.
3. **Given** a bivariate style, **When** the user picks another curated
   palette or swaps the two axes, **Then** the colors update and the map,
   legend and axis labels stay consistent.
4. **Given** the bivariate legend, **When** the user points at or focuses a
   cell, **Then** it shows the two value ranges and the feature count for
   that cell.
5. **Given** the bivariate legend, **When** the user activates a cell,
   **Then** that cell's features are hidden on the map (the cell is shown
   hollow), and activating it again shows them.
6. **Given** features with no value in either column, **When** the map
   draws, **Then** they are drawn in a neutral "No value" color, listed
   under the square with their count, and can be hidden like any class.
7. **Given** a point or line layer, **When** the user chooses Bivariate,
   **Then** markers or lines are colored from the square the same way.

---

### User Story 5 - Save, reopen and exchange the new styles (Priority: P2)

A user saves a two-channel or bivariate style next to the data. It reopens
automatically here. Opened in QGIS, it draws the same map: a two-channel
style as QGIS's own renderer with a data-driven size, a bivariate style as
one rule per cell. Exported to SLD or Mapbox GL style, it keeps as much as
the format holds, and the user is told what was left out.

**Why this priority**: styles that can't be saved or shared would make the
feature a dead end. Exchanging styles with QGIS is part of the product's
promise.

**Independent Test**: save a two-channel style and a bivariate style, reopen
both here and in QGIS, and export and re-import each format, comparing what
is drawn.

**Acceptance Scenarios**:

1. **Given** a two-channel style, **When** it is saved as the QGIS sidecar
   and opened in QGIS, **Then** QGIS draws the same color classes and the
   same sizes, and reopening it here restores both channels.
2. **Given** a bivariate style, **When** it is saved as the QGIS sidecar and
   opened in QGIS, **Then** QGIS draws the same nine cell colors (and the
   "No value" color), and reopening it here restores it as bivariate, with
   its columns, methods and palette.
3. **Given** a QGIS rule-based style not written by this product, **When**
   it is imported, **Then** it is handled as today (first symbol only, with a
   notice). Only this product's own bivariate files reload as bivariate.
4. **Given** any of the new styles, **When** it is exported to a format that
   can't hold part of it, **Then** a notice lists what was left out or
   approximated before the user saves (e.g. proportional sizes written as
   steps, hidden cells left out).

---

### User Story 6 - The map image shows the new legends (Priority: P3)

A user saves the map as an image to put in a report. The image's legend shows
the same groups as the on-map legend: the color classes and the size classes,
or the bivariate square with its axis labels.

**Why this priority**: a bivariate map without its square legend can't be
read. It matters, but it builds on the map image feature that already exists.

**Independent Test**: save the map image for a two-channel style and for a
bivariate style, and check that each image contains the matching legend.

**Acceptance Scenarios**:

1. **Given** a two-channel style, **When** the map image is saved, **Then**
   its legend shows the color group and the size group.
2. **Given** a bivariate style, **When** the map image is saved, **Then**
   its legend shows the 3×3 square with both axis labels, and leaves out
   hidden cells' features from the map as on screen.

### Edge Cases

- **Size column with all equal values**: every feature gets one size, and
  the controls say the range can't be divided (as graduated colors do).
- **Bivariate column with fewer than 3 distinct values**: that axis gets as
  many classes as it has distinct values. The square shrinks to match
  (e.g. 2×3), and a note says why.
- **Bivariate on the same column twice**: refused, with a message asking
  for two different columns.
- **Styled column missing after a query**: the existing graceful fallback
  applies per channel. A missing size column turns the size channel off
  with a notice and keeps the color channel. A missing bivariate column
  falls back to the single symbol with a notice, as categorized and
  graduated styles do.
- **Size channel on a mixed-geometry layer**: markers and lines are sized;
  polygons in the same layer are not. Known limit (spec 007, not this
  spec): a mixed layer draws its points as small dots, because the viewer
  can't tell them from the dots that stand in for tiny polygons. So the
  size channel shows on its lines only, until that limit is fixed.
- **Hidden classes in both channels**: a feature is hidden if its class is
  hidden in either channel.
- **Very large size range**: sizes are limited to the same bounds as the
  single size and width controls, and a setting outside them is refused
  with a message.
- **Proportional with negative or zero values**: lines and markers start
  at the smallest size at the minimum value, whatever its sign. Areas never
  go below the smallest size.
- **Tiled (pre-rendered) layers**: as today, thematic styling is not
  available for them, and the controls say why.

## Requirements *(mandatory)*

### Functional Requirements

**Channels**

- **FR-001**: A style MUST consist of a color channel (single color,
  categorized, graduated, or bivariate) and, for point and line layers, an
  optional size channel. Each channel is configured independently.
- **FR-002**: The size channel MUST be driven by one numeric column of the
  displayed result, chosen independently of the color channel's column(s).
  It sets marker size for points and line width for lines.
- **FR-003**: The size channel MUST offer Classed mode (default): 2–10
  classes by equal interval, quantile or natural breaks, plus manual bounds
  that fix the classes (as graduated colors do). Class sizes run evenly from
  a smallest to a largest size the user sets.
- **FR-004**: The size channel MUST offer Proportional mode: sizes scale
  continuously from the smallest size at the column's minimum value to the
  largest size at its maximum. Line widths scale linearly with the value;
  point markers follow QGIS's size assistant "Area" scale (radius =
  smallest + (largest − smallest) × √t, t the value's place in the range),
  so a style reopened in QGIS draws the same sizes.
- **FR-005**: Features with no value in the size column MUST be drawn at
  the layer's single size or width and counted as "No value" in the size
  legend group.
- **FR-006**: The size channel MUST NOT be offered for polygon layers. On
  mixed-geometry layers it applies to points and lines only.
- **FR-007**: The size channel MUST be available with single, categorized and
  graduated colors. It MUST NOT be combined with bivariate colors (three
  variables on one symbol can't be read; the controls say so).
- **FR-008**: Size classes MUST support the per-class edits graduated
  colors have (label, visibility, bounds). A feature hidden by either
  channel MUST be hidden on the map.
- **FR-009**: Styles saved with the earlier Graduated "Vary: Size" setting
  MUST open as a single color with a classed size channel on the same
  column, with the same method, classes, sizes and labels, and draw
  identically.

**Bivariate**

- **FR-010**: The color channel MUST offer Bivariate: two different numeric
  columns, each split into 3 classes. The method defaults to quantile, and
  equal interval or natural breaks can be chosen per axis. Each feature is
  colored by the cell of its two classes in a 3×3 palette.
- **FR-011**: The user MUST be able to choose among at least 4 curated 3×3
  bivariate palettes, shown as previews, and swap the two axes.
- **FR-012**: Features with no value in either column MUST be drawn in a
  fixed neutral "No value" color, shown under the legend square with their
  count.
- **FR-013**: Each cell and the "No value" class MUST be hideable from the
  legend and the style controls, hiding those features on the map.
- **FR-014**: The bivariate legend MUST be a square of cells in the palette's
  colors, with each axis labeled by its column name and a low-to-high
  direction. Each cell's value ranges and feature count MUST be available on
  hover and to assistive technology.
- **FR-015**: When an axis has fewer than 3 distinct values, that axis MUST
  get one class per distinct value, and the square MUST shrink to match,
  with a note.

**Classification, legend and scale**

- **FR-016**: All new classifications (size classes, proportional range,
  bivariate axes and cell counts) MUST be computed over the whole displayed
  result, as today's thematic styles are, including results too large to
  hold in memory.
- **FR-017**: The legend MUST show one group per active channel: the color
  classes (or the bivariate square) and the size classes or reference sizes.
  Each group has its own title (the column and method). The legend MUST
  draw sizes in proportion to each other.
- **FR-018**: Every new control MUST be keyboard-operable and labeled, and
  the bivariate square MUST be navigable by arrow keys, one cell at a time.
- **FR-019**: Data colors (bivariate palettes, the "No value" color) MUST be
  fixed and theme-independent. The controls and legend chrome follow the
  theme.
- **FR-020**: All edits MUST apply live, with no Apply step, as in the
  existing style controls.

**Persistence and exchange**

- **FR-021**: The new styles MUST be saved in and restored from the existing
  QGIS QML sidecar, losing nothing when they reopen here.
- **FR-022**: A two-channel style MUST be written to QML so that QGIS draws
  the same colors and sizes with its own categorized, graduated or single
  renderer and a data-driven size.
- **FR-023**: A bivariate style MUST be written to QML as QGIS's rule-based
  renderer with one rule per visible cell and one for "No value", so QGIS
  draws the same map. Reopened here, it MUST restore as bivariate.
- **FR-024**: OGC SLD and Mapbox GL style export and import MUST carry the
  new styles where the format allows. Anything that is left out or
  approximated (proportional sizes written as steps, hidden cells, the
  bivariate palette identity) MUST be listed in a notice before saving.
- **FR-025**: Importing a style file this product didn't write MUST keep
  today's behavior and notices. No foreign rule-based style is reinterpreted
  as bivariate.
- **FR-026**: The map image legend MUST include the size group and the
  bivariate square with axis labels, matching the on-map legend.

### Key Entities

- **Color channel**: how features are colored: one color, categorized by a
  column, graduated by a numeric column, or bivariate by two numeric
  columns.
- **Size channel**: optional, for points and lines. A numeric column, a mode
  (classed or proportional), a method and class count (classed), and the
  smallest and largest size. Classes carry the same per-class overrides as
  color classes (label, visibility, bounds).
- **Bivariate axis**: one numeric column, its classification method, and its
  (up to) 3 classes with value ranges.
- **Bivariate palette**: a named, fixed 3×3 grid of colors (with its
  smaller-grid forms for axes with fewer values), plus the "No value" color.
- **Legend group**: one channel's legend: a title, then either a list of
  classes (color or size) or the bivariate square.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can add a size channel to a categorized or graduated
  style in 3 interactions or fewer from an open style panel.
- **SC-002**: A user can build a bivariate map of two columns in 4
  interactions or fewer from an open style panel.
- **SC-003**: For every feature drawn, its color and size match the legend
  classes it is counted in: zero mismatches on a 10,000-feature test layer (checked with the map's own
  expression evaluator),
  for both channels and for every bivariate cell.
- **SC-004**: Bivariate cell counts in the legend add up exactly to the
  number of features in the displayed result (including "No value").
- **SC-005**: A two-channel style and a bivariate style saved here, opened
  in QGIS 4.2.3, draw the same colors and sizes for 100% of the test
  features, and reopen here unchanged.
- **SC-006**: Every style saved before this feature reopens with identical
  drawn sizes and colors (no visual change on the existing test files).
- **SC-007**: On a result of 1 million rows, classifying both channels or
  both bivariate axes takes no more than twice as long as classifying one
  graduated column does today.

## Assumptions

- Bivariate is 3×3 only (user decision). Axes with fewer distinct values
  get smaller squares (FR-015). Other grid sizes are out of scope.
- Bivariate cells have no per-cell color edits: the palette sets the colors,
  and cells can only be hidden. Axis bounds are not edited by hand in this
  spec; each axis's method sets them.
- Bivariate palettes are a small curated set of established cartographic
  3×3 schemes, chosen in the plan and fixed (data colors are
  theme-independent).
- Proportional point markers use QGIS's "Area" scale (by area, starting
  from the smallest size; research §3). Lines scale linearly by width.
  These defaults are not user-configurable in this spec.
- The size legend draws size samples in the single symbol's color. In a
  two-channel legend, color swatches are drawn at one size.
- Marker shape, line pattern and the other single-symbol settings stay layer
  settings and apply to every class of both channels.
- "No value" in the size channel means null, empty or non-numeric, the same
  rules graduated colors use today.
- Out of scope: more than one size channel, opacity or other channels by
  data, more than two bivariate variables, trivariate maps, rule-based or
  expression style editing, heatmaps, clustering, and labels.
