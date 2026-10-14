---

description: "Task list for spec 011: Style by Channels, and Labels"
---

# Tasks: Style by Channels, and Labels

**Input**: Design documents from `specs/011-style-channels/`

**Prerequisites**:
- `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`.
- `contracts/`: `style-core.md`, `interchange-mapping.md`, `ui.md`.
- Spike evidence in `spikes/`.
- Background and options in `proposal.md`.

**Tests**: REQUIRED (constitution IX):
- Vitest in `tests/core`;
- Playwright in `tests/web/specs`;
- `@vscode/test-electron` in `tests/vscode-ext/src/suite`;
- PyQGIS in `tests/qgis`.

Within each story, test tasks come first and must fail before implementation.

**Organization**: grouped by user story (spec.md US1–US8). The phase order
follows the plan's slices, not strict priority:

| Slice | Phases | Stories |
|---|---|---|
| 1 | 3 | US2: model and migration, no visible change |
| 2 | 4, 5 | US1, US3: panel |
| 3 | 6, 7 | US4, US5: scales and legend |
| 4 | 8 | US7: files |
| 5 | 9, 10 | US6, US8: labels and map image |

Commit after each task, on branch `011-style-channels`; never push. Run lint,
typecheck and the affected suites before moving on.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete tasks).
- **[Story]**: US1–US8 from spec.md.
- Paths are repository-relative.

## Ground rules for every task

- **SC-002 is binding.** Until Phase 4 removes the old UI, every existing test
  in `tests/core` and `tests/web/specs` stays green, unedited, except where a
  task names the change. After that, `tests/core/fixtures/style/pre-011-snapshot.json`
  stays the gate: old styles must draw the same.
- **The map matches the legend.** Every channel expression is checked with
  MapLibre's evaluator (`@maplibre/maplibre-gl-style-spec` `createExpression`
  with the property's spec, as `tests/core/style-heatmap.test.ts` does).
- **Reuse, never re-implement:**
  - class rules (`classify.ts`, `classifyRanges`, `rangesFrom`; upper
    inclusive, the first class includes its lower bound; null, "" and
    booleans are No value);
  - categories (`resolve.ts` categorized path);
  - rules (`resolve.ts` rules path);
  - bivariate (`bivariate.ts`);
  - proportional sizes (`proportionalSize`).
- **SQL** uses only core's quoting helpers. Engine work runs through
  `QuerySession.exclusive(…, 'background')`, as today's `resolveStyle` does.
- **Host-agnostic**: no `vscode`, File API or IndexedDB in `packages/core`
  or `packages/ui`.
- **Accessible names in `contracts/ui.md` are binding**, because tests query
  by them.
- **Colors**: data and label colors are fixed; chrome uses `--se-*` tokens.
- **Files**: CRLF line endings. Edit them without reformatting unrelated
  lines.

---

## Phase 1: Setup

**Purpose**: test data, and the baseline of today's drawing, recorded before
any style code changes.

- [X] T001 [P] Write `scripts/fixtures-011.mjs`, modeled on
  `scripts/fixtures-009.mjs`, seeded and deterministic. It writes these to
  `tests/vscode-ext/fixtures/`:
  - `roads-los.geojson`: 1,500 LineStrings with:
    - `los`: A–F, every 30th null;
    - `volume`: integer, log-normal, every 40th null;
    - `name`: street names, including diacritics.
  - `crashes.geojson`: 3,000 Points with:
    - `severity`: 4 text values;
    - `crash_type`: 9 text values, uneven frequencies;
    - `heading`: 0–359;
    - `age_days`: 0–3650;
    - `hex_color`: `#rrggbb`, with every 25th value an invalid string;
    - `name`.
  - `counties-011.geojson`: 600 Polygons with `pop`, `density` (float) and
    `name`.
  Document all three in `tests/vscode-ext/fixtures/README.md`. Run the script
  and commit the outputs.
- [X] T002 Write `tests/core/fixtures/style/pre-011-styles.ts`, modeled on
  `pre-009-styles.ts`. It must hold **raw `LayerStyle` JSON literals**, not
  built through `startStyle` or other edit functions, because those APIs
  change. It covers every pre-011 shape:
  - single, plain and shaped (star, dash, radius 7, layer opacity 0.5);
  - categorized: auto; manual with hidden and recolored classes; Other;
    No value;
  - graduated: equal, quantile, jenks and manual; by expression; with a
    hidden class;
  - rules, with an else and a hidden rule;
  - bivariate, with a hidden cell;
  - heatmap: px; m with automatic intensity; weighted;
  - size channel: classed, and proportional with area and linear curves;
    alone and combined with categorized;
  - extrusion: column × scale, and constant;
  - a `Mixed` geometry case.
  It also exports `SNAPSHOT_LAYER_011`: features with `v`, `kind`, `w` and
  `h`, plus the rule counts and ruleErrors inputs.
- [X] T003 Write the recorder (done as `tests/core/record-pre-011.test.ts`,
  gated by `SE_RECORD_011=1`, because core is TypeScript and vitest already
  resolves it). For every style in T002,
  it records:
  - `resolveStyle`, with `classes`, `caption`, `size`, `grid` and `heat`;
  - `paintFor` at selection color `#f59e0b` and latitude 40;
  - `layoutFor`, `visibilityFilter` and `markerIconIds`;
  - `drawsHeatmap`.
  It writes `tests/core/fixtures/style/pre-011-snapshot.json`. Run it **on the
  current main code, before T006**, commit the JSON, and note the commit hash
  in the file header.
- [X] T004 [P] Add `tests/core/fixtures/style/pre-011-sidecars/`: QML files
  saved by the current exporter (`styleToQml`) for each T002 style, plus a
  `README.md` saying they are the 0.3.0 sidecars used for US2 and SC-002.

---

## Phase 2: Foundational (blocking)

**Purpose**: the channel types and helpers every story needs. There is no
behavior change yet.

- [X] T005 [P] Write the tests in `tests/core/style-channel-model.test.ts`:
  - `CHANNEL_ORDER`;
  - `channelsFor` for every geometry × draw (the data-model table, including
    Mixed);
  - `scalesFor` matches spec FR-010 exactly;
  - `fixedValue` for each channel and part, including fixed line color =
    `strokeColor`, and line width = `lineWidth ?? strokeWidth`;
  - output validation per channel type (color hex, px range 0.5–100, shapes,
    dashes, opacity 0..1, finite rotation, height ≥ 0).
- [X] T006 Create `packages/core/src/style/channels.ts`:
  - the types from data-model.md: `ChannelId`, `Channels`, `Encoding`,
    `Source`, `Output`, `ClassDef`, and the six `Scale` kinds;
  - `CHANNEL_ORDER`, `channelsFor`, `scalesFor`, `fixedValue`;
  - `isOutputFor(channel, v)`, `channelDataColumn(channel, enc)`
    (`column` | `__se_val_<ch>` | `__se_cls_<ch>`), and `LABEL_COLUMN = '__se_lbl'`.
  Export it from `packages/core/src/style/index.ts`. T005 passes.
- [X] T007 Extend `LayerStyle` in `packages/core/src/style/model.ts` with the
  optional fields:
  - `draw`, `channels`, `heatmap`, `height`, `labels`;
  - `lineWidth`, `rotation`, `opacity`.
  Keep `renderer`, `size` and `extrusion` as legacy fields. Add the
  `HeatmapSettings` type (`HeatmapRenderer` minus `kind`). Add `drawOf(style)`.
  No behavior change: the whole `tests/core` suite stays green.
- [X] T008 [P] Add `rotation` and `opacity` to `SymbolSpec` in
  `packages/core/src/style/symbol.ts`, with defaults 0 and 1 in `baseSymbol`.
  Existing symbol tests stay green, with outputs unchanged.
- [X] T009 Generalize the `ResolveInput` fields in
  `packages/core/src/style/resolve.ts`. Add:
  - `ruleCountsByChannel`, `ruleErrorsByChannel`;
  - `expressionErrors: Partial<Record<ChannelId, string>>`;
  - `labelError`.
  The old single forms are read as the `color` channel's. Add the
  `ResolvedChannel` and `LegendGroupModel` types to `model.ts` (data-model.md).
  No behavior change.

**Checkpoint**: types compile; every existing test is green.

---

## Phase 3: User Story 2 — Existing styles keep working (P1) · slice 1

**Goal**:
- channels become the model under the hood;
- old styles and sidecars migrate;
- the map draws exactly as before;
- the UI is unchanged and still reads the alias fields.

**Independent Test**: `tests/core/style-migration-011.test.ts` reproduces
`pre-011-snapshot.json` for every style, and the existing suites stay green.

### Tests for User Story 2

- [X] T010 [P] [US2] Write `tests/core/style-migration-011.test.ts`:
  - **Migration.** For each T002 style, `sanitizeStyle` produces:
    - categorized → `channels.color` Categories;
    - graduated → Classes, with an expression source when it had one;
    - rules → Conditions;
    - bivariate → Bivariate;
    - heatmap → `draw.points = 'heatmap'` plus `heatmap`;
    - size → `size` and `width` with the same encoding;
    - extrusion → `draw.polygons = '3d'` plus `height` identity × scale, or
      `height.meters`.
    No legacy fields remain, and running it twice gives the same result
    (idempotent).
  - **Identity.** The migrated style's `resolveStyle` (alias fields),
    `paintFor`, `layoutFor`, `visibilityFilter` and `markerIconIds` equal the
    snapshot. Expressions are compared by **evaluating both** through
    MapLibre's evaluator on every `SNAPSHOT_LAYER_011` feature, plus
    hover/selected feature-state variants, not by deep-equal.
- [X] T011 [P] [US2] Write `tests/core/style-qml-migration-011.test.ts`: every
  `pre-011-sidecars/*.qml` imports to the same channels T010 expects. Its
  re-export, re-imported, is identical (round trip). It also checks that
  `spatialExplorer/style` is written and is preferred on import.

### Implementation for User Story 2

- [X] T012 [US2] Add the migration to `sanitizeStyle` in
  `packages/core/src/style/model.ts`, following research §9 and data-model.md
  "Validation and migration". Move the output and scale validation into
  `sanitizeEncoding(channel, raw)` in `channels.ts`. Sanitize `labels` in a new
  `packages/core/src/style/labels.ts` (`sanitizeLabels`, defaults per
  geometry). T010's migration half passes.
- [X] T013 [US2] Rewrite `resolveStyle` in `packages/core/src/style/resolve.ts`
  to resolve per channel (`resolveChannel(style, channel, enc, layer)`),
  reusing the existing code:
  - categorized: Categories;
  - graduated / classified: Classes;
  - rules: Conditions;
  - bivariate: Bivariate;
  - `proportionalChannel`: Continuous for numbers;
  - extrusion: Identity for height.
  Each class's `output` is set. `color` keeps `color` on `ResolvedClass`, and
  size classes keep `size`. Fill `ResolvedStyle.channels`, and keep the alias
  fields (`status`, `caption`, `classes`, `grid`, `size`, `heat`) derived from
  the `color` and `size` channels so the UI is untouched.
- [X] T014 [US2] Rewrite the paint builders in
  `packages/core/src/style/expressions.ts`:
  - `channelExpression(style, resolved, channel, part)`;
  - `symbolExpressions`, `paintFor`, `layoutFor`, `visibilityFilter` and
    `markerIconIds` read channels;
  - `heatmapPaint` reads `style.heatmap` and `drawOf(style)`;
  - extrusion height reads the `height` channel or `height.meters`.
  Keep `classIndexExpression` for the color channel. T010's identity half
  passes.
- [X] T015 [US2] Update `packages/core/src/style/extrusion.ts` and its
  callers (`activeExtrusion`, `extrusionColumn`, `extrusionHeightExpression`)
  to read `drawOf(style).polygons === '3d'` and the height channel. Keep the
  `Extrusion` type only for migration and QML. `tests/core/extrusion*.test.ts`
  stays green.
- [X] T016 [US2] Update `styleDataColumns` to list every channel's data
  column plus the label column (`channelDataColumn`), deduplicated. Move it
  to `channels.ts` and re-export it from `model.ts`. Update the callers in
  `packages/core/src/query/session.ts`, `packages/ui/src/viewerStore.svelte.ts`
  (`styleColumns`) and `packages/core/src/view/*`.
- [X] T017 [US2] Generalize the engine side in
  `packages/core/src/query/session.ts`:
  - statistics per distinct channel column (`dataByColumn`);
  - rule counts and errors per conditions channel (`__se_cls_<ch>`), and
    expression values per expression-source channel (`__se_val_<ch>`), in
    the view and tile SELECTs;
  - `resolveHeatmapAuto` reads `style.heatmap`.
  The old single forms feed `color`. Extend `tests/core/stats-sql.test.ts`
  for two conditions channels and two expression channels in one SELECT.
  **Slice 1 outcome:** not needed yet. Only the color channel can have
  conditions or an expression, and it keeps spec 010's engine columns.
  Per-channel columns moved to T043 (research "Slice 1 outcomes").
- [X] T018 [US2] Make the QML reader in `packages/core/src/style/qml.ts`
  produce channels:
  - the renderer becomes `channels.color`;
  - data-defined size becomes `size` / `width`;
  - `<renderer-3d>` becomes `draw` + `height`;
  - the heatmap renderer becomes `draw` + `heatmap`;
  - legacy `spatialExplorer/*` properties are read and migrated.
  Add writing and reading of `spatialExplorer/style` (the full channels, draw
  and labels JSON), preferred on read. Export of channel kinds that existed
  before 011 must produce the same QML as today, apart from the added custom
  property. `tests/core/style-interchange*.test.ts` and
  `qgis-heatmap-cases`/`qgis-rules-cases` stay green. T011 passes.
- [X] T019 [US2] Make `packages/core/src/style/sld.ts`,
  `packages/core/src/style/mapbox.ts` and `interchange.ts` read channels for
  the pre-011 kinds, with identical output. Their existing tests stay green.
- [X] T020 [US2] Update `packages/core/src/style/edit.ts` so every existing
  edit function writes channels:
  - `startStyle`, `setClassColor`, `setRamp`, the size edits, the rules
    edits, the bivariate edits and the heatmap edits;
  - behavior seen through the alias fields is unchanged;
  - signatures stay the same for now.
  `tests/core/style-edit.test.ts`, `style-rules.test.ts`,
  `style-bivariate.test.ts`, `style-channels.test.ts` and
  `style-heatmap.test.ts` stay green.
  **Slice 1 outcome:** edits still return the pre-011 keys; the store's
  sanitize turns them into channels. Channel-scoped edits are T025.
- [X] T021 [US2] Run every suite:
  - `npm test --workspace=tests/core`;
  - the style, accessibility, extrusion and map-image web specs;
  - `tests/vscode-ext` `style.test.ts`;
  - the PyQGIS checks `check_009.py`, `check_010_rules.py` and
    `check_heatmap.py`, against fresh cases.
  Fix regressions. Record the results in `research.md` "Slice 1 outcomes".

**Checkpoint**: slice 1 is done. The UI is unchanged, the model is channels, and
SC-002 is proven.

---

## Phase 4: User Story 1 — Each property by its own column (P1) · slice 2 🎯 MVP

**Goal**:
- the panel lists property rows (Fixed or By column), with the
  Categories and Classes scales for every channel;
- legend groups per channel;
- the style type section, Size section, Appearance section and 3D section
  are removed.

**Independent Test**:
- **Lines:** Color by text and Width by number.
- **Points:** Color, Shape and Size by three columns.
- Check each feature's outputs, and that the legend shows separate groups.

### Tests for User Story 1

- [X] T022 [P] [US1] Write `tests/core/style-channels-011.test.ts`, covering
  Categories and Classes on every channel:
  - `startEncoding` defaults (data-model table);
  - outputs filled from the ramp or range (`classSizes`);
  - shape keeps 6 values plus Other (7 shapes), and pattern 4 values plus Other (5 patterns); the rest fall into
    Other, with a note;
  - every channel's expression evaluated by MapLibre per feature:
    - `circle-stroke-color`, `circle-stroke-width`, `circle-opacity`;
    - `line-width`, `line-dasharray`, `line-opacity`;
    - `fill-opacity`, `fill-outline` color and width;
    - `icon-rotate`, `icon-opacity`, `fill-extrusion-height`;
  - `markerIconExpression` builds ids that `parseMarkerIconId` reads back, with
    the per-feature shape, fill, stroke and width;
  - `layerFilters`: features with a circle shape go to the circle layer, and
    the rest to the marker layer;
  - `visibilityFilter` hides a feature whose class is hidden in **any**
    channel;
  - fixed values per channel, and switching to Fixed restores them.
- [X] T023 [P] [US1] Write `tests/web/specs/style-channels-011.spec.ts`:
  - **Lines** (`roads-los.geojson`):
    - Color: By column `los`;
    - Width: By column `volume`;
    - check rendered pixels: two LOS classes differ in color, two volume
      classes in width;
    - the legend has two groups.
  - **Points** (`crashes.geojson`): Color `severity`, Shape `crash_type`, Size
    `age_days` (classes). Check the pixel shapes and colors of known
    features, and the Other note for the 9 types.
  - **Back to Fixed:** switch Width to Fixed; every line returns to the fixed
    width, and Color is unchanged. Switch Width back to By column: the same
    column, scale and classes come back (FR-007).
  - **Polygons:** the rows are Color, Outline color, Outline width and
    Opacity, with no Size.
  - **Keyboard:** each row's switch and controls are reachable and named per
    contracts/ui.md.
  - **axe:** no violations on the panel.
- [X] T024 [P] [US1] Update `tests/web/specs/helpers.ts`. Add:
  - `setChannel(page, property, { column, scale })`;
  - `setFixed(page, property)`;
  - `expandRow(page, property)`.
  `chooseStyleType` keeps working in this phase: T030 leaves the style type
  dropdown in place, and T037 replaces it. Migrate the specs that use the
  removed Size, Appearance and 3D sections (`style-*.spec.ts`,
  `accessibility.spec.ts`, `extrusion.spec.ts`, `map-image.spec.ts`) to the
  rows, keeping each test's intent. List every changed assertion in the commit
  message.

### Implementation for User Story 1

- [X] T025 [US1] Add the channel-scoped edits to
  `packages/core/src/style/edit.ts` (contracts/style-core.md):
  - `setFixed`, `setEncoding`, `startEncoding`, `setScaleKind`;
  - channel-scoped method, class count, bound, category value, add and delete
    class;
  - `setClassOutput`, `setClassLabel`, `setClassVisible`;
  - `setRamp`, `setRange`, `setCurve`, `setLegendHidden`.
  Re-express the old edit functions as thin wrappers over these (removed in
  T038).
- [X] T026 [US1] Implement the remaining channels in
  `packages/core/src/style/expressions.ts`: `strokeColor`, `strokeWidth`,
  `shape`, `dash`, `opacity` and `rotation`.
  - **Marker icons** (research §2): `markerIconExpression` concatenates the
    per-feature outputs. The opacity channel multiplies `circle-opacity`,
    `circle-stroke-opacity`, `icon-opacity`, `line-opacity`, `fill-opacity`,
    the fill outline and the extrusion.
  - **Filters**: `layerFilters` splits circle and marker by the shape
    expression. Add `rotation` to `icon-rotate` (`icon-rotation-alignment`
    stays `viewport`).
  T022 passes.
- [X] T027 [US1] Update `packages/ui/src/MapView.svelte`:
  - apply `layerFilters` to `circle` and `marker`;
  - `markerIconIds` becomes per-feature: keep `styleimagemissing` drawing
    any id, and drop unused icons on style change by their id prefix rather
    than a known list;
  - paint and layout per channel.
  Check `data-rendered-features` and hit-testing, hover and selection with
  shaped markers varying by data.
- [X] T028 [P] [US1] Write `packages/ui/src/style/ChannelRow.svelte`
  (contracts/ui.md):
  - **Heading** with the property name;
  - **Fixed / By column** radiogroup, named "<Property>: Fixed" and
    "<Property>: By column";
  - **Fixed editor** by channel type: color swatch with opacity, number
    slider, `MarkerShape` select, `LineDash` select, rotation slider;
  - **By column** shows a column select (plus "SQL expression…" reusing the
    graduated expression input), a scale select from `scalesFor`, and a
    collapsible `ScaleEditor` with a one-line summary.
- [X] T029 [P] [US1] Write `packages/ui/src/style/ScaleEditor.svelte`:
  - **Categories:** `ClassList` in value mode with an output column;
  - **Classes:** method, count, manual bounds (as the graduated section
    today), plus a ramp (`RampPicker`) or a min–max range;
  - **Conditions and Bivariate, for Color only in this phase:** today's rules
    editor and `BivariatePicker`, moved in unchanged, so migrated rules and
    bivariate styles stay editable (US2). T044 extends Conditions to every
    channel;
  - **Hide from legend** checkbox.
  Make `ClassList.svelte` take an `outputKind`
  (`'color' | 'px' | 'shape' | 'dash' | 'opacity' | 'degrees' | 'meters'`)
  and render the matching editor per row, with accessible names
  "<class label> <property>".
- [X] T030 [US1] Rebuild `packages/ui/src/LayerStylePanel.svelte`:
  - rows from `channelsFor(geometry, draw)` in `CHANNEL_ORDER`, using
    `ChannelRow`;
  - remove the Size, Appearance and 3D sections;
  - **interim, until T037:** keep the style type dropdown
    (`StyleTypePicker`). Each type now starts its channel through the existing
    `startStyle` wrapper: Single clears `color`, Categorized and Graduated
    start the Color row, Rules and Bivariate start Color with that scale,
    Heatmap sets `draw.points`. So no capability disappears between the two
    phases;
  - keep the heatmap section (shown while Draw as is Heatmap), layer opacity,
    and import and export;
  - the panel's set-aside encodings live in
    `packages/ui/src/viewerStore.svelte.ts`, keyed by layer and channel
    (FR-007);
  - notes per row: Other or cap, third varying channel (advice), fallback
    reason.
- [X] T031 [US1] Generalize legend groups for this slice in
  `packages/ui/src/MapLegend.svelte` and `ViewerLayout.svelte` (`legendSpec`):
  - one group per varying channel, in `CHANNEL_ORDER`, titled with the column;
  - entries are toggle buttons that hide the class through
    `setClassVisible(channel, key)`.
  Merging comes in US5. `mapImage.ts` takes the groups as `LegendSpec.groups`.
- [X] T032 [US1] Profile the panel at a 6× CPU throttle with 10 rows and 3
  varying channels, against `feedback-ui-responsiveness`. Typing in a class
  label or dragging a fixed slider must not re-resolve data. Debounce with
  the existing pattern. Note the results in `research.md`.

**Checkpoint**: US1 works end to end with Categories and Classes. Old styles
still draw identically (T010 green), and T023 and the migrated specs are
green.

---

## Phase 5: User Story 3 — Draw as, and one-click recipes (P1) · slice 2

**Goal**:
- the dropdown offers Draw as for each geometry, plus recipes;
- recipes set channels and are not stored.

**Independent Test**:
- apply each recipe on suitable layers and check the channels;
- switch Markers ↔ Heatmap and Fills ↔ 3D, and check the settings set aside.

### Tests for User Story 3

- [ ] T033 [P] [US3] Write `tests/core/style-recipes.test.ts`:
  - each recipe's channels on fixtures (research §11 table);
  - `recipeUnavailable` reasons;
  - Flow / network on lines sets `color` Categories plus `width` Classes;
  - recipes leave other channels untouched;
  - `setDraw` keeps channels when switching to heatmap, and the `height`
    encoding when switching to fills.
- [ ] T034 [P] [US3] Write `tests/web/specs/style-recipes.spec.ts`:
  - the dropdown has the groups "Draw as" and "Recipes" (roles and names per
    contracts/ui.md);
  - Flow / network on `roads-los.geojson` in at most 4 choices (SC-001);
  - Bivariate is unavailable on a layer with one numeric column, and its
    reason is announced;
  - keyboard: arrows skip unavailable options, Enter applies;
  - Heatmap ↔ Markers round trip: marker channels come back;
  - Fills → 3D shows the Height row.

### Implementation for User Story 3

- [ ] T035 [P] [US3] Create `packages/core/src/style/recipes.ts`:
  - `RECIPES` (id, label, one-line hint);
  - `recipeUnavailable`;
  - `applyRecipe`, reusing `startEncoding`, `suggestedRules`, the bivariate
    start and the heatmap start;
  - `setDraw` in `edit.ts`.
  Export them from core's index. T033 passes.
- [ ] T036 [US3] Extend `packages/ui/src/style/StyleTypePicker.svelte` to take
  groups:
  - `role="group"`, with `aria-label` "Draw as" and "Recipes";
  - recipe options are actions;
  - the button shows the current Draw as and its hint.
  Arrow keys still skip disabled options across groups.
- [ ] T037 [US3] Wire Draw as and recipes into `LayerStylePanel.svelte`,
  replacing T030's interim dropdown:
  - `setDraw` with the camera for the heatmap's meters;
  - the 3D pitch ease (`EXTRUSION_PITCH`) when switching to 3D, as the 3D
    toggle does today;
  - Height row only in 3D.
  Re-express `chooseStyleType` in `tests/web/specs/helpers.ts` as
  `chooseDrawAs` / `applyRecipe`, and update its callers. T034 passes.

**Checkpoint**: slice 2 is done. Run the full web suite and the extension
`style.test.ts`, then go to T038.

### Slice 2 clean-up (no story)

- [ ] T038 Drop the alias fields:
  - from `ResolvedStyle`: `caption`, `classes`, `grid` and `size` at top
    level;
  - from the old edit wrappers in `packages/core/src/style/edit.ts`;
  - `Renderer`, `SizeChannel` and `rendererOf` (types kept only inside the
    migration).
  Move the callers to `resolved.channels`. Update the tests that read the
  aliases to read `channels.color` and `channels.size`. Keep their intent.
- [ ] T039 Update `README.md`'s styling section and the `CHANGELOG.md`
  [Unreleased] entries: Changed (style panel by property, Draw as, recipes),
  and Added (Outline color, Outline width, Shape, Pattern, Opacity and
  Rotation by column).

---

## Phase 6: User Story 4 — The same scales for every property (P2) · slice 3

**Goal**: Continuous, Conditions, As is and Bivariate everywhere FR-010
allows.

**Independent Test**: each property's scale list matches FR-010, and each new
combination's map output matches independently computed values.

### Tests for User Story 4

- [ ] T040 [P] [US4] Extend `tests/core/style-channels-011.test.ts` with
  Continuous, Conditions and As-is scales:
  - **Continuous:**
    - color interpolates exactly between ramp stops (the midpoint of
      `#ffffcc` and `#800026` is `192,128,121`, matching QGIS, research §4);
    - numeric channels follow linear or area curves;
    - a domain override clamps values.
  - **Conditions:** per-channel `__se_cls_<ch>`, first match wins, then the
    else output. Two channels each with their own rules.
  - **As is:**
    - hex colors pass, invalid ones fall back and are counted (note);
    - degrees, px and meters × multiply;
    - more than 256 distinct colors on shaped markers falls back, with a
      note.
  - **Quantized marker colors:** non-circle markers with continuous color use
    a 32-step `step` expression, and circles stay smooth. Check the note text.
  - **Bivariate:** offered on `color` only. `sanitizeEncoding` rejects it
    elsewhere.
- [ ] T041 [P] [US4] Write `tests/web/specs/style-scales-011.spec.ts`:
  - Color by `density` Continuous: a gradient legend with min and max, and a
    pixel color at a known feature matches the expected interpolation;
  - Opacity Continuous 0.3–1;
  - Rotation by `heading` As is: a triangle at heading 90 points east (pixel
    check);
  - Color by `hex_color` As is, with the bad-value note count;
  - Width by Conditions with two rules;
  - Shape triangle plus continuous color: the 32-step note shows.
  - **SC-006**: the four example maps from the spec's Context, each built from
    a freshly opened fixture through the panel alone:
    - roads: LOS color and volume width;
    - crashes: severity color and type shape;
    - stations (`crashes.geojson` as a stand-in): size by `age_days`, faded
      by opacity;
    - arrows: triangles rotated by `heading`.

### Implementation for User Story 4

- [ ] T042 [US4] Implement in `packages/core/src/style/resolve.ts`:
  - Continuous: domain from the column's statistics, `samples` for legends;
  - As is: invalid-value counts from the engine for colors, or features
    when in memory;
  - Conditions on any channel (the rules path parameterized by channel);
  - the shaped-marker bounds for continuous and As-is colors (research §2).
  Add `continuousExpression`, `identityExpression` and the 32-step quantized
  form in `packages/core/src/style/expressions.ts`. T040 passes.
- [ ] T043 [US4] Add the per-channel engine work in
  `packages/core/src/query/session.ts`:
  - `__se_cls_<ch>` rule counts and errors per channel;
  - distinct-color counts and invalid counts for As-is colors (one query,
    cached with the other statistics).
  Extend `tests/core/stats-sql.test.ts`.
- [ ] T044 [US4] Extend `packages/ui/src/style/ScaleEditor.svelte` with the
  new scales:
  - **Continuous:** ramp or min–max, curve (numeric), domain override;
  - **Conditions:** the rules editor (`RuleList` from spec 010) with an
    output editor per rule instead of a color;
  - **As is:** the multiply field for height, and the note;
  - **Bivariate:** `BivariatePicker`, color only.
  The scale select lists `scalesFor(channel)`. T041 passes.

---

## Phase 7: User Story 5 — A legend group per property (P2) · slice 3

**Goal**:
- groups merge when they share a column and classes;
- gradient and samples groups;
- hide a group from the legend.

**Independent Test**: test different columns, then the same column and
breaks, then the same column with different breaks. Check the groups, titles,
entries and merging.

### Tests for User Story 5

- [ ] T045 [P] [US5] Write `tests/core/style-legend-011.test.ts`:
  - `legendGroups` follows the merge rule (research §10): same source, same
    scale kind and same classes or bounds merge; different breaks don't;
  - a merged entry's `SymbolSpec` carries every merged output;
  - continuous color gives a gradient; continuous size, width or opacity give
    3 samples;
  - `legend.hidden` drops the group, and the map is unchanged;
  - group order follows `CHANNEL_ORDER`;
  - migrated size+width on a points-only layer gives one group (the width is
    not listed for points).
- [ ] T046 [P] [US5] Write `tests/web/specs/legend-011.spec.ts`:
  - **two groups:** Color by `los` and Width by `volume`;
  - **one group:** Color and Size by `pop` with the same quantile 5, whose
    swatches are sized and colored;
  - **two groups again:** same column, different method;
  - **gradient** group's accessible name;
  - **Hide from legend:** the group disappears, and map pixels are unchanged;
  - **toggling an entry** hides features.

### Implementation for User Story 5

- [ ] T047 [US5] Create `packages/core/src/style/legend.ts`. `legendGroups`
  builds `LegendGroupModel[]` from `ResolvedStyle.channels`. Export it from
  index. T045 passes.
- [ ] T048 [US5] Render `LegendGroupModel` in
  `packages/ui/src/MapLegend.svelte`:
  - class groups: merged swatches drawn from `SymbolSpec` (color, size,
    shape, dash, rotation, opacity);
  - gradient groups: `role="img"`, named "<title>: colors from <min> to <max>";
  - sample groups: three rows.
  Replace the T031 interim groups. T046 passes.
- [ ] T049 [US5] Draw the same groups in `packages/ui/src/mapImage.ts`, and
  feed them from `ViewerLayout.svelte`. The groups are merged swatches,
  gradient bars (the heatmap bar code reused) and sample rows. Extend
  `tests/web/specs/map-image.spec.ts` with a three-group image.

---

## Phase 8: User Story 7 — Save, reopen and exchange (P2) · slice 4

**Goal**: QML data-defined properties for every channel, plus SLD and Mapbox,
all with notes.

**Independent Test**: export every channel × scale, check QGIS per feature,
and re-import into the app.

### Tests for User Story 7

- [ ] T050 [P] [US7] Write `tests/core/style-interchange-011.test.ts`:
  - **QML:** for every channel × scale, the data-defined keys and expression
    forms of contracts/interchange-mapping.md. This includes:
    - `fillColor`, `outlineColor`, `outlineWidth`, `name`, `angle`,
      `outlineStyle`;
    - symbol `alpha` in percent;
    - `x` → `cross_fill` with +45 angle;
    - a hidden class becomes size 0 or alpha 0;
    - the primary renderer choice.
  - **Import** of QGIS's own simple forms (field, `scale_linear`, simple
    `CASE`). Others keep the fixed value, with a note naming the property.
  - **SLD:**
    - the cross product of two channels;
    - the 100-rule cap and its note;
    - continuous becomes 10 classes, with a note;
    - shape `WellKnownName`, `stroke-dasharray` and `Rotation` per rule.
  - **Mapbox:** each paint expression equals `channelExpression`, and import
    reads `match`/`step`/`interpolate` over one `get`.
  - **Round trip:** app → each format → app is identical where the format can
    express it, otherwise as the notes say.
- [ ] T051 [P] [US7] Write `tests/core/qgis-011-cases.test.ts`, modeled on
  `qgis-cases.test.ts`. When `SE_QGIS_011` names a directory, it writes:
  - per case: data GeoJSON, the app's QML, and per-feature expected outputs
    (fill, stroke, size or width, shape, dash, opacity, rotation, drawn or
    hidden);
  - cases for every row of the interchange table, on points, lines and
    polygons.
- [ ] T052 [P] [US7] Write `tests/qgis/check_011.py`, modeled on
  `check_009.py`. It loads each case and evaluates each symbol layer's
  data-defined properties and the symbol `alpha` per feature in a render
  context (as `spikes/qgis-channels.py.txt` does), compares them with the
  expected values, and renders a PNG per case. Exit 1 on any mismatch.
  Document it in `tests/qgis/README.md`.

### Implementation for User Story 7

- [ ] T053 [US7] Implement the QML export in
  `packages/core/src/style/qml.ts`:
  - the primary renderer choice;
  - `dataDefinedXml` for every non-primary channel;
  - symbol-level `alpha`;
  - the hidden-class forms;
  - `spatialExplorer/style`.
  Generalize spec 009's size code (`sizeDataDefined`) rather than adding a
  parallel path.
- [ ] T054 [US7] Implement the QML import of simple data-defined forms, and
  notes for the rest, in `packages/core/src/style/qml.ts`.
- [ ] T055 [P] [US7] Implement the SLD export and import in
  `packages/core/src/style/sld.ts`:
  - the cross product of two channels;
  - the cap;
  - continuous as 10 classes;
  - per-rule shape, dash and rotation;
  - notes in `interchange.ts`.
- [ ] T056 [P] [US7] Implement the Mapbox export and import in
  `packages/core/src/style/mapbox.ts`, reusing `channelExpression`.
- [ ] T057 [US7] Run `check_011.py` against the T051 cases in QGIS 4.2.3.
  Fix mismatches. Record the outcome (cases, mismatches 0) in `research.md`
  "SC-003", and in `tests/qgis/README.md` "Last run".
- [ ] T058 [US7] Extend `tests/vscode-ext/src/suite/style.test.ts`: save a
  sidecar with three varying channels and labels on (an expression source);
  reopen; the same channels, legend and labels (FR-024).

---

## Phase 9: User Story 6 — Labels (P2) · slice 5 (can start after Phase 3)

**Goal**:
- a Labels rail button and panel;
- text from a column or an expression;
- size, color, halo and placement;
- no overlaps;
- labels saved and exported.

**Independent Test**:
- turn labels on for points, lines and polygons, and check each setting on
  the map;
- check the exported files read back by QGIS.

### Tests for User Story 6

- [ ] T059 [P] [US6] Write `tests/core/style-labels.test.ts`:
  - `sanitizeLabels`: clamps, defaults per geometry, and off without a source;
  - `labelLayer` layout and paint:
    - `text-field` from the column or `__se_lbl`;
    - `text-font ['sans-serif']`;
    - `text-size`, `text-color` and `text-halo-*`;
    - point anchors and offsets mapped to `text-anchor` and `text-offset`;
    - lines use `symbol-placement: line` with `text-keep-upright`;
    - polygons are placed at the label point;
    - `text-allow-overlap: false`;
  - the label filter includes `visibilityFilter`;
  - the session SQL adds `__se_lbl` for an expression and passes its error
    back;
  - QML, SLD and Mapbox label export and import, per
    contracts/interchange-mapping.md.
- [ ] T060 [P] [US6] Write `tests/web/specs/labels.spec.ts`:
  - **Rail and panel:** the Labels button is named and keyboard reachable,
    and the panel's controls are named per contracts/ui.md, with axe clean.
  - **Points** (`crashes.geojson`): text `name` makes labels appear (rendered
    text pixels near known points); with size 20, the text pixels' bounding
    box grows.
  - **Lines:** labels follow the line (pixels along the line's angle).
  - **Expression:** `name || ' (' || los || ')'` works; an invalid expression
    shows its error and the previous labels stay.
  - **Legend:** hiding a class hides its labels.
  - **Basemap:** switching to Blank keeps the labels drawn.
  - **3D:** on `counties-011.geojson` drawn as 3D, labels are drawn at ground
    level at each polygon's label point (research §3).
  - **Tiles** (large-data fixture): turning labels on issues no new
    `CREATE VIEW` (query log), so the layer is not reloaded.

### Implementation for User Story 6

- [ ] T061 [US6] Implement `packages/core/src/style/labels.ts`:
  `sanitizeLabels`, defaults, and `labelLayer(style, resolved)` per
  geometry. Add the `label` map layer id and its filter to `expressions.ts`.
  Add `setLabels` to `edit.ts`.
- [ ] T062 [US6] Add the engine label column in
  `packages/core/src/query/session.ts`:
  - `__se_lbl` for expression sources, in the view and tile SELECTs;
  - `labelError` returned to resolve;
  - a column source just adds the column to `styleDataColumns`.
- [ ] T063 [US6] Add the label layers in `packages/ui/src/MapView.svelte`:
  - a `label` symbol layer after `marker` and `extrusion`, for each source
    instance (GeoJSON, engine tiles, PMTiles layers);
  - visibility follows `labels.enabled`;
  - not interactive (excluded from `INTERACTIVE_DEFS`);
  - on the globe, with the default `text-pitch-alignment`.
- [ ] T064 [P] [US6] Add the `tag` icon path to `packages/ui/src/Icon.svelte`,
  and the `labels` side tab:
  - `SideTab` in `viewerStore.svelte.ts`;
  - the `ActivityRail.svelte` button between Style and Details, with the title
    "Labels" / "Labels: on (<source>)";
  - `SidePanel.svelte` routing;
  - layout state persistence accepts `labels`.
- [ ] T065 [US6] Write `packages/ui/src/LabelsPanel.svelte` (contracts/ui.md):
  - Show labels;
  - Text: a column select, or "SQL expression…" with completion and an error
    `aria-describedby`;
  - Size;
  - Color;
  - Halo: on, color, width;
  - Placement: point anchors and offset when points are present, plus text
    for lines and polygons.
  Edits go through `setLabels`. T060 passes.
- [ ] T066 [US6] Add label export and import to `qml.ts`
  (`<labeling type="simple">`), `sld.ts` (`TextSymbolizer`) and `mapbox.ts`
  (an `<id>-labels` symbol layer), with notes. Add label cases to
  `qgis-011-cases.test.ts` and `check_011.py`: read-back of field or
  expression, size, color, buffer and placement code. T059 passes.
- [ ] T067 [US6] **Tracked check (research §3)**: open `roads-los.geojson` in
  the VS Code extension on a real GPU and look for a mark at word gaps in line
  labels.
  - If it is there: try `text-letter-spacing: 0.01`, then a `font-faces`
    file.
  - Record the result and a screenshot path in `research.md`.

---

## Phase 10: User Story 8 — Map image (P3) · slice 5

**Goal**: the saved image includes labels and every legend group.

- [ ] T068 [P] [US8] Extend `tests/web/specs/map-image.spec.ts` and
  `tests/vscode-ext/src/suite/map-image.test.ts`. A map with labels on and
  three legend groups (one merged, one gradient) saves an image whose map
  area has label text pixels, and whose legend lists the three groups.
- [ ] T069 [US8] Fix whatever T068 shows in `packages/ui/src/mapImage.ts` or
  `MapView.svelte`. Research §3 expects labels to be in the captured frame
  already.

---

## Phase 11: Polish & Cross-Cutting

- [ ] T070 [P] Profile SC-004 (`tests/web/specs/redesign-performance.spec.ts`
  pattern) on a 100,000-row fixture:
  - a channel change reaches the map within 1 s;
  - a fixed value within 200 ms;
  - panel interactions at 6× CPU throttle.
  Record the results in `research.md`.
- [ ] T071 [P] Check SC-005: on a tiles-mode layer, label toggle and setting
  changes cause no data reload, and pan frame times stay within spec 010's
  budget with labels on. Record the results in `research.md`.
- [ ] T072 [P] Run the tracked check from research §1: dashes varying per
  feature on engine tiles (large-data fixture), with a pixel check. Record
  the result.
- [ ] T073 [P] Check themes: run the new panel and Labels panel in light,
  dark and high contrast (`theme.spec.ts` pattern), plus the
  `accessibility.spec.ts` keyboard pass over the new controls (SC-007).
- [ ] T074 Update the documentation for slices 3–5. T039 already covered
  slice 2.
  - `README.md`: a labels section, and the new scales in the styling section;
  - `CHANGELOG.md` [Unreleased]: Added (labels; continuous, conditions and
    as-is scales; legend merging);
  - CLAUDE.md's "Styling and export" bullet, to describe channels and labels;
  - `THIRD-PARTY-NOTICES.md`: no change expected; confirm.
- [ ] T075 Run `scripts/screenshots.mjs` for the style panel, Labels panel and
  legend in light and dark. Review every screenshot and fix what looks wrong.
- [ ] T076 Run the whole of `quickstart.md`:
  - all suites: core, web, extension and lint;
  - the PyQGIS checks (009, 010, heatmap, 011);
  - the steps done by hand.
  Record the outcomes in `research.md` "Final gates". Then merge
  `011-style-channels` into `main` locally (no push).

---

## Dependencies & Execution Order

### Phases

| Phase | Depends on |
|---|---|
| Phase 1 Setup | — (T003 must run before T006 changes anything) |
| Phase 2 Foundational | Phase 1 |
| Phase 3 US2 | Phase 2. Blocks every later phase. |
| Phase 4 US1 | Phase 3 |
| Phase 5 US3 | Phase 4. T038 drops the aliases after slice 2 is green. |
| Phase 6 US4, Phase 7 US5 | Phase 5. US5's merging can start alongside US4 once T047's inputs exist. |
| Phase 8 US7 | Phases 6 and 7 (it exports what they add) |
| Phase 9 US6 | Phase 3 only. It can run in parallel with Phases 4–8, but T066 needs T053's QML structure. |
| Phase 10 US8 | Phases 7 and 9 |
| Phase 11 | everything |

### Within stories

- Tests first; they must fail.
- Then core model and resolve, then expressions, then UI.
- Then the story's web spec green, then commit.

### Parallel opportunities

- **Setup:** T001, T002 and T004. T003 needs T002.
- **Foundational:** T005 and T008 alongside T006 and T007.
- **US2:** T010 and T011.
- **US1:** T022, T023 and T024; then T028 and T029.
- **US3:** T033, T034 and T035.
- **US4:** T040 and T041.
- **US5:** T045 and T046.
- **US7:** T050–T052; then T055 and T056.
- **US6:** T059, T060 and T064.
- **Polish:** T070–T073.

## Parallel Example: User Story 1

```text
T022 tests/core/style-channels-011.test.ts      (core expectations)
T023 tests/web/specs/style-channels-011.spec.ts (browser expectations)
T024 tests/web/specs/helpers.ts + spec migration
then T028 ChannelRow.svelte ‖ T029 ScaleEditor.svelte, after T025–T027
```

## Parallel Example: User Story 6 (alongside Phases 4–8)

```text
T059 tests/core/style-labels.test.ts ‖ T060 tests/web/specs/labels.spec.ts ‖ T064 rail/tab/icon
then T061 → T062 → T063 → T065 → T066
```

## Implementation Strategy

### MVP

The MVP is Phases 1–4 (slice 1, then US1). It is the user's own example (LOS
color plus volume width) and shape, outline, opacity and rotation by column,
with every old style unchanged.

### Incremental delivery

Each slice ends green and can be released:
1. Slice 1 (US2): no visible change.
2. Slice 2 (US1 and US3): the new panel.
3. Slice 3 (US4 and US5): scales and legend.
4. Slice 4 (US7): files.
5. Slice 5 (US6 and US8): labels.

Labels can move earlier if the user wants them sooner. They depend only on
slice 1.
