# Feature Specification: Large Files and Viewport Loading

**Feature Branch**: `007-viewport-loading`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Large files and viewport loading (spec 007; spec 004's basemap picker was absorbed into spec 001, and 006 stays reserved for multi-file sessions). Make Spatial Explorer open and explore large vector files (hundreds of MB to a few GB) in both the VS Code extension and the web app without loading the whole file into memory and without freezing. Today every format is parsed whole up front; a 50 MB GeoJSON did not finish opening in VS Code within 45 s, and DuckDB-WASM has a ~512 MB ceiling. Goals: the map shows the features in the current viewport, capped, and refreshes as the user pans and zooms; at low zoom the user sees a meaningful overview of the whole dataset, not an arbitrary first-N subset; metadata (row count, extent, CRS, geometry type, columns) appears quickly and covers the whole file; the attribute table, SQL queries, thematic styling and export keep working against the whole dataset, with clear disclosure whenever something is limited; formats that support partial reads (GeoParquet/Parquet, FlatGeobuf with its spatial index, PMTiles) read only what they need, while formats that can't (GeoJSON, Shapefile, CSV, GML) get a clear, honest path: a size threshold, progress, cancel, and a message pointing to a better format when a file is too large. Opening a file never hangs: progress and cancel are always available, and running out of memory fails with a clear message instead of a blank viewer. Must work in the VS Code webview (including Remote-SSH/WSL where possible) and the web app (local files via the file picker). Verify risky assumptions with spikes before building (range reads through the webview, a spatial index in the WASM build, vector tiles via ST_AsMVT if available) and never claim a format is fast until measured. Out of scope: editing, raster data, remote/cloud URLs as sources (unless a spike shows it's nearly free), multi-file sessions (spec 006), 3D."

## Clarifications

### Session 2026-10-10

- Q: How does viewport loading relate to the default `LIMIT 1000` query and
  spec 002's "Show first 50,000" prompt? → A: Viewport loading applies to
  every file. The default query becomes `SELECT * FROM layer` with no LIMIT.
  The map draws the result's features in view (capped and disclosed), the
  table pages through the whole result, and the 50,000 prompt is removed. A
  WHERE or LIMIT the user writes is respected.
- Q: What does a PMTiles archive support beyond the map and inspector? →
  A: View-only. Map at every zoom, inspector, and the archive's facts. SQL,
  table, styling and export are disabled with a short reason (the archive
  holds pre-cut tiles, not a table).

## Context

Specs 001–005 deliver the four pillars (look, query, style, export) for
files that comfortably fit in memory. Today, opening a file hands the whole
file to the embedded engine, which parses all of it before anything appears.
The map then shows the first 1,000 rows of the file (a `LIMIT 1000` the user
can edit in the query), which for a large file is an arbitrary slice that
may sit in one corner of the dataset.

That breaks down quickly. A 50 MB GeoJSON did not finish opening in VS Code
within 45 seconds (found in spec 005), and the engine has a hard memory
ceiling of roughly 512 MB, so files of a few hundred MB cannot open at all.
Desktop GIS handles these files routinely, and "the file is too big" is one
of the main remaining reasons to leave the editor for QGIS.

This spec makes large files first-class: the viewer shows what is in view,
reads only what it needs where the format allows it, and is honest and
responsive where the format doesn't.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a large file and see it quickly (Priority: P1)

An analyst opens a 1.5 GB GeoParquet file of building footprints for a
whole state. Within a few seconds the viewer shows the file's facts (about
4 million features, its extent, CRS, geometry type and columns) and a map
of the whole state. The map shows an overview at that zoom, and a notice
says the map is showing a subset. Nothing freezes, and the editor stays
usable.

**Why this priority**: Without this, large files do not open at all. Every
other story depends on the file opening.

**Independent Test**: Open a GeoParquet file larger than the engine's memory
ceiling. The facts and an overview appear within the target time, memory
stays bounded, and the viewer responds to input throughout.

**Acceptance Scenarios**:

1. **Given** a GeoParquet file of 1 GB or more, **When** the user opens it,
   **Then** the row count, extent, CRS, geometry type and columns for the
   whole file appear within the target time, without reading the whole
   file.
2. **Given** the file has opened, **When** the map first appears, **Then**
   it is zoomed to the whole file's extent and shows an overview drawn from
   across that whole extent (FR-005), with a visible notice that the map
   shows a subset and how to see everything (zoom in).
3. **Given** a large file is opening, **When** the user presses Cancel,
   **Then** opening stops within 3 seconds and the viewer returns to its
   previous state (or the empty state) with no error.
4. **Given** a FlatGeobuf file with a spatial index, **When** the user opens
   it, **Then** the same holds as for GeoParquet.

---

### User Story 2 - Pan and zoom through a large file (Priority: P1)

The analyst zooms into one city. As the view settles, the map fills in
with every building in view. Panning to the next city loads its buildings.
Clicking a building opens the inspector with all of its attributes.

**Why this priority**: Seeing the data where you're looking is the core of
"look". It makes the large file useful, not just openable.

**Independent Test**: With a large file open, zoom into areas of different
density. The map shows the features in view (all of them below the cap, a
disclosed subset above it) and updates after each pan or zoom within the
target time.

**Acceptance Scenarios**:

1. **Given** a view containing fewer features than the display cap, **When**
   the view settles, **Then** every feature in the view is drawn.
2. **Given** a view containing more features than the cap, **When** the
   view settles, **Then** a subset is drawn and the notice states that it is
   a subset (for example "Showing 50,000 of about 310,000 in view; zoom in
   to see all").
3. **Given** the user pans or zooms repeatedly, **When** they stop, **Then**
   the map shows the final view's features. Loads for views the user has
   already left are abandoned, not queued.
4. **Given** features are drawn, **When** the user clicks one, **Then** the
   inspector shows all of its attributes, as in spec 001.
5. **Given** a selection from the attribute table, **When** the selected
   feature is outside the loaded area, **Then** double-clicking it still
   zooms to it and draws it highlighted.

---

### User Story 3 - Query, style and export the whole file (Priority: P2)

The analyst runs `SELECT * FROM layer WHERE height > 30`, styles the result
by height and exports it. The query runs against all 4 million buildings,
not just those on screen. The attribute table lists the whole result and
scrolls smoothly through it. The style's classes describe the whole result.
The export contains every matching row.

**Why this priority**: Specs 002, 003 and 005 must keep their meaning on
large files: "the result" is the whole result. Without this, large files
would look right but give wrong answers.

**Independent Test**: On a large file, run a filtering query, open the
table, apply a graduated style and export. Compare row counts, class
breaks and export rows with the same operations run against the full
dataset.

**Acceptance Scenarios**:

1. **Given** a large file, **When** the user runs a query, **Then** it is
   evaluated over the whole file, and the result's row count is exact.
2. **Given** a result of any size, **When** the user scrolls the attribute
   table, **Then** it can reach every row of the result, and rows appear as
   they scroll into view without freezing.
3. **Given** a result larger than what the map draws at once, **When** the
   user views it, **Then** the map shows the result's features in the
   current view (as in Story 2), not the first N rows of the result.
4. **Given** a graduated or categorized style, **When** it is computed on a
   large result, **Then** the classes and legend counts describe the whole
   result, and the legend says so.
5. **Given** a large result, **When** the user exports it, **Then** spec 005
   applies unchanged: the export contains the complete result.

---

### User Story 4 - An honest path for formats that must be read whole (Priority: P2)

A user opens a 300 MB GeoJSON. Before anything heavy happens, the viewer
says that this format must be read in full, how big it is, and that it may
be slow or not fit. It offers to continue, with progress and Cancel
always visible. If the file cannot fit, the user gets a clear message
instead of a frozen or blank viewer, with a suggestion: convert the file to
GeoParquet or FlatGeobuf, which open at any size.

**Why this priority**: GeoJSON, Shapefile and CSV are very common. Users
must never be left with a hang or a blank map, even when the file can't be
opened.

**Independent Test**: Open GeoJSON files just below and well above the
threshold. Below it, the file opens with progress. Above it, the user is
told first, can cancel at any time, and either the file opens or a clear
out-of-memory message appears. The viewer never hangs.

**Acceptance Scenarios**:

1. **Given** a whole-read format below the size threshold, **When** the
   user opens it, **Then** it opens as today, with progress shown if it
   takes longer than a moment.
2. **Given** a whole-read format above the threshold, **When** the user
   opens it, **Then** the viewer explains the situation before reading and
   lets the user continue or cancel.
3. **Given** a whole-read file that exceeds the available memory, **When**
   reading fails, **Then** the viewer shows a clear message naming the
   cause and the suggested formats, and remains usable (another file can be
   opened).
4. **Given** a whole-read file is opening, **When** the user cancels,
   **Then** reading stops within 3 seconds and memory is released.

---

### User Story 5 - View a PMTiles archive (Priority: P3)

A user opens a `.pmtiles` vector tile archive of several GB. The map shows
it at any zoom by reading only the tiles in view. Clicking a feature shows
its attributes. The facts show what the archive declares (name, zoom range,
bounds, layers).

**Why this priority**: PMTiles is the most efficient format to *look* at, and
CLAUDE.md already assigns it to the viewer, but it holds pre-rendered tiles
rather than a table, so it is a smaller slice of value.

**Independent Test**: Open a multi-GB PMTiles archive. The map renders in
view at several zooms within the target time and the inspector works.

**Acceptance Scenarios**:

1. **Given** a PMTiles vector archive, **When** the user opens it, **Then**
   the map shows its tiles in view, and only those tiles are read.
2. **Given** an archive with several layers, **When** it is shown, **Then**
   each layer is drawn and the user can tell which layer a clicked feature
   belongs to.
3. **Given** a PMTiles archive, **When** the user looks for SQL, table,
   styling or export, **Then** they are disabled, each with a short reason:
   the archive holds pre-cut tiles, not a table, so it is view-only.

---

### Edge Cases

- **Remote workspaces** (Remote-SSH, WSL, containers): partial reads may
  not be available through the remote file connection. The viewer must
  fall back to the whole-read path (Story 4) with the same honesty, not
  fail. The fallback is disclosed.
- **Web app, local files**: the browser can read slices of a picked file
  without loading it whole; partial-read formats must not be copied into
  memory there either.
- **No spatial index**: a FlatGeobuf without an index, or a Parquet file
  without per-chunk bounding boxes, still opens. Viewport loads are slower
  and this is disclosed once ("this file has no spatial index; …").
- **Very dense views**: millions of features in one view. The map shows a
  capped subset with the notice, and never tries to draw them all.
- **Very large single features** (a country with millions of vertices):
  one feature larger than the per-view budget is still drawn, or reported
  if it cannot be.
- **Features without geometry or with invalid geometry**: counted and
  listed in the table as today (spec 002), never drawn.
- **Projected files**: viewport filtering works in the file's own CRS; the
  view's extent is converted, not every feature.
- **The user's own `LIMIT`**: a query with an explicit LIMIT returns that
  many rows; the viewport only decides which of them are *drawn*.
- **A query that cannot be evaluated within memory** (for example a sort of
  the whole multi-GB file): it fails with the spec 002 message, and the
  viewer stays usable.
- **Files that change on disk while open**: as today (spec 001), not
  re-read automatically.
- **Mixed geometry types**: as today.
- **Zero features**: as today (spec 001 empty-layer state).

## Requirements *(mandatory)*

### Functional Requirements

**Opening**

- **FR-001**: The viewer MUST show the whole file's facts (row count,
  extent, CRS, geometry type, column names and types) for partial-read
  formats without reading the whole file. Where a fact is an estimate (for
  example a count declared in the file's header), it MUST be labelled as
  such until confirmed.
- **FR-002**: Opening a file MUST show progress whenever it takes longer
  than 1 second, and MUST offer Cancel throughout. Cancel MUST take effect
  within 3 seconds and release the memory used so far.
- **FR-003**: Partial-read formats (GeoParquet and Parquet with a geometry
  column, FlatGeobuf, PMTiles) MUST be read in parts: only the file's
  metadata and the parts needed for the current view, query or export. The
  whole file MUST NOT be copied into the viewer's memory. Each format is
  partial-read only after this is measured in the real build (FR-018).
- **FR-004**: Whole-read formats (GeoJSON, Shapefile, CSV, GML, GeoPackage
  unless a spike shows it can be read in parts) MUST behave as follows:
  - below a size threshold, open as today, with FR-002's progress and
    Cancel;
  - above it, explain before reading that the format must be read in full,
    give the file's size, and let the user continue or cancel;
  - when reading runs out of memory, show a clear message that names the
    cause and suggests GeoParquet or FlatGeobuf, and leave the viewer usable.

  The threshold is fixed by measurement in the plan, not by guesswork.

**The map**

- **FR-005**: The map MUST draw the features of the current result that lie
  in the current view, up to a display cap. When the view holds more than
  the cap, the drawn subset MUST be spread across the view (not the first N
  in file order), and at low zoom MUST give an overview of the whole
  dataset's distribution.
- **FR-006**: Whenever the map shows fewer features than the result holds
  in view, a notice MUST say so, with counts (exact or labelled estimates)
  and how to see everything (zoom in, or filter with a query).
- **FR-007**: After the user stops panning or zooming, the map MUST update
  to the new view. Loads for views the user has already left MUST be
  abandoned. Features already drawn stay visible until replaced (no flash
  of an empty map).
- **FR-008**: Selection, the inspector, zoom-to-feature and the selection
  highlight (spec 001) MUST keep working for features outside the loaded
  area: selecting a row zooms to it and draws it.
- **FR-009**: Viewport loading MUST apply to every file, whatever its size.
  The default query MUST be `SELECT * FROM layer` (no LIMIT), so the
  initial view is the whole file, drawn by view (FR-005). Spec 002's "Show
  first 50,000" prompt MUST be removed: any result size is shown this way.
  A WHERE or LIMIT the user writes is respected as part of their query.
- **FR-009a**: PMTiles archives MUST be view-only: the map, the inspector
  and the archive's declared facts (bounds, zoom range, layers). SQL, the
  attribute table, styling and export MUST be disabled with a short reason.

**The whole dataset**

- **FR-010**: Queries (spec 002) MUST be evaluated over the whole file. The
  reported row count of a result MUST be exact.
- **FR-011**: The attribute table MUST be able to reach every row of the
  current result, loading rows as they scroll into view, with sorting
  applied to the whole result (or disclosed as unavailable for results too
  large to sort within memory).
- **FR-012**: Thematic styles (spec 003) MUST classify over the whole
  result. Legend counts MUST describe the whole result. When the result is
  too large to classify within the time target, the style MUST say it used
  a sample and how large the sample was.
- **FR-013**: Export (spec 005) MUST keep exporting the complete result.

**Robustness and honesty**

- **FR-014**: Running out of memory at any stage (opening, viewport load,
  query, styling, export) MUST produce a clear message naming the stage and
  a way forward, and MUST leave the viewer usable. A blank map or a hang
  is a failure.
- **FR-015**: When the platform cannot read files in parts (for example a
  remote workspace where a spike shows it is unavailable), the viewer MUST
  fall back to the whole-read path (FR-004) and say why, once.
- **FR-016**: Every limit that affects what the user sees (display cap,
  sampling, estimated counts, fallback to whole reads, missing spatial
  index) MUST be disclosed where the user is looking (map notice, status
  bar, legend or table header). Nothing is limited silently.
- **FR-017**: The viewer MUST NOT send file contents anywhere: partial
  reads stay between the viewer and the local (or remote-workspace) file
  (Constitution IV).

**Verification**

- **FR-018**: Each format MUST be classified as partial-read or whole-read
  only after it is measured in the real build in both shells, and the
  measurement is recorded. No format is described as fast or "any size"
  until then. The format matrix in the user documentation MUST state each
  format's classification and measured limits.

**Both shells**

- **FR-019**: All of the above MUST work in the VS Code extension and the
  web app with the same behavior, except where a platform limit is
  disclosed (FR-015).

### Key Entities

- **Dataset facts**: the whole file's row count (exact or estimated),
  extent, CRS, geometry type, columns, whether it has a spatial index, and
  its read mode (partial or whole). Shown immediately; never derived from
  the subset on screen.
- **Read mode**: partial-read (only needed parts are read) or whole-read
  (the file must be read in full), per format and per platform, decided by
  measurement.
- **View load**: the features of the current result drawn for one map view:
  the view's extent and zoom, the features drawn, how many the view holds
  (exact or estimated), and whether it is a capped subset.
- **Display cap**: the most features drawn for one view; when exceeded, a
  spread-out subset is drawn and disclosed.
- **Result**: as in spec 002, always the complete set of rows a query
  returns. The table, styles and export work on it; the map draws the part
  in view.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A 1 GB GeoParquet file and a 1 GB FlatGeobuf file show their
  whole-file facts within 5 seconds and a map overview within 10 seconds
  of opening, in both shells.
- **SC-002**: The viewer opens and explores a partial-read file of at least
  5 GB without running out of memory, staying under the engine's memory
  ceiling throughout a session of opening, panning, zooming, querying and
  exporting a filtered result.
- **SC-003**: After a pan or zoom stops, the map shows the new view's
  features within 2 seconds for views at or below the display cap, on the
  1 GB test files.
- **SC-004**: The viewer never stops responding to input for 1 second or
  more during opening, viewport loads, queries or styling on the test
  files.
- **SC-005**: Cancel during opening takes effect within 3 seconds in 100%
  of trials, for every format.
- **SC-006**: For whole-read formats, 100% of files above the threshold
  are announced before reading, and 100% of out-of-memory failures end in
  the clear message with the viewer still usable (zero hangs or blank
  viewers in the test set).
- **SC-007**: A filtering query on the 1 GB GeoParquet returns an exact
  row count, and its export contains exactly that many rows.
- **SC-008**: Every displayed limit in the test scenarios is disclosed: an
  audit of the map, table, legend and status bar finds zero silent
  subsets.
- **SC-009**: Files that open today (specs 001–005 test sets) open at
  least as fast as before, and every existing suite still passes.

## Assumptions

- **Test data**: realistic large files are generated or downloaded for
  testing (for example building footprints or parcels): GeoParquet,
  FlatGeobuf with an index, GeoJSON at several sizes, and a PMTiles vector
  archive. They are not committed to the repository.
- **Display cap**: the per-view display cap is chosen by measurement in the
  plan (map drawing speed in the webview), not set as a user setting,
  consistent with the decision not to add a cap setting.
- **Overview**: at low zoom, the overview is a subset spread across the
  extent (for example a spatially even sample, or simplified features).
  Aggregated displays (heat maps, hexagon bins) are not part of this spec.
- **Estimated counts**: counts "in view" may be estimates when exact
  counting would be slow; the whole-file row count is exact when the file
  declares it or once it is counted.
- **Whole-read threshold**: the size above which whole-read formats are
  announced is measured in the plan (the engine's ceiling is about 512 MB,
  and a parsed file takes several times its size on disk).
- **Remote workspaces**: partial reads through Remote-SSH/WSL are verified
  by a spike. If unavailable, the fallback of FR-015 applies; this spec
  does not require building a new transfer mechanism for remote files.
- **Out of scope**: editing, raster data, remote or cloud URLs as sources
  (unless the plan's spike shows they come nearly free), multi-file
  sessions (spec 006), 3D, aggregated overview displays, and converting
  files inside the viewer (the message points to formats, not a converter).
- **Dependencies**: specs 001 (open, map, table, inspector), 002 (query
  model and the large-result prompt), 003 (styling), 005 (export). Changes
  to their behavior are listed in this spec's requirements; everything else
  stays as specified there. Notably, the default query loses its
  `LIMIT 1000` and the 50,000 prompt goes away (FR-009). Spec 005's "All N
  rows / only the M shown" choice then no longer arises; export always
  writes the complete result.
