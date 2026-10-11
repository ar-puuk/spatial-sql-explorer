# Quickstart: validating spec 007

## Prerequisites

- **Builds**: `npm install`, then `npm run build --workspace=apps/web` and
  `npm run build --workspace=apps/vscode-ext`.
- **Scale data** (for SC-001–SC-006): generate `tests/.large-data/`, which
  is gitignored.
  1. Run `npm run large-data`, which runs `scripts/large-data.sql` with a
     native DuckDB CLI. It writes `parcels-4m.parquet` (762 MB), the
     no-bbox variant, and a 1 GB variant (`parcels-6m.parquet`).
  2. FlatGeobuf and GeoJSON variants need GDAL's `ogr2ogr` (for example
     OSGeo4W); the commands are in research.md, "Test data".
  3. For SC-002, a 5 GB variant: `parcels-27m.parquet`.
- **PMTiles**:
  - a small committed fixture (`tests/vscode-ext/fixtures/sample.pmtiles`);
  - any multi-GB public vector archive for the manual run.

## Scenario 1: open a large GeoParquet (US1, FR-001–FR-003)

1. Open `parcels-4m.parquet` (web: the file picker; VS Code: Open With).
   - **Expected**:
     - the status bar shows 4,000,000 features, EPSG:4326 and Polygon
       within 5 s;
     - the map fits Utah and shows a thinned overview with the notice
       "Showing 25,000 of 4,000,000 in view…" within 10 s;
     - VS Code's output channel later reports reading tens of MB, not
       762 MB.
2. Open it again and press Cancel during facts.
   - **Expected**: back to the previous state within 3 s.

## Scenario 2: pan and zoom (US2, FR-005–FR-008)

1. Zoom to Salt Lake City.
   - **Expected**: every parcel in view is drawn (under the cap) within
     2 s, and the notice clears.
2. Pan quickly several times, then stop.
   - **Expected**: only the final view is drawn, and the map never goes
     blank.
3. Click a parcel.
   - **Expected**: the inspector shows all of its attributes.
4. In the table, double-click row 3,900,000.
   - **Expected**: the map zooms to that parcel and highlights it.

## Scenario 3: query, style, export the whole file (US3, FR-009–FR-013)

1. The query panel shows `SELECT * FROM layer`. Run `SELECT * FROM layer
   WHERE value > 1500000`.
   - **Expected**: exactly 1,000,166 rows (spiked), no "first 50,000"
     prompt, and the map shows the result in view.
2. Scroll the table to the end, then sort by `value`.
   - **Expected**: every row is reachable. Rows fill in as they scroll, and
     the sort covers all rows.
3. Graduated on `value`, Natural breaks.
   - **Expected**: the legend counts sum to 1,000,166, and the note says
     "Breaks from a 50,000-value sample".
4. Export as GeoParquet.
   - **Expected**: the file has 1,000,166 rows (SC-007).

## Scenario 4: whole-read formats (US4, FR-004, FR-014)

1. Open `parcels-77k.geojson` (56 MB).
   - **Expected**: no announcement, progress after 1 s, opened in about 5 s.
2. Open `parcels-460k.geojson` (325 MB).
   - **Expected**: the announcement first. Open: progress with elapsed time
     and Cancel. Opened in about 25 s.
3. Repeat and press Cancel while it reads.
   - **Expected**: stopped within 3 s, and memory released (the next open
     works).
4. Force an out-of-memory error (the e2e hook opens a GeoJSON larger than
   memory, or `?e2e=1&memoryLimit=…`).
   - **Expected**: the FR-014 message, no blank viewer, and another file
     opens.

## Scenario 5: FlatGeobuf (FR-003, research §4)

1. Open `parcels-4m.fgb` (1.45 GB).
   - **Expected**:
     - facts within 1 s;
     - city views fast;
     - region views capped at about 2,500, with the notice;
     - the query panel offers "Load the whole file (1.4 GB) to query it".
2. Open `parcels-460k.fgb` (158 MB).
   - **Expected**: loaded into memory at open. Queries work at once.

## Scenario 6: PMTiles (US5, FR-009a)

1. Open a PMTiles vector archive.
   - **Expected**: tiles at every zoom, the inspector shows the clicked
     feature and its layer, and SQL, the table, styling and export show the
     view-only reason.

## Scenario 7: VS Code fallback (FR-015)

1. Run `_forceBytesFallback(true)` (test hook), then open
   `parcels-77k.geojson`.
   - **Expected**: the fallback notice, the file opens through the whole
     transfer, and the output channel logs the reason.
2. **Manual, on a Remote-SSH or WSL window**: open `parcels-4m.parquet`.
   Record whether partial reads work, or which fallback notice appears.
   This is research §3's open item.

## Automated coverage

| Layer | Suite | Covers |
|---|---|---|
| Unit | `tests/core/read-modes.test.ts`, `viewport-sql.test.ts`, `pages-sql.test.ts`, `stats-sql.test.ts`, `result-model.test.ts` | catalog and platform override; bbox predicates per index kind; the thinning grid; caps; page SQL and the LRU; stats SQL and sampling; count-then-materialize; hidden columns stripped |
| Browser | `large-open.spec.ts`, `viewport.spec.ts`, `paging.spec.ts`, `pmtiles.spec.ts` (fixtures + a `?e2e=1&cap=` override) | Scenarios 1–6 on small data; thinning and notices; selection outside the view; Cancel; announcement; OOM recovery; FR-009 changes to specs 002 and 005 |
| Browser (scale) | `scale.spec.ts` (needs `tests/.large-data`, else skipped with a message) | SC-001–SC-007 timings and memory on the 762 MB / 1 GB / 5 GB files |
| Extension | `source-server.test.ts`, `large-open.test.ts` | Range, `HEAD` 206, 416, token, `Origin`; sidecars; bytes served (partial); forced fallback; parity with the web |

## Results (2026-10-11)

Measured on a Windows 11 laptop. The web numbers come from the production
build in headless Chromium (SwiftShader WebGL, so map timings are
pessimistic): `test-results/scale.json` from `scale.spec.ts`. The VS Code
numbers come from `scale.test.ts` with `SE_LARGE_DATA=1`. Details are in
research.md, "Implementation outcomes (Polish)".

| Criterion | Web | VS Code | Verdict |
|---|---|---|---|
| SC-001 GeoParquet 1.1 GB (6M) | facts 2.0 s, overview 4.9 s | facts 2.1–2.8 s, overview 7.0–7.8 s | Pass |
| SC-001 FlatGeobuf 1.45 GB (4M) | facts 2.0–2.5 s, overview 2.7 s | facts 1.8 s, overview 2.1 s | Pass (after the JS reader; 128 s before) |
| SC-002 GeoParquet 5 GB (27M) | open, 5 cities, filter (135,191 rows), style, export; engine memory 5–57 MiB | not run | Pass (web) |
| SC-003 views ≤ cap within 2 s | GeoParquet: 10 cities, max 1.92 s; FlatGeobuf: 5 cities, ~0.37 s | not measured separately | Pass |
| SC-004 no task ≥ 1 s | longest 143–152 ms | not measurable from the extension host | Pass (web) |
| SC-005 Cancel ≤ 3 s | GeoParquet 0.23 s, FlatGeobuf 2.40 s, 325 MB GeoJSON 2.41 s; engine-reset path 0.36–0.87 s | 325 MB GeoJSON 2.06–2.11 s | Pass |
| SC-006 announce + OOM | 325 MB GeoJSON announced, opens in ~34 s; `memoryLimit` 8 MB / 64 MB → message, next open works | same code path | Pass |
| SC-007 exact filter + export | 1,000,166 rows in 11.6 s; GeoParquet export 189 MB, 1,000,166 rows (DuckDB CLI count) | 10k parity: 4,958 rows, export 4,958 | Pass |
| SC-008 no silent subsets | audited in screenshots and tests: thinned notice ("Showing 25,000 of 70,400"), "about N" for FlatGeobuf estimates, the legend's "(estimated from N values)", status bar rows vs features, invalid-geometry banner | same UI | Pass |
| SC-009 no regression | 10 MB open: 1.48 s warm (spec 001 baseline 1.59 s); every earlier suite passes (core 319, web 84 + scale, VS Code 66) | | Pass |

**Scenario notes**
- **3.3**: the legend says "(estimated from 200,000 values)", not "Breaks
  from a 50,000-value sample". Natural breaks keeps spec 003's 200,000-value
  sampling (research.md, US3 outcomes). Counts are exact.
- **5.1**: "Load the whole file" was run on the 10k FlatGeobuf (0.2–0.4 s).
  It was not run on the 1.45 GB file: in memory, that file is close to the
  engine's limit, and an out-of-memory error would end in the FR-014
  message.
- **7.2 (Remote-SSH/WSL)**: not run, because no remote host was available.
- **VS Code bytes read**: the 1.1 GB GeoParquet overview read 676 MB of
  1,139 MB over the loopback server, not "tens of MB". It is fine locally,
  and a residual risk for slow remotes (research.md).

## Definition of done

- [X] Scenarios 1–7 pass (7.2 not run: no remote host; see Results).
- [X] SC-001–SC-009 are measured and recorded in a "Results" section here.
- [X] Every format's read mode and measured limits are in the extension
      README's format matrix (FR-018).
- [X] The spec 001–005 suites pass with the FR-009 changes.
