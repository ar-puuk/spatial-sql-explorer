# Feature Specification: Quick Look

**Feature Branch**: `001-quick-look`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Quick look. Open a geospatial file and immediately see it on a map and in a table. Users: analysts, data scientists and developers who need to inspect geospatial files without opening a desktop GIS."

## Clarifications

### Session 2026-10-09

- Q: Which file formats must spec 001 actually support opening? → A: Everything DuckDB's spatial extension can read natively (`ST_Read`/`read_parquet`), confirmed per-format against the real WASM build in the Phase 0 spike rather than assumed from documentation. GeoPackage is explicitly flagged as high-risk: GeoLibre (same DuckDB-WASM + MapLibre stack) does not use DuckDB for `.gpkg` at all — it reads via sql.js (SQLite WASM) instead, citing write limitations and multi-layer/`gpkg_ogr_contents` quirks — so `.gpkg` support must not be presumed working until the spike confirms it, and a non-DuckDB fallback (sql.js) should be considered if the spike fails.
- Q: What target file size / load time should spec 001 be designed and tested against? → A: Small, ~10MB, loading in under ~2 seconds.
- Q: How should spec 001 handle a file that contains multiple layers (e.g. a GeoPackage with several tables)? → A: Open the first layer only; a layer picker is deferred to a later spec.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a file from VS Code and see it rendered (Priority: P1)

As a VS Code user, I right-click a supported geospatial file (or use Open With, or set
it as the default viewer) and it opens in a viewer showing the data on a map and its
attributes in a table. Map and table selection stay in sync. The layer's extent is
fitted on open.

**Why this priority**: this is the entire value proposition of the product — "never
open QGIS for basic GIS work" starts with this single interaction. Without it there is
no product.

**Independent Test**: can be fully tested by right-clicking a supported file in the VS
Code Explorer, opening it in the viewer, and confirming the map shows the geometry
(zoomed to its extent) and the table shows matching attribute rows, with no other
feature present.

**Acceptance Scenarios**:

1. **Given** a supported geospatial file in the VS Code Explorer, **When** the user
   opens it via the default editor association, **Then** the viewer opens showing the
   data rendered on a map, zoomed/panned to fit the layer's extent, and an attribute
   table listing its features.
2. **Given** the viewer is open, **When** the user selects a row in the table,
   **Then** the corresponding feature is highlighted on the map, and vice versa when a
   feature is clicked on the map.
3. **Given** a file the viewer does not support, **When** the user tries to open it
   with Spatial Explorer, **Then** the user sees a clear message explaining the file
   could not be opened, with no partial or broken viewer state.

---

### User Story 2 - Open a file from the web shell (Priority: P1)

As a web user, I open a file by picker or drag-and-drop and get the same viewer
experience as the VS Code extension: map and table of the opened file's data.

**Why this priority**: the product ships as both a standalone web app and a VS Code
extension from one codebase; the web shell must prove the same core pipeline
independent of any VS Code host, in parallel with User Story 1.

**Independent Test**: can be fully tested by opening the web app, dragging a supported
file onto it (or choosing it via a file picker), and confirming the same map + table
result as User Story 1.

**Acceptance Scenarios**:

1. **Given** the web app is open, **When** the user drags a supported geospatial file
   onto it or selects one via a file picker, **Then** the viewer shows the data on a
   map and in a table, matching the VS Code experience.
2. **Given** the web app is open with no file loaded, **When** no file has been chosen
   yet, **Then** the user sees a clear empty state inviting them to open a file.

---

### User Story 3 - Understand what was loaded (Priority: P2)

As a user inspecting a file, I can see the layer's coordinate reference system (CRS),
feature count, and geometry type, and the cursor's coordinates as I move over the map,
even when the source CRS is not WGS84.

**Why this priority**: this is the core "quick look" value beyond just rendering —
knowing what you're looking at (CRS, count, geometry type) is the reason to reach for
this tool instead of guessing from the raw file. It depends on User Story 1/2 already
working.

**Independent Test**: can be fully tested by opening a file with a known non-WGS84 CRS
and confirming the displayed CRS, feature count, and geometry type match the file's
actual metadata, and that moving the cursor over the map updates displayed coordinates.

**Acceptance Scenarios**:

1. **Given** an opened file, **When** the viewer finishes loading it, **Then** the
   layer's CRS, feature count, and geometry type are displayed.
2. **Given** a file whose source CRS is not WGS84, **When** it is rendered on the map,
   **Then** the geometry displays correctly positioned (reprojected for display) and
   the *original* source CRS is what is shown to the user, not the reprojected one.
3. **Given** the map is visible, **When** the user moves the cursor over it, **Then**
   the current cursor coordinates are displayed and update continuously.

---

### User Story 4 - Get a usable default basemap (Priority: P2)

As a user looking at a file, I get a sensible default basemap that matches the light
or dark appearance of the host, and I can turn the basemap off (blank background).

**Why this priority**: an appropriate basemap materially affects whether the "quick
look" is actually useful (context for the data), and makes the viewer feel native to
its host. It is not required for the core open-and-inspect loop to be testable, so it
ranks below Stories 1–3.

**Independent Test**: can be fully tested by opening the viewer under a light host
theme and a dark host theme and confirming the default basemap matches each, and by
toggling the basemap off and confirming a blank background with no map errors.

**Acceptance Scenarios**:

1. **Given** the host is in light appearance, **When** the viewer opens, **Then** a
   light-appropriate default basemap is shown.
2. **Given** the host is in dark appearance, **When** the viewer opens, **Then** a
   dark-appropriate default basemap is shown.
3. **Given** the viewer is open, **When** the user turns the basemap off, **Then** the
   background becomes blank and the data layer remains visible and correctly
   positioned.

---

### User Story 5 - Inspect a single feature (Priority: P3)

As a user looking at the map, I can click a feature to inspect its attributes.

**Why this priority**: useful but strictly additive once Stories 1–4 work — the table
view already exposes attributes; map-click inspection is a convenience on top.

**Independent Test**: can be fully tested by clicking a rendered feature on the map and
confirming its attributes are shown, independent of any other feature in this spec.

**Acceptance Scenarios**:

1. **Given** rendered features on the map, **When** the user clicks one, **Then** that
   feature's attributes are displayed (e.g. in the table, via a selection or a popup).

---

### Edge Cases

- What happens when the user opens an unsupported or corrupt file? The viewer must
  show a clear error message and must not leave a broken or partially-rendered state.
- What happens when the opened file contains zero features? The viewer opens showing
  an empty map and an empty table with a visible "no features" indication, not an
  error.
- How does the system handle mixed geometry types within one layer (e.g. points and
  polygons together)? All geometries render; the table shows all rows regardless of
  geometry type.
- How does the system handle invalid geometries within a layer? Invalid geometries are
  skipped for rendering with a visible warning/count, rather than failing the whole
  load.
- How does the system handle a file with multiple layers? Only the first layer is
  opened for this vertical slice; a layer picker/multi-layer view is deferred to a
  later spec.
- What happens when the file has no CRS information? The system assumes WGS84 and
  surfaces this assumption to the user rather than silently guessing without
  disclosure.
- What happens with a very large file? Spec 001 targets small files (~10MB, loading in
  under ~2 seconds); files substantially larger than that may load slowly or hit
  resource limits, and dedicated large-file handling (viewport bbox queries, range
  reads) is deferred to later hardening per the project's performance rules. The
  default 1000-feature display cap (FR-019) also bounds how much is ever rendered
  at once regardless of file size, independent of the byte-size target.
- What happens if the file changes on disk while it is open in the viewer? The viewer
  does not need to live-reload in this spec; the user can be told the file changed
  on next relevant interaction, but stale data must not be silently presented as current
  without any indication on reopen.
- What happens when the host's theme changes while the viewer is open? The basemap and
  chrome update to match the new theme without requiring the user to reopen the file.
- What happens when there is no network connectivity? The data layer and table still
  work fully (local-first); only the basemap is affected, and it must degrade to a
  blank background with a short message rather than fail the whole viewer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to open a supported geospatial file from within VS
  Code (via right-click, Open With, or as the default viewer for that file type) and
  have it rendered in the viewer.
- **FR-002**: Users MUST be able to open a supported geospatial file in the standalone
  web app via a file picker or drag-and-drop, with the same rendering outcome as the
  VS Code experience.
- **FR-003**: The system MUST display the opened file's geometry on a map, with the
  view fitted to the layer's extent on open.
- **FR-004**: The system MUST display the opened file's attributes in a table,
  alongside the map.
- **FR-005**: Selecting a feature in the table MUST highlight the corresponding
  feature on the map, and selecting a feature on the map MUST highlight the
  corresponding row in the table.
- **FR-006**: The system MUST display the layer's coordinate reference system,
  feature count, and geometry type after a file loads.
- **FR-007**: The system MUST correctly position geometry on the map regardless of the
  file's source CRS, reprojecting for display while reporting the original source CRS
  to the user.
- **FR-008**: The system MUST display the cursor's live map coordinates while the
  cursor is over the map.
- **FR-009**: The system MUST show a default basemap matching the host's light or dark
  appearance, and MUST let the user turn the basemap off entirely (blank background).
- **FR-010**: The system MUST let the user click a rendered feature to inspect its
  attributes.
- **FR-011**: The system MUST show a clear, specific error message (not a generic
  failure or blank screen) when a file cannot be opened because it is unsupported,
  corrupt, or otherwise unreadable.
- **FR-012**: The system MUST handle an opened file that contains zero features by
  showing an empty map and an empty table with a visible indication, not an error.
- **FR-013**: The system MUST render all geometry types present in a single layer,
  including mixed geometry types, in both map and table.
- **FR-014**: The system MUST skip invalid geometries during rendering while surfacing
  a visible count/warning, rather than failing the entire file load.
- **FR-015**: The system MUST assume WGS84 for a file with no CRS information and
  disclose that assumption to the user rather than silently guessing.
- **FR-016**: The system MUST degrade basemap failures (offline, blocked request, bad
  key) to a blank background with a short, visible message, without affecting the data
  layer or table.
- **FR-017**: The system MUST update chrome and basemap to match a host theme change
  that occurs while the viewer is already open.
- **FR-018**: The system MUST support opening the following vector file formats,
  each confirmed readable (via `ST_Read` or `read_parquet`) against the actual WASM
  runtime this product ships (Phase 0 spike, `research.md` §1 "T006 resolution"):
  GeoJSON, CSV (with coordinate columns), GeoParquet, FlatGeobuf, GeoPackage,
  Shapefile, and GML. MapInfo TAB is explicitly excluded from this spec's supported
  list pending resolution of an unverified companion-file read issue — it MUST NOT be
  listed as supported in user-facing copy until a passing spike confirms it.
- **FR-019**: When an opened layer has more features than a default display cap, the
  system MUST render only the first 1000 features (or all features, if the layer has
  1000 or fewer) by default, and MUST visibly indicate to the user that the view is
  showing a truncated subset rather than the complete dataset.

### Key Entities

- **Layer**: a single opened geospatial dataset — has a geometry type (or mixed),
  source CRS, feature count, and an ordered collection of features. Produced by
  opening one file (or, for multi-layer files, one layer within it — see Edge Cases).
- **Feature**: one record within a layer — has a geometry and a set of named
  attribute values. Shared identity between its map representation and its table row.
- **Viewer session**: the open instance of the viewer bound to one file — holds the
  current layer, basemap choice, and selection state (which feature, if any, is
  selected) for the duration the file is open.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can go from choosing a supported file of up to ~10MB to seeing it
  rendered on the map and in the table in under 2 seconds.
- **SC-002**: 100% of formats confirmed supported by the Phase 0 spike open
  successfully and show correct geometry placement and attribute data when tested
  against sample files of that format.
- **SC-003**: A user can identify a layer's CRS, feature count, and geometry type
  within 2 seconds of the file finishing load, without consulting any other tool.
- **SC-004**: Selecting a feature in either the map or the table highlights the
  matching counterpart with no perceptible delay (under 100ms).
- **SC-005**: When a file cannot be opened, 100% of such attempts show a specific,
  understandable error message rather than a blank, frozen, or crashed viewer.
- **SC-006**: The viewer produces the same rendering outcome (map + table content)
  for the same file whether opened via the VS Code extension or the web app.

## Assumptions

- "Supported geospatial file" for this slice means vector formats only; raster files
  are out of scope (per product scope: LOOK/QUERY/STYLE/EXPORT on vector data).
- Users have the file already available locally (on disk, or chosen via a local file
  picker); remote/URL-based opening is out of scope for this slice.
- No authentication or multi-user concerns apply — this is a single-user, local,
  read-only "look" at one file at a time.
- Styling beyond a single sensible default (one color/symbol per geometry type) is out
  of scope for this spec and is deferred to spec 003.
- SQL querying, export, and multi-file sessions are out of scope for this spec and are
  deferred to specs 002, 005, and 006 respectively.
- A basemap picker (choosing among multiple basemaps) is out of scope for this spec;
  only a single sensible default plus an on/off toggle is required here, with the full
  picker deferred to spec 004.
