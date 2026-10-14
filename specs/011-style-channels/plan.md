# Implementation Plan: Style by Channels, and Labels

**Branch**: `011-style-channels` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/011-style-channels/spec.md`
(research and options in [proposal.md](./proposal.md)).

## Summary

> **Revised 2026-10-13 (user decision, spec Clarifications):** the panel keeps
> the style type, Appearance and 3D sections, and adds **Vary by attribute**
> (`VaryRow`, `AddVaryMenu`, `ScaleEditor`) instead of property rows, Draw as
> and recipes. The model, migration, resolution, paint, legend and files below
> are unchanged by that decision.

A layer style becomes:
- **fixed values**: today's flat symbol fields, kept as they are;
- an optional **Draw as**: markers or heatmap, fills or 3D;
- a map of **channels**: color, outline color, size, width, outline width,
  shape, pattern, opacity, rotation and height;
- **labels**.

Each channel is a source (a column, a SQL expression, or a pair for bivariate)
plus one of six scales. The existing classify, categories, rules and bivariate
code is reused, parameterized by channel and output type. Old styles (the
`renderer`, `size` and `extrusion` fields, and QML sidecars) migrate in
`sanitizeStyle` and the QML reader. A recorded baseline of today's paint proves
the map draws the same (SC-002).

How each part is drawn:
- **Map.** Each channel becomes one MapLibre expression. Markers keep the
  per-look raster icons, with `icon-image` built per feature (research §2),
  because SDF icons failed on fidelity.
- **Labels.** Drawn with the system's sans-serif font, so they need no
  download and work offline on every basemap (research §3).
- **QGIS.** The primary channel becomes QGIS's renderer, and every other
  channel a data-defined property. Every form was spiked in QGIS 4.2.3
  (research §4).
- **SLD** writes up to 100 cross-product rules. **Mapbox GL** reuses the map's
  expressions.

**Delivery in five slices**, each releasable with its tests green:
1. **Model and migration.** No visible change. SC-002 is proven here.
2. **Panel.** Draw as, recipes and property rows, covering today's
   capabilities (US1 for color and size or width, US3).
3. **New scales and channels, and the legend** (US1 complete, US4, US5).
4. **Files and QGIS parity** (US7, SC-003).
5. **Labels** (US6, US8). Independent of slices 2–4 once slice 1 is in.

## Technical Context

**Language/Version**: TypeScript (strict), Svelte 5, as in specs 001–010.

**Primary Dependencies**:
- Existing: MapLibre GL JS 6.13, DuckDB-WASM (pinned and downloaded), Svelte 5,
  Vite, esbuild.
- **New runtime dependencies: none.**
- **No bundled font**: labels use system fonts (research §3).

**Storage**:
- The QML sidecar, with the full model in a new `spatialExplorer/style`
  custom property.
- In-session `LayerStyle` objects, migrated by `sanitizeStyle`.

**Testing**:
- **Vitest (core):**
  - migration identity against a recorded paint baseline;
  - every channel × scale evaluated by MapLibre's expression evaluator;
  - the legend merge rule;
  - recipes;
  - label expressions;
  - QML, SLD and Mapbox round trips;
  - SQL builders for per-channel computed columns.
- **Playwright (web):**
  - new channel and label specs, including axe checks on the new panel and
    legend;
  - the 15 existing style specs migrated to the new panel.
- **`@vscode/test-electron`:** sidecar round trip with channels and labels.
- **PyQGIS:** `tests/qgis/check_011.py`, per-feature parity for every channel
  and scale (SC-003), plus label settings read back.

**Target Platform**: VS Code webview and evergreen browsers, as before.

**Project Type**: the existing monorepo (`apps/web`, `apps/vscode-ext`,
`packages/core`, `packages/ui`).

**Performance Goals**:
- SC-004: a channel change reaches the map within 1 s on 100,000 features; a
  fixed value within 200 ms. The panel stays responsive at a 6× CPU throttle.
- SC-005: labels never reload the layer, and panning with labels on a tiles
  layer stays within the spec 010 frame-time budget.

**Constraints**:
- Single-threaded WASM and the 3.1 GiB ceiling: no new full loads. Statistics
  stay one query per distinct column.
- Marker icons are bounded (research §2): 32 color steps, and 256 As-is colors
  on non-circle markers.
- No new CSP needs.

**Scale/Scope**:
- 10 channels, 6 scales and 7 recipes.
- Up to 10 classes, or 12 categories plus Other and No value, per channel.
- SLD at most 100 rules.

## Constitution Check

*GATE: passed before Phase 0, and re-checked after Phase 1 design (below).*

| Principle | Check | Status |
|---|---|---|
| I. Scope Discipline | Channels and labels are STYLE. Labels were not listed out of scope by the constitution; spec 009 deferred them, and the user brought them in (2026-10-13). No new 3D beyond spec 008's extrusion. Clustering, dot density, charts and label rules are excluded. | Pass |
| II. Host-Agnostic Core | Model, resolve, expressions, legend, recipes and interchange are in `packages/core/src/style`; panels in `packages/ui`. No platform access. | Pass |
| III. Native VS Code Feel | The new rows and the Labels panel use `--se-*` tokens. Data colors and label colors are style data (fixed). The label halo default is white, like a print map, not a theme color. | Pass |
| IV. Local-First and Private | No network use added. Labels draw from local fonts. A basemap's own glyph server may get one 404 per range for our stack, a request to a host already in use and allowed (research §3). | Pass |
| V. Bounded Resources | One statistics query per distinct column; computed columns are added to the existing view and tile SELECT; icon count bounded. | Pass |
| VI. Verified Claims | Spiked: data-driven dashes (GeoJSON), marker icons vs SDF, local label glyphs, generic font families, QGIS data-defined keys for every channel, QGIS labeling reload, color interpolation parity. Tracked checks during implementation: dashes on engine tiles, label word-gap artifact on a real GPU, QGIS per-feature parity at scale (check_011). | Pass, with tracked checks |
| VII. Accessibility and Keyboard | Rows use radiogroups and disclosure buttons; the Labels panel and legend groups are fully labeled (contracts/ui.md); axe checks in the new specs. | Pass |
| VIII. Clean-Room References | Design ideas from ggplot2, Tableau, Kepler.gl and ArcGIS only; no code or assets. | Pass |
| IX. Testing | Unit, browser, extension and QGIS checks as listed. | Pass |
| X. Simplicity | No dependencies. Fixed values keep the existing fields; channels are shared across geometry parts rather than one set per part (research §8); recipes aren't stored; one encoding type for every channel replaces three separate mechanisms (renderer, size, extrusion). | Pass |

**Post-design re-check**:
- The data model and contracts add one map layer (`label`), no dependencies and
  no platform access.
- The spec's Mixed-geometry edge case and font assumption were revised to match
  research §3 and §8.
- Still Pass.

## Project Structure

### Documentation (this feature)

```text
specs/011-style-channels/
├── proposal.md          # options and background research (pre-spec)
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: spikes and decisions
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── style-core.md
│   ├── interchange-mapping.md
│   └── ui.md
├── spikes/              # browser and PyQGIS spike sources, QGIS outputs
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/style/
├── model.ts             # LayerStyle (draw, channels, labels, heatmap, height), migration in sanitizeStyle
├── channels.ts          # NEW: ChannelId, Encoding, Scale types, CHANNEL_ORDER, channelsFor, scalesFor, fixedValue
├── resolve.ts           # per-channel resolution (classify/categories/rules/bivariate reused), continuous, identity
├── legend.ts            # NEW: legendGroups (merge rule)
├── recipes.ts           # NEW: RECIPES, recipeUnavailable, applyRecipe
├── labels.ts            # NEW: LabelSettings sanitize, label layer layout/paint, defaults per geometry
├── symbol.ts            # SymbolSpec + rotation/opacity; icon ids unchanged
├── expressions.ts       # channelExpression, markerIconExpression, layerFilters, label layer
├── edit.ts              # channel-scoped edits (contracts/style-core.md)
├── interchange.ts       # export classes per channel, notes
├── qml.ts               # data-defined properties per channel, labeling, spatialExplorer/style
├── sld.ts               # cross product ≤ 100, TextSymbolizer
└── mapbox.ts            # channel expressions, label layer, import
packages/core/src/query/session.ts     # per-channel computed columns, stats per column, label column
packages/core/src/view/*.ts            # computed columns in view and tile SELECTs
packages/ui/src/
├── LayerStylePanel.svelte             # rows; old sections removed
├── style/StyleTypePicker.svelte       # groups: Draw as, Recipes
├── style/ChannelRow.svelte            # NEW
├── style/ScaleEditor.svelte           # NEW
├── ClassList.svelte                   # output column per channel type
├── LabelsPanel.svelte                 # NEW
├── ActivityRail.svelte, SidePanel.svelte, viewerStore.svelte.ts   # 'labels' side tab; set-aside encodings
├── MapView.svelte                     # label layer; circle/marker filters by shape
├── MapLegend.svelte, mapImage.ts      # legend groups (merged, gradient, samples)
└── Icon.svelte                        # 'tag'
scripts/fixtures-011.mjs, scripts/paint-baseline-011.mjs   # NEW
tests/core/style-migration-011.test.ts, style-channels-011.test.ts, style-legend-011.test.ts,
  style-labels.test.ts, style-interchange-011.test.ts, qgis-011-cases.test.ts   # NEW
tests/web/specs/style-channels-011.spec.ts, labels.spec.ts   # NEW (+ existing specs migrated)
tests/vscode-ext/src/suite/…           # sidecar round trip
tests/qgis/check_011.py                # NEW
```

**Structure Decision**: the existing monorepo layout. Everything that
classifies, draws or serializes stays in `packages/core/src/style`, as in specs
003, 009 and 010. New focused files (`channels`, `legend`, `recipes`,
`labels`) keep `model.ts` and `resolve.ts` from growing further. The panel is
split into rows and a scale editor, so `LayerStylePanel.svelte` (1,483 lines
today) shrinks.

## Slice notes (for /speckit-tasks)

1. **Model and migration.**
   - First, record the paint baseline from today's code.
   - Then add `channels.ts` and migration, and have resolve and expressions read
     channels.
   - Keep `ResolvedStyle` aliases (`classes`, `caption`, `size`) so the UI is
     untouched.
   - Gate: SC-002 baseline identity, and every existing test green.
2. **Panel.**
   - Rows for color, size and width (from the old size channel), height and
     heatmap.
   - Draw as and recipes; old sections removed.
   - Migrate the 15 web specs' helpers (`chooseStyleType` becomes
     `chooseDrawAs` / `applyRecipe` / `setChannel`).
   - Drop the aliases.
3. **New scales and channels.**
   - Continuous color, identity, categories for numeric channels.
   - Strokecolor, strokeWidth, shape, dash, opacity and rotation as channels.
   - The marker icon expression, and circle and marker filters.
   - Conditions on any channel (per-channel `__se_cls_*`).
   - The legend module with merging; map image groups.
4. **Files.**
   - QML data-defined properties and `spatialExplorer/style`.
   - Import of simple QGIS data-defined forms.
   - SLD cross product; Mapbox.
   - `check_011.py` parity.
5. **Labels.**
   - Model, label layer, `__se_lbl`, Labels panel and rail button.
   - QML, SLD and Mapbox labels; map image test.
   - The word-gap artifact check.

## Complexity Tracking

No constitution violations to justify.
