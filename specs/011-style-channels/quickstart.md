# Quickstart: validating spec 011

## Prerequisites

- `npm install` at the repo root; `npm run build`.
- **Fixtures**: `node scripts/fixtures-011.mjs` writes these into `tests/vscode-ext/fixtures/`:
  - `roads-los.geojson`: lines with `los` (A–F), `volume` and `name`;
  - `crashes.geojson`: points with `severity`, `crash_type` (9 types),
    `heading` (degrees), `age_days`, `hex_color` and `name`;
  - `counties-011.geojson`: polygons with `pop`, `density` and `name`.
- **Baseline for SC-002**: `tests/core/fixtures/style/pre-011-snapshot.json`,
  recorded from the pre-011 `paintFor` by `scripts/paint-baseline-011.mjs` (styles in `pre-011-styles.ts`)
  before slice 1 changes the builder.
- **Optional**: PyQGIS at `C:\OSGeo4W` for the parity checks.

## Automated

| What | Command | Expect |
|---|---|---|
| Core | `npm test --workspace=tests/core` | green, including:<br>• `style-migration-011`: SC-002 paint identity on the baseline<br>• `style-channels-011`: every channel × scale through MapLibre's evaluator<br>• `style-legend-011`: merge rule<br>• `style-labels`<br>• `style-interchange-011`: round trips |
| Web | `npm test --workspace=tests/web` | green, including:<br>• `style-channels-011.spec.ts`: US1, US3–US5<br>• `labels.spec.ts`: US6 and US8<br>• the existing style specs, updated to the new panel |
| Extension | `npm test --workspace=tests/vscode-ext` | sidecar save and reopen with channels and labels |
| Lint | `npm run lint` | 0 errors |

## By hand (each maps to an acceptance scenario)

1. **US1 / SC-001**: open `roads-los.geojson`.
   - Steps: Style, then Color: By column `los`, then Width: By column `volume`.
   - Expect: colors follow LOS, widths follow volume, and the legend has two
     groups.
   - Then apply the Flow / network recipe on a fresh open: the same result in
     ≤ 4 choices.
2. **US1**: open `crashes.geojson`.
   - Steps: Color by `severity`, Shape by `crash_type`, Rotation by `heading`.
   - Expect: shapes differ by type and turn by heading. `crash_type` has 9
     values; 6 get their own shape and the 3 rarest share Other's, with a note.
3. **US4**:
   - Color by `density` Continuous: a gradient legend, and smooth colors.
   - Switch Shape to triangle: the panel notes 32 color steps.
   - Color by `hex_color` As is: the colors match the column, and bad values
     use the fixed color, with a count.
4. **US2 / SC-002**: open a sidecar saved by 0.3.0 (`tests/core/fixtures/style/pre-011-sidecars/*.qml`).
   - Expect: the same drawing and legend.
   - Re-save, then `check_011.py` passes.
5. **US6**:
   - Labels, Show, Text `name`: labels appear and never overlap.
   - On lines, labels follow the line and are never upside down.
   - Change size, color and halo; switch the basemap to Blank, then offline:
     labels stay.
6. **US7 / SC-003**:
   - export QML for steps 1–3 and labels;
   - `SE_QGIS_011=out npx vitest run qgis-011-cases` (in `tests/core`);
   - then `C:\OSGeo4W\bin\python-qgis.bat tests\qgis\check_011.py out`;
   - exit code 0.
7. **US8**: Save map image with labels and three groups: the image shows
   both.
8. **SC-004 / SC-005**:
   - Changing a channel on the 100,000-row fixture updates within 1 s, and a
     fixed value within 200 ms, at the 6× CPU throttle.
   - Toggling labels on a tiles-mode layer issues no data reload: no new
     `CREATE VIEW` in the query log.
