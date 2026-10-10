# Implementation Plan: Spatial SQL Query

**Branch**: `002-spatial-sql-query` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-spatial-sql-query/spec.md`

## Summary

Add the QUERY pillar to both shells. The user writes spatial SQL, in a docked
CodeMirror 6 editor, against the opened file exposed as a `layer` view (plus
a file-name alias). The result replaces the displayed layer: the same map,
table, inspector and style machinery as spec 001.

Each statement goes through a dependency-free scanner and allowlist in
`packages/core`. The allowed ones run on a dedicated, **cancellable**
streaming connection, against an engine **locked down** to the source
directory. Queries are materialized once into a temp table, measured,
size-guarded (confirmation above 50,000 rows), reprojected from the tracked
result CRS, and streamed into the UI in batches.

Errors map back to editor positions. Timings go to the query area and to
VS Code's output channel. History is persisted per file through the existing
`HostAdapter.loadState/saveState`.

All risky assumptions (cancel, lockdown, CRS typing, error format) were
spiked on the real WASM build before this design; see `research.md`.

## Technical Context

**Language/Version**: TypeScript (strict), Svelte 5, same as spec 001.

**Primary Dependencies**:
- Existing: DuckDB-WASM **1.32.0** (DuckDB v1.4.3, `eh` bundle) + spatial;
  MapLibre GL JS 6; Svelte 5; Vite; esbuild.
- **New**: CodeMirror 6 (`@codemirror/view`, `state`, `commands`,
  `language`, `autocomplete`, `lang-sql`, `@lezer/highlight`), MIT, measured
  at 379 KB minified / 126 KB gzipped (research §6).

**Storage**:
- Per-file query history, through `HostAdapter.loadState`/`saveState` (VS
  Code `globalState`, web `localStorage`).
- Temp tables and views live only in the viewer's DuckDB instance.

**Testing**:
- Vitest (`tests/core`): scanner, classifier, error parser, result-CRS
  resolution, history store.
- Playwright (`tests/web`): editor flows, refusal, cancel, threshold dialog,
  autocomplete, history, accessibility.
- `@vscode/test-electron` (`tests/vscode-ext`): query through a test hook,
  output-channel logging, history across reopen.

**Target Platform**: VS Code webview (desktop, plus Remote best-effort) and
evergreen browsers, as in spec 001.

**Project Type**: The existing monorepo. Two thin shells over
`packages/core` and `packages/ui`.

**Performance Goals**:
- SC-001: a filtering query (≤ 1,000 rows) on a ~10 MB file renders in
  < 1 s.
- SC-004: cancel returns control in < 3 s. Measured: 6 ms.

**Constraints**:
- Single-threaded WASM, with the ~512 MB ceiling (Constitution V).
- Local-first (IV): the engine is locked down, with no network or file
  egress.
- No new CSP exemptions: CodeMirror needs no workers.

**Scale/Scope**: One file per viewer. Results confirm above 50,000 rows.
History holds 20 entries per file.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | How this plan complies |
|---|---|---|
| I. Scope Discipline | ✅ | QUERY pillar only. Export (`COPY`), multi-file sessions and thematic styling are refused or out of scope. FR-013 refuses writes. |
| II. Host-Agnostic Core | ✅ | Scanner, classifier, query service, CRS resolution and history are in `packages/core`. Editor and UI are in `packages/ui`. Host access is only via `HostAdapter`, which gains `log` and `OpenedFileRef.stateKey`. The lint rule guards it. |
| III. Native VS Code Feel | ✅ | Editor colors come from `--vscode-editor-*` and `--vscode-symbolIcon-*` variables via `--se-sql-*` tokens. High-contrast borders apply. Output-channel logging. |
| IV. Local-First & Private | ✅ | Engine lockdown (`enable_external_access=false`, `allowed_directories=['/se-source/']`, `lock_configuration`) blocks URL and file reads. History stays local. |
| V. Bounded Resources | ✅ | Parse once (CTAS), confirm above 50,000 rows, batched streaming with yields, cancel. A failure keeps the previous result. |
| VI. Verified Claims | ✅ | Cancel, lockdown, CRS typing, error format, catalog contents and editor size were all measured (research §1–§8). |
| VII. Accessibility & Keyboard | ✅ | Editor ARIA; Ctrl/Cmd+Enter; Esc cancels; every control labeled; axe suite extended. |
| VIII. Clean-Room References | ✅ | GeoLibre's batch-yield pattern is adopted as a decision, with no code copied. CodeMirror is a declared MIT dependency. |
| IX. Testing | ✅ | Unit, browser and extension tests per user story (see quickstart). |
| X. Simplicity | ✅ | One new dependency family, justified against Monaco (research §6). No SQL-parser dependency; a 200-line scanner instead (research §3). |

**Gate: PASS.** No violations; Complexity Tracking is empty.

**Post-design re-check (after Phase 1): PASS.** The data model and contracts
add no new principle tension. The one spec-level change (below) increases
honesty: no rows are silently dropped.

## Spec amendments made during planning

1. **Invalid-geometry rows stay in the table** (research §5).
   - Spec 001 dropped rows with invalid geometry from the table. In a query
     tool, the table must show every row the query returned, so those rows
     now appear, and are skipped only on the map ("180 rows · 179 mapped").
   - FR-003, SC-002 and the edge case are updated so the default query
     matches spec 001's initial view **in mapped features, columns and
     order**, with invalid-geometry rows additionally listed in the table.
   - Spec 001's tests that count table rows are updated accordingly.
2. **Result CRS chip** (research §4).
   - DuckDB v1.4.3 types carry no CRS, so FR-014's "determined"
     reprojection is made concrete: engine type, then extent detection, then
     the layer CRS, with a user override.
   - The chip always says which CRS is assumed.

## Project Structure

### Documentation (this feature)

```text
specs/002-spatial-sql-query/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0: spikes + decisions
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── query-service.md         # packages/core query API
│   ├── statement-policy.md      # scanner/allowlist rules (FR-013)
│   ├── host-adapter-delta.md    # HostAdapter additions
│   ├── host-webview-protocol-delta.md
│   └── ui-query-panel.md        # layout, controls, keyboard (FR-001/004/017)
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── sql/
│   ├── scanner.ts          # NEW: tokenize, split, statement at cursor
│   ├── policy.ts           # NEW: classify (read / temp DDL / refused + reason)
│   ├── errors.ts           # NEW: parse engine errors -> message, hints, position
│   └── index.ts
├── query/
│   ├── session.ts          # NEW: layer view setup, lockdown, query connection, cancel
│   ├── run.ts              # NEW: CTAS -> describe -> stats -> threshold -> stream rows
│   ├── resultCrs.ts        # NEW: CRS resolution order (override/engine/extent/layer)
│   ├── catalog.ts          # NEW: tables/columns/functions/keywords snapshot
│   └── history.ts          # NEW: per-file history via HostAdapter state
├── openFile.ts             # CHANGED: /se-source/ paths, `layer` view + alias, keeps session
├── duckdbService.ts        # CHANGED: one-time lockdown after spatial load
├── hostAdapter.ts          # CHANGED: log?(), OpenedFileRef.stateKey
└── models.ts               # CHANGED: QueryResult fields (rowCount, mappedCount, resultCrs)

packages/ui/src/
├── QueryPanel.svelte       # NEW: editor + run/cancel/reset/history + status line
├── SqlEditor.svelte        # NEW: CodeMirror 6 wrapper (theme tokens, completion, diagnostics)
├── QueryHistory.svelte     # NEW: history popover
├── LargeResultDialog.svelte# NEW: FR-012 confirmation
├── ResultCrsChip.svelte    # NEW: assumed/detected/override CRS
├── ViewerLayout.svelte     # CHANGED: drawer splits into [query panel | attribute table]
├── AttributeTable.svelte   # CHANGED: row vs mapped counts, extra geometry columns as text
└── viewerStore.svelte.ts   # CHANGED: query state machine, history, cancel, reset

apps/vscode-ext/src/
├── extension.ts            # CHANGED: log -> output channel; _runQuery/_getQueryState test hooks
└── webview/{hostAdapter,theme.css,main}.ts   # CHANGED: log(), stateKey, --se-sql-* tokens

apps/web/src/
├── hostAdapter.ts          # CHANGED: stateKey from name+size+lastModified
└── theme.css               # CHANGED: --se-sql-* brand tokens

tests/core/      sql-scanner.test.ts, sql-policy.test.ts, sql-errors.test.ts, result-crs.test.ts, history.test.ts
tests/web/specs/ query.spec.ts, query-errors.spec.ts, query-cancel.spec.ts, query-history.spec.ts (+ accessibility additions)
tests/vscode-ext/src/suite/ query.test.ts
```

**Structure Decision**: the existing four-package monorepo is unchanged.
- Query logic lives in `packages/core/src/sql` and `src/query`, so it's
  testable without a browser.
- The editor and panel live in `packages/ui`.
- Each shell gains only thin adapter additions: `log`, `stateKey`, tokens
  and test hooks.

## Complexity Tracking

No constitution violations to justify.
