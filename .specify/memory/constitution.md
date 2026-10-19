<!--
Sync Impact Report
Version change: 1.6.0 → 1.7.0 (spec 024, user decision 2026-10-19)
Modified principles:
  - I. Scope Discipline: a GTFS feed is two layers, routes and stops, drawn on the map together. One is
    the open layer (the table, filters, selection and export) and the other is a read-only companion
    drawn beside it with the same style. This is the only exception to one layer at a time; it corrects
    1.6.0's "one styled result, not a second map layer".

Previous: 1.5.0 → 1.6.0 (spec 024, user decision 2026-10-19)
Modified principles:
  - I. Scope Discipline: opening a GTFS transit feed (a zip or folder of text tables) is LOOK, and
    drawing its routes and stops together is one styled result, not a second map layer. Timetables,
    service-day filters, validation, editing and network analysis stay out of scope.
  - IV. Local-First and Private: gdal3.js is now also fetched the first time a GTFS feed is opened
    (same pinned, hash-checked file as for File Geodatabases; no new download).
  - VIII. Clean-Room References: GTFS-X (AGPL-3.0) is added as a reference tool. Its code is never
    copied or adapted (AGPL would bind this project); only the visual decisions are followed.
  - Technology & Platform Constraints: gdal3.js also reads GTFS (the GDAL GTFS driver in DuckDB-WASM's
    own build cannot list a registered folder or zip: specs/024-gtfs/research.md).
Added sections: none
Removed sections: none
Templates: no change.
Follow-up TODOs: delete the gdal3.js GTFS reader if the engine's GTFS driver starts to open registered folders.

Previous: 1.4.0 → 1.5.0 (spec 013, user decision 2026-10-18)
Modified principles:
  - IV. Local-First and Private: one more pinned download. gdal3.js (GDAL 3.8.4 in
    WebAssembly, LGPL-2.1+, used unmodified as a separate file) is fetched from jsDelivr
    like the engine: pinned URL, SHA-256 recorded at build time, checked before it runs,
    kept as a local copy, and only when a File Geodatabase is first opened.
  - Technology & Platform Constraints: the extension host and a web worker may run gdal3.js
    (WebAssembly) to read File Geodatabases, which no part of the SQL engine can read.
    "No native GDAL" still holds: no GDAL binary is shipped or called.
Added sections: none
Removed sections: none
Templates: no change.
Follow-up TODOs: delete the reader if DuckDB-WASM's spatial extension gains the OpenFileGDB driver.

Previous: 1.3.0 → 1.4.0 (spec 017, user decision 2026-10-17)
Modified principles:
  - IV. Local-First and Private: one more pinned download host. The fts extension (official
    host) and the h3 and a5 community extensions (community-extensions.duckdb.org, a
    different signing key) are fetched like the other extensions: pinned URL, SHA-256
    recorded at build time, checked before they run, DuckDB's signature check left on.
    They are optional: the app starts without them.
Added sections: none
Removed sections: none
Templates: no change.
Follow-up TODOs: none

Previous: 1.2.1 → 1.3.0 (spec 014, user decisions 2026-10-15)
Modified principles:
  - I. Scope Discipline: a terrain on/off switch is allowed: a DEM is a height source the
    one basemap and the data are lifted onto, not a second basemap (so "stacked basemaps"
    stays out). Scratch shapes drawn on the map for measuring, selecting and filtering are
    allowed: they are never edits to the data. Tilt and rotate were already allowed
    (CLAUDE.md, 2026-10-13). Planets, 3D tiles and every other 3D stay out.
  - IV. Local-First and Private: the optional terrain elevation tiles are one more
    fetched-at-runtime resource (AWS Open Data Terrarium tiles; no user data is sent).
Added sections: none
Removed sections: none
Templates: no change.
Follow-up TODOs: none

Previous: 1.2.0 → 1.2.1 (clarification: the engine's code is kept as a local
copy after the first download, still hash-checked on every start)

Previous: 1.1.0 → 1.2.0
Modified principles:
  - IV. Local-First and Private: the SQL engine is downloaded, not bundled (user
    decision 2026-10-11): DuckDB-WASM, its extensions and sql.js come from pinned URLs
    (jsDelivr, extensions.duckdb.org), each checked against a SHA-256 recorded at build
    time before it runs. A mismatch is refused, never run.
Added sections: none
Removed sections: none
Templates: no change.
Follow-up TODOs: none

Previous: 1.0.0 → 1.1.0
Modified principles:
  - I. Scope Discipline: "globe" removed from the out-of-scope list; a Mercator/Globe
    projection toggle and polygon extrusion are allowed (user decision 2026-10-11,
    spec 008). Terrain, 3D tiles, planets and other 3D stay out.
  - IV. Local-First and Private: one more allowed network use, the opt-out place search
    (typed text only, disclosed before first use).
  - V. Bounded Resources: memory ceiling updated to the measured 3.1 GiB
    (specs/007-viewport-loading/research.md §1).
Added sections: none
Removed sections: none
Templates: plan/spec/tasks templates need no change (they reference the constitution
generically).
Follow-up TODOs: none
-->

# Spatial Explorer Constitution

## Core Principles

### I. Scope Discipline
The product does LOOK, QUERY, STYLE and EXPORT only — nothing else. Feature editing,
georeferencing, the processing toolbox, print layouts, notebook/ipynb integration, a
plugin system, 3D tiles/planets, raster analysis, and stacked basemaps are
explicitly out of scope. Three 3D-adjacent map options are in scope as part of LOOK
and STYLE: a Mercator/Globe projection toggle, polygon extrusion by a column, and a
terrain on/off switch (a height source the one basemap and the data are lifted onto,
never a second basemap). Shapes the user draws on the map to measure, select and filter
are in scope as scratch geometry, never as edits to the data. No other 3D. Any proposal to add scope beyond LOOK/QUERY/STYLE/EXPORT MUST
be rejected at review time and raised as a constitution amendment instead of being
absorbed silently into a feature.
**Rationale**: the product's value is being the fast "never open QGIS" tool; unbounded
scope growth is the single greatest risk to shipping and to keeping the UI simple.

### II. Host-Agnostic Core
`packages/core` and `packages/ui` MUST NOT import the `vscode` API, call
`acquireVsCodeApi`, or touch the File API or IndexedDB directly. All platform access
(file bytes, theme, persisted state, status reporting) goes through the `HostAdapter`
interface, with a web implementation and a VS Code implementation. This MUST be
enforced by a lint rule, not by convention alone.
**Rationale**: the product ships as both a standalone web app and a VS Code extension
from one codebase; any direct platform dependency in shared code breaks one of the two
shells.

### III. Native VS Code Feel
Chrome (panels, inputs, tables, buttons) uses VS Code theme tokens with sensible
fallbacks (e.g. `var(--vscode-sideBar-background, var(--vscode-editor-background))`)
and MUST support light, dark, and high-contrast themes, reacting live to theme changes
via a `MutationObserver`. Canvas/WebGL colors (MapLibre paint, selection highlights) do
not follow CSS variables automatically and MUST be read via `getComputedStyle` and
re-applied on theme change. Data colors (choropleth ramps, categorical palettes) are
fixed and theme-independent by design.
**Rationale**: the extension's credibility depends on looking and behaving like a
first-party VS Code feature, not a web page embedded in a webview.

### IV. Local-First and Private
User data never leaves the machine. No telemetry is collected without explicit
opt-in. The network is used only for basemap tiles/styles, downloading the SQL engine's code
(DuckDB-WASM, its extensions, sql.js and, only when a File Geodatabase or a GTFS feed is opened, gdal3.js,
from pinned URLs, each checked against a SHA-256 recorded at build time before it runs;
the engine is not bundled, and each shell keeps a local copy after the first download), and the place search, which sends only the text the user
types, is disclosed before first use, and can be turned off — never for user data
egress (no file contents, file names or paths).
**Rationale**: the target user opens sensitive or proprietary geospatial files; trust
requires a hard guarantee, not a policy statement.

### V. Bounded Resources
DuckDB runs as the single-threaded DuckDB-WASM bundle inside each webview (no
SharedArrayBuffer, no native host-side DuckDB), with a known memory ceiling
(3.1 GiB, measured in both shells in spec 007). The system MUST NOT load a whole large file
into memory when avoidable, MUST query by viewport bbox with a feature cap in the
MVP, and MUST fail with a clear, actionable message rather than crash or hang when a
resource limit is hit.
**Rationale**: the WASM runtime's resource ceiling is a hard physical constraint, not
a tuning parameter; features must be designed within it from the start.

### VI. Verified Claims
A file format or capability (e.g. "GeoPackage is supported", "range reads work under
Remote-SSH") may be documented or built upon only after it has been tested against the
real WASM build and runtime target — never assumed from documentation alone. Risky
assumptions MUST be spiked, with the outcome recorded in `research.md`, before
dependent design or implementation work begins.
**Rationale**: several of this project's hardest unknowns (WASM GDAL driver coverage,
webview Range-request support) cannot be answered from documentation and have
previously caused false assumptions elsewhere in this codebase's history.

### VII. Accessibility and Keyboard
Every interactive control MUST be keyboard-reachable and properly labeled
(accessible name, role, and state). This applies equally to the web shell and the VS
Code extension's webviews.
**Rationale**: a GIS "quick look" tool is used constantly and briefly throughout a
workday; keyboard friction compounds, and accessibility is not optional for a tool
intended for daily professional use.

### VIII. Clean-Room References
Reference tools (Data Wrangler, Hex Editor, GitLens, SQLite Viewer, built-in Image
Preview, GeoLibre, omx-viewer, GTFS-X) may inform product and UX DECISIONS and DESIGN only.
Copying code or shipping assets from any reference tool is prohibited, particularly
where licensing is mixed or unclear (e.g. GitLens assets) or copyleft (GTFS-X is
AGPL-3.0: follow its look, never its code).
**Rationale**: avoids license contamination and keeps the team's design reasoning
explicit rather than borrowed.

### IX. Testing
Core logic (`packages/core`) requires unit tests, the web shell requires browser
tests, and the VS Code extension requires integration tests via
`@vscode/test-electron`. A feature is not complete without its corresponding tests at
the layer(s) it touches.
**Rationale**: the host-agnostic core/adapter boundary (Principle II) and the dual-shell
shipping model only stay correct under continuous verification; manual spot-checks do
not scale across two shells and three WASM-dependent code paths.

### X. Simplicity
Prefer the smallest design that satisfies the current spec. Every new dependency MUST
be justified against what already exists in the stack (DuckDB-WASM, MapLibre GL JS,
Svelte 5, Vite, esbuild). Do not build for hypothetical future specs (e.g. spec
002–006) while implementing spec 001.
**Rationale**: this is a from-scratch rebuild of a legacy single-page app; re-accumulating
unnecessary complexity would repeat the conditions that made the legacy app worth
rebuilding rather than patching.

## Technology & Platform Constraints

- Monorepo layout matches `../omx-viewer`'s convention — inspect it before diverging:
  `apps/web`, `apps/vscode-ext`, plus shared packages (confirm exact package names,
  e.g. `packages/core`/`packages/ui` vs. omx-viewer's `packages/engine`, during planning).
- Stack: Svelte 5 + Vite + strict TypeScript for UI; esbuild for the extension host;
  DuckDB-WASM (single-threaded bundle) with the spatial extension, downloaded at a pinned
  version and hash-checked (not bundled), one instance per custom-editor webview, `retainContextWhenHidden` for the MVP; MapLibre GL JS for
  rendering (deck.gl only later, only if needed).
- VS Code integration: `customEditors` with `Open With`; priority `"default"` for
  `.gpkg .fgb .shp .pmtiles .geoparquet`, priority `"option"` for
  `.geojson .csv .parquet .json` (never hijack built-in text/data viewers); an
  explorer/context command for folder-based formats (`.gdb`) that cannot bind to a
  custom editor (spec 013 reads them with gdal3.js: in a child process of the extension host,
  in a worker on the web; spec 024 reads GTFS feeds, zip or folder, the same way, and detects
  them by content, never by file name); status bar items for CRS/feature count/cursor coordinates; an output
  channel for query logs and timings.
- Basemap catalog is DATA (one table: id, name, type, url template, attribution,
  requiresKey, region) — the UI renders from it, and adding a provider means adding a
  row, not writing code. A blank background is a first-class catalog option. Default
  basemap follows the host's theme kind (light/dark). Basemap failure (offline, CSP
  block, bad key) MUST degrade gracefully to blank + a short message, never a crash.
- Style persistence is a sidecar file next to the data file; the exact format (custom
  JSON vs. QGIS QML/SLD/Mapbox Style JSON) is an open decision for `/speckit-clarify`,
  preferring interop if the cost is moderate.

## Development Workflow

- `spec.md` stays technology-agnostic; stack and architecture decisions belong in
  `plan.md`.
- Phase 0 of any plan touching a listed risky assumption (WASM format support, range
  reads, spatial-extension delivery, webview CSP/worker bootstrapping) MUST include a
  spike with a recorded outcome before Phase 1 design proceeds.
- Features are delivered as small vertical slices; anything marked OPEN in project
  guidance is resolved by asking before assuming.
- Work proceeds phase by phase during implementation, not all at once, with a commit
  after each completed task and tests run before moving to the next task.

## Governance

This constitution supersedes conflicting ad hoc practices for this repository. Any
change to Core Principles or the scope defined in Principle I requires an explicit
constitution amendment (a dedicated update to this file via `/speckit-constitution`),
not an incidental change inside a feature spec or plan. Amendments bump
`CONSTITUTION_VERSION` per semantic versioning: MAJOR for backward-incompatible
principle removal/redefinition, MINOR for a new principle or materially expanded
guidance, PATCH for clarification or wording fixes. All specs, plans, and task lists
MUST be checked against this constitution at `/speckit-analyze` time; unjustified
complexity or scope drift is a blocking finding, not a note. Use `CLAUDE.md` at the
repository root for day-to-day runtime development guidance that supplements, but does
not override, this constitution.

**Version**: 1.7.0 | **Ratified**: 2026-10-09 | **Last Amended**: 2026-10-19
