# Feature Specification: Export

**Feature Branch**: `005-export`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Export (EXPORT pillar of Spatial Explorer, spec 005). In both the VS Code extension and the web app, users save the data they are looking at (the opened file's displayed result, i.e. the current query result) to a new file, so they never need QGIS just to convert or extract data. Formats: GeoJSON, GeoParquet, CSV (geometry as WKT, or lon/lat for points), and others only where the embedded engine actually supports writing them (candidates: FlatGeobuf, GeoPackage, Shapefile, KML) — nothing is offered until verified. The user picks format and file location (VS Code save dialog next to the data by default; browser download on the web). Coordinates are written in a chosen CRS: the data's original CRS by default, with WGS84 as an option (GeoJSON always WGS84 per RFC 7946). Attribute columns keep their names and types where the format allows; anything a format can't hold (long field names in Shapefile, nested types, mixed geometry types, null geometries) is handled predictably and reported in a clear notice — nothing is lost silently. Results without geometry export as tables (CSV/Parquet). Large exports show progress, can be cancelled, and never freeze the viewer; memory limits fail with a clear message. Exports are offered from a visible Export action near the attribute table/query results and by command (VS Code command palette). The source file is never modified. Out of scope: exporting map images/PNG/PDF (print layouts are out of scope), exporting styles (already in spec 001/003), writing back to the source file or editing, multi-file/session exports (spec 006), cloud/remote destinations."

## Clarifications

### Session 2026-10-10

- Q: Which rows does an export contain when the display is limited (the
  initial view's first 1,000 rows, or "first 50,000")? → A: The full result,
  asking when limited. Export uses the current query's complete result.
  When what's shown is a display-limited subset, the dialog asks "All N rows"
  (the default) or "Only the M shown". A LIMIT the user wrote themselves is
  part of their query and is respected.

## Context

Spec 001 opens a file and shows its first 1,000 features. Spec 002 makes
what is shown the result of an editable query, and spec 003 styles it. This
spec adds the last pillar, EXPORT: saving data to a new file. Converting a
file to another format and extracting a filtered subset are the most common
reasons people open a desktop GIS for a moment, and this removes them.
Exporting *styles* already exists (specs 001 and 003) and is not part of
this spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save the current result as GeoJSON, GeoParquet or CSV (Priority: P1)

A planner has queried the parcels they need (`WHERE zone = 'R1'`) and wants
to hand them to a colleague. They choose **Export**, pick GeoJSON, confirm
the file name and location, and get a file that opens in any GIS with
exactly the rows and columns they were looking at.

**Why this priority**: extracting and converting data is the core of the
EXPORT pillar. Three widely read formats already cover most hand-offs.

**Independent Test**: open a file, run a filtering query, export to each of
the three formats, and open each file in another tool. Rows, columns,
values and geometry must match the result.

**Acceptance Scenarios**:

1. **Given** a query result with geometry, **When** the user exports it as
   GeoJSON, **Then** the file holds every exported row, every attribute
   column with its values, and the geometry in WGS84 (longitude, latitude).
2. **Given** the same result, **When** the user exports it as GeoParquet,
   **Then** the file holds the same rows and columns with their types, and
   the geometry with its coordinate system recorded, so that another tool
   reads it correctly.
3. **Given** the same result, **When** the user exports it as CSV, **Then**
   geometry is written as WKT text in one column. For a point layer the user
   can instead choose separate longitude and latitude (or X and Y) columns.
4. **Given** any export, **When** it finishes, **Then** a short
   confirmation names the file, the number of rows written, and any notice
   items (FR-009).
5. **Given** any export, **When** it finishes, **Then** the opened source
   file is unchanged.

---

### User Story 2 - Export in the original coordinate system (Priority: P1)

A surveyor works in a projected coordinate system (for example UTM zone
12N). They export a subset and need it to stay in that system so it lines up
with their other project files. A colleague needs the same data in WGS84
for a web map.

**Why this priority**: a wrong or silently changed coordinate system makes
an exported file unusable, and it is the most common conversion error in
GIS hand-offs.

**Independent Test**: open a projected file, export to GeoParquet in the
original CRS and again in WGS84, and confirm both files' coordinates and
recorded CRS.

**Acceptance Scenarios**:

1. **Given** a layer in a projected CRS, **When** the user exports with the
   default CRS choice, **Then** the coordinates and the recorded CRS are the
   original ones, unchanged.
2. **Given** the same layer, **When** the user chooses WGS84, **Then** the
   coordinates are reprojected to longitude and latitude, and the file
   records WGS84.
3. **Given** GeoJSON is chosen, **When** the user opens the CRS choice,
   **Then** only WGS84 is available, with a note that GeoJSON is always
   WGS84.
4. **Given** a query result whose CRS was detected or overridden (spec 002
   result CRS), **When** the user exports in the "original" CRS, **Then**
   the result CRS shown in the viewer is the one used and recorded.

---

### User Story 3 - More formats, only where they truly work (Priority: P2)

A user needs a Shapefile for an older desktop tool, or a GeoPackage or
FlatGeobuf for QGIS. These formats appear in the format list only if
Spatial Explorer can actually write them correctly. Formats it can't write
don't appear.

**Why this priority**: valuable, but every additional format must first be
proven to work in both shells. The P1 formats already cover the core need.

**Independent Test**: for each additional format offered, export the same
result and read it back in QGIS. Rows, attributes, geometry and CRS must
match.

**Acceptance Scenarios**:

1. **Given** a format was verified (FR-004), **When** the user exports to
   it, **Then** the file opens in QGIS with the same rows, attributes,
   geometry and CRS.
2. **Given** Shapefile is offered, **When** a column name is longer than the
   format allows, or the result mixes geometry types, **Then** the export
   still succeeds with predictable names or split output, and the notice
   lists exactly what changed (FR-009). Shapefile is written as its
   companion files together, delivered as a zip.
3. **Given** a format that was not verified, **When** the user opens the
   format list, **Then** the format is not offered.

---

### User Story 4 - Large exports stay responsive (Priority: P2)

A user exports a large result. The export shows progress, the viewer keeps
responding, and the user can cancel. If the result is too large for the
available memory, the export stops with a clear message, and the viewer
keeps working.

**Why this priority**: the core value is complete without it, but an export
that freezes or crashes the viewer, or silently writes half a file, is
worse than no export.

**Independent Test**: export a result of 100,000+ rows, watch progress,
cancel midway, and confirm that no partial file is left behind and the
viewer still works.

**Acceptance Scenarios**:

1. **Given** an export that takes longer than about a second, **When** it
   runs, **Then** progress is shown (rows written, or a busy indicator if
   the count isn't known) and the viewer stays usable.
2. **Given** a running export, **When** the user cancels, **Then** the
   export stops within a few seconds, no partial file is left at the chosen
   location, and the viewer is unaffected.
3. **Given** an export that exceeds the available memory, **When** it
   fails, **Then** the user sees a clear message suggesting a smaller result
   (for example a filter or LIMIT) or a more compact format. The viewer and
   the displayed data remain intact.

---

### User Story 5 - Export from the keyboard and the command palette (Priority: P3)

A keyboard-centric VS Code user runs **Spatial Explorer: Export Data…**
from the command palette while a Spatial Explorer editor is active, and the
same export dialog appears.

**Why this priority**: convenience and consistency with VS Code. The
visible Export action already covers the feature.

**Independent Test**: run the command with a viewer active and complete an
export using only the keyboard.

**Acceptance Scenarios**:

1. **Given** a Spatial Explorer editor is active, **When** the user runs the
   Export command, **Then** the export dialog opens for that editor's
   current result.
2. **Given** no Spatial Explorer editor is active, **When** the user runs
   the command, **Then** a short message explains that a Spatial Explorer
   view must be open.
3. **Given** the export dialog, **When** the user navigates it with the
   keyboard only, **Then** every option is reachable, labeled, and theme
   native, as in specs 001–003.

---

### Edge Cases

- **Result without geometry** (e.g. `SELECT zone, count(*) … GROUP BY
  zone`): only table formats are offered (CSV and Parquet), and the CRS
  choice is hidden.
- **Several geometry columns**: the primary (mapped) geometry is exported as
  the geometry. The others are written as WKT text columns, as the table
  shows them. The notice says so.
- **Rows with missing or invalid geometry** (listed in the table, not
  mapped, spec 002): they are exported with an empty geometry where the
  format allows it, and counted in the notice. They are never dropped
  silently.
- **Mixed geometry types** in formats that hold one type per layer: the
  behavior is format-specific and always announced (Shapefile in US3,
  scenario 2).
- **Column types a format can't hold** (lists, structs, maps, intervals,
  very large integers): converted to text, listed in the notice.
- **Duplicate or reserved column names** after a format's renaming rules:
  made unique predictably (e.g. `name_1`), listed in the notice.
- **Non-ASCII text**: written as UTF-8 in every format that supports it, and
  declared where the format needs a declaration.
- **The chosen file name already exists**: the host's normal overwrite
  confirmation applies. An existing file is never overwritten silently.
- **The chosen location is the source file itself**: refused with a clear
  message (FR-012).
- **A query is running when Export is chosen**: Export waits until there is
  a settled result, or is disabled until then.
- **Converting a whole file**: open it and Export straight away. The
  initial view shows 1,000 rows, so the dialog offers "All 22,000 rows" by
  default (FR-002). No query editing is needed.
- **Empty result (0 rows)**: the export still writes a valid, empty file
  with the column structure, and the confirmation says 0 rows.
- **The "changed on disk" notice is showing** (spec 001): export uses the
  data currently loaded in the viewer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to export the current result (the data
  behind the map and the attribute table) to a new file, from a visible
  Export action near the attribute table or query results, in both shells.
- **FR-002**: An export MUST contain the current query's complete result.
  When the displayed rows are a display-limited subset, the export dialog
  MUST ask whether to export all rows (the default, with the total count) or
  only the rows shown. A display limit is either:
  - the untouched initial view (the default query's 1,000-row cap, spec 002);
    or
  - the "Show first 50,000" choice (spec 002 FR-012).

  A LIMIT, WHERE or other clause the user wrote is part of their query and
  MUST be respected without asking.
- **FR-003**: GeoJSON, GeoParquet and CSV MUST be offered in both shells.
  CSV writes geometry as WKT by default. For point geometry, the user MAY
  instead choose separate X/Y (longitude/latitude) columns.
- **FR-004**: Any further format (candidates: FlatGeobuf, GeoPackage,
  Shapefile, KML) MUST be offered only after it has been verified to write
  correctly in both shells. Verified means it reads back in QGIS with the
  same rows, attributes, geometry and CRS. Unverified formats MUST NOT
  appear.
- **FR-005**: Users MUST be able to choose the file name and location.
  VS Code: a save dialog, defaulting next to the source file with a name
  derived from it (e.g. `parcels-export.geojson`). Web: a download with that
  name.
- **FR-006**: Users MUST be able to choose the output CRS: the result's CRS
  (the default) or WGS84. Formats that require one CRS (GeoJSON: WGS84) MUST
  offer only that, and say why. The CRS MUST be recorded in the output
  wherever the format can record one.
- **FR-007**: Attribute columns MUST keep their names, order and types
  where the format allows. Where it doesn't, the conversion MUST follow
  documented rules (renaming, text conversion) that give the same output
  every time.
- **FR-008**: Results without geometry MUST be exportable to table formats
  (CSV, Parquet), and geometry formats MUST NOT be offered for them.
- **FR-009**: Every change a format forces MUST be reported in a notice
  listing each item: renamed or truncated columns, converted types, rows
  with empty geometry, other geometry columns written as text, split or
  dropped geometry types. Nothing may be lost silently. Changes that are
  known in advance MUST be shown before the export starts.
- **FR-010**: Exports that take more than about one second MUST show
  progress and MUST be cancellable. The viewer MUST stay responsive
  throughout. A cancelled or failed export MUST NOT leave a partial file at
  the chosen location.
- **FR-011**: An export that runs out of memory (or hits another resource
  limit) MUST fail with a clear, actionable message. It MUST NOT crash or
  hang the viewer, and the displayed data MUST stay intact.
- **FR-012**: The source file MUST never be modified. Choosing the source
  file itself as the destination MUST be refused.
- **FR-013**: The VS Code extension MUST provide a command-palette command
  that opens the export dialog for the active Spatial Explorer editor, and
  says when none is active.
- **FR-014**: The export dialog MUST be keyboard-accessible, labeled and
  theme-native, as specs 001–003 require.
- **FR-015**: Exports MUST run entirely locally. Data MUST NOT leave the
  machine except to the location the user chose.
- **FR-016**: The same result and options MUST produce equivalent files in
  both shells: the same rows, columns, values, geometry and CRS.

### Key Entities

- **Export request**: what is exported (the current query's complete result,
  or only the shown rows when the user chose so, FR-002), the
  format, the output CRS, the format options (e.g. CSV geometry as WKT or
  X/Y), and the destination.
- **Export format**: a format the viewer can write (P1 formats, and
  verified extras). For each format: whether it holds geometry, whether it
  holds a CRS, its CRS constraints, its naming and type limits, and whether
  it is written as several files.
- **Export notice**: the list of changes a format forces (FR-009), shown
  before the export where predictable, and in the confirmation.
- **Export outcome**: success (file, rows written, notices), cancelled, or
  failed (with a reason).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can export a filtered result to GeoJSON, or convert a
  whole file to another format, in under 30 seconds of interaction, from
  Export to a saved file.
- **SC-002**: For every offered format, an exported file read back in QGIS
  has 100% of the exported rows, the same attribute values, the same
  geometry (within the format's coordinate precision), and the stated CRS,
  across the test set of files from spec 001's format matrix.
- **SC-003**: Exporting 100,000 polygon features to GeoParquet completes in
  under 15 seconds, and the viewer responds to input throughout (no freeze
  over 1 second).
- **SC-004**: Cancelling an export stops it within 3 seconds and leaves no
  file at the destination, in 100% of trials.
- **SC-005**: 100% of format-forced changes in the test set (long names,
  unsupported types, empty geometry, mixed types, extra geometry columns)
  appear in the notice. Zero silent changes.
- **SC-006**: The same result exported from both shells produces files with
  identical rows, columns, values and CRS.
- **SC-007**: The source file is unchanged after every export, verified by
  checksum in the test set.

## Assumptions

- **Default output name**: `<source name>-export.<ext>` (e.g.
  `parcels-export.geojson`), next to the source in VS Code.
- **CSV defaults**: UTF-8, comma separator, header row, geometry as WKT in a
  column named after the geometry column. X/Y is offered only for point
  geometry.
- **Coordinate precision**: GeoJSON is written with enough decimal places
  for about centimetre precision in WGS84. The other formats keep full
  precision.
- **GeoParquet** follows the current GeoParquet specification, so that
  GDAL/QGIS, DuckDB and GeoPandas read the geometry and CRS.
- **Shapefile**, if verified, is delivered as one `.zip` holding its
  companion files (`.shp .shx .dbf .prj .cpg`). This is the usual way to
  hand one over, and it works the same in both shells.
- **Selection export is out of scope**. To export a subset, users filter
  with a query (spec 002).
- **Style is not embedded** in exported data files. Styles export
  separately (specs 001 and 003).
- **Out of scope**: map images, PNG or PDF (print layouts); exporting styles
  (specs 001/003); writing to the source file or editing; multi-file or
  session exports (spec 006); cloud or remote destinations.
- **Dependencies**: the current result and its CRS (spec 002), the host's
  save and download mechanisms (spec 001's style export), and the format
  matrix files (spec 001) as the test set.
