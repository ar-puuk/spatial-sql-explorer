# Implementation Plan: Grid cells (H3 and A5)

**Branch**: `017-grid-cells` | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: step 2 of the feature, the "Bin into cells" action. Step 1 (the `fts`, `h3` and `a5` extensions) is built and committed.

## Summary

A dialog writes a SQL query that assigns each row of the open layer (by point, or centroid for lines and polygons) to an H3 or A5 cell,
aggregates a measure per cell, and returns the cell polygons. The query goes into the query panel and runs like any query, so the result
reuses the whole pipeline: the table, drawing (memory or engine tiles), the style panel, the legend and every export. New code is the SQL
builder and size tables (core), one session method (the narrowed rows and layer facts), a store action, a default style, and the dialog (ui).
No new libraries.

## Technical Context

**Language/Version**: strict TypeScript, Svelte 5 (runes), Vite; Node for tests.
**Primary Dependencies**: existing only: DuckDB-WASM with `spatial`, `h3`, `a5` (step 1); bits-ui kit wrappers; Lucide through `Icon.svelte`.
**Storage**: one small global preference through `HostAdapter.saveState('binCells')` (last system, measure kind).
**Testing**: vitest in `tests/core` (SQL builder, size tables, estimates, default style); Playwright (Chrome channel) in `tests/web`
(counts add up, equal area, date line, filters, dialog a11y, keyboard); `@vscode/test-electron` suite gets a dialog smoke test.
**Target Platform**: both shells (VS Code webview first, web app second); the engine is the same.
**Project Type**: monorepo (apps/web, apps/vscode-ext, packages/core, packages/ui).
**Performance Goals**: 1M points to H3 in about 0.5 s and to A5 in about 2.5 s in the engine (spike 2); the UI stays responsive at 6x CPU
throttle; the live preview debounces and never blocks typing.
**Constraints**: engine memory ceiling 3.1 GiB (a result is cells, not points, so small); results under 100,000 rows are drawn from memory,
larger from engine tiles; `core` and `ui` import no `vscode`; chrome uses host tokens; nothing leaves the machine (the a5 telemetry is blocked).
**Scale/Scope**: layers up to the engine ceiling; up to 100,000 cells drawn without a prompt; finer grids warn first.

## Constitution Check (v1.4.0)

- I Scope: QUERY plus STYLE of a query result; no new layer, no editing, no 3D. Pass.
- II Host-agnostic core: the SQL builder is pure core; the dialog is ui; the preference goes through `HostAdapter`. Pass.
- III Native feel: kit components, host tokens, no new chrome language. Pass.
- IV Local-first: no network beyond the pinned engine files; the a5 telemetry is blocked and tested. Pass.
- V Bounded resources: the cell limit, the cancel path, the 100,000-row drawing rule, work stays in the engine. Pass.
- VI Verified claims: A5 equal area, count sums and the date-line split are tested in the real engine before they are claimed. Pass.
- VII Accessibility: keyboard-complete dialog, labelled controls, announced estimates; axe test. Pass.
- IX Testing: unit, browser and extension-host tests listed above. Pass.
- X Simplicity: reuse the query path instead of a second drawing path; one dialog, two entry points. Pass.

No violations; Complexity Tracking is empty. Re-checked after design: unchanged.

## Design decisions

1. **The query is the product.** The dialog only builds text (`binQuerySql`), puts it in the query panel and runs it. The user can edit and
   rerun; nothing in the dialog is hidden state. (Same pattern as `shapesQuerySql`.)
2. **Output columns** are fixed: `cell_id` (text), `resolution`, `value`, `n`, `geom`. `value` is the style's column, so a rerun with another
   resolution keeps the style. `geom` is `ST_SetCRS(..., 'EPSG:4326')` so the result CRS is known to the engine, not guessed.
3. **Assignment** uses the layer's geometry converted to longitude/latitude (`ST_Transform` from the layer CRS when it is not 4326),
   `ST_Centroid` for non-points, and each system's own argument order, hidden from the user.
4. **Rows shown** (spec story 5): the current column filters and shape filter are inlined as the WHERE text the session already holds
   (`filterWhere`, `spatialWhere`); "selected rows only" adds the selection predicate (spike S3).
5. **Date line and poles**: cells are unwrapped and split into a MultiPolygon in SQL (spike S2), so MapLibre, tiles and exports all see
   valid geometry.
6. **Style**: after a successful bin, the store applies a default graduated style on `value` (quantile, 5 classes, a sequential ramp, a thin
   outline) only when the previous result was not already a bin; a rerun keeps the user's style. The legend title is the measure's label.
7. **Live preview**: an estimated cell count (rows and extent against the cell-size table) under 5,000 redraws on change after a 250 ms pause;
   above it, Run. Cancel restores the previous query and view.
8. **Resolution picker** shows size (edge or area, metric or imperial as the Measure tool does) and the estimate; resolutions within a usable
   range for the extent are listed first ("All resolutions" reveals the rest); above 100,000 estimated cells a warning comes before running.
9. **Entry points**: a button in the query panel's header and a **map control** ("Bin into cells", in the Tools group, on by default,
   positionable like the others; the app has no layer menu, and the controls registry is where layer-level actions live). Both call
   `store.openBinDialog()`. Both are disabled with the reason when no layer with geometry is open; a grid system whose extension did not load is
   unavailable inside the dialog.

## Project Structure

### Documentation (this feature)

```text
specs/017-grid-cells/
├── spec.md
├── plan.md              # this file
├── research.md          # spike 1 (loading), spike 2 (signatures, sizes, date line, speed), spikes still to run
├── data-model.md
├── quickstart.md
├── contracts/
│   └── bin-cells.md     # the generated SQL, the session and store API, the dialog's behavior
└── tasks.md             # from /speckit-tasks
```

### Source Code

```text
packages/core/src/grid/
├── gridSystems.ts       # registry: id, label, resolution range, cell area/edge tables, argument order, SQL fragments
├── binSql.ts            # binQuerySql(spec, layerFacts) -> { sql, valueLabel }; skippedRowsSql
├── binEstimate.ts       # suggestResolution, estimateCells, resolutionChoices (size text, in or out of range)
├── gridStyle.ts         # default graduated style for the value column, legend title
└── index.ts
packages/core/src/query/session.ts    # + binQuerySql(), binSkippedRows(), layerFactsForBin()
packages/ui/src/BinCellsDialog.svelte # the dialog (kit Segmented, Select, Slider; Icon 'grid')
packages/ui/src/QueryPanel.svelte     # header button
packages/ui/src/viewerStore.svelte.ts # binDialog state, openBinDialog, setBinSpec, applyBin, cancelBin
packages/ui/src/Icon.svelte           # + grid icon (Lucide Hexagon)
tests/core/grid-*.test.ts
tests/web/specs/grid-cells-017.spec.ts (beside grid-extensions-017.spec.ts)
tests/vscode-ext/src/suite/grid-cells.test.ts
```

**Structure Decision**: the layout the project already uses; the pure parts in `core`, the dialog in `ui`, no new package.

## Order of work (vertical slices)

1. **SQL core, no UI**: `gridSystems`, `binSql` for points, counts only, both systems; unit tests; web tests for count sums (SC-2) and equal
   area (SC-3). Runnable by typing the generated query.
2. **Date line, poles and non-points**: spike S2, centroid assignment, projected layers; tests.
3. **Measures and filters**: sum, avg, min, max, median, column filters, shape filter, selected rows only (S3), the skipped-rows count.
4. **Store and default style**: `applyBin`, graduated style, legend title; the result drawn in both draw modes.
5. **Dialog and entry points**: system, resolution with sizes and estimate, measure; the SQL goes to the SQL tab (no box in the dialog); keyboard and a11y; the disabled state.
6. **Live preview and cancel**: debounce, the 5,000 threshold, restore on cancel; the warning above 100,000.
7. **Polish and release notes**: preference persistence, docs, CHANGELOG, the extension-host smoke test.
