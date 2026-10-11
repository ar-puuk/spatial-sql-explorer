# Feature Specification: UX Polish and Legacy Parity

**Feature Branch**: `008-ux-parity`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "UX polish and legacy parity (spec 008). Make Spatial Explorer feature complete and clearly better than the legacy single-page app (tag legacy-v1), in both the web app and the VS Code extension unless noted. Requested by the user: (1) a light/dark theme toggle in the web app, which follows the OS until the user picks one and remembers the choice (VS Code keeps following its own theme); (2) a column chooser drop-down in the attribute table so users pick which columns to show instead of scrolling sideways; the choice persists per file; (3) a much better style panel UI/UX: clearer layout and flow for single, categorized and graduated styles, ramp previews, live legend, an opacity control, and less clutter; (4) style save as ONE split button: the main action saves QML (the sidecar), and a drop-down on the same button offers SLD and Mapbox GL style JSON; (5) a Mercator/Globe projection toggle on the map (globe only, no terrain); (6) 3D polygon extrusion as a style option, with height taken from a numeric column (optionally scaled), with a tilted view; (7) legacy parity and beyond, from the legacy-v1 inventory: per-column filters in the attribute table, row selection, export the map as a PNG image with its legend, a place search (geocoder), sample/demo data to try the app without a file, a legend range filter for graduated styles, resizable panels, and anything else in legacy-v1 that the new app lacks. Out of scope: editing, terrain, 3D tiles, other 3D beyond polygon extrusion and the globe, raster data, multi-file sessions (spec 006). Large-file behavior from spec 007 must keep working (viewport loading, PMTiles view-only)."

## Context

Specs 001–007 rebuilt the four pillars (look, query, style, export) and made
large files first-class. The rebuild is now ahead of the legacy single-page
app (tag `legacy-v1`) on formats, scale, SQL and style interchange, but it
still lacks several things the legacy app had, and some of its own panels
are harder to use than they should be.

What the legacy app had that the rebuild lacks today:

| Legacy feature | Rebuild today |
|---|---|
| Light/dark theme toggle that follows the OS until chosen | Web app follows the OS only |
| Globe projection | Flat map only |
| Per-column filter inputs in the table | Sort only; filtering needs SQL |
| Row checkboxes, multi-select, select all | One selected feature at a time |
| Legend range filter (graduated) | Category toggles only |
| Export the map view as a PNG with the legend | None |
| Share link (query + style in the URL) | None |
| Place search (geocoder) | None |
| Demo data | None |
| Satellite and topographic basemaps | Vector basemaps and Blank only |
| Double-click a panel handle to reset its size | Handles resize only |

Already at parity or better, and kept as they are: resizable panels, SQL
autocomplete, query history, opacity controls, auto-zoom to a result,
category toggles in the legend, CSV/GeoJSON export (plus more formats), and
large-file safety (spec 007 replaced the legacy LIMIT cap).

Not carried over: several files loaded as tables at once (spec 006, multi-file
sessions), and keeping loaded files across reloads (the legacy app copied the
data into browser storage; the rebuild never stores user data).

The user also asked for things the legacy app never had: a column chooser,
a redesigned style panel, a single split button for saving styles, 3D
polygon extrusion, more export formats with a choice to leave geometry out,
proper handling of files that hold several layers (GeoPackage, File
Geodatabase), and fixes such as the map's attribution icon in dark mode.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A style panel that is quick to use (Priority: P1)

A planner opens a county parcels file and wants a choropleth of land value.
They open the style panel, pick "Graduated", pick the value column, and the
map updates right away with a sensible default (method, class count and
ramp). They try two other ramps from previews, nudge the class count, and
see where the class breaks fall on a small chart of the values. They lower
the opacity so the basemap shows through. They press Save, and the style
lands next to the data as a QGIS sidecar. A colleague wants it for a web
map, so they open the arrow on the same Save button and pick Mapbox GL.

**Why this priority**: Styling is the pillar users touch most after
opening a file, and the current panel is the part users find hardest to use.
The split save button is part of the same flow.

**Independent Test**: Open a polygon file, make a graduated style by a
numeric column, change ramp, classes and opacity, save the sidecar, and
export SLD and Mapbox GL from the save button's menu. Count the steps and
check each output loads in QGIS (QML, SLD) and as a style document (Mapbox GL).

**Acceptance Scenarios**:

1. **Given** a file is open, **When** the user opens the style panel,
   **Then** they see the three style types (Single, Categorized, Graduated)
   as one choice at the top, and below it only the settings that apply to
   the chosen type, grouped in this order: what to color by, how to class
   it, colors, and appearance (opacity, outline, size).
2. **Given** the user picks Graduated and a numeric column, **When** they
   make no other choice, **Then** the map shows a classed style at once,
   with a default method, class count and ramp, and no separate Apply step.
3. **Given** a graduated style, **When** the user looks at the panel,
   **Then** they see a small chart of the column's value distribution with
   the class breaks marked on it, and the breaks update as they change the
   method or class count.
4. **Given** the ramp picker is open, **When** the user moves through it,
   **Then** each ramp shows a preview of its colors, and the map previews the
   focused ramp before they commit; the ramp can be reversed in one action.
5. **Given** any style, **When** the user changes opacity, **Then** the map
   and the legend update live.
6. **Given** a style, **When** the user presses the main part of the Save
   button, **Then** the QGIS sidecar is saved next to the data (VS Code) or
   downloaded (web), exactly as today's Save does.
7. **Given** a style, **When** the user opens the arrow on the Save button,
   **Then** a menu offers "QGIS style (.qml)", "OGC SLD (.sld)" and "Mapbox
   GL style (.json)", and picking one saves or downloads that format; there
   is no separate Export button.
8. **Given** the save menu is open, **When** the user uses the keyboard,
   **Then** arrow keys move through the formats, Enter picks one, and Escape
   closes the menu and returns focus to the button.
9. **Given** a style the user has changed, **When** they want to start
   over, **Then** a reset action returns the default style, and import of
   QML, SLD and Mapbox GL keeps working from the panel.

---

### User Story 2 - Find columns and rows in the table (Priority: P1)

An analyst opens a file with 80 columns and only cares about six. They open
the column chooser, type part of a name to find columns, untick the rest,
and the table fits on screen without scrolling sideways. They type
"commercial" in the filter box under the land-use column and a lower bound
in the filter under the area column; the table and the map now show only
matching features, and the count says "1,204 of 210,553". They tick three
rows and the map highlights those three features. They zoom the map to the
selection. Next time they open the same file, the same six columns show.

**Why this priority**: The table is where people check their data, and
sideways scrolling and the lack of quick filters were the most visible gaps
against the legacy app.

**Independent Test**: Open a wide file, hide most columns with the chooser,
add a text filter and a numeric filter, select rows, reopen the file, and
check the visible columns, counts, map and selection.

**Acceptance Scenarios**:

1. **Given** a file is open, **When** the user opens the column chooser,
   **Then** they see every column with a checkbox, a search box, and "Show
   all" and "Hide all" actions; unticking a column hides it from the table
   at once.
2. **Given** some columns are hidden, **When** the user reopens the same
   file later, **Then** the same columns are hidden; a different file starts
   with all columns shown.
3. **Given** columns are hidden, **When** the user looks at the table
   header, **Then** an indicator shows how many columns are hidden and opens
   the chooser; hiding columns does not change SQL results, styling or
   export.
4. **Given** the table shows a result, **When** the user types in the
   filter under a text column, **Then** only rows whose value contains the
   text (ignoring case) stay in the table and on the map.
5. **Given** a numeric or date column, **When** the user enters a filter,
   **Then** they can ask for equal to, at least, at most, or between two
   values.
6. **Given** filters on several columns, **When** they apply, **Then** a row
   must match all of them; the count reads "N of M"; and a single "Clear
   filters" action removes them all.
7. **Given** a large file read in parts (spec 007), **When** the user
   filters, **Then** the filter covers the whole file, not just the rows
   loaded so far, with progress and cancel as for any other whole-file work.
8. **Given** the table, **When** the user ticks row checkboxes, **Then** each
   ticked feature is highlighted on the map; a header checkbox selects or
   clears all rows that match the current filters; and the count of
   selected rows is shown.
9. **Given** selected rows, **When** the user picks "Zoom to selection" or
   "Show selected only", **Then** the map fits the selected features, or the
   table and map show only them.
10. **Given** the map, **When** the user clicks a feature, **Then** its row
    is selected and scrolled into view; Ctrl/Cmd-click adds it to the
    selection.
11. **Given** active filters or a selection, **When** the user opens
    Export, **Then** they can export all rows, the filtered rows, or the
    selected rows.

---

### User Story 3 - Files with several layers (Priority: P1)

A GIS analyst opens a GeoPackage that holds roads, parcels and zoning. Today
the viewer silently shows only the first layer, so the analyst can't tell
the others exist. With this story, the viewer lists the three layers with
their geometry type and feature count, opens the first, and lets the
analyst switch to parcels in one click. In SQL, every layer is a table they
can join. A colleague sends a File Geodatabase folder, and it opens the same
way.

**Why this priority**: Showing one layer of many, without saying so, gives
users a wrong picture of their data. GeoPackage and File Geodatabase are the
most common multi-layer formats in desktop GIS.

**Independent Test**: Open a GeoPackage with three layers (points, lines,
polygons) and a File Geodatabase folder with two layers. Check the layer
list, switch layers, and join two layers in SQL.

**Acceptance Scenarios**:

1. **Given** a file with more than one layer, **When** it opens, **Then** the
   viewer shows a layer list with each layer's name, geometry type and
   feature count, opens the first spatial layer, and says that the file has
   N layers.
2. **Given** the layer list, **When** the user picks another layer, **Then**
   the map, table, facts, style and query switch to that layer; the style
   and column choice are remembered per layer.
3. **Given** a file with several layers, **When** the user writes SQL,
   **Then** every layer can be queried by name, and autocomplete offers the
   layer names and their columns.
4. **Given** a layer without geometry (an attribute table), **When** the user
   picks it, **Then** the table shows its rows and the map says that the
   layer has no geometry.
5. **Given** a file with one layer, **When** it opens, **Then** nothing
   changes from today (no layer list).
6. **Given** a File Geodatabase (a folder), **When** the user opens it (VS
   Code: right-click the folder, "Open in Spatial Explorer"; web: choose the
   folder, or a .zip of it), **Then** it opens like a multi-layer file. If
   the format can't be read in a shell, it says so plainly.
7. **Given** a large multi-layer file, **When** layers are listed, **Then**
   listing them doesn't read every layer in full (spec 007 rules hold).

---

### User Story 4 - Export exactly what you need (Priority: P2)

An engineer needs the filtered parcels as a Shapefile for a consultant and
the same rows as a spreadsheet without geometry for a manager. In the
export dialog, they keep "Include geometry" on and pick Shapefile; then
they turn geometry off, and the format list changes to attribute formats
such as CSV and Excel.

**Why this priority**: Export is one of the four pillars, and users still
leave for QGIS when they need common formats such as Shapefile, GeoPackage
or KML.

**Independent Test**: Export a polygon result to each new format with
geometry and read it back in QGIS. Export without geometry to each
attribute format and open it in a spreadsheet or reader.

**Acceptance Scenarios**:

1. **Given** the export dialog, **When** the result has geometry, **Then**
   an "Include geometry" switch is on by default.
2. **Given** "Include geometry" is on, **When** the user opens the format
   list, **Then** it offers spatial formats only: today's GeoParquet and
   GeoJSON, plus GeoPackage, FlatGeobuf, Shapefile (zipped), KML,
   newline-delimited GeoJSON, and CSV with WKT or X/Y.
3. **Given** "Include geometry" is off (or the result has no geometry),
   **When** the user opens the format list, **Then** it offers attribute
   formats only: CSV, Parquet, Excel workbook and JSON.
4. **Given** the user switches "Include geometry", **When** the chosen
   format isn't valid for the new choice, **Then** the dialog picks the
   nearest valid format and says what changed (as it does today for other
   forced changes).
5. **Given** a format with known limits (Shapefile: 10-character field
   names, one geometry type per file, 2 GB; KML: WGS84 only), **When** the
   user picks it, **Then** the dialog says what will change before export
   (renamed fields, split or dropped geometries, reprojection).
6. **Given** each new format, **When** it is offered, **Then** it has been
   verified end to end (written here, read back by QGIS or a reader); a
   format that can't be verified isn't offered.

---

### User Story 5 - Theme, globe and basemaps (Priority: P2)

A user of the web app works in a bright office and switches the app to
light mode. The choice sticks on the next visit. They switch the map to
the globe to see a dataset that spans continents, then back to the flat
map to measure a city. They switch the basemap to satellite imagery to
check building footprints against the ground.

**Why this priority**: These are visible, expected features from the legacy
app. Each is small, and none blocks the others.

**Independent Test**: Toggle the web theme and reload; toggle the globe and
pan; pick each new basemap and check that it draws and shows attribution.

**Acceptance Scenarios**:

1. **Given** the web app, **When** the user has never chosen a theme,
   **Then** it follows the operating system's light/dark setting, live.
2. **Given** the web app, **When** the user opens the theme control,
   **Then** they can pick System, Light or Dark; the whole interface and the
   default basemap switch at once with no reload, and the choice is
   remembered.
3. **Given** the VS Code extension, **When** the user looks for a theme
   control, **Then** there is none: the viewer follows VS Code's theme,
   including high contrast, as today.
4. **Given** a map, **When** the user turns the globe on, **Then** the map
   shows the Earth as a globe, keeping the center, and turning it off
   returns to the flat map; the choice is remembered.
5. **Given** the globe and a large file (spec 007), **When** the user pans
   and zooms, **Then** the map keeps showing what is in view, with the same
   overview and notices as on the flat map.
6. **Given** the basemap picker, **When** the user opens it, **Then** it also
   offers satellite imagery, a topographic map and a standard street map,
   each with a preview and its attribution, and each degrading to Blank with
   a short message if it fails to load.

---

### User Story 6 - Polygons in 3D (Priority: P2)

A transportation planner styles building footprints by a height column and
turns on 3D. The buildings rise from the map, colored by the current style,
and the map tilts so the heights are visible. They raise the height scale
because the column is in stories, not meters. They rotate the view, then
use "Reset view" to return to a flat, north-up map.

**Why this priority**: The user asked for it explicitly. It is a style
option, so it builds on User Story 1.

**Independent Test**: Open a polygon file with a numeric height column,
turn on 3D with that column and a scale, check the heights, colors and
tilt, rotate, reset, save the style, and reopen the file.

**Acceptance Scenarios**:

1. **Given** a polygon layer, **When** the user opens the style panel,
   **Then** a 3D section offers "Extrude by" with the numeric columns, a
   height scale (default 1), and an optional constant height instead of a
   column.
2. **Given** a point or line layer, **When** the user opens the style panel,
   **Then** the 3D section is absent or disabled with the reason ("3D
   extrusion applies to polygons").
3. **Given** the user turns on extrusion, **When** it applies, **Then** each
   polygon rises to its column value times the scale, colored by the
   current Single, Categorized or Graduated style, and the map tilts so the
   heights are visible if it was flat.
4. **Given** extruded polygons, **When** a value is missing, zero or
   negative, **Then** that polygon is drawn flat, and the panel says how
   many were drawn flat.
5. **Given** a tilted or rotated map, **When** the user picks "Reset view",
   **Then** the map returns to flat and north-up; tilt and rotate are also
   possible with the keyboard.
6. **Given** extrusion is on, **When** the user saves the sidecar or the
   Mapbox GL style, **Then** the extrusion is kept and comes back when the
   file is reopened; when a chosen format can't carry it (SLD), the save
   still succeeds and says that the 3D setting was left out.
7. **Given** extrusion is on, **When** the user clicks a raised polygon,
   **Then** the inspector shows that feature, as on the flat map.

---

### User Story 7 - Share and present (Priority: P3)

A user exports the current map, with its legend, as a PNG for a slide. In
the web app, they copy a link that opens the same query, style, basemap
and view for a colleague who has the same file (or for anyone, when the
map shows the demo data).

**Why this priority**: Useful for reporting, but not part of daily looking
and querying.

**Independent Test**: Export a PNG with a styled layer and check the image
holds the map, legend and attribution. Copy a share link in the web app,
open it in a new tab, open the same file, and check the query, style and
view.

**Acceptance Scenarios**:

1. **Given** a map, **When** the user picks "Export map image", **Then**
   they get a PNG of the current view at the screen's resolution, or at 2×,
   with the legend (when shown) and the basemap attribution drawn on it.
2. **Given** a basemap that forbids reading its pixels, **When** the user
   exports an image, **Then** the export still succeeds with the data and
   legend on a blank background, and says why the basemap was left out.
3. **Given** the web app, **When** the user picks "Copy link", **Then** a
   link holding the query, style, basemap, projection and map view is copied
   to the clipboard; the link never contains the data itself.
4. **Given** someone opens such a link, **When** the app loads, **Then** it
   asks for the file named in the link (or opens the demo data when the
   link was made from it), then applies the query, style and view.
5. **Given** the VS Code extension, **When** the user looks for "Copy link",
   **Then** it isn't offered (there is no page address to share); "Export map
   image" is offered and saves through the editor's save dialog.

---

### User Story 8 - Try it without a file, and find a place (Priority: P3)

A first-time user opens the web app with no data at hand. They press "Try
sample data", and a small sample dataset opens with a default style and a
query they can edit. They type "Salt Lake City" into the place search and
the map flies there.

**Why this priority**: Helps first-time users and demos; not needed by
users who already have their data.

**Independent Test**: In a fresh web app session, open the sample data,
run the sample query, and search for a place.

**Acceptance Scenarios**:

1. **Given** the empty state (web) or the command palette (VS Code),
   **When** the user picks "Try sample data", **Then** a bundled sample
   dataset opens without any network access, ready to query, style and
   export like any file.
2. **Given** the map, **When** the user types a place name in the place
   search, **Then** matching places appear as a list, and picking one moves
   the map there.
3. **Given** place search, **When** the user uses it for the first time,
   **Then** they are told the typed text is sent to a public place-search
   service; nothing else (no file data, no file names) is ever sent.
4. **Given** VS Code, **When** the user has turned place search off in
   settings, or is offline, **Then** the search box is hidden (setting) or
   says it can't reach the service (offline), and nothing else breaks.

---

### Edge Cases

- Every column hidden: the chooser keeps at least one column visible and
  says so.
- A remembered column set for a file whose columns have since changed:
  columns that no longer exist are dropped silently, new columns are shown.
- A query result has different columns from the file: the column choice
  belongs to the result's columns; a query that returns the same columns as
  the file keeps the file's choice.
- A filter value that doesn't fit the column type (letters in a number
  filter): the filter box is marked invalid with a short reason and is not
  applied.
- Filters that match nothing: the table says "No rows match the filters"
  with a Clear filters action; the map draws nothing and says why.
- Filters on a PMTiles archive: not offered (the table is unavailable,
  spec 007 FR-009a).
- Selecting all rows of a very large result: the selection is held as a
  rule ("all matching the filters"), not a list of millions of rows, and
  "Zoom to selection" uses the result's extent.
- A new query, or reopening the file: filters and selection are cleared;
  the column choice is kept.
- Extrusion on the globe: works if the map supports it; if not, the user
  is told that 3D is shown on the flat map only, and turning on one tells
  the user what happens to the other.
- Very tall values (outliers) in the extrusion column: drawn as is; the
  height scale lets the user bring them down.
- Extrusion with a graduated legend range filter: polygons outside the
  range are hidden, as on the flat map.
- Legend range filter set, then the style changes: the range resets to the
  full range.
- A PNG export larger than the device can render (2× on a very large
  screen): the export falls back to 1× and says so.
- A share link made by a newer version, or with a query that fails: the
  app opens the file, shows the error as any failed query would, and keeps
  the parts that did apply.
- Share link too long for a URL (a very long query): the user is told the
  link can't hold it and is offered to copy the query text instead.
- Place search returns nothing: "No places found".
- Theme choice in the web app when the OS theme changes while "Light" or
  "Dark" is picked: the app keeps the picked theme.
- A raster basemap with a key requirement is never added (keyless only).
- A multi-layer file where every layer is empty: the viewer opens it, lists
  the layers with 0 features, and shows the empty state.
- Layer names with spaces, quotes or non-Latin characters: the layer list
  shows them as they are, and SQL accepts them quoted (autocomplete inserts
  them quoted).
- A File Geodatabase with layers in different CRSs: each layer is drawn in
  its own CRS reprojected for display, as for any file.
- A zip given to the web app that holds no geodatabase (or several): it says
  what it found and opens nothing.
- Export without geometry from a result whose only column is the geometry:
  the dialog says there is nothing to export.
- Shapefile export of a mixed result (points and polygons): the user is told
  that one file per geometry type will be written (in the zip), or which
  rows are dropped.

## Requirements *(mandatory)*

### Functional Requirements

**Style panel (US1)**

- **FR-001**: The style panel MUST show the style type (Single, Categorized,
  Graduated) as a single choice at the top, and only the settings that
  apply to the chosen type, grouped as: what to color by, classification,
  colors, appearance, 3D (polygons only).
- **FR-002**: Choosing a style type and a column MUST produce a complete
  style on the map at once, with defaults for every other setting; changes
  apply live, with no Apply step.
- **FR-003**: Graduated styles MUST show the column's value distribution
  with the class breaks marked, updating with the method and class count;
  for large data the distribution MAY be drawn from a sample, and says so.
- **FR-004**: Ramp choices MUST show previews; the focused ramp MUST preview
  on the map; the ramp MUST be reversible in one action.
- **FR-005**: The panel MUST offer fill opacity, outline color, width and
  opacity, and point size, each applying live to the map and the legend.
- **FR-006**: The panel MUST offer one Save control that is a split button:
  the main action saves (VS Code) or downloads (web) the QGIS sidecar, and
  its menu offers QML, SLD and Mapbox GL style JSON. Import and reset MUST
  remain available.
- **FR-007**: The style panel MUST be usable in the narrowest panel width
  the layout allows without sideways scrolling.

**Table (US2)**

- **FR-008**: The attribute table MUST offer a column chooser with a
  checkbox per column, a search box, Show all and Hide all, and an
  indicator of how many columns are hidden.
- **FR-009**: The column choice MUST be remembered per file and restored
  when the same file is reopened; it MUST NOT affect queries, styles or
  exports.
- **FR-010**: Each visible column MUST have a filter: "contains" (ignoring
  case) for text; equal, at least, at most and between for numbers and
  dates; true/false for booleans. Filters combine with AND.
- **FR-011**: Filters MUST apply to the whole current result (including
  large files read in parts), and to both the table and the map; the count
  MUST read "N of M" while filters are active; one action MUST clear all
  filters.
- **FR-012**: Rows MUST be selectable with checkboxes, including a header
  checkbox for all rows that match the filters; selected features MUST be
  highlighted on the map; map clicks MUST select the row, and Ctrl/Cmd-click
  MUST add to the selection.
- **FR-013**: The user MUST be able to zoom to the selection, show selected
  rows only, and clear the selection.
- **FR-014**: The export dialog MUST offer all rows, filtered rows (when
  filters are active) and selected rows (when rows are selected).

**Several layers (US3)**

- **FR-015**: Opening a file that holds more than one layer MUST list its
  layers (name, geometry type, feature count) without reading them in full,
  open the first spatial layer, and say how many layers the file holds.
- **FR-016**: The user MUST be able to switch layers in one action; map,
  table, facts, style and query switch together; the style and column choice
  are remembered per layer.
- **FR-017**: Every layer of an open file MUST be queryable by name in SQL,
  and autocomplete MUST offer layer names and their columns.
- **FR-018**: File Geodatabase folders MUST open as multi-layer files (VS
  Code: folder context command; web: a chosen folder or a .zip), if a spike
  shows the engine can read them in that shell; otherwise the shell MUST say
  the format isn't supported there.

**Export (US4)**

- **FR-019**: The export dialog MUST offer an "Include geometry" switch
  (on by default when the result has geometry), and MUST list only formats
  valid for that choice.
- **FR-020**: With geometry, the dialog MUST offer GeoPackage, FlatGeobuf,
  Shapefile (zipped), KML and newline-delimited GeoJSON in addition to
  today's formats; without geometry, CSV, Parquet, Excel workbook and JSON.
  A format is offered only after it is verified end to end in both shells.
- **FR-021**: Before export, the dialog MUST state each change a format
  forces (field renames, geometry splits or drops, reprojection, size
  limits).

**Map (US5, US6)**

- **FR-022**: The web app MUST offer a theme control with System, Light and
  Dark; System follows the operating system live; the choice is remembered.
  The VS Code extension MUST keep following VS Code's theme.
- **FR-023**: The map MUST offer a flat/globe toggle, kept per user; the
  globe MUST work with viewport loading and every spec 007 notice. No terrain.
- **FR-024**: The basemap catalog MUST add keyless satellite imagery,
  topographic and standard street basemaps, each with preview, attribution
  and graceful fallback.
- **FR-025**: Polygon layers MUST offer extrusion by a numeric column or a
  constant height, with a height scale; colors follow the current style;
  missing, zero or negative heights are drawn flat and counted.
- **FR-026**: Turning on extrusion MUST tilt a flat map so heights are
  visible; the map MUST offer a "Reset view" (flat, north-up) and keyboard
  tilt and rotate.
- **FR-027**: Extrusion MUST be saved in the sidecar and the Mapbox GL
  style, and restored on reopen; saving to a format that can't hold it MUST
  say it was left out.
- **FR-028**: Graduated legends MUST offer a value range filter (two
  handles) that hides features outside the range on the map, with a reset;
  category toggles stay as they are.
- **FR-029**: Double-clicking (or pressing Enter on) a panel resize handle
  MUST reset that panel to its default size.

**Share and present (US7, US8)**

- **FR-030**: Both shells MUST export the current map view as a PNG at 1×
  or 2×, with the legend (when shown) and attribution; a basemap that can't
  be captured MUST be left out with a message instead of failing.
- **FR-031**: The web app MUST copy a link holding the query, style,
  basemap, projection and view, and never the data or a file path; opening
  it MUST ask for the named file (or open the sample data) and then apply
  what it holds.
- **FR-032**: Both shells MUST offer bundled sample data that opens with no
  network access.
- **FR-033**: The map MUST offer a place search that sends only the typed
  text to a public place-search service, says so before first use, and can
  be turned off (VS Code setting); offline, it MUST say it can't reach the
  service.

**Cross-cutting**

- **FR-034**: Every new control MUST be keyboard-reachable and labeled,
  including the split button's menu, the column chooser, the filters, row
  checkboxes and the range filter; and MUST work in light, dark and high
  contrast.
- **FR-035**: Every map control, including the attribution button and its
  icon, the zoom and scale controls and the place search, MUST be legible in
  light, dark and high contrast (today the attribution "i" icon is dark on a
  dark background in dark mode).
- **FR-036**: All remembered choices (theme, columns per file, projection)
  MUST be stored through the host's preference storage, never with the
  user's data.
- **FR-037**: Spec 007 behavior MUST keep working: viewport loading, the
  overview, notices, cancel, out-of-memory messages, and PMTiles being
  view-only (filters, selection by checkbox, styling and extrusion are not
  offered for PMTiles, with the existing reason).

### Key Entities

- **Column view**: for one file, which columns are visible and their order
  in the table. Remembered per file.
- **Filter set**: per-column conditions on the current result. Cleared by a
  new query or reopening the file.
- **Selection**: the set of selected features, held either as a list or as
  "all matching the filters".
- **Layer**: one named table inside a file (GeoPackage, File Geodatabase):
  name, geometry type, feature count, CRS. A file holds one or more layers;
  style and column choice are kept per layer.
- **Export request** (extended): adds "include geometry" and the scope (all,
  filtered, selected rows) to spec 005's format, CRS and destination.
- **Extrusion setting**: part of a layer style: on/off, height column or
  constant, height scale.
- **Map view settings**: projection (flat or globe), tilt, rotation; the
  projection is remembered per user.
- **Theme preference** (web only): System, Light or Dark.
- **Share link** (web only): query, style, basemap, projection, view and the
  file's name; never data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From opening the style panel, a user makes a graduated style by
  a chosen column in 3 interactions or fewer (type, column, done), and saves
  SLD in 2 more (open menu, pick format).
- **SC-002**: In a moderated check with at least 3 people who haven't used the
  app, each completes "make a graduated map, change the ramp, save it for
  QGIS" in under 90 seconds without help.
- **SC-003**: With a 50-column file, the user hides all but 5 columns in under
  20 seconds, and the table then fits a 1,280-pixel-wide window without
  sideways scrolling.
- **SC-004**: Applying a column filter on a 1-million-row file updates the
  count, the table and the map within 3 seconds; on a 10,000-row file within
  0.5 seconds.
- **SC-005**: Switching theme, projection or basemap takes effect within 1
  second with no reload, and keeps the current view.
- **SC-006**: With 10,000 extruded polygons in view, panning and rotating
  stays smooth: no single interaction stalls the page for more than 200 ms.
- **SC-007**: A map image export completes within 5 seconds and the image
  holds the map, legend and attribution.
- **SC-008**: Sample data opens and draws within 3 seconds with no network.
- **SC-009**: Every layer of a multi-layer test GeoPackage (3 layers) and
  File Geodatabase (2 layers) is listed with the right feature count, and
  switching layers takes under 2 seconds for files up to 100 MB.
- **SC-010**: Every offered export format, with and without geometry, reads
  back in QGIS (or Excel/a JSON reader for attribute formats) with the same
  row count and, for spatial formats, matching geometries.
- **SC-011**: Every row of the legacy feature table in Context is either
  delivered by this spec or named under "Not carried over" with a reason; a
  side-by-side walk through the legacy README's features finds no gap.
- **SC-012**: No regressions: every spec 001–007 test passes, and spec 007's
  measured large-file timings stay within 10% of their recorded values.
- **SC-013**: Every new control passes an automated accessibility check with
  no serious issues, in light, dark and high contrast.

## Assumptions

- The user's approval on 2026-10-11 (recorded in CLAUDE.md) allows the globe
  toggle and polygon extrusion, and nothing else 3D. The constitution still
  lists "globe" as out of scope (Principle I) and limits network use to
  basemaps (Principle IV); a constitution amendment covering the globe,
  extrusion, and the place-search service MUST be ratified before planning
  completes.
- "Exceeds the legacy app" means: every legacy feature is delivered or
  consciously not carried over (Context), plus the column chooser, the
  redesigned style panel, the split save button, extrusion, filters that
  cover whole large files, and exporting filtered or selected rows.
- The share link is web only; it can't carry data, so it reproduces a view
  only for someone who has the same file, or for the sample data.
- Sample data is small (well under 5 MB), freely licensed, and bundled with
  both shells; its license is recorded in the third-party notices.
- Place search uses a free public service with a usage policy (no heavy
  use, attribution); results are requested only when the user searches,
  never while typing each letter faster than the policy allows.
- New basemaps are keyless and follow each provider's usage policy, as with
  the existing raster rule in project guidance.
- Extrusion heights are in meters after scaling; the scale lets users convert
  other units (stories, feet).
- Filters are a convenience over the current result, not a second query
  language; anything more complex stays in SQL.
- The style panel redesign keeps every capability specs 003 and 005 deliver
  (renderers, methods, ramps, classes editing, import/export formats).
- Today a multi-layer GeoPackage shows only its first layer, with no notice,
  and File Geodatabase isn't supported. Spec 005 found that the engine's
  built-in writers for GeoPackage, FlatGeobuf, Shapefile and KML fail in this
  runtime, so the new export formats and File Geodatabase depend on spikes
  (other writers or readers), and each is offered only once verified.
- Several layers of one file are layers of one document, not a multi-file
  session; joining layers from different files stays in spec 006.
- Out of scope: editing, terrain, 3D tiles, 3D for points or lines, raster
  data, multi-file sessions (spec 006), restoring loaded files after a
  reload, labels.
