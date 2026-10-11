# Quickstart: validating thematic styling (spec 003)

## Prerequisites

- `npm install` at the repo root, plus the spec 001/002 setup.
- Optional, for the QGIS checks: QGIS with PyQGIS. Spikes used QGIS 4.2.3
  from OSGeo4W (`C:\OSGeo4W\bin\python-qgis.bat`).

## Setup

- **Web**: `npm run dev`, then open `http://localhost:5173/`.
- **VS Code**: install the VSIX (`npm run package --workspace=apps/vscode-ext`)
  or start a development instance.
- **Fixtures**:
  - `tests/vscode-ext/fixtures/world-boundaries.geojson`;
  - the generated ~10 MB parcels file from the performance spec (columns
    `zone`, `acres`, `value`).

## Scenario 1: Categorized (US1)

1. Open the parcels file. Open **Layer style**, choose **Categorized**,
   then the column `zone`.
   - **Expected**: 5 colors on the map. The legend lists R1, R2, C, I and
     AG with counts that add up to the rows in the result (1,000 for the
     initial view; FR-005).
2. Run `SELECT * FROM layer` (show all 22,000) and categorize by `owner`
   (997 values).
   - **Expected**: 12 classes plus "Other (985 values)". The legend counts
     add up to 22,000.

## Scenario 2: Graduated (US2)

1. Graduated on `value`, Quantile, 5 classes.
   - **Expected**: the class counts are equal to within ties. The legend
     caption is `value · Quantile, 5 classes`.
2. Switch to Equal interval, then Natural breaks, then 3 and 10 classes.
   - **Expected**: the map and the legend change together each time
     (SC-006).
3. On `world-boundaries`, choose Graduated with only text columns.
   - **Expected**: Graduated is disabled, and its tooltip gives the reason.

## Scenario 3: Ramps and class edits (US3, FR-009)

1. Open the ramp picker with the keyboard, choose `RdBu`, then press
   **Reverse**.
   - **Expected**: the map and the legend follow each change.
2. Change one class's color, rename one label, and hide one class with its
   legend swatch.
   - **Expected**: the method stays the same, the hidden features leave the
     map, and the legend row dims.
3. Edit a break.
   - **Expected**: the method shows **Manual**, and the classes stay put
     when a new query result arrives (counts update).

## Scenario 4: Save, reopen, QGIS, interchange (US4)

1. Save a categorized style with one hidden class, close and reopen the
   file.
   - **Expected**: identical classes, colors, labels and hidden flag.
2. Open the same file in QGIS, or run the PyQGIS check
   `tests/qgis/check_sidecar.py <file>.qml`.
   - **Expected**: the same renderer, classes, colors, labels and render
     flags (SC-003).
3. Export to SLD and to Mapbox GL style JSON.
   - **Expected**: before writing, the SLD notice lists "classification
     method" and "1 hidden class". Mapbox shows no notice.
4. Import each exported file back.
   - **Expected**: the same classes and colors (SC-004). SLD comes back as
     fixed classes with the hidden class missing, as announced.

## Scenario 5: Queries and fallback (US5)

1. Graduated on `value`, then run `SELECT * FROM layer WHERE zone = 'R1'`.
   - **Expected**: the classes are recomputed for the result.
2. Run `SELECT parcel_id, geom FROM layer`.
   - **Expected**: single symbol, and the notice "Column "value" is not in
     this result." The legend shows the reason.
3. Run `SELECT * FROM layer`.
   - **Expected**: the graduated style returns by itself.
4. Press Reset.
   - **Expected**: the original view and the saved sidecar style.

## Automated coverage

| Layer | Suite | Covers |
|---|---|---|
| Unit | `tests/core/style-classify.test.ts`, `style-resolve.test.ts`, `style-expressions.test.ts`, `style-edit.test.ts`, `style-ramps.test.ts`, `style-interchange.test.ts` | Breaks vs the QGIS fixtures and brute-force Jenks (SC-002); map = legend per feature through MapLibre's evaluator (SC-006); FR-009 transitions; every row of `contracts/interchange-mapping.md` (SC-004) |
| Browser | `tests/web/specs/style-thematic.spec.ts`, plus accessibility and performance additions | Scenarios 1–5 in the real build; axe on the panel, ramp list and legend (light and dark); SC-001 timing; SC-007 with 50,000 rows |
| Extension | `tests/vscode-ext/src/suite/style.test.ts` | Save to the sidecar, reopen, auto-apply; parity of classes with the web build (FR-020) |
| QGIS (optional, local) | `tests/qgis/check_sidecar.py` | The exported QML loads in QGIS with identical classes (SC-003) |

## Results (T046, measured 2026-10-10)

Windows 11, production builds. The web numbers come from headless Chromium
using SwiftShader software WebGL, so map timings are pessimistic.

| Criterion | Target | Measured | How |
|---|---|---|---|
| SC-001: style change on the ~10 MB file (22,000 features, all shown) | < 1 s | Categorize **123 ms**; natural breaks with 10 classes **102 ms** (change → legend updated → 2 frames) | `performance.spec` "SC-001 (spec 003)" |
| SC-002: breaks correct | 100% | Equal interval and quantile **identical to QGIS 4.2.3**; natural breaks **optimal** (30 brute-force trials; lower SSQ than QGIS on its one differing break) | `style-classify.test.ts` |
| SC-003: saved style reopens identically, in both shells and in QGIS | 100% | VS Code save → reopen identical (classes, colors, labels, hidden); web download → reopen with sidecar identical; QGIS 4.2.3 reads the app's categorized, Jenks and manual QML with identical classes, colors, labels and render flags | `style.test.ts` US4, `style-thematic.spec` US5, `tests/qgis/check_sidecar.py` (research.md) |
| SC-004: export → import keeps classes, values/breaks, colors | 100%, zero silent losses | **18 interchange tests**: lossless through QML and Mapbox; SLD losses (method, hidden classes) always announced before writing and on import | `style-interchange.test.ts` |
| SC-006: legend = map | every change | Per-feature MapLibre evaluation equals legend counts for categorized (cap 12/4), equal, quantile, jenks and manual, including nulls, '', numeric strings, booleans and values on breaks | `style-expressions.test.ts` |
| SC-007: 50,000 rows, no freeze | no task ≥ 1 s | Jenks end to end **191 ms**; the long-task observer recorded **no** task ≥ 50 ms | `performance.spec` "SC-007 (spec 003)" |
| FR-020: same classes in both shells | identical | world-boundaries categorized and squares quantile give identical labels, counts and colors in VS Code and web | `style.test.ts`, `style-thematic.spec` |

## Definition of done

- [x] Scenarios 1–5 pass in both shells (web `style-thematic.spec`, VS Code
      `style.test.ts`).
- [x] SC-001 (< 1 s on ~10 MB) and SC-007 (50,000 rows, no freeze) are
      measured (see Results).
- [x] The QML exported by the app is verified by the PyQGIS check.
- [x] The default ramps (Viridis, Set 2 / Paired) and the ramp list are
      reviewed in screenshots on the Positron and Dark basemaps, in all three
      VS Code themes and web light/dark (T045).
- [ ] All spec 001 and 002 suites still pass.
