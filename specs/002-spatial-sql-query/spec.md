# Feature Specification: Spatial SQL Query

**Feature Branch**: `002-spatial-sql-query`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Spatial SQL query (QUERY pillar of Spatial Explorer). In both the VS Code extension and the web app, users can write and run SQL (DuckDB spatial dialect) against the file(s) they have open, and the results are shown on the map and in the attribute table. The opened file is exposed as a ready-made, queryable table (e.g. named after the file, or "layer") so users don't need to know the reader function. Results that contain a geometry column become a map layer; results without geometry show in the table only. An embedded SQL editor is docked in the viewer (resizable, alongside the map and attribute drawer), with syntax highlighting, keyboard run (Ctrl/Cmd+Enter), and autocomplete for table names, column names and spatial functions from the live catalog. The default feature cap (1000) applies as the initial query's LIMIT, and users raise or remove it by editing their query, so the 1000-feature default from spec 001 becomes an editable query, not a hidden setting. Clear, specific error messages for invalid SQL (with position where possible); long-running queries can be cancelled; query timing is reported (VS Code output channel and in-UI). A short per-file query history is kept. Results can be reset back to the original layer view. Out of scope for this spec: multi-file sessions and joins across separately opened files (later spec), thematic styling (later spec), exporting results to files (later spec), writing/editing the source file."

## Clarifications

### Session 2026-10-10

- Q: In which CRS should the queryable table expose geometry? → A: The file's
  original CRS. Results are reprojected for display automatically (FR-014).
- Q: Which statements can users run? → A: Read queries plus temporary
  in-viewer tables and views. Writing files, installing or attaching, changing
  settings and modifying the file's table are refused (FR-013).
- Q: What happens when a result is too large to show safely? → A: The size is
  checked first. Above a threshold, the user chooses Show all, Show first
  50,000, or Cancel (FR-012).

## Context

Spec 001 (Quick Look) opens one vector file and shows it on a map and in an
attribute table, showing at most 1,000 features. This spec adds the QUERY
pillar: the user writes spatial SQL against the opened file and sees the
result in the same map and table. The query that produces spec 001's view
becomes visible and editable. The 1,000-feature default is the initial
query's row limit, not a hidden setting.

Scope is one opened file per viewer, as in spec 001. Querying across
several files belongs to a later spec on multi-file sessions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run a query and see the result on the map and in the table (Priority: P1)

A user has a file open. They open the query editor, which already contains
the query behind the current view: all columns of the file's table, limited
to 1,000 rows. They change it, for example to filter to features whose
`zone` is `'R1'` and whose area is over one hectare, and run it with
Ctrl/Cmd+Enter. The map and the attribute table show exactly the rows the
query returned. Map/table selection sync, click-to-inspect and fit-to-layer
work on the result as they did on the original layer.

**Why this priority**: this is the QUERY pillar itself. Without it there is
no feature. It also replaces spec 001's hidden 1,000-feature cap with
something the user controls.

**Independent Test**: open a sample file, run a filtering query, and confirm
that the map and the table contain exactly the rows the query returns,
including the row count shown.

**Acceptance Scenarios**:

1. **Given** a file is open, **When** the user opens the query editor,
   **Then** it shows the query that produced the current view, including
   its 1,000-row limit, and the file is available under a stable table name
   without the user knowing how the file is read.
2. **Given** the editor contains a valid query that returns geometry,
   **When** the user runs it, **Then** the map shows only the returned
   features, fitted to their extent. The table shows the same rows and
   columns, and the feature count shown matches the number of rows returned.
3. **Given** the user removes or raises the `LIMIT`, **When** they run the
   query, **Then** more than 1,000 features are shown, within the
   large-result safeguard (FR-012).
4. **Given** a query result is shown, **When** the user selects a row or
   clicks a feature, **Then** selection sync and the feature inspector work
   as in spec 001.

---

### User Story 2 - Understand and recover from query problems (Priority: P1)

A user writes a query with a typo, references a column that doesn't exist,
or runs a query that takes too long. They get a specific error message that
points to the problem and can fix it and run again. They can cancel a
long-running query. The previous result stays on screen until a new query
succeeds, so a failed query never leaves the viewer blank or broken.

**Why this priority**: a query feature that fails silently, hangs, or wipes
the view on error is unusable. This is as important as running a query at
all.

**Independent Test**: run an invalid query and a deliberately slow query,
and confirm a specific, position-aware error for the first, a working
Cancel for the second, and that the previous result remains visible in both
cases.

**Acceptance Scenarios**:

1. **Given** a query with a syntax error, **When** it is run, **Then** a
   specific error message is shown that names the problem and, where the
   engine reports one, the position (line and column), with that position
   marked in the editor. The previously shown result is unchanged.
2. **Given** a query referencing a column or table that doesn't exist,
   **When** it is run, **Then** the error names the missing column or table.
3. **Given** a query is running, **When** the user chooses Cancel, **Then**
   the query stops within a few seconds, the viewer stays responsive and
   shows the previous result, and the user can run another query.
4. **Given** any query completes, **Then** its duration and row count are
   shown in the query area. In VS Code they are also written to the
   extension's output channel.

---

### User Story 3 - Get back to the original view (Priority: P2)

After exploring with queries, the user wants the file as it was originally
opened. One action ("Reset") restores the original layer view: the
default query, its result, the map extent and the layer style.

**Why this priority**: exploration needs a safe way back. Without it, users
must re-open the file.

**Independent Test**: run any query, choose Reset, and confirm the view
matches a freshly opened file.

**Acceptance Scenarios**:

1. **Given** a query result is shown, **When** the user chooses Reset,
   **Then** the editor shows the default query again and the map and table
   match the originally opened view.

---

### User Story 4 - Write queries faster with autocomplete (Priority: P2)

While typing, the user gets suggestions for the file's table name, its
columns (with their types), SQL keywords, and the available spatial
functions, drawn from what is actually available in the running engine
rather than a fixed list. The editor highlights SQL syntax.

**Why this priority**: autocomplete removes the most common query errors
(misspelled columns and functions). It is not required to run a query,
however.

**Independent Test**: type the start of a column name and of a spatial
function and confirm both are suggested and correctly completed.

**Acceptance Scenarios**:

1. **Given** the editor is focused, **When** the user types the first
   letters of a column name, **Then** matching columns from the opened file
   are suggested, with their types.
2. **Given** the user types the start of a spatial function name, **Then**
   matching functions available in the running engine are suggested.

---

### User Story 5 - Reuse recent queries (Priority: P3)

The user re-runs or edits a query they ran earlier on the same file, even
after closing and re-opening it.

**Why this priority**: convenience on top of the core loop.

**Independent Test**: run three queries, close and reopen the file, and
confirm all three are in the history and can be loaded into the editor.

**Acceptance Scenarios**:

1. **Given** the user has run queries on a file, **When** they open the
   history, **Then** the most recent queries for that file are listed
   newest first, each with when it was run and its outcome (rows returned
   or error).
2. **Given** a history entry, **When** the user picks it, **Then** its
   text is loaded into the editor without running automatically.

---

### Edge Cases

- **A query returns no geometry column** (e.g. `SELECT zone, COUNT(*) …
  GROUP BY zone`): the table shows the result, the map keeps showing the
  original layer dimmed, and a short note says the result has no geometry
  to map.
- **A query returns several geometry columns**: the first is mapped, and
  the others are shown in the table as text summaries.
- **A query returns zero rows**: an empty map and an empty table with a
  "0 rows" indication, as for spec 001's zero-feature files. This is not an
  error.
- **A result contains invalid or empty geometries**: they are skipped on the
  map with a visible count, as in spec 001 (FR-014 there). The rows still
  appear in the table.
- **Mixed geometry types in a result**: all are rendered, as in spec 001.
- **The editor contains several statements**: only the selected text, or the
  statement under the cursor, is run, so the user always knows which one ran.
- **A statement that writes files, installs or attaches anything, changes
  settings, or modifies the file's table** (`COPY … TO`, `INSTALL`, `ATTACH`,
  `SET`, `INSERT INTO layer`, …): refused before execution with a specific
  message (FR-013). The previous result stays displayed.
- **A query transforms geometry to another CRS** (e.g. to Web Mercator):
  it is mapped correctly from that CRS (FR-014).
- **A result is very large** (e.g. no `LIMIT` on a 2-million-row file):
  the user is asked before anything above 50,000 rows is rendered (FR-012).
- **The file has no CRS** (spec 001's "WGS84 assumed" case): queries still
  run, and the assumption is still disclosed.
- **A query runs while the theme or basemap changes**: unaffected. The
  result keeps its style and the basemap behaves as in spec 001.
- **The source file changes on disk while a result is shown**: spec 001's
  "changed on disk" notice applies, and Reload re-opens the file and resets
  to the default query.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to open a query editor docked in the viewer,
  alongside the map and attribute table, in both the VS Code extension and
  the web app. The editor MUST be resizable and collapsible, like the
  attribute drawer, and MUST NOT cover the map's controls.
- **FR-002**: The opened file MUST be queryable under a stable, documented
  table name. Users MUST NOT need to know how the file is read (reader
  functions, file paths, formats). The name MUST be shown in the query area.
- **FR-003**: When a file opens, the editor MUST contain the default query
  that produced the initial view: all columns of the file's table, limited
  to 1,000 rows. Its result MUST be identical to spec 001's initial view.
- **FR-004**: Users MUST be able to run the current query with
  Ctrl+Enter (Cmd+Enter on macOS) and with a visible Run control. When text
  is selected, only the selection runs. Otherwise the statement under the
  cursor runs.
- **FR-005**: When a query returns a column holding geometry, the map MUST
  show the returned rows, positioned correctly regardless of their CRS (see
  FR-014), and fit to their extent. The attribute table MUST show the same
  rows and all non-geometry columns.
- **FR-006**: When a query returns no geometry column, the table MUST show
  the result, and the map MUST indicate that the result has nothing to map
  (see Edge Cases).
- **FR-007**: Spec 001's map/table behaviors MUST work on query results:
  selection sync, click-to-inspect, zoom-to-feature, fit-to-layer, sorting,
  layer style, and the status bar's count/type/CRS.
- **FR-008**: Invalid queries MUST produce a specific message that names the
  problem (e.g. the missing column or table) and, when the engine reports
  it, the line and column, with that position marked in the editor. A
  failed query MUST leave the previous result displayed.
- **FR-009**: Users MUST be able to cancel a running query. Cancellation MUST
  return control within a few seconds (see SC-004) and leave the previous
  result displayed.
- **FR-010**: Every completed query MUST report its duration and row count
  in the query area. The VS Code extension MUST also write each query (text,
  duration, row count or error) to its output channel.
- **FR-011**: Users MUST be able to reset to the original view (FR-003's
  default query and result) with one action.
- **FR-012**: Before rendering, the system MUST check the result's size. If it
  exceeds a safety threshold (initially 50,000 rows; see Assumptions), the
  user MUST be asked how to proceed, with three choices:
  - **Show all**, with a warning that it may be slow;
  - **Show the first 50,000**;
  - **Cancel**.

  Nothing above the threshold is rendered without that choice. If showing
  all still exceeds available memory, the viewer MUST fail with a clear
  message and keep the previous result, never crash or hang.
- **FR-013**: Users MUST be able to run:
  - read queries: `SELECT`, `WITH`, `DESCRIBE`, `SUMMARIZE`, `EXPLAIN`;
  - statements that create, replace or drop **temporary tables and views**
    living only in this viewer, so multi-step analysis is possible (e.g.
    buffer, then intersect).

  Temporary objects appear in autocomplete and can be queried like the
  file's table. They disappear when the viewer closes.

  Statements that write files, install or load extensions, attach other
  databases, change settings, or modify the file's table MUST be refused
  before execution, with a message saying what is not allowed and why.
- **FR-014**: Geometry in the queryable table MUST be in the file's
  **original CRS**, so measurements (area, length, distance) come out in the
  file's own units. The query area MUST show the table's CRS.

  Results MUST be reprojected for display automatically:
  - geometry left in the source CRS is reprojected from it;
  - geometry the user explicitly transformed to another CRS is mapped from
    that CRS;
  - when the CRS can't be determined, the map uses the table's CRS and says
    so (the same disclosure as spec 001's "WGS84 assumed").
- **FR-015**: The editor MUST highlight SQL syntax and MUST offer
  autocomplete for the file's table name, its columns (with types), SQL
  keywords, and the spatial functions available in the running engine.
- **FR-016**: The system MUST keep a history of the most recent queries per
  file (see Assumptions for the size), surviving closing and re-opening the
  file. Each entry has the query text, when it ran, and its outcome. Picking
  an entry loads it into the editor without running it.
- **FR-017**: All query controls (editor, Run, Cancel, Reset, history) MUST
  be keyboard-reachable, labeled and theme-native, as required for spec 001
  (light, dark and high-contrast in VS Code; brand light/dark on the web).
- **FR-018**: Queries MUST run entirely locally. Query text, results and
  history MUST NOT leave the machine.

### Key Entities

- **Queryable table**: the opened file exposed under a stable name, with its
  columns and types and its geometry in the file's original CRS. There is one
  per viewer. Temporary tables and views created by the user's queries live
  alongside it in the same viewer (FR-013).
- **Query**: the SQL text the user runs (or the selected part), with its
  state: idle, running, succeeded, failed, cancelled.
- **Query result**: the rows and columns a query returned, which geometry
  column (if any) is mapped, its row count, duration and any skipped-geometry
  count. A result replaces the displayed view until reset or replaced.
- **Default query**: the query that reproduces the file's initial view (all
  columns, `LIMIT 1000`), which Reset restores.
- **Query history entry**: query text, time run, outcome (row count or error
  message), scoped to one file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a ~10 MB file, a filtering query returning up to 1,000
  rows shows its result on the map and in the table within 1 second of
  running it.
- **SC-002**: The default query's result is identical to spec 001's initial
  view (same rows, same columns, same order) for every supported format.
- **SC-003**: 100% of invalid queries in a test set (syntax errors, unknown
  columns, unknown tables, unknown functions, type errors) produce a message
  naming the specific problem, and none blanks or breaks the viewer.
- **SC-004**: A running query can be cancelled, with the viewer responsive
  again, within 3 seconds of choosing Cancel.
- **SC-005**: A first-time user can write and run a working filter query on
  an opened file within 2 minutes, using only autocomplete, without
  external documentation.
- **SC-006**: Query features produce the same results in the VS Code
  extension and the web app for the same file and query.
- **SC-007**: Query history entries survive closing and re-opening the file
  and are attributed to the right file in 100% of cases.

## Assumptions

- **One file per viewer.** Joins across separately opened files, and
  sessions of several files, belong to a later spec. Self-joins and
  subqueries on the one table are in scope.
- **The result replaces the displayed layer** rather than being added as an
  extra layer: one layer at a time, as in spec 001. Reset restores the
  original.
- **The style carries over to results.** The current layer style applies,
  and spec 001's style save/export keeps working. Thematic styling of
  results belongs to a later spec.
- **Table name.** The file is available as `layer`, a fixed name so saved
  queries work on any file. When the file name is a valid identifier, its
  name without the extension (e.g. `parcels`) is also available. Both are
  shown in the query area.
- **Statement selection.** If text is selected, only the selection runs.
  Otherwise the statement under the cursor runs.
- **Query history** keeps the 20 most recent queries per file, newest first,
  stored locally on the user's machine through the same preference storage
  as spec 001's blank basemap color. It is cleared only when the user clears
  it.
- **Exporting results is out of scope** (a later spec). The table can still
  be selected and copied as in spec 001.
- **Map performance** follows spec 001's limits.
  - The large-result safeguard (FR-012) uses an initial threshold of 50,000
    rows. Spec 001's measurements show that is comfortably within the
    memory ceiling for typical geometry.
  - The threshold may be tuned during planning, based on measurements.
  - Viewport-based loading of very large results remains a later
    performance slice.
- **Temporary objects** created by queries (FR-013) are not part of query
  history, and do not survive reload or "changed on disk"; the history keeps
  only the query text.
- **SQL dialect.** The SQL is that of the embedded engine spec 001 already
  uses, including its spatial functions. No new language is invented, and
  the dialect's documentation is linked from the query area.
- **Persistence.** Persistence and file access go through the existing
  host-agnostic interfaces from spec 001. Nothing in this spec stores data
  outside the user's machine.
