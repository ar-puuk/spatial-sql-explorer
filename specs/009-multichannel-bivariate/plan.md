# Implementation Plan: Multi-Channel Styling and Bivariate Maps

**Branch**: `009-multichannel-bivariate` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-multichannel-bivariate/spec.md`

## Summary

A style becomes a **color channel** (the existing renderer, plus a new
**bivariate** kind) and an optional **size channel**. The size channel
sets line width or marker size from its own numeric column, classed by
default or proportional. Both resolve with the graduated classifier that
exists today. The map draws them as independent MapLibre expressions built
in core, so "map = legend" stays a per-channel unit test. Large results
gather statistics per channel column in the engine, with one joint
`GROUP BY` for bivariate cell counts.

For QGIS:
- Color + size uses QGIS's own data-defined size on the class symbols: an
  expression for classed sizes, the size assistant's transformer for
  proportional sizes.
- Bivariate uses QGIS's rule-based renderer, with a custom property so it
  reloads here as bivariate.
- Both forms were spiked in QGIS 4.2.3.

Bivariate palettes are generated (bilinear CIELAB from ColorBrewer anchors)
rather than copied, and are checked for color-blind distinctness. The
Graduated "Vary: Size" switch from 2026-10-12 is migrated into a size
channel and removed.

Delivery is two slices, as decided:
1. Channels: US1–US3, plus the parts of US5 and US6 they touch.
2. Bivariate: US4, plus the rest of US5 and US6.

## Technical Context

**Language/Version**: TypeScript (strict), Svelte 5, as specs 001–008.

**Primary Dependencies**:
- Existing: MapLibre GL JS 6, DuckDB-WASM (pinned, downloaded), Svelte 5,
  Vite, esbuild.
- **New runtime dependencies: none.**
- **New generated data**: `bivariateData.ts`, produced by
  `scripts/bivariate-palettes.mjs` from the ColorBrewer anchors already
  vendored (Apache-2.0); no third-party palette data is copied (research
  §8).

**Storage**: the QML sidecar, as today. The new fields go in renderer
structure plus `spatialExplorer/*` custom properties.

**Testing**:
- **Vitest** (core):
  - resolve per channel;
  - map = legend through MapLibre's evaluator (both channels, every cell);
  - migration against a 2026-10-12 fixture;
  - interchange round trips;
  - palette thresholds;
  - engine SQL builders.
- **Playwright** (web): new specs for channels and bivariate, axe on the
  new legend; existing style specs must stay green.
- **`@vscode/test-electron`**: sidecar save and reopen for both styles.
- **PyQGIS** `tests/qgis/check_009.py`: a QGIS render comparison
  (SC-005).

**Target Platform**: VS Code webview and evergreen browsers, as before.

**Project Type**: the existing monorepo (`apps/web`, `apps/vscode-ext`,
`packages/core`, `packages/ui`).

**Performance Goals**:
- A style edit reaches the map and legend in < 1 s on ~22,000 features
  (spec 003 SC-001 budget, now for two channels).
- SC-007: two-column classification ≤ 2× one graduated column on 1M rows
  (4 passes vs 3; research §4).

**Constraints**:
- Single-threaded WASM and the 3.1 GiB ceiling: no new in-memory copies;
  small results stream all channel columns in one `SELECT`.
- No new CSP needs.
- Data colors fixed (Constitution III).

**Scale/Scope**:
- One displayed layer, with up to 12 + 2 color classes × 10 + 1 size
  classes, or a 3 × 3 bivariate grid plus No value.
- SLD at most ~154 rules.

## Constitution Check

*GATE: passed before Phase 0, and re-checked after Phase 1 design (below).*

| Principle | Check | Status |
|---|---|---|
| I. Scope Discipline | Bivariate and multi-channel styling are both STYLE (thematic). No heatmap, clustering or rule editing. | Pass |
| II. Host-Agnostic Core | Resolve, expressions, interchange and palettes are in `packages/core`; UI only in `packages/ui`. No platform access; the lint rule is unchanged. | Pass |
| III. Native VS Code Feel | Panel and legend chrome use existing tokens; palettes are fixed data colors; the legend grid uses theme focus and border tokens. | Pass |
| IV. Local-First and Private | No network use is added. | Pass |
| V. Bounded Resources | Engine statistics per column, one joint count pass, no full loads; large results stay views. | Pass |
| VI. Verified Claims | QGIS data-defined size (both forms), rule-based renderer reload, the custom property, and the "Area" formula were spiked (research §3, §5, §6). The marker `size` key and render parity are checked during implementation before claiming SC-005. | Pass, with tracked checks |
| VII. Accessibility and Keyboard | The bivariate legend is a keyboard grid with full accessible names; every new control is labeled. | Pass |
| VIII. Clean-Room References | Palettes are generated, not copied from biscale (GPL-3.0) or the Stevens images; only design ideas are borrowed. | Pass |
| IX. Testing | Unit, browser, extension and QGIS checks are listed above. | Pass |
| X. Simplicity | No new dependencies. Reuses the graduated classifier, `classCountsSql` and the symbol model; one new optional field, one new renderer kind. | Pass |

**Post-design re-check**: the data model and contracts add no dependencies,
no new map layers, and no platform access. Still Pass.

## Project Structure

### Documentation (this feature)

```text
specs/009-multichannel-bivariate/
├── plan.md              # This file
├── research.md          # Phase 0 (spikes in spikes/)
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── style-core.md
│   ├── interchange-mapping.md
│   └── ui.md
├── spikes/              # QGIS scripts and outputs, palette scoring
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/style/
├── model.ts             # SizeChannel, BivariateRenderer, ResolvedStyle.size/.grid, migration in sanitizeStyle
├── resolve.ts           # size channel + bivariate axes and cells (reusing the graduated path)
├── bivariate.ts         # NEW: cell index, palette lookup, smaller grids
├── bivariateData.ts     # NEW, generated: BIVARIATE_PALETTES
├── symbol.ts            # sizeSymbols, proportionalSize
├── expressions.ts       # size expression, bivariate color index, combined visibility filter
├── edit.ts              # size channel and bivariate edits; Vary removed
├── interchange.ts       # ExportClass extensions, notices
├── qml.ts               # data-defined size; RuleRenderer bivariate; custom properties
├── sld.ts               # cross-product rules; bivariate rules
└── mapbox.ts            # size and bivariate paints; proportional import
packages/core/src/view/stats.ts        # combined totals, two-column cell counts
packages/core/src/query/session.ts     # resolveStyle: per-channel column data
packages/ui/src/
├── LayerStylePanel.svelte             # Bivariate type, Size section; Vary removed
├── ClassList.svelte                   # size mode for the size channel (built instead of a SizeClassList.svelte)
├── style/BivariatePicker.svelte       # NEW: axes, swap, palette previews
├── style/BivariateLegend.svelte       # NEW: keyboard grid
├── MapLegend.svelte                   # legend groups
├── MapView.svelte                     # icon-size for shaped markers
├── ViewerLayout.svelte                # legend groups to the legend and map image
└── mapImage.ts                        # groups, bivariate square
scripts/bivariate-palettes.mjs         # NEW: palette generator
scripts/fixtures-009.mjs               # NEW: roads-traffic, counties-bivariate
tests/core/style-channels.test.ts, style-bivariate.test.ts   # NEW
tests/web/specs/style-channels.spec.ts, style-bivariate.spec.ts   # NEW
tests/vscode-ext/src/suite/…           # sidecar round trip for both styles
tests/qgis/check_009.py                # NEW: QGIS render parity
```

**Structure Decision**: the existing monorepo layout. Everything that
classifies, draws or serializes lives in `packages/core/src/style`, as in
specs 003 and 008. The UI adds three focused components rather than growing
`LayerStylePanel.svelte` further.

## Complexity Tracking

No constitution violations to justify.
