# Implementation Plan: Thematic Styling

**Branch**: `003-thematic-styling` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-thematic-styling/spec.md`

## Summary

Add the STYLE pillar: Categorized and Graduated renderers next to spec 001's
single symbol, with a ramp picker, per-class editing (color, label, value or
break, add and delete, visibility), and an on-map legend. Classes are
computed in `packages/core` from the displayed result's rows, which are
already in memory. The map gets data-driven paint expressions built in core,
so ramp and color edits never re-upload data.

The sidecar stays QGIS QML, now with QGIS's own `categorizedSymbol` and
`graduatedSymbol` structures. SLD and Mapbox GL carry thematic styles too,
with a notice listing anything a format can't hold.

All risky assumptions were spiked against the real tools: QGIS 4.2.3
reading and writing the QML, our breaks against QGIS's, Jenks speed, and
MapLibre expression coercions. The result changed two spec details; see
"Spec amendments".

## Technical Context

**Language/Version**: TypeScript (strict), Svelte 5, as specs 001 and 002.

**Primary Dependencies**:
- Existing: MapLibre GL JS 6, DuckDB-WASM 1.32.0 (not used by
  classification), Svelte 5, Vite, esbuild.
- **New runtime dependencies: none.** Classification, Jenks and ramp
  interpolation are our own code (research §3, §6).
- **New dev dependency**: `@maplibre/maplibre-gl-style-spec`, already
  installed with MapLibre and added explicitly to `tests/core`, to evaluate
  the generated expressions in unit tests.
- **Data**: ColorBrewer color specs (Apache-2.0, notice) and the Viridis,
  Cividis and Magma anchors (CC0).

**Storage**:
- The style: the QML sidecar, by explicit Save, as in spec 001.
- `legend.collapsed`, through `HostAdapter.saveState`.

**Testing**:
- **Vitest**: classification against the QGIS fixtures, plus brute-force
  Jenks; per-feature map = legend through MapLibre's evaluator; edit
  transitions; interchange round trips; ramps.
- **Playwright**: scenarios, axe, and the SC-001 / SC-007 timings.
- **`@vscode/test-electron`**: sidecar save, reopen and parity.
- **Optional local PyQGIS**: a check of the QML the app writes.

**Target Platform**: VS Code webview and evergreen browsers, as before.

**Project Type**: the existing monorepo (`apps/web`, `apps/vscode-ext`,
`packages/core`, `packages/ui`).

**Performance Goals**:
- **SC-001**: a style change on ~22,000 features reaches the map and the
  legend in < 1 s. Budget: resolve < 50 ms, plus `setPaintProperty` and
  `setFilter`.
- **SC-007**: 50,000 rows, with no freeze. Jenks measured 49 ms at 50,000
  values and 231 ms at 200,000.

**Constraints**:
- Single-threaded WASM and the ~512 MB ceiling: classification only reads
  rows already loaded, with no copies beyond one numeric array.
- No new CSP needs.
- Data colors fixed (Constitution III).

**Scale/Scope**:
- One displayed layer.
- Up to 12 categories plus "Other" and "No value".
- 2–10 graduated classes.
- Results up to the spec 002 limits; Jenks is estimated above 200,000
  values.

## Constitution Check

*GATE: passed before Phase 0, and re-checked after Phase 1 design (below).*

| Principle | Status | How this plan complies |
|---|---|---|
| I. Scope Discipline | ✅ | STYLE pillar only. Labels, rule-based styling, heatmaps, size by value, multiple layers and data export stay out (spec). Size-by-value and rule-based QGIS files import with a notice instead of being supported. |
| II. Host-Agnostic Core | ✅ | Classification, resolution, edits, ramps, expressions and interchange are in `packages/core/src/style`. The panel and legend are in `packages/ui`. Only `legend.collapsed` persists, via `HostAdapter`. |
| III. Native VS Code Feel | ✅ | Panel and legend chrome use `--se-*` tokens (VS Code `editorWidget`, high-contrast borders). Data colors are fixed. The selection halo is read from theme tokens and re-applied on theme change, as today. |
| IV. Local-First | ✅ | No network. Ramps are bundled data. |
| V. Bounded Resources | ✅ | Classification is in memory over already-loaded rows, under 50 ms at 50,000. Jenks is exact up to 200,000 values, then estimated with a caption. The previous style is kept until the new one is ready. |
| VI. Verified Claims | ✅ | QML read and write verified in QGIS 4.2.3; breaks verified against QGIS (equal and quantile identical; Jenks optimal, see research §3); MapLibre coercions verified (§4). |
| VII. Accessibility | ✅ | Radio group, listbox ramp picker, `aria-pressed` toggles, inline label editing (F2), a legend `region`, and axe in light and dark (quickstart). |
| VIII. Clean-Room | ✅ | GeoLibre informs decisions only (spec Assumptions). Jenks is written from the published algorithm, not from QGIS (GPL) or GeoLibre code. ColorBrewer and Viridis colors are data under Apache-2.0 / CC0, with a notice. |
| IX. Testing | ✅ | Unit, browser and extension suites per quickstart, plus the optional PyQGIS check. |
| X. Simplicity | ✅ | No new runtime dependency. Reuses the spec 001 panel, serializers and sidecar flow, and the spec 002 in-memory result. Expression building replaces data re-uploads. |

**Post-design re-check**: no violations. Complexity Tracking is empty.

## Spec amendments made during planning

1. **Class boundaries are upper-inclusive (FR-004).** A class covers
   `lower < value ≤ upper`, and the first class includes its lower bound,
   as in QGIS.
   - The draft said "each class is defined by its lower bound". That came
     from GeoLibre, and it would disagree with QGIS on every value that
     equals a break. Jenks breaks always do: they are data values
     (research §2).
   - GeoLibre's real lesson, flat-color classes with no blending, is kept.
2. **The reference for natural breaks (SC-002)** is the provable optimum,
   not QGIS.
   - QGIS 4.2.3's Jenks matched ours on 3 of 4 breaks. On the fourth, our
     breaks have the lower within-class sum of squares (research §3).
   - Equal interval and quantile match QGIS exactly.

## Project Structure

### Documentation (this feature)

```text
specs/003-thematic-styling/
├── spec.md
├── plan.md                 # this file
├── research.md             # Phase 0: spikes + decisions
├── data-model.md           # Phase 1
├── quickstart.md           # Phase 1: validation scenarios
├── contracts/
│   ├── style-core.md           # packages/core/src/style API + guarantees
│   ├── interchange-mapping.md  # QML / SLD / Mapbox element table (FR-013..015)
│   └── ui-style-panel.md       # panel, ramp picker, class list, legend, map
├── spikes/                 # QGIS 4.2.3 outputs: categorized.qml, graduated.qml, qgis-breaks.json, values.json
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks (not created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── style/
│   ├── model.ts            # CHANGED: Renderer types, ResolvedStyle, defaults
│   ├── classify.ts         # NEW: toNumber/toCategory, equal/quantile/jenks, classOf
│   ├── resolve.ts          # NEW: resolveStyle (classes, counts, fallback, caption)
│   ├── edit.ts             # NEW: FR-009 transitions
│   ├── ramps.ts            # NEW: catalog data + rampColors (Lab interpolation)
│   ├── expressions.ts      # NEW: paintFor / visibilityFilter (MapLibre JSON)
│   ├── qml.ts              # CHANGED: categorizedSymbol / graduatedSymbol read+write
│   ├── sld.ts              # CHANGED: rule-per-class read+write
│   ├── mapbox.ts           # CHANGED: expressions + spatial-explorer metadata
│   └── index.ts            # CHANGED: notices, previewExportNotice
├── query/run.ts            # CHANGED: attribute columns + types onto the result
├── openFile.ts             # CHANGED: same for the initial view
└── models.ts               # CHANGED: Layer.columns

packages/ui/src/
├── LayerStylePanel.svelte  # CHANGED: renderer, column, method, ramp, class list
├── RampPicker.svelte       # NEW: listbox of ramp strips + Reverse
├── ClassList.svelte        # NEW: editable class rows (FR-009)
├── MapLegend.svelte        # NEW: on-map legend (FR-010)
├── MapView.svelte          # CHANGED: paint/filter from core, selection halo
├── ViewerLayout.svelte     # CHANGED: mounts the legend
└── viewerStore.svelte.ts   # CHANGED: resolved style ($derived), fallback, legend prefs

tests/core/        style-classify, style-resolve, style-expressions, style-edit, style-ramps, style-interchange (+ fixtures/style/)
tests/web/specs/   style-thematic.spec.ts (+ accessibility, performance additions)
tests/vscode-ext/  src/suite/style.test.ts
tests/qgis/        check_sidecar.py (optional, local PyQGIS)
```

**Structure Decision**: the spec 001/002 monorepo layout, unchanged.
Everything new sits under `packages/core/src/style` (logic, pure) and
`packages/ui` (components). The shells get no new code beyond the existing
`HostAdapter` state calls, and the VS Code test hook gains a
`_getStyleState` report for parity tests.

## Complexity Tracking

No constitution violations to justify.
