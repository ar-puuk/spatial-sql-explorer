# Feature Specification: Style by Channels, and Labels

**Feature Branch**: `011-style-channels`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "Redesign styling around channels: a 'Draw as' choice
(Markers, Heatmap, Lines, Fills, 3D) and per-property channels, each Fixed or By column
through a scale. Markers: color, outline color, size, shape, opacity, rotation. Lines:
color, width, pattern, opacity. Polygons: color, outline color, outline width, opacity,
plus height in 3D. Scales shared by every channel where they make sense. 'Style type'
is replaced by channels; the dropdown keeps Draw as and recipes. Legend: one group per
varying channel, merged when they share a column and breaks. Lossless migration. QML,
SLD and Mapbox files. Labels are in scope: a separate button in the side panel to turn
labels on and adjust them." Research and design: [proposal.md](./proposal.md).

## Clarifications

### Session 2026-10-13

- Q: Do channels replace the style type, or sit under it as "vary by attribute"?
  → A: First answer: channels replace it (proposal §7.1). **Revised by the user
  after seeing it built (2026-10-13): keep the style type and the Appearance
  section, and add a "Vary by attribute" section under them** (the proposal's
  ArcGIS-like alternative). "Draw as" and recipes are dropped. The storage model
  (channels) stays as built; only the panel changes.
- Q: Why does Single have Vary by attribute? → A: The style type sets only the
  color; Vary by attribute sets the other properties. To say so, the style type's
  heading is **Color** and "Single" is **Single color** (user decision,
  2026-10-13). Merged legend groups (US5) stay in scope.
- Q: Rules: a scale on any channel, or one rule sets the whole symbol? → A: A scale
  on any channel (proposal §7.2).
- Q: Which channels? → A: Markers: color, outline color, size, shape, opacity,
  rotation (plus outline width, added in analysis to match QGIS and the fixed
  settings). Lines: color, width, pattern, opacity. Polygons: color, outline color,
  outline width, opacity, plus height when drawn in 3D.
- Q: Labels? → A: In scope. Labels get their own button on the side panel's rail,
  where the user turns them on and adjusts them.
- Q: Process? → A: Full spec cycle on its own branch.

## Context

Today a layer has one *style type* (Single, Categorized, Graduated, Bivariate,
Rules or Heatmap), and that type only sets color. Spec 009 added a separate
"Size by"; spec 008 added a separate 3D height. Every other property (shape,
pattern, opacity, outline) is one fixed value for the whole layer.

Analysts often encode several variables at once:
- a road network colored by level of service and drawn wider with more traffic;
- crash points colored by severity and shaped by crash type;
- stations sized by ridership and faded by data age;
- wind arrows rotated by direction.

Tools that make this easy, such as ggplot2, Tableau and Kepler.gl, treat every
visual property the same way: a fixed value, or a column through a scale. This
spec adopts that model for the STYLE pillar, and adds labels, which the product
has never had.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - More properties, each by its own column (Priority: P1)

A transportation planner opens a road network. In the style panel:
- they choose the style type **Categorized** by `los`;
- under **Vary by attribute**, they choose **Add… → Width** and pick `volume`.

Each road's color follows its level of service and its width follows its
traffic. Then they open a crash point layer:
- Categorized by `severity`;
- Add… → **Shape** by `crash_type`.

Each point gets its severity's color and its type's shape, independently.

**Why this priority**: two or more variables on one map is the central reason
for this spec, and it must work the same way for every property.

**Independent Test**: on a line layer, categorize by a text column and add Width
by a numeric column. On a point layer, categorize by one column and add Shape
and Size by two others. Check that each feature's color, width, shape and size
each follow their own column.

**Acceptance Scenarios**:

1. **Given** a point layer, **When** the user opens Add… under Vary by
   attribute, **Then** it offers Outline color, Outline width, Size, Shape,
   Opacity and Rotation.
2. **Given** a line layer, **When** the user opens Add…, **Then** it offers
   Width, Pattern and Opacity.
3. **Given** a polygon layer, **When** the user opens Add…, **Then** it offers
   Outline color, Outline width and Opacity (no size).
4. **Given** any property, **When** the user adds it, **Then** it starts on a
   suitable column with a sensible default scale, the map applies it, and the
   legend shows the property's group. There is no Apply step.
5. **Given** three properties varying by three different columns, **When** the
   user changes one property's column or scale, **Then** only that property
   changes on the map; the other two are untouched.
6. **Given** a varying property, **When** the user removes it, **Then** every
   feature returns to its Appearance setting, and adding it again in the same
   session brings back its column and scale.
7. **Given** the style type and Appearance section, **When** the panel opens,
   **Then** they look and work as before (Single, Categorized, Graduated,
   Bivariate, Rules, Heatmap; fill, outline, width, shape, pattern, point size;
   3D).

---

### User Story 2 - Existing styles keep working (Priority: P1)

A user reopens files styled with an earlier version:
- a categorized, graduated, bivariate, rules or heatmap style;
- a style with Size by, 3D height, a marker shape or a line pattern;
- a QML sidecar saved by an earlier version.

Each one looks exactly as it did before, and the new panel shows it as the
equivalent properties.

**Why this priority**: styles are saved in sidecars next to users' data and in
saved state. A redesign that changes how old maps look breaks trust.

**Independent Test**: load every style saved by the previous version (the
existing test fixtures and sidecars). Compare the map's drawing, legend and
re-saved files against the previous version.

**Acceptance Scenarios**:

1. **Given** a style saved by the previous version, **When** it is loaded,
   **Then** every feature has the same color, size or width, shape, pattern,
   opacity and height as before, and the legend shows the same classes and labels.
2. **Given** a previous Categorized style, **When** the panel opens, **Then**
   the style type is Categorized, with the same values, colors, Other and No
   value settings.
3. **Given** a previous style with Size by, **When** the panel opens, **Then**
   Vary by attribute shows Size (points) or Width (lines) with its column, mode,
   classes and sizes.
4. **Given** a previous 3D style, **When** the panel opens, **Then** the 3D
   section is on, with its column and scaling.
5. **Given** a previous style, **When** it is saved again without edits, **Then**
   QGIS reads the new QML file and shows the same map as it did from the old file.

---

### User Story 3 - (Withdrawn: Draw as and recipes)

Withdrawn by the user's revision of 2026-10-13 (Clarifications). The style
type keeps choosing the color style and the heatmap, and the 3D section keeps
choosing 3D, as before this spec.

---

### User Story 4 - The same scales for every property (Priority: P2)

Each property set by a column chooses how values become visuals. The same
choices apply wherever they make sense:
- **Categories**: one value per distinct value;
- **Classes**: equal interval, quantile, natural breaks or manual;
- **Continuous**: smooth, unclassed;
- **Conditions**: SQL rules, the first match wins;
- **As is**: the column already holds the output, such as `#hex` colors,
  degrees or meters;
- **Bivariate**: two numeric columns, color only.

This brings new maps:
- unclassed color;
- width by road class;
- shape by category;
- opacity by a number;
- rotation by direction;
- colors stored in a column.

**Why this priority**: it makes the properties consistent and opens the new maps,
but US1 is useful with the scales that exist today.

**Independent Test**: for each property, open its scale choices and confirm the
offered set matches the table in FR-010. For each new combination, check the map
against values computed independently.

**Acceptance Scenarios**:

1. **Given** Color set by a numeric column, **When** the user picks Continuous,
   **Then** features get colors along the color ramp in proportion to their value,
   and the legend shows a gradient bar with the minimum and maximum.
2. **Given** Width set by a text column, **When** the scale is Categories,
   **Then** each value gets its own width, which the user can edit, and Other and
   No value get their own widths.
3. **Given** Shape set by a text column, **When** the column has more distinct
   values than there are shapes, **Then** the most common values get distinct
   shapes, the rest fall into Other, and the panel says so in one line.
4. **Given** any property, **When** the user picks Conditions, **Then** they write
   SQL conditions over the layer's columns, each with an output value, and each
   feature takes the output of the first condition it meets, or the fallback.
5. **Given** Rotation set by a numeric column As is, **When** the map draws,
   **Then** each marker is turned clockwise by that many degrees from north.
6. **Given** Color set by a text column As is, **When** a value is not a
   valid color, **Then** that feature uses the fixed color, and the panel notes how
   many features fell back.
7. **Given** Opacity set by a number with Continuous, **When** the map draws,
   **Then** each feature's opacity runs from the chosen minimum to the maximum,
   multiplied by the layer's overall opacity.

---

### User Story 5 - A legend group per property (Priority: P2)

The legend shows one group for each property set by a column, titled with its
column name. Properties left Fixed don't appear. When two properties use the same
column with the same breaks (for example Color and Size both classed by `pop`),
they merge into one group: each entry shows the color and the size together.

**Why this priority**: a map with several variables is only readable if each
variable has a clear key.

**Independent Test**: set two properties by different columns, then by the same
column and breaks, then by the same column with different breaks. Check the
legend's groups, titles, entries and merging in each case.

**Acceptance Scenarios**:

1. **Given** Color by `los` and Width by `volume`, **When** the legend shows,
   **Then** it has two groups: `los` with colored swatches, and `volume` with line
   samples of increasing width.
2. **Given** Color and Size both classed by `pop` with the same breaks, **When**
   the legend shows, **Then** it has one `pop` group whose entries are colored
   and sized.
3. **Given** a continuous scale, **When** the legend shows, **Then** color appears
   as a gradient bar, and size or width as three samples (minimum, middle and
   maximum) with their values.
4. **Given** a legend group, **When** the user hides it from the legend, **Then**
   the map is unchanged and the group no longer appears in the legend or the
   saved map image.
5. **Given** a class or category in any group, **When** the user toggles it off in
   the legend, **Then** the features in it are hidden from the map, as for colors
   today.

---

### User Story 6 - Labels (Priority: P2)

A user turns on labels from a **Labels** button on the side panel's rail, next to
Style. They pick a column or a SQL expression for the text, and adjust:
- font size and text color;
- a halo (an outline around the text) and its color;
- placement:
  - points: above, below, left, right or centered;
  - lines: along the line;
  - polygons: inside.

Labels never pile up on top of each other. Where they would collide, some are left
out.

**Why this priority**: labels are basic map reading, and a quick look without them
often means opening QGIS.

**Independent Test**: turn labels on for a point layer, a line layer and a polygon
layer. Change each setting, and check the text, size, color, halo and placement on
the map, then in the saved style files read back by QGIS.

**Acceptance Scenarios**:

1. **Given** a layer, **When** the user opens Labels and turns them on with a
   column, **Then** each feature with a value shows that value as text on the map.
2. **Given** labels by an expression (for example `name || ' (' || lanes || ')'`),
   **When** the expression is valid, **Then** each label shows its result. When it
   is invalid, **Then** the error shows next to the expression and the previous
   labels stay.
3. **Given** labels on, **When** two labels would overlap, **Then** only one
   is drawn; the others reappear when zooming in gives them room.
4. **Given** a line layer with labels, **When** the map draws, **Then** each label
   follows its line's direction and is never upside down.
5. **Given** labels on, **When** the user hides a class in the legend, **Then**
   the hidden features lose their labels too.
6. **Given** labels on, **When** the user changes the basemap or the theme,
   **Then** the labels keep their settings and remain readable through their halo.
7. **Given** the Labels panel, **When** used by keyboard alone, **Then** every
   setting is reachable and labeled.

---

### User Story 7 - Save, reopen and exchange (Priority: P2)

Every new property, scale and label setting is saved:
- in the style sidecar;
- in saved state;
- in QGIS QML, OGC SLD and Mapbox GL style files.

Each file gives the closest equivalent it supports, and says in a note what it
couldn't keep.

**Why this priority**: STYLE is only finished when a style can leave the app,
above all to QGIS.

**Independent Test**: for each property and scale, and for labels, export the
three formats. Read the QML in QGIS and compare its drawing per feature. Re-import
each file into the app.

**Acceptance Scenarios**:

1. **Given** a style with several properties by column, **When** it is saved as
   QML and opened in QGIS, **Then** every feature has the same color, outline,
   size or width, shape, pattern, opacity and rotation as in the app.
2. **Given** a QML saved by the app, **When** it is imported back, **Then** the
   style is identical.
3. **Given** a style with two properties classed or categorized by data,
   **When** it is saved as SLD, **Then** the file draws every combination
   correctly up to a stated rule limit. Beyond that, a note says what was
   simplified.
4. **Given** a style with labels, **When** it is exported, **Then** QML and SLD
   carry the label text, size, color, halo and placement QGIS and SLD support,
   and Mapbox GL carries them as a label layer.
5. **Given** a QML from QGIS with data-defined properties of the simple kinds
   (a field, a linear scale, a simple CASE expression), **When** it is imported,
   **Then** those properties become By column properties. Other expressions keep
   the fixed value and produce a note.

---

### User Story 8 - Map image (Priority: P3)

The saved map image includes the labels and the full legend, with every
property's group, merged groups, gradient bars and size samples.

**Why this priority**: the image is how maps leave the app for reports; it follows
once the legend and labels exist.

**Independent Test**: save a map image of a layer with three properties by column
and labels on. Check its legend groups and labels against the live map.

**Acceptance Scenarios**:

1. **Given** a map with labels and three legend groups, **When** the user saves a
   map image, **Then** the image shows the labels as drawn on the map and all
   three groups.

### Edge Cases

- **A column used by a property disappears** after a new query: that property
  falls back to Fixed with a one-line note. The other properties are unaffected.
- **Mixed-geometry layers** list the properties of every part present. Each
  property applies to the parts it fits:
  - Color: marker fill, line color and polygon fill;
  - Outline color and Outline width: markers and polygons;
  - Size and Rotation: markers;
  - Width: lines;
  - Pattern: lines and polygon outlines;
  - Opacity: all parts.
  (Revised in planning, research §8: one setting per property, as today, not
  one per part.)
- **Heatmap**: while points are drawn as Heatmap, the marker properties are hidden
  and kept. Lines and polygons in a Mixed layer keep their own properties.
- **Properties that don't apply**:
  - Rotation has no visible effect on a circle; the panel says so when the
    shape is a fixed circle.
  - Polygons have no Size.
  - Bivariate is offered for Color only.
- **No values or bad values**: null or empty values use the property's No value
  setting. A value an As-is scale can't read (not a color, not a number) uses the
  fixed value, and a count is noted. On markers of a shape other than circle,
  at most 256 distinct As-is colors are drawn; further colors use the fixed
  color, with a note.
- **Too many values for Categories**: values past the limit for each property
  fall into Other (shapes: 6 values plus Other; patterns: 4 values plus Other;
  other properties: as today for colors).
- **Three or more properties by column**: allowed, with a one-line note that maps
  with many variables are harder to read. This is advice only.
- **Same column, different breaks** (Color in 5 quantiles, Size in 3 equal
  classes): the legend keeps two groups.
- **Labels on very large layers** (drawn from tiles): labels follow what is
  drawn. Turning them on must not reload the layer or block panning.
- **Labels with empty text**: features whose label text is null or empty get
  no label.
- **Labels on the globe and in 3D**: labels stay upright and readable. In 3D
  they are drawn on the ground at each feature's label point, not on top of the
  extrusion (research §3).
- **Opacity**: a feature's opacity is its property value multiplied by the layer's
  overall opacity, never above 1.
- **Conditions referring to missing columns or invalid SQL**: the error shows
  next to that condition. The property keeps its last working state.
- **Files from a newer version**: unknown settings are ignored with a note, never
  an error.

## Requirements *(mandatory)*

### Functional Requirements

**Model and panel**

- **FR-001**: The style panel MUST keep the style type (Single, Categorized,
  Graduated, Bivariate, Rules, Heatmap), the Appearance section and the 3D
  section as they were before this spec.
- **FR-002**: Under them, a **Vary by attribute** section MUST list the
  properties that vary by a column, and an **Add…** menu MUST offer the
  layer's other properties:
  - points: Outline color, Outline width, Size, Shape, Opacity, Rotation;
  - lines: Width, Pattern, Opacity;
  - polygons: Outline color, Outline width, Opacity;
  - Mixed: every part's.
  Color is the style type's; Height is the 3D section's. A property that can't
  be added says why (for example, Size with a bivariate style).
- **FR-003**: A varying property MUST read from a column (or a SQL expression)
  through a scale. Removing it MUST return every feature to its Appearance
  setting.
- **FR-004**: Changing one property MUST NOT change any other property. Every
  change MUST show on the map and legend without an Apply step.
- **FR-005**: With three or more variables on the map (the style type's color
  counted), the section MUST show a one-line note that such maps are harder to
  read. Advice only.
- **FR-006**: (Withdrawn: recipes.)
- **FR-007**: A property removed and added again in the same session MUST come
  back with its column and scale.
- **FR-008**: A property added MUST start with a default scale suited to the
  column's type and the property: categories for text, classes for numbers.

**Scales**

- **FR-009**: The scales MUST be:
  - Categories: per distinct value, plus Other and No value;
  - Classes: equal interval, quantile, natural breaks or manual, 2–10 classes;
  - Continuous: from the column's minimum to maximum. Color uses a ramp; sizes
    and widths use a minimum and maximum with a linear or by-area curve;
  - Conditions: ordered SQL conditions, the first match wins, then a fallback;
  - As is: the value is the output;
  - Bivariate: two numeric columns on a 3×3 grid.
- **FR-010**: Each property MUST offer exactly these scales:

  | Property | Categories | Classes | Continuous | Conditions | As is | Bivariate |
  |---|---|---|---|---|---|---|
  | Color, Outline color | yes | yes | yes | yes | yes (colors) | Color only |
  | Size, Width, Outline width | yes | yes | yes | yes | yes (pixels) | — |
  | Shape, Pattern | yes | — | — | yes | — | — |
  | Opacity | yes | yes | yes | yes | yes (0–1) | — |
  | Rotation | — | yes | yes | yes | yes (degrees) | — |
  | Height | yes | yes | yes | yes | yes (meters) | — |

- **FR-011**: Every scale's outputs MUST be editable where they apply:
  - colors per class or category, or the ramp;
  - sizes, widths, opacities or shapes per class or category;
  - minimum and maximum for Continuous.
- **FR-012**: Categories and classes MUST be computed over the whole
  result, not just the features in view. Results MUST be reused while the column,
  the method and the data don't change.
- **FR-013**: Shape by categories MUST use the 7 existing marker shapes: 6 values
  get their own shape and Other takes the seventh. Pattern uses the 5 existing
  line patterns: 4 values plus Other. Further values fall into Other, with a
  note.

**Legend**

- **FR-014**: The legend MUST show one group per property set by a column, titled
  with its column name or expression, in the panel's property order.
- **FR-015**: Groups for properties using the same column with identical breaks
  or categories MUST merge into one group, each entry showing all of the merged
  properties.
- **FR-016**: Continuous color MUST show a gradient bar with its minimum and
  maximum. Continuous size, width or opacity MUST show three samples with values.
- **FR-017**: The user MUST be able to hide a group from the legend without
  changing the map. Toggling a class or category off MUST hide its features, as
  it does today for colors.

**Labels**

- **FR-018**: The side panel's rail MUST have a **Labels** button. It opens the
  label settings for the current layer.
- **FR-019**: Labels MUST be off by default. When on, the text comes from a column
  or a SQL expression over the layer's columns.
- **FR-020**: The user MUST be able to set:
  - font size;
  - text color;
  - halo on or off, its color and its width;
  - placement:
    - points: above, below, left, right or center, with an offset;
    - lines: along the line;
    - polygons: inside.
- **FR-021**: Labels MUST NOT overlap one another. Where they collide, some are
  omitted for that view.
- **FR-022**: Line labels MUST follow the line and never be upside down.
- **FR-023**: Labels MUST respect features hidden through the legend, and MUST
  work in both drawing modes (in memory and from tiles) without reloading the layer.
- **FR-024**: Label settings MUST be saved with the layer's style.

**Compatibility and files**

- **FR-025**: Styles saved by earlier versions (saved state and sidecars) MUST
  load as their equivalent properties, and draw identically.
- **FR-026**: QML export MUST:
  - write one property set by a column as QGIS's renderer: Color if it varies,
    otherwise the first property in panel order that varies;
  - write every other property as a QGIS data-defined property, so QGIS draws
    each feature the same;
  - write labels as QGIS labeling;
  - carry the full style in a custom property, so the app re-imports it exactly.
- **FR-027**: Mapbox GL style export MUST express every property and labels as
  that format's own data-driven styling.
- **FR-028**: SLD export MUST:
  - write combinations of up to two properties classed or categorized by data as
    one rule per combination, up to a limit of 100 rules;
  - write Continuous scales as classes;
  - when over the limit, or when a property can't be expressed, simplify and add
    a note naming what was simplified;
  - write labels as SLD text symbolizers.
- **FR-029**: QML import MUST read QGIS data-defined properties that are:
  - a field;
  - a linear scale of a field;
  - a simple CASE over a field.
  These become By column properties. Any other expression keeps the fixed value
  and adds a note. QGIS labeling (text field or expression, size, color, buffer,
  placement) MUST be read into label settings.
- **FR-030**: Every export or import that drops or approximates something MUST
  say what, in the existing notes.

**Map image and accessibility**

- **FR-031**: The saved map image MUST include labels and every legend group,
  including merged groups, gradient bars and size samples.
- **FR-032**: Every new control MUST be reachable by keyboard and labeled for
  assistive technology. This includes:
  - the property rows and their Fixed / By column switch;
  - scale choices, legend group toggles, and the Labels panel.
- **FR-033**: New controls MUST follow the host theme (light, dark, high contrast).
  Data colors stay fixed across themes.

### Key Entities

- **Drawing**: how points and polygons are drawn: markers or a heatmap (the
  style type Heatmap), fills or 3D (the 3D section). Stored with the style.
- **Property (channel)**: one visual property of a drawing, such as color, size
  or shape. Either a fixed value or an encoding.
- **Encoding**: a source (column, SQL expression, or two columns for bivariate),
  plus a scale, plus legend options (title, hidden).
- **Scale**: how values become outputs: categories, classes, continuous,
  conditions, as is, or bivariate. Each has its own settings and outputs.
- **Label settings**: on or off; text source (column or expression); font size;
  color; halo (on, color, width); placement and offset.
- **Legend group**: what a reader sees for one property, or several merged ones:
  a title and entries, a gradient, or size samples.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can make the level-of-service and traffic map (color by one
  column, width by another) from a freshly opened layer in under 1 minute: style
  type, its column, Add… → Width, its column.
- **SC-002**: 100% of the styles saved by the previous version in the test suite
  draw identically after the change: per-feature color, size, shape, pattern,
  opacity and height, and the same legend classes and labels.
- **SC-003**: For every property and scale in FR-010, a QML exported by the app
  draws each test feature in QGIS 4.2 with the same values as the app (same check
  as spec 009's size channel parity). Mismatches: 0.
- **SC-004**: Changing any property's setting updates the map and legend within
  1 second on a 100,000-feature layer, and within 200 ms for a fixed value. The
  panel stays responsive under the project's 6× CPU throttle check.
- **SC-005**: Turning labels on, or changing a label setting, never reloads the
  layer. Panning with labels on, over a layer drawn from tiles, stays as smooth
  as without labels, judged by the same frame-time check as spec 010.
- **SC-006**: Each of the four example maps in the Context section can be made
  from a freshly opened layer through the panel alone, with no SQL. A browser
  test proves each one.
- **SC-007**: Every new control passes the existing keyboard-only and
  accessible-name checks, in light, dark and high-contrast themes.

## Assumptions

- **Order of work** follows the proposal's slices (proposal §6):
  1. the property model, with migration and no visible change;
  2. the panel's Vary by attribute section (revised from Draw as and recipes);
  3. the new scales and properties, and the legend;
  4. files;
  5. labels.
  Labels may be built alongside slices 3 and 4, since they are independent.
- **Fixed values per property** are today's Appearance settings. The layer's
  overall opacity stays a separate layer setting.
- **Shapes and patterns** are the existing 7 marker shapes and 5 line
  patterns. No new symbols are added in this spec.
- **Rotation** is measured in degrees clockwise from north. Shapes that look the
  same when turned (circle) are unaffected.
- **Height** for 3D keeps spec 008's behavior (meters, from a column, with its
  existing scaling) as its Continuous and As-is scales. Classes, Categories and
  Conditions are added.
- **Heatmap** keeps its current settings and behavior unchanged. It doesn't take
  properties.
- **Label limits:**
  - one label per feature;
  - one font family (the map's default text font);
  - no curved multi-line wrapping beyond automatic wrapping of long point labels;
  - no label rules or per-class label styles;
  - no callouts or leader lines;
  - no rich text.
- **Label fonts:** labels are drawn with the system's sans-serif font. No font is
  downloaded or bundled, so labels work offline and on every basemap, including
  Blank. (Revised in planning, research §3.)
- **Bivariate** stays 3×3 with its curated palettes (spec 009).
- **Out of scope:**
  - more than one size property;
  - per-class marker images (custom icons);
  - fill patterns or hatches;
  - line offsets for two-way flows;
  - dot density;
  - chart symbols;
  - clustering;
  - label rules.
