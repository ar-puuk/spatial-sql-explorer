# Quickstart: validating spec 008

How to prove each story works end to end. Contracts: [contracts/](./contracts/).
Entities: [data-model.md](./data-model.md). Decisions: [research.md](./research.md).

## Prerequisites

- `npm ci`, then `npm run build`.
- Fixtures in `tests/vscode-ext/fixtures/`, plus the new ones:
  - `three-layers.gpkg`: countries (polygons), "city points" (points) and
    `lookup_table` (no geometry);
  - `wide-50.parquet`: 50 columns;
  - `buildings-10k.parquet`: polygons with a numeric `height_m`.

  Make them with `spikes/make-data.bat.txt` and `scripts/` (tasks).
- Optional, for read-back checks: QGIS 4.2.3 (`C:\OSGeo4W\bin\python-qgis.bat`)
  and Python with `openpyxl`.

## Automated suites

```
npm run lint && npm run typecheck
npm run test:core
npm run test:web           # includes axe in light, dark and high contrast
npm run test:vscode-ext
```

All must pass with no regressions in specs 001–007 (SC-012).

## Scenarios

| # | Story | Steps | Expected |
|---|---|---|---|
| 1 | US1 | Open `world-boundaries.geojson`, open Layer style, pick Graduated, pick a numeric column | A classed map appears with no Apply step (≤3 interactions, SC-001); the histogram shows the breaks |
| 2 | US1 | Arrow through ramps, then press Escape | The map previews each ramp, then restores the previous one |
| 3 | US1 | Press Save; then the arrow, then `OGC SLD (.sld)` | The QML sidecar is saved or downloaded; the SLD is saved; the keyboard works alone (Enter/arrows/Escape) |
| 4 | US2 | Open `wide-50.parquet`, Columns, `Hide all`, tick 5 | The table fits 1,280 px with no horizontal scroll (SC-003); reopening the file keeps the choice |
| 5 | US2 | Filter a text column with "a" and a number column with ≥ | "N of M rows"; map and table agree; on a 1M-row file it takes ≤3 s (SC-004) |
| 6 | US2 | Tick 3 rows, `Zoom to selection`, then Export → Rows: Selected | The map fits the 3 features; the export has 3 rows |
| 7 | US3 | Open `three-layers.gpkg` | "This file has 3 layers"; countries opens; switching to `city points` takes <2 s; `SELECT * FROM "lookup_table"` works |
| 8 | US3 | VS Code: right-click a `.gdb` folder → Open in Spatial Explorer | A message: not supported yet, with the ogr2ogr hint |
| 9 | US4 | Export a polygon result to every spatial format, then every attribute format with geometry off | Each file reads back with the same row count: `tests/qgis/read_back.py` for spatial formats, openpyxl/JSON for attributes (SC-010) |
| 10 | US4 | Export a mixed result as a Shapefile | The dialog lists the field renames and the per-type split before export |
| 11 | US5 | Web: Theme → Light, reload; switch the OS theme | Light persists; the OS change is ignored until System is picked |
| 12 | US5 | Globe view on; pan a large file (spec 007) | Globe with the same notices; switching takes ≤1 s (SC-005) |
| 13 | US5 | Pick Esri imagery, OpenTopoMap, OSM | Each draws with attribution; the attribution icon is legible in dark and high contrast |
| 14 | US6 | Open `buildings-10k.parquet`, 3D → Extrude by `height_m` | The map tilts; polygons rise; "N drawn flat" shows; rotating stays smooth (SC-006, on real hardware) |
| 15 | US6 | Save QML; run `check_sidecar.py` | QGIS shows a `QgsVectorLayer3DRenderer` with `"height_m" * 1` |
| 16 | US7 | Export map image at 2× with the legend | A PNG of 2× the canvas size, with legend and attribution, in ≤5 s (SC-007) |
| 17 | US7 | Web: Copy link; open it in a new tab; choose the same file | Query, style, basemap, projection and view are restored; the link has no data |
| 18 | US8 | Offline: Try sample data (web) / Open Sample Data (VS Code) | The sample draws in ≤3 s (SC-008) |
| 19 | US8 | Search "Salt Lake City" | One-time notice, then results; picking one flies there. VS Code with the setting off: no search box |
| 20 | Polish | Walk the legacy README's feature list | Every feature is present or listed under "Not carried over" (SC-011) |

## Definition of done

- [ ] All scenarios pass in both shells (web only where noted).
- [ ] Every new export format is verified by read-back before it appears in
  the dialog.
- [ ] Spec 007 timings within 10% (re-run `scale.spec.ts` with
  `SE_LARGE_DATA=1`).
- [ ] README, CHANGELOG, THIRD-PARTY-NOTICES (sql.js, sample data
  source) and screenshots updated.
