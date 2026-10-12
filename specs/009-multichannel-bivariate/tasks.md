---

description: "Task list for spec 009: Multi-Channel Styling and Bivariate Maps"
---

# Tasks: Multi-Channel Styling and Bivariate Maps

**Input**: Design documents from `specs/009-multichannel-bivariate/`

**Prerequisites**:
- `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`.
- `contracts/`: `style-core.md`, `interchange-mapping.md`, `ui.md`.
- Spike evidence in `spikes/`.

**Tests**: REQUIRED (constitution IX):
- Vitest in `tests/core`;
- Playwright in `tests/web/specs`;
- `@vscode/test-electron` in `tests/vscode-ext/src/suite`;
- PyQGIS checks in `tests/qgis`.

Within each story, test tasks come first and must fail before
implementation.

**Organization**: grouped by user story (spec.md US1–US6). The phase order
follows the two-slice decision (spec Clarifications), not strict priority:
- **Slice 1, channels**: US1, US3, US2, then US5 and US6 for channels.
- **Slice 2, bivariate**: US4, then US5 and US6 for bivariate.

Commit after each task. Run lint, typecheck and the affected suites before
moving on.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete tasks).
- **[Story]**: US1–US6 from spec.md.
- Paths are repository-relative.

## Ground rules for every task

- **Existing styles draw exactly as before.**
  - A style with no `size` and no bivariate renderer must produce identical
    `resolveStyle`, `paintFor`, `layoutFor` and exports.
  - All existing tests in `tests/core/style*.test.ts` and
    `tests/web/specs/style-*.spec.ts` stay green, unedited, except where a
    task names the change.
- **Map = legend**: every new expression is checked with MapLibre's own
  evaluator (`@maplibre/maplibre-gl-style-spec`), as
  `tests/core/style-expressions.test.ts` does.
- **Class rules are the graduated ones**:
  - upper-inclusive, with the first class including its lower bound;
  - null, "" and boolean count as No value.
  - Reuse `classify.ts` / `rangesFrom` / `classOf`; never re-implement
    them.
- **SQL**: built only with core's quoting helpers (`quoteIdent`, literals
  doubled). Engine work runs through `QuerySession.exclusive(…, 'background')`
  like today's `resolveStyle`.
- **Host-agnostic**: no `vscode`, File API or IndexedDB in `packages/core`
  or `packages/ui`.
- **Accessible names in `contracts/ui.md` are binding**, because tests query
  by them.
- **Data colors stay fixed.** Chrome uses `--se-*` tokens.
- **No palette data is copied** from biscale, the Stevens images or any
  other source (research §8). Palettes come only from
  `scripts/bivariate-palettes.mjs`.

---

## Phase 1: Setup

**Purpose**: test data for both slices.

- [X] T001 [P] Write `scripts/fixtures-009.mjs`, modeled on
  `scripts/fixtures-008.mjs`. It writes two seeded, deterministic files to
  `tests/vscode-ext/fixtures/`, and is described in the fixtures README:
  - `roads-traffic.geojson`: 2,000 LineStrings with `functional_class`
    (5 text values), `aadt` (integer, log-normal, every 40th null) and `lanes`
    (1–4).
  - `counties-bivariate.geojson`: 600 Polygons on a grid, with
    `poverty_rate` and `obesity_rate` (correlated, every 50th null in one or
    the other) and `name`.
  - Then generate both files and commit them.
- [X] T002 [P] Add a 2026-10-12 migration fixture,
  `tests/core/fixtures/style/legacy-vary-size.json`. It is a `LayerStyle`
  with a graduated renderer, `vary: 'size'`, `sizeMin: 2`, `sizeMax: 10`, a
  label override on class 1 and a hidden class 3. Next to it, put its
  expected per-feature radii for the `layer` in
  `tests/core/style-symbols.test.ts` (computed with the current build before
  any change), as `legacy-vary-size.expected.json`.

---

## Phase 2: Foundational (blocking)

**Purpose**: the model, resolve input and SQL builders both slices rely on.

- [X] T003 Extend the types in `packages/core/src/style/model.ts` as in
  `data-model.md`:
  - `SizeChannel`, `BivariateRenderer` (in the `Renderer` union) and
    `LayerStyle.size?`;
  - `ResolvedClass` gets `kind: 'cell'`, `row?`, `col?`, `x?`, `y?`;
  - `ResolvedStyle` gets `size?: ResolvedSizeChannel` and
    `grid?: { x: AxisInfo; y: AxisInfo }`.
  - Keep `GraduatedRenderer.vary/sizeMin/sizeMax` as read-only legacy input,
    documented as such.
  - No behavior change yet. Typecheck passes.
- [X] T004 Extend `ResolveInput` in `packages/core/src/style/resolve.ts`
  with `dataByColumn?: Record<string, ColumnData>`. Add a helper
  `columnData(input, column)` that prefers `dataByColumn[column]`, then
  falls back to `data` when `data.column === column`.
  - Use it in `valuesOf` and in the graduated and categorized branches.
  - All existing core tests stay green.
- [X] T005 [P] Add SQL builders in `packages/core/src/view/stats.ts`:
  - `multiTotalsSql(relation, columns[])`: one pass, per column `n`,
    `nulls`, `min`, `max`, aliased by position;
  - `cellCountsSql(relation, xColumn, xRanges, yColumn, yRanges)`: the
    `classCountsSql` CASE for each column, `GROUP BY cx, cy`, with -2 for
    null and -1 outside.
  - Unit-test both in `tests/core/stats-sql.test.ts` (SQL shape, as the
    existing builders are; core tests don't run DuckDB). Execution is checked
    by the browser specs. Done 2026-10-12: also run once in the native DuckDB
    CLI on `counties-bivariate.geojson`, where all 16 cell/no-value counts
    equal a JS `classOf` reference.
- [X] T006 Generalize `QuerySession.resolveStyle` in
  `packages/core/src/query/session.ts`:
  - collect the channel columns (color column(s), and the size column when
    `style.size` applies, deduplicated);
  - small results: stream all needed columns in one `SELECT` into
    `dataByColumn`;
  - large results: `multiTotalsSql` once, then the existing order-statistics
    pass per numeric column, then class counts per channel.
  - Keep the current single-column path's behavior and timings for styles
    without a size channel or bivariate renderer (the
    `tests/core/viewport-sql.test.ts` and session tests stay green).

**Checkpoint**: the foundation is ready. Stories can start.

---

## Phase 3: User Story 1 — Color by one column, width by another (P1) 🎯 MVP

**Goal**: an independent, classed size channel next to any single,
categorized or graduated color.

**Independent Test**: on `roads-traffic.geojson`, categorize by
`functional_class`, turn on Size by `aadt`. Expect class colors, stepped
widths, and two legend groups (quickstart scenario 1).

### Tests for User Story 1

- [X] T007 [P] [US1] Create `tests/core/style-channels.test.ts` (failing
  first):
  - `resolveStyle` with a classed size channel gives `resolved.size`
    classes, with `size` from `classSizes`, the counts, No value, and the
    caption `aadt · Quantile, 5 classes`.
  - Same column as color: both channels classify independently.
  - A missing or non-numeric size column gives `size.status = 'fallback'`
    while the color stays `ok`.
  - `paintFor` `line-width` and `circle-radius`, evaluated per feature with
    MapLibre's evaluator, equal the feature's size class size (SC-003), for
    categorized + size and graduated + size.
  - `visibilityFilter` hides a feature whose color **or** size class is
    hidden.
  - Polygons: `paintFor` ignores `size`. Mixed: lines and points are sized,
    polygon outlines are not.
  - Shaped markers: `icon-size` = size / base radius per feature, and
    `markerIconIds` are drawn at the largest radius.
  - A style without `size` gives deep-equal paint, layout, filter and
    resolved output to a snapshot taken before this phase.
- [X] T008 [P] [US1] Create `tests/web/specs/style-channels.spec.ts`
  (failing first) on `roads-traffic.geojson`:
  - the Size section switch "Size by column" (name per `contracts/ui.md`);
  - choosing `aadt` gives 5 size rows in a legend group titled
    `aadt · Quantile, 5 classes`, and the color group is unchanged;
  - `data-rendered-features` is unchanged;
  - changing the method, classes and smallest/largest sizes updates the
    legend live;
  - turning the switch off removes the group;
  - a polygon layer shows "Polygons have no size";
  - the Graduated "Vary" radio is gone.

### Implementation for User Story 1

- [X] T009 [US1] In `packages/core/src/style/resolve.ts`, resolve the size
  channel:
  - add `resolveSizeChannel(style, input)`, reusing the graduated branch
    (extract it into `classifyRanges(column, method, classCount, manual
    classes, input)` shared by graduated and size);
  - set `size` on each range class from `classSizes(n, sizeMin, sizeMax)`;
  - give No value the single size, with the label and visibility
    overrides;
  - build the caption;
  - apply the fallback (FR-012 style) when the column is missing or not
    numeric.
  - `resolveStyle` sets `resolved.size` when `style.size` is present and
    the renderer is not bivariate.
- [X] T010 [US1] In `packages/core/src/style/symbol.ts`:
  - add `sizeSymbols(style, resolved)`: one `SymbolSpec` per size class,
    in single colors, with `radius` (points) and `lineWidth` (lines) set to
    the class size;
  - remove the size handling from `classSymbol`, since color classes no
    longer carry sizes (the graduated `vary` path is migrated in US3).
- [X] T011 [US1] In `packages/core/src/style/expressions.ts`:
  - add `sizeIndexExpression(style, resolved)`: the graduated index rules on
    the size column;
  - `symbolExpressions` gains `size`: a number when no channel applies,
    otherwise a `match` on the size index with the single size as fallback;
  - `radius` and `lineWidth` come from it (points and lines);
  - `visibilityFilter` combines the hidden color and size classes;
  - shaped markers: `layoutFor` sets `icon-size`, and `markerIconIds` /
    `markerIconId` draw the icon at the largest radius in use.
- [X] T012 [US1] Add the size-channel edits in
  `packages/core/src/style/edit.ts`: `setSizeChannel` (on with geometry
  defaults: points 2–10, lines 1–6; off deletes `size`), `setSizeColumn`,
  `setSizeMethod`, `setSizeClassCount`, `setSizeRange`,
  `setSizeClassBound` (switches to manual, with neighbor bounds as in
  `setClassBound`), `setSizeClassLabel` and `setSizeClassVisible`.
  - Remove `setGraduatedVary`/`setSizeRange` for graduated renderers.
  - `validateStyle` reports the size range and manual bounds.
  - Export them all from `packages/core/src/style/index.ts`.
- [ ] T013 [P] [US1] Create `packages/ui/src/style/SizeClassList.svelte`:
  rows of eye toggle, `SymbolSwatch` (to scale), label (F2 rename), count,
  and "Edit bounds" mode with lower/upper inputs, keyboard as in
  `ClassList.svelte` (factor shared helpers rather than copy them).
  Accessible names follow `contracts/ui.md`.
- [ ] T014 [US1] In `packages/ui/src/LayerStylePanel.svelte`:
  - remove the Graduated "Vary" radio and its size inputs;
  - add the **Size** section per `contracts/ui.md`: the switch, Column
    (numeric), Method, Classes, Smallest/Largest (px), and
    `SizeClassList`;
  - for polygon layers, show the note instead of the section;
  - wire everything to the `edit.ts` functions through `apply()`
    (validation messages as today).
- [ ] T015 [US1] Make `packages/ui/src/MapLegend.svelte` show groups: the
  color group as today, plus a size group (a heading with the size
  caption, then rows of `SymbolSwatch` to scale, with classed rows toggling
  visibility through `onToggleClass`).
  - In `packages/ui/src/ViewerLayout.svelte`, pass `sizeSymbols` and
    `resolved.size`. Size class keys are `size:range:<i>` / `size:__null`.
  - Route `store.setClassVisible` for `size:` keys to `setSizeClassVisible`
    in `packages/ui/src/viewerStore.svelte.ts`.
- [ ] T016 [US1] In `packages/ui/src/MapView.svelte`, apply `icon-size`
  from `layoutFor` for shaped markers. Re-run
  `tests/web/specs/style-symbols.spec.ts`: it must pass once its Vary steps
  are rewritten to use the Size section (update that spec in this task).
- [ ] T017 [US1] Run T007 and T008 to green, plus all
  `tests/core/style*.test.ts` and `tests/web/specs/style-*.spec.ts`.
  Profile a size edit on `parcels-10k` points at 6x CPU throttle in the
  browser (memory: UI responsiveness): no input lag beyond today's color
  edits.

**Checkpoint**: color + classed size works and is testable on its own.

---

## Phase 4: User Story 3 — Existing size styles keep working (P1)

**Goal**: styles saved with Graduated "Vary: Size" open identically, as a
single color + classed size channel.

**Independent Test**: open the T002 fixture and the
`tests/core/fixtures/style/symbols/pt_gradsize.qml` QML. Expect identical
sizes and labels, with a Size section shown.

- [ ] T018 [P] [US3] Add migration tests in
  `tests/core/style-channels.test.ts`:
  - `sanitizeStyle(legacy-vary-size.json)` gives `renderer: single` +
    `size` with the same column, method, classCount, overrides and
    sizes;
  - the per-feature radii equal `legacy-vary-size.expected.json`;
  - the QML from `pt_gradsize.qml` imports as a size channel (2–10 mm
    converted, as today);
  - the old fields are never written by `exportStyle` (any format) or
    `sanitizeStyle`.
- [ ] T019 [US3] Implement the migration in `sanitizeStyle`
  (`packages/core/src/style/model.ts`): graduated `vary: 'size'` becomes
  single + `size` (drop color overrides; keep label, visible and bounds).
  - Update the QML (`qml.ts`), SLD (`sld.ts`) and Mapbox (`mapbox.ts`)
    importers so that GraduatedSize / size-varying rules / a size `match`
    produce `style.size`, not `vary`.
  - Update `tests/core/style-symbols.test.ts` expectations that read
    `vary` (named change).

**Checkpoint**: no saved style changes appearance.

---

## Phase 5: User Story 2 — Proportional sizes (P2)

**Goal**: smooth size scaling, by area for points and by width for lines.

**Independent Test**: set Size to Proportional on a point layer. A value
halfway through the domain is drawn at rMin + (rMax − rMin)·√0.5, and the
legend shows 3–5 reference sizes (quickstart scenario 2).

- [ ] T020 [P] [US2] Add tests in `tests/core/style-channels.test.ts`:
  - `proportionalSize` for lines (linear) and points (√t), clamping, null,
    and min = max;
  - `resolved.size.domain` and `samples` (3–5, including min and max,
    sizes from the same formula);
  - the `paintFor` size evaluated per feature equals `proportionalSize`;
  - the size legend reference rows aren't toggles, but No value is.
- [ ] T021 [P] [US2] Add web tests in
  `tests/web/specs/style-channels.spec.ts`: the Classed | Proportional radio,
  the legend reference sizes with values, and switching back to Classed
  restoring stepped classes.
- [ ] T022 [US2] Implement Proportional mode:
  - `proportionalSize` and domain/samples in
    `packages/core/src/style/symbol.ts` and `resolve.ts` (domain from
    `numberTotalsSql` min/max on large results, from the values otherwise);
  - in `expressions.ts`, `size` becomes `['let','t', clamp((to-number
    v − min)/(max − min)), …]`: linear for lines, `sqrt` for points, and
    null → single size;
  - `setSizeMode` in `edit.ts` (dropping class overrides when going to
    proportional);
  - the mode radio and reference rows in `LayerStylePanel.svelte` and
    `MapLegend.svelte`.

**Checkpoint**: Slice 1 drawing is complete.

---

## Phase 6: User Story 5 (channels) — Save, reopen and exchange size channels (P2)

**Goal**: a two-channel style round-trips through QML, SLD and Mapbox GL,
and QGIS draws it natively.

**Independent Test**: save the US1 and US2 styles as QML, reopen them here
and in QGIS, and export and re-import SLD and Mapbox (quickstart scenario
5).

- [ ] T023 [US5] **Spike-confirm** the QGIS marker data-defined size key
  (research §5) with PyQGIS: set `setDataDefinedSize` on a
  `QgsMarkerSymbol`, save the QML, and record the property name under
  `<data_defined_properties>`. Append the result to
  `specs/009-multichannel-bivariate/research.md` §5, and save the script
  in `spikes/`.
- [ ] T024 [P] [US5] Add interchange tests in
  `tests/core/style-channels.test.ts`:
  - QML for classed size: each class symbol layer has
    `<data_defined_properties>` with `outlineWidth` (lines) or the T023 key
    (markers), `type` 3, and a `CASE` expression whose arms equal the
    class sizes (diameters for markers);
  - QML for proportional size: `type` 2, a field and a transformer with
    Linear (lines) or Area with exponent 0.5 (points), with min/max value
    and size, and nullSize;
  - the custom property `spatialExplorer/size` is present, and each format
    round-trips to a deep-equal `size`;
  - a foreign QML with a transformer imports as Proportional, and one with
    an expression size gives a note;
  - SLD: (color classes × size classes) rules with both filters, proportional
    as 5 steps plus a notice, and re-import gives the single symbol plus the
    research §7 notice;
  - Mapbox: the paint equals `symbolExpressions`, `metadata` round-trips,
    and a foreign two-stop linear `interpolate` on `line-width` becomes
    Proportional;
  - `previewExportNotice` lists the losses in `interchange-mapping.md`.
- [ ] T025 [US5] Implement QML in `packages/core/src/style/qml.ts`:
  - `symbolXml` gains optional data-defined size XML (both forms, per
    research §5 and the T023 key);
  - write the `spatialExplorer/size` custom property;
  - read the custom property first, then foreign transformers.
- [ ] T026 [P] [US5] Implement SLD in `packages/core/src/style/sld.ts`:
  - cross-product rules for classed sizes;
  - 5-step proportional;
  - the import notice for two-column rules (shared with bivariate).
- [ ] T027 [P] [US5] Implement Mapbox in `packages/core/src/style/mapbox.ts`:
  - the size expressions in `line-width` / `circle-radius`, and
    `icon-size` for shapes;
  - the foreign two-stop `interpolate` import.
  - Extend `previewExportNotice` in `interchange.ts`.
- [ ] T028 [P] [US5] Create `tests/qgis/check_009.py` (documented in
  `tests/qgis/README.md`), following `check_sidecar.py`'s CLI. It loads each
  QML the app saved for this spec, renders with
  `QgsMapRendererParallelJob` or symbol evaluation inside a render context,
  and compares per-feature width/size and color against a JSON of expected
  values written by the core test (SC-005). Run it on the US1/US2 QMLs and
  record the outcome in research §5.
- [ ] T029 [US5] Add a VS Code suite test in
  `tests/vscode-ext/src/suite/layers.test.ts` (or a new
  `style-channels.test.ts`): save the sidecar for a two-channel style on
  `roads-traffic.geojson`, close, reopen; the size channel is restored and
  `data-rendered-features` matches.

---

## Phase 7: User Story 6 (channels) — Map image with the size group (P3)

**Independent Test**: save a PNG for a two-channel style. The legend shows
the color group and the size group (quickstart scenario 6).

- [ ] T030 [P] [US6] Extend `tests/web/specs/map-image.spec.ts`: for a
  categorized + size style, the PNG legend box contains both group titles
  (check with the existing pixel and OCR-free approach: sample the swatch
  and title rows as the spec does today).
- [ ] T031 [US6] Change `LegendSpec` in `packages/ui/src/mapImage.ts` to
  `groups` (contracts/ui.md). `drawLegend` lays the groups out one after
  another, with the size rows drawn to scale. Build the groups in
  `packages/ui/src/ViewerLayout.svelte`. Keep the old single-group output
  identical for existing styles (map-image spec stays green).

**Checkpoint**: Slice 1 is complete. Merge locally, after the full suites
pass, before starting Slice 2.

---

## Phase 8: User Story 4 — Bivariate map of two numeric columns (P1)

**Goal**: a 3×3 bivariate choropleth with a keyboard legend square.

**Independent Test**: on `counties-bivariate.geojson`, choose Bivariate on
`poverty_rate` × `obesity_rate`. Expect a 3×3 legend whose cell counts plus
No value equal the feature count; hover shows the ranges; cells can be
hidden (quickstart scenario 4).

### Tests for User Story 4

- [ ] T032 [P] [US4] Create `tests/core/style-bivariate.test.ts` (failing
  first):
  - `resolveStyle` gives 9 cells in row-major order from low/low (`i + nx *
    j`) with x/y ranges, plus `grid` and No value; cell counts plus No value
    equal the row count (SC-004);
  - an axis with 2 distinct values gives a 2×3 grid with a note (FR-015);
  - the same column twice fails `validateStyle`;
  - `paintFor` colors, evaluated per feature, equal the cell's palette
    color for every cell (SC-003); null in either column is No value;
  - hidden cells and No value are filtered;
  - swapping the axes transposes the colors and `hidden`;
  - changing one axis's method leaves the other axis's ranges unchanged;
  - large results: cell counts from `cellCountsSql` equal the in-memory
    counts on the same data;
  - polygons, lines and points all color.
- [ ] T033 [P] [US4] Create a palette test in
  `tests/core/style-bivariate.test.ts`: every palette in
  `BIVARIATE_PALETTES` meets research §8 (min ΔE ≥ 15, deuteranope ≥ 12
  except palettes carrying a `note`, lightness decreasing low/low →
  high/high), and 2-class grids use the corner and middle indexes.
- [ ] T034 [P] [US4] Create `tests/web/specs/style-bivariate.spec.ts`
  (failing first):
  - the Style radio "Bivariate"; axis selects; the legend `grid` with 9
    cells whose accessible names follow `contracts/ui.md`;
  - arrow keys move focus between cells, and Enter toggles `aria-pressed`
    and changes `data-rendered-features`;
  - Swap axes; a palette change updates the cell colors;
  - Bivariate is unavailable with fewer than two numeric columns (with the
    reason);
  - the Size section reads "Bivariate maps have no size channel";
  - axe has no violations on the legend and panel (as
    `accessibility.spec.ts` does).

### Implementation for User Story 4

- [ ] T035 [US4] Write `scripts/bivariate-palettes.mjs`. It ports the
  scoring from `spikes/bivariate-palettes.mjs.txt` into a generator that
  reads the ColorBrewer anchors from `packages/core/src/style/rampData.ts`
  and writes `packages/core/src/style/bivariateData.ts` (GENERATED header,
  ColorBrewer Apache-2.0 notice, as `rampData.ts` has). It produces four
  palettes: `orange-blue` (default), `red-blue`, `green-purple`, and
  `pink-blue` with its note. Run it and commit the output.
  - Add the palettes to `THIRD-PARTY-NOTICES.md` only if the attribution
    text needs updating (the anchors are already covered).
- [ ] T036 [US4] Create `packages/core/src/style/bivariate.ts`:
  - `BIVARIATE_PALETTES` re-export, `DEFAULT_BIVARIATE_PALETTE`,
    `bivariateColor(palette, i, j, nx, ny)`;
  - `bivariateIndexExpression(style, resolved)`: two `let`s with the
    graduated index rules, then `ix + nx * iy` mapped to the class
    positions; No value when either axis is.
  - Export from `index.ts`.
- [ ] T037 [US4] Resolve bivariate in `packages/core/src/style/resolve.ts`:
  - each axis through `classifyRanges` (T009) with `classCount` 3;
  - cells with counts (in memory, or filled from `cellCountsSql` by the
    session), labels such as "`<x range>` · `<y range>`", visibility from
    `hidden`;
  - No value; `grid`; the caption
    `poverty_rate × obesity_rate · Quantile`.
  - In `packages/core/src/query/session.ts`, add the bivariate path: totals
    for both columns, order statistics per axis, then `cellCountsSql`
    (SC-007).
- [ ] T038 [US4] Wire bivariate into `expressions.ts`:
  - `classIndexExpression` returns `bivariateIndexExpression` for
    bivariate;
  - colors come from the cell classes through the existing `classSymbols`
    path;
  - `symbolExpressions` ignores `size` for bivariate (FR-007).
- [ ] T039 [US4] Add the bivariate edits in `edit.ts`:
  - `startStyle(…, 'bivariate', layer)` picks the first two numeric
    columns, keeps `size` stored but inactive, and applies the
    `THEMATIC_SYMBOL` defaults as for other thematic renderers;
  - `setBivariateAxis`, `swapBivariateAxes` (transposes `hidden`),
    `setBivariatePalette`, `setCellVisible`;
  - `validateStyle`: two different numeric columns.
  - `sanitizeRenderer`: bivariate fields, with an unknown palette falling
    back to the default.
- [ ] T040 [P] [US4] Create `packages/ui/src/style/BivariatePicker.svelte`:
  the Axis 1 / Axis 2 selects (numeric only), a Swap button, Method selects
  per axis, and a palette radio group with 3×3 SVG previews and notes.
- [ ] T041 [P] [US4] Create `packages/ui/src/style/BivariateLegend.svelte`
  per `contracts/ui.md`:
  - `role="grid"`, rows high-to-low;
  - cell buttons with `aria-pressed` and full accessible names and
    titles;
  - roving tabindex, arrow keys, Enter/Space toggle;
  - axis labels with arrows; a No value row;
  - theme tokens for chrome, fixed palette colors.
  - It is used by both `MapLegend.svelte` and the style panel ("Cells").
- [ ] T042 [US4] Integrate:
  - `LayerStylePanel.svelte`: the fourth Style radio, with the
    unavailable reason; `BivariatePicker`; the "Cells" legend; the Size
    section note;
  - `MapLegend.svelte`: render `BivariateLegend` for bivariate;
  - `viewerStore.svelte.ts`: route `cell:` keys to `setCellVisible`.
- [ ] T043 [US4] Run T032–T034 to green, plus all style suites. Profile
  axis and palette changes on `counties-bivariate` at 6x CPU throttle.

**Checkpoint**: bivariate maps work and are testable on their own.

---

## Phase 9: User Story 5 (bivariate) — Save, reopen and exchange bivariate styles (P2)

**Independent Test**: save the bivariate style as QML, reopen it here (still
bivariate) and in QGIS (the same 9 colors), and export SLD and Mapbox with
their notices (quickstart scenario 5).

- [ ] T044 [P] [US5] Add bivariate interchange tests in
  `tests/core/style-bivariate.test.ts`:
  - QML: `type="RuleRenderer"`, 9 cell rules (fewer for small grids) with
    the filters in `interchange-mapping.md`, `checkstate="0"` for hidden
    cells, a No value rule, the custom property `spatialExplorer/bivariate`,
    and re-import deep-equal;
  - a foreign RuleRenderer keeps today's behavior and notice (FR-025);
  - SLD: one rule per visible cell plus No value, the notices, and
    re-import as the single symbol with the notice;
  - Mapbox: the paint equals the viewer's, the hidden-cell filter, and
    `metadata` round-trips.
- [ ] T045 [US5] Implement bivariate QML write and read in
  `packages/core/src/style/qml.ts`:
  - a `ruleRendererXml(style, resolved, kind)` writer with keys, labels,
    `checkstate`, and symbols from `classSymbols`;
  - import: a `RuleRenderer` with `spatialExplorer/bivariate` becomes a
    `BivariateRenderer` (sanitized); without it, the existing fallback.
- [ ] T046 [P] [US5] Implement bivariate in `sld.ts` (cell rules, notices)
  and `mapbox.ts` (cell `match` paint, filter). Extend `previewExportNotice`
  in `interchange.ts`.
- [ ] T047 [US5] Extend `tests/qgis/check_009.py` to the bivariate QML:
  - QGIS lists 10 rules, with 9 active minus hidden;
  - each feature's rendered fill equals the expected cell color (SC-005).
  - Record the outcome in research §6.
- [ ] T048 [US5] Add a VS Code suite test (same file as T029): save, close
  and reopen a bivariate sidecar on `counties-bivariate.geojson`; it is
  still bivariate, with the same palette and hidden cells.

---

## Phase 10: User Story 6 (bivariate) — Map image with the bivariate square (P3)

- [ ] T049 [P] [US6] Extend `tests/web/specs/map-image.spec.ts`: for a
  bivariate style, the PNG contains the 3×3 square. Sample the 9 cell
  centers against the palette colors, and check a hidden cell is drawn
  hollow.
- [ ] T050 [US6] Draw the bivariate group in `packages/ui/src/mapImage.ts`:
  - the square with axis labels (column names, arrows), and No value
    below;
  - built in `ViewerLayout.svelte` from `resolved.grid`.

---

## Phase 11: Polish & Cross-Cutting

- [ ] T051 [P] Update `CLAUDE.md` "Styling and export": the renderers are
  now single, categorized, graduated or bivariate, plus an optional size
  channel (classed or proportional); and the QML forms (data-defined size,
  rule-based bivariate). Update the in-app or README feature list if there
  is one (`apps/web` landing copy, `apps/vscode-ext/README.md`).
- [ ] T052 [P] Re-run `npm run screenshots` only if the docs show the style
  panel; otherwise skip and say so.
- [ ] T053 Run the full gates:
  - `npm run lint`, `npm run typecheck:core`, `npm run typecheck:ui`;
  - `npm run test:core`, `npm run test:web`, `npm run test:vscode-ext`;
  - `tests/qgis/check_009.py`.
  - Walk through every quickstart scenario, including SC-007 timing on the
    1M-row fixture, and record the timings in research §4.
- [ ] T054 Run `/speckit-analyze` for spec/plan/tasks consistency, and fix
  any blocking finding before the final local merge (no push without user
  approval, per project memory).

---

## Dependencies & Execution Order

### Phases

- **Setup (T001–T002)** and **Foundational (T003–T006)** come before
  everything. T003 → T004 → T006; T005 can run alongside T003/T004.
- **Slice 1**: US1 (T007–T017) → US3 (T018–T019) → US2 (T020–T022) →
  US5-channels (T023–T029) → US6-channels (T030–T031).
  - US3 depends on US1's `size` resolve.
  - US2 extends US1.
  - US5/US6 need US1–US2 to be drawable.
- **Slice 2**: US4 (T032–T043) → US5-bivariate (T044–T048) →
  US6-bivariate (T049–T050). US4 depends only on Foundational and on T009's
  `classifyRanges`; it can start after T009 if Slice 1 is paused.
- **Polish (T051–T054)** comes last.

### Within stories

- Tests before implementation (they must fail first).
- Core types and resolve before expressions, before UI.
- T023 (spike) before T025 (QML markers).
- T035 (palettes) before T036–T037.

### Parallel opportunities

- T001 ∥ T002; T005 ∥ T003/T004.
- US1: T007 ∥ T008 ∥ T013. US2: T020 ∥ T021.
- US5-channels: T026 ∥ T027 ∥ T028 (after T024).
- US4: T032 ∥ T033 ∥ T034; T040 ∥ T041.
- US5-bivariate: T044 ∥ T046 (after T045's writer shape is agreed).
- US6: T030 ∥ T031 prep; T049 ∥ T050 prep.

## Parallel Example: User Story 1

```text
Task: "T007 tests/core/style-channels.test.ts — channel resolve, map = legend, combined visibility"
Task: "T008 tests/web/specs/style-channels.spec.ts — Size section, legend groups"
Task: "T013 packages/ui/src/style/SizeClassList.svelte — size class rows"
```

## Parallel Example: User Story 4

```text
Task: "T032 tests/core/style-bivariate.test.ts — cells, counts, map = legend"
Task: "T034 tests/web/specs/style-bivariate.spec.ts — grid keyboard, axe"
Task: "T040 packages/ui/src/style/BivariatePicker.svelte"
Task: "T041 packages/ui/src/style/BivariateLegend.svelte"
```

## Implementation Strategy

### MVP (User Story 1)

Do Setup, Foundational, then US1 (T001–T017). Validate quickstart
scenario 1 (color + width on roads). Classed sizes on top of any color
renderer are the most-asked-for result.

### Incremental delivery

1. US1, then US3: no saved style regresses (required before any merge).
2. US2: proportional.
3. US5 and US6 for channels. **Slice 1 local merge.**
4. US4: bivariate drawing and legend.
5. US5 and US6 for bivariate. **Slice 2 local merge.**
6. Polish, then `/speckit-analyze`.

Each slice ends with the full suites green and a local `--no-ff` merge to
`main`, as specs 007 and 008 did. Nothing is pushed or published without
user approval.
