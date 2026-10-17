# Spec 017: Grid cells (H3 and A5)

**Status:** draft for review (2026-10-17), branch `017-grid-cells`. Step 1 (the extensions) is built and committed;
this spec covers step 2, the "Bin into cells" action. Research: research.md.
**Request (user, 2026-10-17):** start with the h3 and a5 DuckDB extensions, in two steps: the extensions first, then an
action that bins a layer into cells and draws them.

## Purpose

A layer with many points (crashes, calls, sensors) is hard to read as dots. Binning it into a regular grid of cells and
coloring each cell by how many points fall in it (or by an average of a column) shows the pattern at a glance and makes
areas comparable. Two grid systems are offered:

- **H3**: hexagonal cells, hierarchical, widely used. Cell sizes differ with latitude.
- **A5**: pentagonal cells of equal area everywhere, so densities compare fairly across latitudes.

This is a quick-look summary tool, in scope as QUERY plus STYLE: the result is an ordinary query result, drawn and styled
like any other. No new layers, no editing of the data.

## Decisions already made (user, 2026-10-17)

- Two steps. Step 1 (built): `fts`, `h3` and `a5` load with the engine, so the functions can be typed in SQL.
  Step 2 (this spec): the guided action.
- The community extensions come from `community-extensions.duckdb.org` and are pinned and hash-checked
  (constitution v1.4.0). Their start-up report to Query.Farm is blocked.
- Everything runs in the SQL engine (DuckDB-first). The action writes SQL; it does not compute cells in JavaScript.

## User stories

### 1. Bin a layer into cells (priority 1)
The user opens a layer, chooses **Bin into cells**, picks a grid system (H3 or A5), a resolution and what each cell
shows (the number of features, or the sum, average, minimum, maximum or median of a numeric column). The cells are
drawn on the map, colored by that value, with a legend.
- *Acceptance:* from opening a point layer to a drawn, colored grid takes no more than four choices and one confirmation,
  and the first choices offered already give a sensible result (default grid H3, a resolution picked from the layer's
  extent, the feature count).

### 2. Choose the resolution with confidence (priority 1)
Resolution numbers mean nothing by themselves. The picker shows, for each resolution, the approximate cell size (an
edge length or area in the user's units) and, from the layer's extent, roughly how many cells the result will have.
- *Acceptance:* the picker never offers a resolution that would exceed the cell limit without a warning; the user can
  go finer after confirming. The limit follows the map's own drawing rule (results under 100,000 rows are drawn from
  memory; larger ones are drawn from engine-built tiles).

### 3. See and own the SQL (priority 1)
The action shows the query it wrote, in the query panel, where it can be edited and rerun. The result is a normal
query result: it has the table, the legend, the style panel and every export format.
- *Acceptance:* the user can change the resolution or the measure and press run; "As layer" and export work without any
  special case.

### 4. Style the cells (priority 2)
The cells open with a graduated style on the value (a sequential ramp, quantile classes), an outline thinner than a
polygon layer's default, and a legend titled with the measure. All style options of a polygon layer remain available
(including extrusion from the value).
- *Acceptance:* changing the ramp, the classes or the opacity works as on any polygon layer; the style survives a
  rerun of the same query.

### 5. Respect what the user already narrowed (priority 2)
The cells are built from the rows the layer currently shows: column filters and a drawn-shape filter apply. A selection
does not, unless the user chooses "selected rows only".
- *Acceptance:* with a filter active, the counts add up to the filtered row count (minus rows without a location).

### 6. Read a cell (priority 3)
Clicking a cell shows its attributes like any feature: the cell id (as the grid system writes it), the resolution, the
value, and how many features it holds. The id can be copied.

## Requirements

**Functional**
- FR-1 Grid systems: H3 (resolutions 0 to 15) and A5 (resolutions 0 to 30). Only resolutions that make sense for the
  layer's extent are offered by default; the rest are behind "all resolutions".
- FR-2 Assignment: a point belongs to the cell containing it. Lines and polygons are assigned by their center point
  (centroid), stated in the dialog. (Covering every cell a polygon touches is a different feature; see Out of scope.)
- FR-3 Measures: feature count (default), and sum, average, minimum, maximum, median of a numeric column. Cells with no
  features are not drawn.
- FR-4 Coordinates: the layer's coordinate system is read and converted to longitude and latitude for the assignment, as
  for display. The two extensions take their arguments in a different order (H3: latitude then longitude; A5: longitude
  then latitude); the user never sees that, and a query the action writes is correct for both.
- FR-5 Rows without a usable location (no geometry, empty geometry, coordinates outside the valid range) are skipped and
  reported ("37 rows had no location and are not counted").
- FR-6 Output columns: the cell id (text, and the numeric form where the system has one), the resolution, the measure
  value, the feature count, and the cell's geometry.
- FR-7 Cells that cross the antimeridian or sit at a pole must draw correctly on the flat map and the globe.
- FR-8 The result follows the existing drawing rules: drawn from memory under 100,000 cells, from engine tiles above, with
  the same "Load all" behavior; no re-query on every pan.
- FR-9 If an extension failed to load (offline first start, blocked download), the action is disabled with a short reason
  and the rest of the app is unaffected. Typing the functions by hand fails with the engine's own message.
- FR-10 Nothing about the data leaves the machine.

**Quality**
- Binning a million points to an H3 grid completes without freezing the interface (work stays in the engine; the
  interface remains responsive at 6x CPU throttle, per the project's responsiveness rule) and shows progress or a
  cancel for anything slower than about a second.
- All new controls work by keyboard and are announced to screen readers; light, dark and high-contrast themes are
  supported; chrome uses the host's tokens in VS Code. The cell outline and the ramp are data colors and stay fixed.
- The action, the dialog and the picker use the existing icon and kit components. No new libraries.

## Edge cases
- A layer with no points (all polygons): works by centroid; the dialog says so.
- A single feature, or all features in one place: one cell.
- A resolution so coarse that a cell is larger than the layer's extent, or so fine that the cell count explodes:
  a notice, not a failure.
- A numeric column with nulls: nulls are ignored by the measure; a cell with only nulls shows no value (and says so in
  its card).
- A layer in a projected CRS (meters): converted before assignment (FR-4).
- A5 pentagons are not drawn as hexagons; the style panel and legend make no assumption about cell shape.
- Empty result (every row skipped): a clear message, nothing drawn.
- The layer changes (a different file is opened): the binned result is dropped with the old layer, like any query result.

## Out of scope
- Filling a polygon with the cells that cover it (polyfill), and aggregating one grid into a coarser one with a
  hierarchy slider. Candidates for a later spec.
- Neighbor analysis (rings, disks, smoothing), spatial joins between two grids, grid-based flow maps.
- Saving cells as a second map layer (one layer at a time still holds); export is through the existing dialog.
- `fts` (full-text search): loaded, but no interface in this spec.
- Any 3D beyond the existing polygon extrusion option.

## Success criteria
- SC-1 A first-time user turns a 100,000-point layer into a colored H3 grid in under 30 seconds and four choices.
- SC-2 Counts per cell add up to the number of rows with a location (checked on test layers, both grid systems).
- SC-3 The same layer binned with A5 shows cells of equal area at 10 degrees and at 60 degrees north (checked from the
  cell areas, within 1%).
- SC-4 An exported GeoParquet or GeoJSON of the cells reopens in the app and matches the map.
- SC-5 No request to any host other than the pinned engine hosts is made by the action.

## Open questions (for the user before planning)
1. **Where does the action live?** (a) A button in the query panel's toolbar next to the SQL helpers, (b) an entry in
   the layer's menu, (c) both. Recommended: (c), one dialog.
2. **Lines and polygons:** centroid assignment only for now (recommended), or also offer "all cells touched"
   (polyfill) in this spec?
3. **Live preview:** should changing the resolution redraw immediately (cheap at coarse levels, guarded by the cell
   limit), or only after pressing Run? Recommended: immediate below 5,000 cells, Run above.
