# Implementation Plan: Quick Look

**Branch**: `001-quick-look` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-quick-look/spec.md`

## Summary

Open a supported geospatial vector file — from VS Code (via `customEditors`)
or the standalone web app (picker/drag-and-drop) — and immediately see it
rendered on a MapLibre map (fitted to extent, reprojected to EPSG:4326 for
display) and in an attribute table, with map↔table selection sync, CRS/count/
geometry-type/cursor-coordinate display, a theme-matched default basemap with
an off/blank option, and click-to-inspect. Technical approach: DuckDB-WASM
(single-threaded `mvp` bundle) with the spatial extension running inside each
webview/browser tab parses the file via `ST_Read`/`read_parquet`; a
host-agnostic `packages/core` (HostAdapter, DuckDB access, CRS handling) and
`packages/ui` (Svelte 5 components) are shared between `apps/vscode-ext` and
`apps/web`, matching `../omx-viewer`'s tooling conventions. Four risky
assumptions are spiked in Phase 0 (`research.md`) before this design is
treated as settled: WASM format driver coverage, webview range-read support
(deferred — not required by this slice's small-file scope), spatial
extension delivery/VSIX size, and — the highest-priority, highest-risk
item — DuckDB-WASM worker bootstrapping inside an actual VS Code webview.

## Technical Context

**Language/Version**: TypeScript (strict), matching `../omx-viewer`.

**Primary Dependencies**: Svelte 5, Vite, esbuild (extension host bundler),
`@duckdb/duckdb-wasm` (single-threaded `mvp` bundle + spatial extension),
MapLibre GL JS.

**Storage**: N/A for this spec — no persistence beyond the lifetime of one
`ViewerSession` (no save/export in spec 001; sidecar style persistence and
export land in specs 003/005).

**Testing**: Vitest (or project-standard equivalent) for `packages/core` unit
tests; Playwright (or the project's chosen browser test runner) for
`apps/web`; `@vscode/test-electron` for `apps/vscode-ext` integration tests —
per the constitution's Testing principle (IX).

**Target Platform**: VS Code extension host + webview (desktop; Remote-SSH/
WSL/Containers best-effort, vscode.dev best-effort per CLAUDE.md) and modern
evergreen browsers for the standalone web app.

**Project Type**: Monorepo — two thin app shells (`apps/vscode-ext`,
`apps/web`) over shared host-agnostic packages (`packages/core`,
`packages/ui`) — see `research.md` §0 for why this diverges from
`../omx-viewer`'s single `packages/engine`.

**Performance Goals**: SC-001 — open-to-rendered in under ~2s for files up to
~10MB (the clarified size target). SC-004 — map↔table selection highlight
under ~100ms.

**Constraints**: Single-threaded DuckDB-WASM (no `SharedArrayBuffer`; no
`coi-serviceworker` in VS Code webviews — CLAUDE.md). Known ~512MB DuckDB-WASM
memory ceiling, independently reconfirmed as a real, already-hit limit by
`../omx-viewer`'s own production history (they removed DuckDB-WASM from their
hot path entirely after hitting it — see `research.md` §1). Local-first: no
user data leaves the machine (Constitution IV); only basemap tile/style
requests and (ideally self-hosted, see `research.md` §3) the spatial extension
fetch touch the network.

**Scale/Scope**: One file, one layer (first layer only for multi-layer files
per the clarified scope), up to ~10MB, open in one viewer session at a time.
Multi-file sessions are spec 006, explicitly out of scope here.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Check | Status |
|---|---|---|
| I. Scope discipline | Spec 001 is LOOK only (no query/style/export) | PASS |
| II. Host-agnostic core | `packages/core`/`packages/ui` touch only `HostAdapter`; VS Code specifics confined to `apps/vscode-ext` (contracts/host-webview-protocol.md) | PASS |
| III. Native VS Code feel | Deferred to implementation tasks (theming tokens); no violation introduced by this plan | PASS |
| IV. Local-first & private | No telemetry; network only for basemaps + (self-hosted-by-default) spatial extension | PASS |
| V. Bounded resources | Small-file scope (~10MB) chosen specifically to stay well under the known ~512MB DuckDB-WASM ceiling; large-file handling explicitly deferred, not silently ignored | PASS |
| VI. Verified claims | Spike 1 (formats) and Spike 4 (worker bootstrap) are NOT fully verified yet — see `research.md`'s residual-risk table. This plan does not claim them as done; it routes them to `tasks.md` as the first tasks, before any feature code depends on them | PASS (with explicit, tracked follow-up — not a silent gap) |
| VII. Accessibility & keyboard | Carried into task-level acceptance criteria (table/map focus order, ARIA labeling) in `tasks.md` | PASS (tracked at task level) |
| VIII. Clean-room references | omx-viewer and GeoLibre were read for decisions/evidence only; no code or assets copied — all citations above are design/behavior descriptions, not code excerpts used verbatim | PASS |
| IX. Testing | Test layers assigned per app in Technical Context above | PASS (tracked at task level) |
| X. Simplicity | No spec 002–006 functionality (query, styling, export, basemap picker, sessions) pulled forward into this plan | PASS |

No violations requiring the Complexity Tracking table below.

## Project Structure

### Documentation (this feature)

```text
specs/001-quick-look/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── host-adapter.md
│   └── host-webview-protocol.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/
├── web/                  # Standalone web shell (Svelte 5 + Vite)
│   └── src/
└── vscode-ext/           # VS Code extension host + webview bundle (esbuild + Vite)
    └── src/
        ├── extension.ts       # customEditors provider, host-side of contracts/host-webview-protocol.md
        └── webview/           # Webview entry; implements HostAdapter for the VS Code target

packages/
├── core/                 # Host-agnostic: HostAdapter contract, DuckDB-WASM access,
│                         # CRS handling, basemap catalog data. No `vscode`, File API,
│                         # or IndexedDB imports (Constitution II; lint-enforced).
│   └── src/
└── ui/                   # Svelte 5 components (map view, attribute table, status bar
│                         # content, basemap toggle). Same import restriction as core.
    └── src/

tests/
├── core/                 # Unit tests (packages/core)
├── web/                  # Browser tests (apps/web)
└── vscode-ext/           # @vscode/test-electron integration tests
```

**Structure Decision**: Monorepo matching `../omx-viewer`'s app-shell/shared-
package tooling conventions, with the shared layer split into `packages/core`
+ `packages/ui` instead of omx-viewer's single `packages/engine` — see
`research.md` §0 for the rationale (stricter, lint-enforced host-agnostic
boundary needed for this product's larger shared surface).

**Legacy app migration**: the repo root currently holds the legacy single-page
app (`index.html`, `js/`, `css/`, `coi-serviceworker.min.js`, `data/`,
`webapp-theme.md`) — already preserved at the `legacy-v1` git tag. T001 moves
these into `legacy/` (kept in-tree for reference during the rebuild, not
deleted yet) before the new workspace root is created, so root-level config
(`package.json`, `tsconfig.json`, etc.) for the new monorepo has no filename
collisions with the old app.

## Complexity Tracking

*No Constitution Check violations — table intentionally left empty.*
