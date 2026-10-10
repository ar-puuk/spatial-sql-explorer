# Quickstart: Validating Spatial SQL Query (002)

This is a validation guide only. The design is in `plan.md`, `research.md`,
`data-model.md` and `contracts/`.

## Prerequisites

- Spec 001 is complete; its suites pass (`npm run test:core`,
  `npm run test:web`, `npm run test:vscode-ext`).
- Fixtures in `tests/vscode-ext/fixtures/`:
  - `world-boundaries.geojson`, which has one invalid geometry;
  - `usa-utm12n.gpkg` and `usa-utm12n.parquet`, both in EPSG:26912;
  - `points.csv`.
- The generated ~10 MB parcels GeoJSON from spec 001's performance tests.

## Setup

```bash
npm install
npm run build --workspace=apps/web
npm run build --workspace=apps/vscode-ext
```

Manual runs:
- **Web**: `npm run dev`.
- **VS Code**: F5 for an Extension Development Host, or
  `npm run package --workspace=apps/vscode-ext` and install the VSIX.
- **Visual check**: `npm run screenshots`.

## Scenario 1: Run a query (US1, P1)

1. Open `world-boundaries.geojson`, then open the query panel
   (Ctrl/Cmd+Shift+Q).
   - **Expected**: the editor shows `SELECT * FROM layer LIMIT 1000`.
   - **Expected**: the header shows `layer · EPSG:4326 · 180 rows`.
   - **Expected**: the table and map match spec 001's view, plus the one
     invalid-geometry row listed in the table ("180 rows · 179 mapped";
     plan "Spec amendments").
2. Replace the query with `SELECT * FROM layer WHERE name LIKE 'U%'` and
   press Ctrl/Cmd+Enter.
   - **Expected**: only the matching countries appear on the map (fitted)
     and in the table.
   - **Expected**: the status line shows the row count and the duration.
   - **Expected**: selection sync, the inspector and the style panel still
     work.
3. Remove the `LIMIT` from the default query on the ~10 MB parcels file.
   - **Expected**: all 22,000 rows are shown, with no dialog (under 50,000).
   - **Expected**: a filtering query on that file renders in under 1 s
     (SC-001).
4. Run `SELECT zone, count(*) FROM layer GROUP BY zone` on parcels.
   - **Expected**: a table-only result, the map dimmed with a "no geometry
     to map" note (FR-006).

## Scenario 2: Errors, refusal and cancel (US2, P1)

1. Run `SELECT *` then a newline, then `FORM layer`.
   - **Expected**: "Parser Error: syntax error at or near "layer"", with a
     squiggle on line 2.
   - **Expected**: the previous result is unchanged (FR-008).
2. Run `SELECT nope FROM layer`.
   - **Expected**: the message names `nope` and lists the candidate columns.
3. Run `COPY layer TO 'x.csv'`.
   - **Expected**: refused with "Exporting results isn't available yet."
   - **Expected**: nothing executes (FR-013).
4. Run `INSERT INTO layer SELECT * FROM layer`.
   - **Expected**: refused (the policy). Even through the engine directly, it
     fails because `layer` is a view.
5. Run `SELECT sum(a.range*b.range) FROM range(200000) a, range(200000) b`,
   then press Cancel (or Esc).
   - **Expected**: "Cancelled after N s" in under 3 s (SC-004).
   - **Expected**: the viewer is responsive and the previous result is still
     shown.
6. In VS Code, open **View → Output → Spatial Explorer**.
   - **Expected**: one line per query above, with its outcome and duration
     (FR-010).

## Scenario 3: Reset (US3, P2)

1. After any query, choose Reset.
   - **Expected**: the default query, the original result, the original
     extent and the original style, as on a fresh open (FR-011).

## Scenario 4: Autocomplete (US4, P2)

1. Type `SELECT na`.
   - **Expected**: `name` is suggested with its type.
2. Type `ST_Ar`.
   - **Expected**: `ST_Area` is suggested with its signature and description.
3. Run `CREATE TEMP TABLE big AS SELECT * FROM layer WHERE ST_Area(geom) > 50`,
   then type `SELECT * FROM bi`.
   - **Expected**: `big` is suggested (catalog refresh after DDL).

## Scenario 5: History (US5, P3)

1. Run three different queries, then close and reopen the file (VS Code:
   close the tab and reopen; web: open the same file again).
   - **Expected**: History lists all three, newest first, with time and
     outcome.
   - **Expected**: choosing one loads it without running (FR-016, SC-007).

## Scenario 6: CRS (FR-014)

1. Open `usa-utm12n.gpkg` and run `SELECT name, ST_Area(geom) / 1e6 AS km2 FROM layer`.
   - **Expected**: about 10.18 million km², in real units from the UTM
     source CRS. This was measured in the Phase 0 spike: 10,179,527,591,736
     m². UTM 12N distorts area far from its zone, e.g. in Alaska.
2. Run `SELECT * FROM layer`.
   - **Expected**: the chip shows `EPSG:26912 (layer)` and the USA is drawn
     in the right place.
3. Run `SELECT ST_Transform(geom, 'EPSG:26912', 'EPSG:4326', always_xy := true) AS geom FROM layer`.
   - **Expected**: the chip shows `EPSG:4326 (detected)`, and it is drawn in
     the same place.

## Scenario 7: Large result (FR-012)

1. On a file with more than 50,000 rows (generated), run
   `SELECT * FROM layer`.
   - **Expected**: the dialog offers Show first 50,000 / Show all / Cancel.
   - **Expected**: "Show first 50,000" renders 50,000 and says so.

## Automated coverage (Constitution IX)

| Layer | Suite | Covers |
|---|---|---|
| Unit | `tests/core/sql-*.test.ts`, `result-crs.test.ts`, `history.test.ts` | Scanner (strings, comments, dollar quotes, cursor), classifier (every allowed and refused row of statement-policy.md), error parsing (all research §8 samples), CRS precedence, history cap and de-duplication |
| Browser | `tests/web/specs/query*.spec.ts`, plus accessibility additions | Scenarios 1–7 in the real web build; the engine lockdown called directly; axe with the panel open, the dialog open and an error shown |
| Extension | `tests/vscode-ext/src/suite/query.test.ts` | Run, error, refuse and cancel through the test hooks; output-channel lines; history across reopen; default-query parity with spec 001 for every format in the 001 format matrix (SC-002) |

## Results (T050, measured 2026-10-10)

Windows 11, production builds. The web numbers come from headless Chromium, which uses SwiftShader software WebGL, so map-side timings are pessimistic. The VS Code numbers come from the `@vscode/test-electron` suite.

| Criterion | Target | Web | VS Code | How |
|---|---|---|---|---|
| SC-001: filtering query on the ~10 MB file (22,000 parcels, 10.41 MB), ≤ 1,000 rows | < 1 s | **122 ms** (Run → result status and map redrawn) | **62–94 ms** (3 runs; Run → result reported, polled every 25 ms) | `performance.spec` "SC-001 (spec 002)"; `query.test.ts` "Spec 002 timings" |
| SC-004: cancel a running query | < 3 s | **120 ms** (button), **104 ms** (Esc) | **112 ms** | `query-cancel.spec`; `query.test.ts` cancel test (`TIMING` log lines) |
| SC-003: invalid-query test set names the specific problem | 100% | **7 / 7** | Parser and refusal paths covered | `query-errors.spec` "every error class in the SC-003 set" |
| SC-002: default-query parity with spec 001 | identical | n/a | **10 / 10 formats** | `query.test.ts` parity tests |
| SC-007: history across reopen, per file | 100% | pass | pass | `query-history.spec`, `query.test.ts` US5 |

The SC-003 set covers a statement-keyword typo (`SELEC`), a syntax error (`SELECT * FORM layer`), an unknown column, an unknown table, an unknown function, a VARCHAR + INTEGER type error and an invalid geometry literal. Every case keeps the previous result (8 rows). Measuring it found one gap, now fixed: a typo in the first word used to get the generic "This statement isn't supported". It now gets `"SELEC" isn't a SQL statement keyword. Did you mean SELECT?` (statement-policy.md). It is still refused before reaching the engine.

## Definition of done

- [x] Scenarios 1–7 pass in both shells (SC-006). They are covered by the web `query*.spec` files and the VS Code `query.test.ts` suite; see Results.
- [x] SC-001 (< 1 s filtering query on ~10 MB) and SC-004 (cancel < 3 s)
      measured, not eyeballed (see Results).
- [ ] All spec 001 suites still pass, with the table-row expectations
      updated for the invalid-geometry amendment.
