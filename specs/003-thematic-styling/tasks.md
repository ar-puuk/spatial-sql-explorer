---

description: "Task list for spec 003: Thematic Styling"
---

# Tasks: Thematic Styling

**Input**: Design documents from `specs/003-thematic-styling/`

**Prerequisites**:
- `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`.
- `contracts/`: `style-core.md`, `interchange-mapping.md`, `ui-style-panel.md`.
- QGIS-written fixtures in `spikes/`.

**Tests**: REQUIRED. Constitution IX requires unit tests (`tests/core`,
Vitest), browser tests (`tests/web`, Playwright) and extension tests
(`tests/vscode-ext`, `@vscode/test-electron`) for every layer a story
touches. Within each story, test tasks come first and must fail before
implementation.

**Organization**: tasks are grouped by user story, so each story can be built
and verified on its own. Commit after each task (constitution, Development
Workflow).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete tasks).
- **[Story]**: US1–US5 from spec.md.
- Paths are repository-relative. The monorepo layout is spec 001's.

## Ground rules for every task

- **Host-agnostic.** No `vscode`, File API, IndexedDB, `localStorage` or
  `sessionStorage` in `packages/core` or `packages/ui`. `npm run lint` stays
  at 0 problems.
- **Pure core.** Everything in `packages/core/src/style` is pure (no I/O).
  Style objects are never mutated: edits return new objects
  (`contracts/style-core.md`).
- **Never post Svelte `$state` proxies.** Use the existing JSON-normalizing
  `post()` in `apps/vscode-ext/src/webview/hostAdapter.ts`. Use
  `$state.raw` for resolved styles and paint objects.
- **Theming.** Chrome colors come only from `--se-*` tokens, defined in
  **both** `apps/vscode-ext/src/webview/theme.css` and
  `apps/web/src/theme.css`. Data colors (ramps, "Other" and "No value"
  grays) are fixed hex values from `style/ramps.ts`.
- **Upper-inclusive classes everywhere** (research §2):
  `lower < v ≤ upper`, and the first class includes `lower`. The same
  `toNumber()` and `toCategory()` rules are used in the classifier and in
  the expressions (research §4).
- **No copying.** GeoLibre and QGIS inform decisions only. Jenks is written
  from the published algorithm (Constitution VIII).
- **Verify before checking off.** Run the relevant suite(s), then mark the
  task `[X]` with a one-line verification note.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: test tooling, fixtures and licenses that every story needs.

- [X] T001 Add `@maplibre/maplibre-gl-style-spec` as a devDependency of `tests/core/package.json`, pinned to the installed version (26.4.4). Run `npm install`. Confirm `import { expression } from '@maplibre/maplibre-gl-style-spec'` works in a throwaway Vitest file, then delete that file.
  - *Done*: pinned 26.4.4 (exact); a throwaway Vitest file confirmed createExpression works, then was deleted.
- [X] T002 [P] Create `tests/core/fixtures/style/` with:
  - copies of `specs/003-thematic-styling/spikes/{categorized.qml,graduated.qml,values.json,qgis-breaks.json}`;
  - a `README.md` saying that the QML files and breaks were written by QGIS 4.2.3 via PyQGIS, and how to regenerate them (the spike script is `research.md` §1–§3).
  - *Done*: 4 fixtures + README in tests/core/fixtures/style/.
- [X] T003 [P] Add the ColorBrewer (Apache-2.0, © Cynthia Brewer, Mark Harrower and The Pennsylvania State University) and Viridis/Plasma/Magma (CC0) entries to `THIRD-PARTY-NOTICES.md`, under a new "Color data" section.
  - *Done*: added a 'Color data' section. Cividis was swapped for Plasma, since the license of all three perceptual ramps must be CC0 (Cividis's provenance is matplotlib or its paper); plan, research and tasks updated.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the renderer model, result columns, ramps, and the plumbing
from a resolved style to the map. Single symbol keeps behaving exactly as in
spec 001.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [X] T004 [P] Write `tests/core/style-model.test.ts` covering:
  - a spec 001 style object without `renderer` behaves as `{ kind: 'single' }`;
  - `DEFAULT_LAYER_STYLE.renderer.kind === 'single'`;
  - validation helpers reject `classCount` outside 2..10, `cap` outside 1..12, bad hex colors and duplicate category values (`data-model.md` Validation).
  - *Done*: style-model.test.ts, 5 tests: back-compat, defaults, sanitize clamps, validation incl. manual contiguity.
- [X] T005 Extend `packages/core/src/style/model.ts` with:
  - `Renderer`, `SingleRenderer`, `CategorizedRenderer`, `GraduatedRenderer`, `RampRef`, `ClassOverride`, `CategoryClassDef`, `RangeClassDef`, `ResolvedStyle`, `ResolvedClass` and `StyleNotice`, exactly as in `data-model.md`;
  - `DEFAULT_LAYER_STYLE.renderer = { kind: 'single' }`;
  - `validateStyle()`;
  - the constants `OTHER_COLOR = '#bdbdbd'`, `NO_VALUE_COLOR = '#8c8c8c'`, `DEFAULT_CATEGORY_CAP = 12` and `DEFAULT_CLASS_COUNT = 5`.

  Export them from `packages/core/src/style/index.ts`. Make T004 pass. `tests/core/style.test.ts` (spec 001) stays green.
  - *Done*: renderer types plus rendererOf, sanitizeRenderer and validateStyle in model.ts. renderer is optional in the type (spec 001 literals stay valid) and always filled by sanitizeStyle and the default. Core 127/127; ui svelte-check 0.
- [X] T006 [P] Add `columns: Array<{ name: string; type: string }>` (attribute columns only: not the primary geometry and not `__se_*`) to `Layer` in `packages/core/src/models.ts`.
  - Fill it from the existing `DESCRIBE` in `packages/core/src/query/run.ts` (`describeAndFetch`), and pass it through `layerFromResult()` in `packages/core/src/query/session.ts`.
  - The initial view (`openFile.ts` → `runDefault()`) gets it the same way.
  - Add an assertion to `tests/web/specs/query.spec.ts` through the `?e2e=1` hook, or to a core test with a fake result, that `world-boundaries` reports `name: VARCHAR`.
  - *Done*: Layer.columns comes from DESCRIBE (geometry columns excluded); utility results infer types from values. New query.spec test via the e2e hook (layerColumns): 5/5.
- [X] T007 [P] Write `tests/core/style-ramps.test.ts` covering:
  - every catalog entry has `id`, `name`, `kind`, a `license`, and valid hex colors;
  - `rampColors({id:'viridis',reversed:false}, n)` returns `n` distinct colors for n = 2..10, starting and ending at the anchors;
  - ColorBrewer ramps use their own n-class lists when available (e.g. `brewer-blues` with 5 classes equals ColorBrewer Blues-5);
  - `reversed` reverses the list;
  - qualitative palettes repeat in order beyond their length;
  - `rampsFor('graduated')` holds only sequential and diverging ramps, and `rampsFor('categorized')` only qualitative palettes.
  - *Done*: style-ramps.test.ts, 8 tests: catalog fields, 2..12 colors for every ramp, Blues-5 / RdBu-3 equal ColorBrewer, interpolation past 9, reverse, qualitative repeat, defaults.
- [X] T008 Implement `packages/core/src/style/ramps.ts` per research §6:
  - `RAMPS` holds:
    - Sequential: Viridis (graduated default), Plasma, Magma, and Brewer Blues, Greens, Oranges, Reds, Purples, YlOrRd, YlGnBu.
    - Diverging: Brewer RdBu, RdYlBu, BrBG, PiYG, Spectral.
    - Qualitative: Brewer Set2 (default up to 8), Dark2, Set1, Paired (default for 9–12).
  - `rampColors()` uses ColorBrewer's n-class lists where they exist and Lab interpolation otherwise.
  - `rampsFor()` and `defaultRamp(kind, classCount)`.
  - Enter the color values by hand from the ColorBrewer and matplotlib specifications. They are data, not code.

  Make T007 pass.
  - *Done*: ramps.ts (catalog + Lab interpolation) + rampData.ts. The color data was GENERATED rather than typed: ColorBrewer from QGIS 4.2.3's QgsColorBrewerPalette, and Viridis/Magma/Plasma anchors from matplotlib. Lint 0.
- [X] T009 [P] Write `tests/core/style-expressions.test.ts` (single symbol part), using `expression.createExpression(json, 'layers[0].paint.fill-color')` from the style-spec:
  - `paintFor(singleStyle, resolvedSingle, '#0078d4')` produces the same paint values spec 001's `MapView.svelte` builds today (fill, outline, line and circle, with the selected and hovered `case`s);
  - `visibilityFilter` returns `null` for single.
  - *Done*: style-expressions.test.ts (single), 4 tests: paint identical to spec 001's MapView paint; every value parses with the style-spec; no halo or filter for single; halo contrast.
- [X] T010 Create `packages/core/src/style/expressions.ts` with `paintFor()` and `visibilityFilter()`:
  - move the paint construction out of `packages/ui/src/MapView.svelte` (the `selected` / `hovered` feature-state cases) unchanged for single;
  - add the **selection halo** for thematic renderers: a second outline ring in the contrasting color (research §6), as a no-op for single.

  Make T009 pass.
  - *Done*: expressions.ts: paintFor and visibilityFilter. Paint moved from MapView unchanged for single; the halo applies to thematic styles only. The draft registry indirection was dropped in favor of a direct switch (Constitution X).
- [X] T011 Create `packages/core/src/style/resolve.ts` with `resolveStyle(style, layer)` and `eligibleColumns(columns, kind)`:
  - for single: one class, caption `''`, status `ok`;
  - numeric types for graduated are `TINYINT, SMALLINT, INTEGER, BIGINT, HUGEINT, UTINYINT, USMALLINT, UINTEGER, UBIGINT, UHUGEINT, FLOAT, DOUBLE, DECIMAL(...)` (research §5);
  - categorized accepts every non-geometry type.

  Unit tests go in `tests/core/style-resolve.test.ts` (single and eligibility cases).
  - *Done*: resolve.ts: resolveStyle (single), eligibleColumns and isNumericType; style-resolve.test.ts has 2 tests.
- [X] T012 Wire the plumbing in `packages/ui/src/viewerStore.svelte.ts`:
  - `resolvedStyle = $derived.by(() => resolveStyle(style, session.layer))`, stored raw;
  - `setStyle(patch)` accepts `renderer` patches.

  Then in `packages/ui/src/MapView.svelte`:
  - take `paint` and `filter` props built with `paintFor` / `visibilityFilter`, and apply them via `setPaintProperty` / `setFilter`, combining the geometry filter with the visibility filter;
  - re-apply the selection color on theme change, as today.

  Run the full web suite and the VS Code suite: spec 001 and 002 behavior is unchanged.
  - *Done*: Store: resolvedStyle derived from a raw displayedLayer kept in step via setLayer() (no per-attribute signals). MapView gets the resolved prop, core paint, and per-layer filters plus a halo layer. Web 32/32 and VS Code 37/37 unchanged.
- [X] T013 Add the VS Code test hooks:
  - `spatialExplorer._getStyleState`, which reports `{ renderer, column, method, classCount, status, reason, caption, classes: [{ key, label, color, visible, count }] }` from the webview, mirroring `watchQueryState` in a new `apps/vscode-ext/src/webview/styleState.svelte.ts`;
  - `spatialExplorer._setStyle(styleJson)`, which applies a full `LayerStyle` in the active viewer;
  - `spatialExplorer._saveStyle`, which triggers Save.

  Register them in `apps/vscode-ext/src/extension.ts`, next to `_getQueryState`. Handle the messages in `apps/vscode-ext/src/webview/main.ts`.
  - *Done*: styleState.svelte.ts, reportStyleState, and the testSetStyle/testSaveStyle handlers; _getStyleState, _setStyle and _saveStyle are registered. Verified by style.test.ts in the VS Code suite (39/39).

**Checkpoint**: everything from specs 001 and 002 is green. The single
symbol now flows through `resolveStyle → paintFor`.

---

## Phase 3: User Story 1 - Color features by category (Priority: P1) 🎯 MVP

**Goal**: Categorized on any column: a color per value, "Other" above the
cap, "No value" for nulls, and a legend with counts.

**Independent Test**: categorize `world-boundaries` or the parcels file by a
text column, and see per-value colors and a matching legend (quickstart
Scenario 1).

- [X] T014 [P] [US1] Write `tests/core/style-classify.test.ts` (categorized part):
  - `toCategory` maps `null` and `''` to null, numbers via `String()`, and `true` to `'true'`;
  - categories are ordered most frequent first, ties alphabetical;
  - with the cap, the top N get classes and the rest go to "Other", with `groups` equal to the number of distinct values grouped;
  - nulls go to "No value";
  - counts add up to `features.length`.
  - *Done*: style-classify.test.ts, categorized part (9 tests): frequency order, numeric-aware ties, cap and Other with groups, No value, counts add up, overrides, repeats note, missing-column fallback.
- [X] T015 [P] [US1] Extend `tests/core/style-expressions.test.ts` (categorized):
  - for a fixture of 200 features with string, number, boolean, null and `''` values, evaluate `paintFor`'s fill-color expression per feature with the style-spec;
  - assert that it equals the color of the class `resolveStyle` assigned (SC-006, "map = legend").
  - *Done*: Expression parity: per-feature evaluation of the class color with MapLibre's style-spec on 200 mixed-type features (null, '', booleans, 0.1+0.2, ints, text) equals the legend counts for cap 12 and 4. Hidden classes are filtered exactly.
- [X] T016 [P] [US1] Write `tests/web/specs/style-thematic.spec.ts` (categorized part):
  - open the 22,000-parcel file (reuse `writeParcels` from `helpers.ts`, adding the `owner` column if missing);
  - Layer style → Categorized → `zone`;
  - the legend region "Legend" lists 5 rows whose counts add up to 1,000;
  - run `SELECT * FROM layer` (Show all), categorize by `owner`: 12 rows plus `Other (985 values)`, with counts adding up to 22,000;
  - switch to Single: the legend shows one row, or is hidden for the default style.
  - *Done*: style-thematic.spec.ts (3): zone auto-picked, 5 classes summing to 1,000; owner on 22,000 rows gives 12 + Other (985 values); Single hides the legend; world-boundaries parity list; a legend swatch hides its class (rendered count drops).
- [X] T017 [P] [US1] Write `tests/vscode-ext/src/suite/style.test.ts` (categorized part):
  - open `world-boundaries.geojson`;
  - `_setStyle` with categorized on a text column;
  - `_getStyleState` reports the same classes and counts that the web spec computes for the same file and column (FR-020). Hard-code the expected list derived from the fixture.
  - *Done*: style.test.ts (2): the default reports one class of 180; categorized on name gives the same 12 + Other (168) and counts as the web build, with first color #a6cee3. VS Code 39/39.
- [X] T018 [US1] Implement categorization:
  - in `packages/core/src/style/classify.ts`: `toNumber` and `toCategory` (research §4 rules);
  - in `resolve.ts`, the categorized branch: count values, order them, apply the cap, the "Other" and "No value" classes, overrides by value (color, label, visible), default labels, and a caption like `zone · 5 categories`;
  - in `expressions.ts`: a `match` on `['to-string', ['get', col]]`, guarded by a null / `''` `case`, with the "Other" fallback, plus a `visibilityFilter` for hidden classes.

  Make T014 and T015 pass.
  - *Done*: classify.ts (toCategory, toNumber, compareCategories), the categorized branch of resolve.ts, and categorizedIndex in expressions.ts (a let/case/match mirroring toCategory). Core 157/157.
- [X] T019 [US1] Update `packages/ui/src/LayerStylePanel.svelte`:
  - a renderer radio group (Single / Categorized / Graduated; Graduated is disabled until US2, with the tooltip "Coming in this build" removed in US2);
  - a Column select with the eligible columns as `name · TYPE`;
  - the existing symbol controls move into a collapsible "Symbol" section;
  - a read-only class list (swatch, label, count) for now; editing comes in US3.

  Layout and keyboard follow `contracts/ui-style-panel.md`.
  - *Done*: LayerStylePanel: renderer radio group (arrow keys; Graduated disabled until US2), Column select (name · TYPE), read-only classes, notes, fallback line, collapsible Symbol. 320 px, height-capped and scrolling. Visual check: spec 001's blue outline washed out class colors, so startStyle() now switches untouched symbol defaults to a thin neutral outline with 75% fill, as QGIS does, and back again for Single (style-edit.test.ts).
- [X] T020 [US1] Create `packages/ui/src/MapLegend.svelte` per `contracts/ui-style-panel.md`:
  - a `region` named "Legend", top-left, with a collapsible header (`aria-expanded`);
  - swatches drawn per geometry (square, line or circle) with a 1 px contrast border;
  - tabular counts and the "Other (N values)" text;
  - the swatch is a toggle button for visibility (it calls `setStyle` through a new `setClassVisible` stub that edits overrides; the full edit logic comes in US3).

  Mount it in `packages/ui/src/ViewerLayout.svelte`. Persist the collapsed state via `hostAdapter.saveState('legend.collapsed')`. Add any new overlay tokens to both theme files.
  - *Done*: MapLegend.svelte: region 'Legend', collapsible (remembered as legend.collapsed), geometry-shaped swatch toggles (aria-pressed), and a hollow swatch when hidden. setClassVisible lives in core edit.ts. Placed bottom-left above the scale bar: bottom-right was covered by the style panel (found by T016), and top-left belongs to the inspector. research §8 and the contract are amended. --se-swatch-border is defined in both themes.
- [X] T021 [US1] Make T016 and T017 pass. Fix the selection halo if a categorized palette color hides the selection (FR-019). Run lint, the core, web and VS Code suites, then commit.
  - *Done*: Web style 3/3, VS Code 39/39, core 157/157, lint 0. Selection over class colors: amber fill plus black halo, confirmed in a screenshot.

**Checkpoint**: US1 works in both shells. This is the MVP: a thematic map by
category, with a legend.

---

## Phase 4: User Story 2 - Color features by a numeric range (Priority: P1)

**Goal**: Graduated with Equal interval, Quantile and Natural breaks, 2–10
classes, upper-inclusive classes, and "No value".

**Independent Test**: graduate `value` with 5 classes, switch methods and
counts, and see the map and legend change together (quickstart Scenario 2).

- [X] T022 [P] [US2] Extend `tests/core/style-classify.test.ts` (graduated):
  - on `fixtures/style/values.json`, `equalIntervalBreaks` and `quantileBreaks` equal `qgis-breaks.json` to 1e-6;
  - `jenksBreaks` equals QGIS on breaks 1, 3 and 4, and on break 2 has a **lower** within-class sum of squares than QGIS's (research §3);
  - brute force on random sets (n ≤ 12, k = 2..4) confirms Jenks is optimal;
  - duplicate breaks collapse, and fewer distinct values than k gives one class per value;
  - all-equal values give one class plus a note;
  - `classOf` is upper-inclusive, and the first class includes its lower bound;
  - `toNumber` gives "12.50" → 12.5 and "", null, "abc" and booleans → null;
  - Jenks above 200,000 values is estimated, with a note.
  - *Done*: style-classify.test.ts graduated part: equal and quantile equal QGIS 4.2.3 to 1e-6; Jenks matches QGIS on breaks 1, 3, 4 and has lower SSQ on break 2; 30 random brute-force trials prove optimality; boundaries, toNumber, ties and collapse, all-equal, per-value, labels, manual plus Other, non-numeric fallback, estimated above 200k.
- [X] T023 [P] [US2] Extend `tests/core/style-expressions.test.ts` (graduated):
  - a fixture with values exactly on breaks, nulls, `''`, numeric strings and `'abc'`;
  - per feature, the expression's color equals the resolved class color. This proves upper-inclusiveness and the null guard on the map.
  - *Done*: Expression parity for equal, quantile and jenks on values sitting on every break plus null, '', '12.50', 'abc', booleans and 'Infinity': per-feature colors equal the legend counts. Manual: outside values go to Other, hidden ranges are filtered.
- [X] T024 [P] [US2] Extend `tests/web/specs/style-thematic.spec.ts` (graduated):
  - Graduated on `value` with Quantile 5: the legend caption is `value · Quantile, 5 classes` and the counts are within ±1% of 200 each;
  - switch to Equal interval, Natural breaks, 3 and 10 classes: the legend updates each time;
  - on `world-boundaries`, which has only text columns, Graduated is disabled with its reason.
  - *Done*: style-thematic.spec graduated (3): Quantile 5 on 22k parcels gives ~200 each, then equal, jenks, 3 and 10 classes update the legend; squares parity labels; disabled with reason on text-only data (needs force-click: Playwright waits on aria-disabled). The class list was renamed 'Class list' because it collided with the 'Classes' select label (an a11y ambiguity).
- [X] T025 [P] [US2] Extend `tests/vscode-ext/src/suite/style.test.ts` (graduated): on `usa-utm12n.gpkg` or a generated numeric fixture, quantile classes and counts from `_getStyleState` equal the expected values (FR-020).
  - *Done*: style.test.ts US2: squares.geojson (i²) Quantile 5 gives the same labels and counts [20x5] as the web build, first color #440154. VS Code 40/40.
- [X] T026 [US2] Implement in `packages/core/src/style/classify.ts`:
  - `equalIntervalBreaks`;
  - `quantileBreaks` (QGIS interpolation);
  - `jenksBreaks`: an exact DP with divide-and-conquer, estimated above 200,000 values on evenly spaced order statistics;
  - `classOf`.

  Make T022 pass.
  - *Done*: classify.ts: equalIntervalBreaks, quantileBreaks (QGIS interpolation), jenksBreaks (exact DP plus divide and conquer; estimated above JENKS_EXACT_LIMIT=200,000), classOf (upper-inclusive).
- [X] T027 [US2] Implement the graduated branch:
  - in `resolve.ts`: collect values with `toNumber`, compute breaks, ranges, counts, default labels (formatted with `Intl.NumberFormat`, as the table does), overrides by index, "No value", and the caption `col · Method, k classes`, plus ` (estimated from 200,000 values)` when estimated;
  - in `expressions.ts`: a `case` chain with a null / `''` / non-number guard first, then `<=` tests per class (upper-inclusive), then the "Other" fallback for values outside manual ranges.

  Make T023 pass.
  - *Done*: Graduated branch of resolve.ts: ranges with collapse, per-value mode when distinct < k, labels sized to the class width, Other for manual outliers, captions with the method. graduatedIndex in expressions.ts: null, boolean and '' guard; a to-number sentinel plus abs >= MAX_VALUE guard; upper-inclusive case chain. Core 202/202.
- [X] T028 [US2] In `packages/ui/src/LayerStylePanel.svelte`:
  - enable Graduated: Method select (Equal interval, Quantile, Natural breaks (Jenks)) and a Classes select (2–10);
  - show the classes as ranges in the read-only list;
  - show a thin progress bar while a recompute takes longer than 150 ms, keeping the previous style on the map (FR-016).

  Make T024 and T025 pass. Commit.
  - *Done*: Graduated enabled; Method and Classes selects on separate rows ('Natural breaks' was truncated in one row, found in a screenshot). Deviation: no progress bar. Classification is synchronous (about 50 ms at 50k, about 230 ms at 200k), so a bar could never paint, and the previous style stays until the new one is ready by construction. SC-007's long-task test (T044) guards it. Web style 6/6.

**Checkpoint**: US1 and US2 together give both core thematic map types.

---

## Phase 5: User Story 3 - Ramp picker and per-class editing (Priority: P2)

**Goal**: ramps with previews and Reverse (FR-007). Per-class color, label,
value or break, add and delete, and visibility, with the switch to Manual
(FR-009).

**Independent Test**: quickstart Scenario 3.

- [X] T029 [P] [US3] Write `tests/core/style-edit.test.ts` for every transition in `data-model.md`:
  - color, label and visible edits keep the method and manual flag;
  - a bound or value edit, add, or delete sets Manual and stores the full class list;
  - a manual edit that breaks the order or contiguity is rejected;
  - choosing a method again keeps only the overrides that still match;
  - manual classes recount on new features (FR-009 last line).
  - *Done*: style-edit.test.ts, 12 tests covering every data-model transition: color and label overrides (empty label resets), method re-choice keeps index overrides and drops bounds, class count resets Manual, bound edit with contiguous neighbour, validation of crossing bounds, manual ranges recount on new data, add (split last) and delete (merge), categorized value/add/delete then Auto restoring frequency order with overrides.
- [X] T030 [P] [US3] Extend `tests/web/specs/style-thematic.spec.ts` (ramps and edits):
  - keyboard-open the ramp picker, use arrows and Enter to pick `RdBu`, then Reverse: the legend's first swatch color changes accordingly;
  - change one class's color via its swatch input;
  - rename a label with F2 / Enter;
  - hide a class with the legend swatch: the rendered feature count (`data-rendered-features`) drops by that class's count;
  - edit a break: the Method shows Manual;
  - run a filtering query: the breaks are unchanged and the counts update.
  - *Done*: style-thematic.spec US3: keyboard ramp picker (Enter, End, Up, Enter) to Red–blue then Reverse (legend swatch #ca0020 then #0571b0); class color via its input; legend hide drops rendered points 100 to 80; a bound edit gives Manual, '0 – 100' survives a filtering query with count 11; inline rename to 'Lowest'. Passes.
- [X] T031 [US3] Implement `packages/core/src/style/edit.ts` per `contracts/style-core.md`. Replace T020's `setClassVisible` stub. Make T029 pass.
  - *Done*: edit.ts: setClassColor, setClassLabel, setRamp, setMethod, setClassCount, setCategorizedAuto, setClassBound, setCategoryValue, addClass, deleteClass, plus the earlier setClassVisible and startStyle. Deviation from contracts/style-core.md: the Manual edits take the current ResolvedStyle, since fixing classes needs the classes as resolved. Core 210/210.
- [X] T032 [US3] Create `packages/ui/src/RampPicker.svelte`:
  - a button showing the current strip;
  - a listbox of strips grouped by kind, with arrows, Enter and Esc, and accessible names like "Viridis, sequential";
  - a Reverse toggle (`aria-pressed`).

  Use it in `LayerStylePanel.svelte`.
  - *Done*: RampPicker.svelte: strip button; listbox grouped by kind with aria-activedescendant, arrows, Home/End, Enter, Esc and Tab; options named 'Name, kind'; Reverse is an aria-pressed toggle. Strips use hard stops. The list widens to 280 px, right-aligned, because names were truncated (found in a screenshot).
- [X] T033 [US3] Create `packages/ui/src/ClassList.svelte`:
  - editable rows: visibility toggle, color input, label (F2 / ✎ to edit inline), value or bound number fields, count, delete;
  - an Add button;
  - arrow-key row navigation;
  - a one-time hint when Manual starts.

  It replaces the read-only list in `LayerStylePanel.svelte`. Repeated palette colors show the panel notice (research §6). Make T030 pass. Commit.
  - *Done*: ClassList.svelte: eye toggle, color input, label (Rename button / F2, Enter commits, Esc cancels), count, delete; 'Edit values/bounds' mode with value or bound inputs; Add class; arrow rows. Panel: apply() validates through validateStyle and shows the first error inline; Manual notes, with 'Back to automatic' for categorized. Repeat-colors note shown via resolved.notes. Screenshots reviewed light and dark.

**Checkpoint**: users can fully tune a thematic style.

---

## Phase 6: User Story 4 - Save, reopen and exchange thematic styles (Priority: P2)

**Goal**: the QML sidecar holds thematic styles exactly as QGIS writes them.
SLD and Mapbox GL carry them, with notices for anything lost.

**Independent Test**: quickstart Scenario 4.

- [X] T034 [P] [US4] Write `tests/core/style-interchange.test.ts` with one case per row of `contracts/interchange-mapping.md`:
  - importing `fixtures/style/categorized.qml` and `graduated.qml` (QGIS-written) yields the same classes, colors, labels, hidden flags and method;
  - export, then import, for each renderer × format gives equal classes, values or breaks, and colors (SC-004);
  - `previewExportNotice` lists the exact losses for SLD (method, hidden classes) and nothing for QML or Mapbox;
  - foreign files: a QGIS `ruleBased` QML, a size-graduated QML, a GeoLibre-shaped SLD with the guard rule, and a GeoLibre-shaped Mapbox file (`step`, no metadata) all import with the documented notice items;
  - spec 001 single-symbol cases in `style.test.ts` stay green.
  - *Done*: style-interchange.test.ts, 18 tests: both QGIS-written fixtures import exactly; round trips with no notes (categorized with hidden, quantile with hidden, jenks, manual) through QML and Mapbox; SLD categorized (hidden left out, announced), SLD graduated (bounds kept, Manual, announced), mixed-geometry SLD dedupe; previewExportNotice items; missing column exports single with a notice; foreign RuleRenderer, GraduatedSize, a GeoLibre SLD with guard rule, GeoLibre step Mapbox, Mapbox match. The spec 001 'first symbol only' test was updated to the new categorized import.
- [X] T035 [P] [US4] Extend `tests/vscode-ext/src/suite/style.test.ts`:
  - `_setStyle` categorized with one hidden class, then `_saveStyle`: `<file>.qml` exists next to a temp copy of the fixture;
  - close all editors and reopen: `_getStyleState` equals the saved style (classes, colors, labels, visible flags);
  - delete the temp sidecar afterwards.
  - *Done*: style.test.ts US4: a temp copy of world-boundaries, categorized with Albania hidden and a custom Algeria color and label, plus Other's label. _saveStyle writes world.qml (categorizedSymbol, render=false); after reopening, source=world.qml, not dirty, identical classes, labels, colors, visibility and counts. VS Code 41/41. The modal 'replace?' detail text no longer claims single-symbol only.
- [X] T036 [P] [US4] Create `tests/qgis/check_sidecar.py`: a PyQGIS script (run via `C:\OSGeo4W\bin\python-qgis.bat`) that loads a given QML onto a memory layer and prints its renderer type, classes, colors, labels and render flags as JSON. Also add `tests/qgis/README.md`, which says it is optional and how to run it.
  - *Done*: tests/qgis/check_sidecar.py + README (PyQGIS; prints renderer, classes, colors, labels, render flags as JSON).
- [X] T037 [US4] Extend `packages/core/src/style/qml.ts`:
  - write and read `categorizedSymbol` and `graduatedSymbol` per research §1;
  - one symbol per class, built like the existing single symbol with only the color changed;
  - NULL and empty-value categories;
  - `render` flags;
  - `<classificationMethod id>`;
  - the `spatialExplorer/method = manual` custom property;
  - foreign renderers import as single, with notices.

  Make the QML cases of T034 pass.
  - *Done*: qml.ts: categorizedSymbol/graduatedSymbol write (per-class symbols, QGIS category types long/double/bool/string/NULL, empty value as Other, render flags, classificationMethod or custom spatialExplorer/method=manual, ramp, cap, categories auto/manual, graduated No value as custom properties) and read (categorizedFrom/graduatedFrom in the new interchange.ts keep only non-default overrides). Foreign renderers import as single with a notice; GraduatedSize keeps colors. CDATA is escaped before parsing (happy-dom rejects it; QGIS writes it).
- [X] T038 [US4] Extend `packages/core/src/style/sld.ts` (a rule per class, `PropertyIsEqualTo` / `PropertyIsNull` / `ElseFilter`, `And(>, <=)` ranges, GeoLibre's guard rule skipped on import) and `packages/core/src/style/mapbox.ts` (the same expressions as `expressions.ts`, plus `metadata["spatial-explorer:renderer"]`, with `match` / `step` / `case` / `interpolate` import). Add `previewExportNotice` in `index.ts`. Make T034 pass.
  - *Done*: sld.ts: a rule per visible class (Title = label; PropertyIsEqualTo / PropertyIsNull / ElseFilter / And(>, <=) with the first >=; times geometry family for Mixed). Import recognises these plus GeoLibre's guard and open top class. mapbox.ts: the class-index expression and visibility filter in paint and filter, with the whole style in the existing spatial-explorer:layer-style metadata; foreign match/step/interpolate import. previewExportNotice and thematicForExport are exported.
- [X] T039 [US4] In `packages/ui/src/LayerStylePanel.svelte` and the store's `exportStyleAs`, show `previewExportNotice` in the Export menu next to each format before writing, and the import notice after Import (FR-015). Make T035 pass. Run `tests/qgis/check_sidecar.py` on the QML written by T035 and record the output in `research.md` (SC-003). Commit.
  - *Done*: Store Save/Export pass resolvedStyle and the columns; the Export menu shows each format's loss notice under its item (aria-describedby). SC-003 verified in real QGIS 4.2.3: categorized, Jenks and manual QML from the app load with identical classes, colors, labels and render flags (research.md). Core 230/230, web style 7/7, lint 0.

**Checkpoint**: thematic styles persist and interoperate.

---

## Phase 7: User Story 5 - Styles follow query results (Priority: P3)

**Goal**: reclassify on new data, fall back with a notice when the column is
missing, recover automatically, and Reset restores the sidecar style.

**Independent Test**: quickstart Scenario 5.

- [X] T040 [P] [US5] Extend `tests/core/style-resolve.test.ts`:
  - a missing column gives `status 'fallback'` and the reason `Column "value" is not in this result.`;
  - a graduated column that is now VARCHAR gives `fallback` with a "not numeric" reason;
  - the same style on new features gives new counts and breaks (non-manual) or the same breaks (manual);
  - the style object itself is never changed by a fallback.
  - *Done*: style-resolve.test.ts US5 (4): missing column gives single with reason; VARCHAR gives 'not numeric'; new results reclassify, index overrides survive, the style object is never mutated; the column coming back restores ok.
- [X] T041 [P] [US5] Extend `tests/web/specs/style-thematic.spec.ts` (queries), following quickstart Scenario 5 steps 1–4:
  - reclassify on a filter;
  - `SELECT parcel_id, geom` gives the single symbol and the notice in the panel and legend header;
  - `SELECT *` restores the thematic style;
  - Reset restores the saved sidecar style (save one first in the web shell by importing a QML).
  - *Done*: style-thematic.spec US5: graduated, Download the QML (web Save), reopen data plus sidecar, and the style applies automatically (1,000 counted). A zone filter reclassifies over 400 rows; SELECT parcel_id, geom gives 'value · not available' with the reason; SELECT * returns it; an unsaved Categorized change, then Reset, restores the saved Quantile. This also covers FR-013 in the web shell.
- [X] T042 [US5] Handle the fallback state in `packages/ui/src/viewerStore.svelte.ts` and `LayerStylePanel.svelte` / `MapLegend.svelte`:
  - `resolveStyle` already returns it; show the reason in the panel notice and the legend header;
  - check that Reset (`resetQuery`) re-applies the sidecar style, including thematic, through `applySidecar`.

  Make T040 and T041 pass. Commit.
  - *Done*: No new code needed: fallback status and reason were already rendered by the panel (US1) and the legend header (T020), and resetQuery → applySidecar already re-imports the thematic sidecar (QML import from T037). Verified by T041.

**Checkpoint**: styling and querying work together safely.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T043 [P] Extend `tests/web/specs/accessibility.spec.ts`:
  - axe in light and dark with the style panel on Categorized, with the ramp listbox open, with the class list in edit mode, and with the legend expanded and collapsed;
  - a keyboard test where Tab reaches the renderer radios, Column, Method, Classes, Ramp, Reverse, every class-row control and the legend toggles, and Esc returns focus to "Layer style".

  Fix any violations.
  - *Done*: accessibility.spec: axe in light and dark on the categorized panel with legend, the ramp listbox open, the class list editing, and the legend collapsed (0 violations). Keyboard: radio arrows apply; Tab reaches Column, Method, Classes, Colors, Reverse, each row's Hide/Color/Rename/Delete and the legend toggles. It found a real bug: Esc or Close on a map popover (style or basemap) dropped focus. closePanel() in ViewerLayout now returns focus to the opening control. a11y + basemap specs 13/13.
- [X] T044 [P] Extend `tests/web/specs/performance.spec.ts`:
  - **SC-001**: categorize, then graduate (Jenks, 10 classes), on the 22,000-feature file, timed from change to legend update plus `data-rendered-features` settled, < 1 s each;
  - **SC-007**: Show all on a 50,000-polygon file, then graduated Jenks: no long task over 1 s (`PerformanceObserver` `longtask`), and the previous style stays until the new legend appears.

  Record the numbers.
  - *Done*: performance.spec: SC-001 (003) on the 10.41 MB file with all 22,000 features: categorize 123 ms, Jenks with 10 classes 102 ms (target < 1 s). SC-007: graduated Jenks on 50,000 polygons took 191 ms end to end, and the longtask observer recorded no task of 50 ms or more (target: none >= 1 s). The new heavy specs made the parallel suite flaky (a different heavy test timed out each run while ~10 software-WebGL workers competed), so playwright.config sets workers: 6 and expect.timeout 10 s. The full suite plus performance is 45/45 in 2.3 min (previously 2.9 min with failures).
- [X] T045 [P] Extend `scripts/screenshots.mjs` with style scenes in both shells:
  - categorized with the legend;
  - graduated with the panel open;
  - the ramp picker open;
  - a hidden class;
  - the fallback notice.

  Review every default ramp on the Positron and Dark basemaps in all three VS Code themes and web light and dark, including selection visibility on Blues (FR-019).
  - *Done*: styleScenes() in scripts/screenshots.mjs: categorized with legend, graduated natural breaks on an area column computed in SQL, ramp picker, hidden class, fallback. Captured for the three VS Code themes plus web light and dark, and reviewed. Found and fixed a bug: T043's focus-return also fired when Esc was pressed in the SQL editor (it closed the popover and stole the caret). closePanel() now refocuses only if focus was in the popover, with a regression test in accessibility.spec. The script now waits for its own query's status, not the previous run's ✓.
- [ ] T046 Record the results in `specs/003-thematic-styling/quickstart.md`, in a new "Results" section:
  - SC-001 and SC-007 timings;
  - SC-002 (classification tests);
  - SC-003 (the PyQGIS output);
  - SC-004 (the interchange test count).

  Then tick the Definition-of-done boxes.
- [ ] T047 [P] Update the docs:
  - `CHANGELOG.md` ([Unreleased] → Added: thematic styling, with every capability);
  - `apps/vscode-ext/README.md` (the style feature bullet: categorized, graduated, legend, QGIS-compatible);
  - `specs/003-thematic-styling/research.md` (outcomes and deviations).
- [ ] T048 Run the final full verification:
  - `npm run lint` and all typechecks;
  - `npm run test:core`, `npm run test:web` and `npm run test:vscode-ext`;
  - `npm run package --workspace=apps/vscode-ext`, then install the VSIX into a clean profile.

  Record the results in `tasks.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T001, T002 and T003 can run in parallel.
- **Foundational (Phase 2)**:
  - T004 → T005;
  - T006, T007 → T008, and T009 → T010 can run in parallel;
  - T011 needs T005;
  - T012 needs T010 and T011;
  - T013 needs T012.

  **This phase blocks every story.**
- **US1 (Phase 3)**: depends on Phase 2. It is the MVP.
- **US2 (Phase 4)**: depends on Phase 2, and on US1's panel (T019) and legend (T020). Its classification work (T022, T026) can start right after Phase 2.
- **US3 (Phase 5)**: depends on US1 (panel, legend). Its graduated edits need US2.
- **US4 (Phase 6)**: depends on US1 and US2 (the renderers to serialize). T036 (the PyQGIS script) can start any time.
- **US5 (Phase 7)**: depends on US1 or US2 (a thematic renderer to fall back from). It is independent of US3 and US4, except that Reset's sidecar case needs US4.
- **Polish (Phase 8)**: after the desired stories.

### Within each story

- Tests are written first and fail.
- Then core (`packages/core/src/style`), then UI (`packages/ui`), then shell wiring.
- Commit after each task, running the suites the task touches.

### Parallel Opportunities

- **Phase 1**: everything.
- **Phase 2**: T004, T006, T007 and T009 (separate files), then T008 and T010.
- **US1**: T014–T017 (four test files) in parallel.
- **US2**: T022–T025 in parallel, and T026 in parallel with US1's UI tasks.
- **US4**: T034–T036 in parallel.
- **US5**: can proceed alongside US3 and US4 once US1 and US2 are done.

---

## Parallel Example: User Story 1

```text
# Tests first, in parallel:
T014 tests/core/style-classify.test.ts (categorized)
T015 tests/core/style-expressions.test.ts (categorized)
T016 tests/web/specs/style-thematic.spec.ts (categorized)
T017 tests/vscode-ext/src/suite/style.test.ts (categorized)

# Then core:
T018 classify.ts + resolve.ts + expressions.ts (categorized branches)

# Then UI, sequentially (shared store and layout):
T019 LayerStylePanel.svelte → T020 MapLegend.svelte + ViewerLayout.svelte → T021 suites green, commit
```

---

## Implementation Strategy

### MVP first (User Story 1)

1. Phase 1, then Phase 2. **Checkpoint**: specs 001 and 002 fully green, with
   paint now produced by core.
2. Phase 3 (US1). **Stop and validate**: categorize a layer and read the
   legend in both shells.
3. Demo-able: the STYLE pillar exists.

### Incremental Delivery

US1 → US2 (P1: both core map types) → US3 → US4 → US5 → Polish. Each story
ends at a checkpoint with its tests green, and is committed.

---

## Notes

- `[P]` means different files and no dependency on incomplete tasks.
- Every task names exact files. Where a task changes spec 001 or 002
  behavior (T006, T012), update those specs' tests in the same task, never
  later.
- If a spike result proves wrong during implementation (for example
  MapLibre evaluates an expression differently in the browser than the
  style-spec does in Node), record it in `research.md` and adjust `plan.md`
  before continuing (Constitution VI).
