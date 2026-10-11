# Implementation Plan: Export

**Branch**: `005-export` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-export/spec.md`

## Summary

Add the EXPORT pillar. The current query result, or the whole file for the
untouched initial view, is saved as **GeoJSON, GeoParquet or CSV** (and
Parquet for table results), in the result's CRS or WGS84.

Exports run on the query session's cancellable connection:
- **GeoParquet, CSV and Parquet** are written by DuckDB `COPY` into the
  engine's in-memory file system, under the already-allowed `/se-source/`.
  The bytes are copied out and the file is dropped.
- **GeoJSON** is streamed by our own RFC 7946 writer.

The bytes reach the user through `HostAdapter.saveFile`: a Blob download on
the web, and in VS Code a save dialog with a new chunked binary transfer.

Every risky assumption was spiked first (research.md), and the spikes
changed the design:
- **GDAL can't write any format** in this DuckDB-WASM build. FlatGeobuf,
  GeoPackage, Shapefile and KML are not offered (FR-004), and GeoJSON is
  ours.
- **DuckDB's default GeoParquet mislabels projected data as WGS84** in QGIS.
  We write WKB plus our own `geo` metadata with PROJ's full PROJJSON, and
  QGIS then reads the true CRS.

## Technical Context

**Language/Version**: TypeScript (strict), Svelte 5, as before.

**Primary Dependencies**: the existing ones only.
- DuckDB-WASM 1.32.0 (v1.4.3) + spatial:
  - `COPY` to Parquet/CSV;
  - `ST_AsWKB`, `ST_AsText`, `ST_AsGeoJSON`;
  - `ST_Read_Meta` for PROJJSON.
- MapLibre, Svelte 5, Vite, esbuild.
- **No new runtime dependency.**

**Storage**:
- No persistent storage beyond `export.prefs` (the last choices) through
  `HostAdapter.saveState`.
- Export files exist only in the engine's memory until saved.

**Testing**:
- **Vitest**: plan, notices, formats.
- **Playwright**:
  - exports through real downloads;
  - read-back of the bytes in the page (GeoJSON parse, Parquet row count
    and `geo` metadata via the engine);
  - SC-003/SC-004 timings.
- **`@vscode/test-electron`**: save next to the source, a chunked file over
  32 MB, the source refused, the command, and parity.
- **Local PyQGIS**: `tests/qgis/read_back.py` for SC-002.

**Target Platform**: the VS Code webview and evergreen browsers.

**Project Type**: the existing monorepo.

**Performance Goals**:
- **SC-003**: 100,000 polygons to GeoParquet in under 15 s. Spiked at
  0.27 s.
- **SC-004**: cancel in under 3 s. Spiked at 0.17 s.

**Constraints**:
- The spec 002 engine lockdown stays exactly as it is.
- The single-threaded WASM ceiling of about 512 MB: an export holds the
  encoded file twice (in the engine, then copied out), and OOM is reported
  (FR-011).
- No new CSP needs.

**Scale/Scope**: one result per export. The four formats are listed above;
other formats come back only after re-verification.

## Constitution Check

*GATE: passed before Phase 0 and re-checked after Phase 1 design.*

| Principle | Status | How this plan complies |
|---|---|---|
| I. Scope Discipline | ✅ | The EXPORT pillar only. Map images, styles, sessions and remote destinations are out (spec). |
| II. Host-Agnostic Core | ✅ | The plan, formats, PROJJSON, writers and runs are in `packages/core/src/export`. The dialog is in `packages/ui`. Bytes reach the user only via `HostAdapter.saveFile`. |
| III. Native VS Code Feel | ✅ | A native save dialog defaulting next to the source, a command-palette command, and a theme-token dialog. |
| IV. Local-First | ✅ | Everything runs in the page. Data goes only to the destination the user picks (FR-015). |
| V. Bounded Resources | ✅ | Streaming GeoJSON batches with UI yields; a cancellable `COPY`; the target always dropped; OOM caught with an actionable message; the viewer's data is never replaced by an export. |
| VI. Verified Claims | ✅ | Formats are offered only when proven by spike and QGIS read-back. The GDAL failures, the GeoParquet CRS bug, PROJJSON, timings and cancel are recorded with evidence. |
| VII. Accessibility | ✅ | A modal dialog with radio groups, labeled controls, Esc/Enter and progress text, axe-checked. |
| VIII. Clean-Room | ✅ | The writers come from the RFC 7946 / GeoParquet 1.1 specifications. No code is copied. |
| IX. Testing | ✅ | Unit, browser and extension suites, plus a local QGIS read-back. |
| X. Simplicity | ✅ | No dependencies, and the engine does the encoding where it can. The lockdown is reused rather than widened. |

**Post-design re-check**: no violations. Complexity Tracking is empty.

## Spec amendments made during planning

1. **FR-004 / US3**: no extra format is offered. Every GDAL write fails in
   DuckDB-WASM 1.32.0, even a single point (research §2). US3 scenario 2
   (Shapefile) is deferred with the format. Parquet is available for table
   results.
2. **GeoJSON precision**: full precision, not about 1 cm (research §4).

## Project Structure

### Documentation (this feature)

```text
specs/005-export/
├── spec.md
├── plan.md                 # this file
├── research.md             # Phase 0: spikes + decisions
├── data-model.md           # Phase 1
├── quickstart.md           # Phase 1: validation scenarios
├── contracts/
│   ├── export-core.md      # packages/core/src/export API + guarantees
│   └── host-and-ui.md      # chunked saveFile, VS Code command, export dialog
├── spikes/                 # engine-report.json, scale.json, geoparquet-utm12n.parquet
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks (not created by /speckit-plan)
```

### Source Code (repository root)

```text
packages/core/src/
├── export/
│   ├── formats.ts          # NEW: EXPORT_FORMATS catalog (verified only)
│   ├── plan.ts             # NEW: planExport (rows, availability, CRS, notices, SQL)
│   ├── projjson.ts         # NEW: EPSG -> PROJJSON via an ST_Read_Meta probe, cached
│   ├── geojson.ts          # NEW: streamed RFC 7946 writer
│   ├── run.ts              # NEW: COPY / stream, copyFileToBuffer, dropFile in finally
│   └── index.ts
├── query/session.ts        # CHANGED: exportData() on the exclusive connection; cancel() covers it
├── hostAdapter.ts          # CHANGED: saveFile options { kind } (doc only; signature already takes bytes)
└── models.ts               # CHANGED: Layer gains resultCrs srid/assumed if not already reachable

packages/ui/src/
├── ExportDialog.svelte     # NEW
├── AttributeTable.svelte   # CHANGED: Export button in the header
├── ViewerLayout.svelte     # CHANGED: mounts the dialog
└── viewerStore.svelte.ts   # CHANGED: export state (plan, running, progress, outcome), prefs

apps/vscode-ext/src/
├── extension.ts            # CHANGED: chunked saveFile, source refusal, exportData command, test hooks
├── webview/hostAdapter.ts  # CHANGED: binary saveFile -> Begin/Chunk/End messages
└── package.json            # CHANGED: command + palette when-clause

tests/core/      export-plan.test.ts, export-formats.test.ts
tests/web/specs/ export.spec.ts (+ accessibility, performance additions)
tests/vscode-ext/src/suite/export.test.ts
tests/qgis/      read_back.py
```

**Structure Decision**: the existing layout. Export logic sits beside
`query/` in core. The shells change only for delivery: the VS Code chunked
save, the command and its test hooks.

## Complexity Tracking

No constitution violations to justify.
