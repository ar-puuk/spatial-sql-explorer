# Phase 0 Research: Spatial SQL Query (002)

All findings below were measured on the real runtime: DuckDB-WASM **1.32.0**
(pinned in spec 001's housekeeping), which reports **DuckDB v1.4.3**, the
single-threaded `eh` bundle, and the spatial extension loaded from
`extensions.duckdb.org`. The spike ran in Chromium against the web shell's
own `getDuckDb()` through a temporary page that has since been deleted.
Constitution VI: nothing here is taken from documentation alone.

---

## 1. Cancelling a running query

**Decision**: every user statement runs through the **streaming API**,
`connection.send(sql, true)`, consuming record batches. Cancel calls
`connection.cancelSent()`. User queries run on a dedicated connection, so
cancelling never touches the connection that opens files.

**Evidence** (cross join over `range(200000)²`):

| API | Cancel issued after | Outcome |
|---|---|---|
| `send(sql, true)` + `cancelSent()` | 700 ms | rejected with "query was canceled" **6 ms** after the cancel; `SELECT 42` worked right after |
| `query(sql)` + `cancelSent()` | 700 ms | `cancelSent()` returned `false`; the query **ran to completion (85.9 s)** |

The single-threaded worker can only notice a cancel between polls of a
pending query, and only the streaming path polls. **This makes SC-004 (cancel
within 3 s) achievable only through `send`.**

**Alternatives considered**:
- Terminating the worker and re-opening the file. This works on any API, but
  costs a full engine restart and file re-parse (seconds); it remains the
  last resort if a cancel ever fails to land.
- `query()` with a timeout. It can't interrupt anything.

---

## 2. Statement policy (FR-013): engine lockdown plus allowlist

**Decision**: two independent layers.

1. **Engine lockdown, set once per DuckDB instance after spatial is loaded:**
   - `SET allowed_directories = ['/se-source/']`
   - `SET enable_external_access = false`
   - `SET lock_configuration = true`

   Source files are registered under `/se-source/`.
2. **Statement allowlist** in `packages/core`, checked before anything
   executes (§3). It refuses everything not explicitly allowed, with a
   specific message.

**Evidence** with the lockdown applied:

| Statement | Result |
|---|---|
| `SELECT … ST_Area(geom) FROM layer` | ✅ works (spatial stays usable) |
| `CREATE TEMP TABLE … AS SELECT ST_Buffer(…)`, `CREATE TEMP VIEW`, `DROP VIEW` | ✅ work |
| `ST_Read('/se-source/usa.gpkg')`, and a VIEW over it | ✅ work (GDAL also probes `/se-source/usa.*`) |
| `COPY … TO '/tmp/out.csv'` | ⛔ Permission Error |
| `read_csv('https://…')`, `read_csv('/se-source/../tmp/x.csv')` | ⛔ Permission Error (path traversal blocked) |
| `LOAD httpfs` | ⛔ Permission Error |
| `SET threads = 2`, `RESET enable_external_access` | ⛔ configuration locked |
| `INSERT INTO layer …` when `layer` is a VIEW | ⛔ "layer is not a table" |
| `INSTALL httpfs` | ⚠️ **not blocked** (silently succeeds) |
| `ATTACH ':memory:' AS other` | ⚠️ **not blocked** |
| `COPY … TO '/se-source/evil.csv'` | ⚠️ **not blocked** (writes to the in-memory virtual FS only, never to disk) |

The lockdown alone is not enough (INSTALL, ATTACH, and COPY into the
allowed directory get through), and the allowlist alone is a parser that
could have gaps. Together, each covers the other's holes.

**Implementation finding (T008)**: DuckDB **autoloads** some extensions on
first use, e.g. `parquet` on the first `read_parquet()`. The lockdown
correctly refuses that autoload ("Extension Autoloading Error"), and the
spec 001 format matrix failed for all three Parquet fixtures. `parquet` is now
installed and loaded explicitly before the lockdown. Any other
autoload-dependent function a user calls (e.g. from `json` or `icu`) fails
with the engine's clear autoloading message rather than silently going to
the network. That is accepted, and listed for review if users hit it.

**Alternatives considered**:
- `allowed_paths = ['/se-source/<file>']`. Fails, because GDAL opens
  `/se-source/<name>.*` to look for sidecar files.
- Read-only only, with no temp tables. Rejected by the user's FR-013 answer.

---

## 3. Splitting and classifying statements

**Decision**: a small SQL scanner in `packages/core/src/sql/`, unit-tested,
with no dependencies.

- **Tokenizes** around `--` and nested `/* */` comments, `'…'` strings (with
  `''` escapes), `E'…'`, `$tag$…$tag$` strings, and `"…"` identifiers.
- **Splits** on top-level `;`. The statement to run is the selection if any,
  otherwise the statement containing the cursor (FR-004).
- **Classifies** each statement by its leading keyword(s):

  | Class | Statements |
  |---|---|
  | **read** | `SELECT`, `WITH` (only if it ends in a query; any top-level `INSERT`, `UPDATE`, `DELETE`, `MERGE` or `COPY` makes it refused), `FROM` (DuckDB FROM-first), `VALUES`, `TABLE`, `PIVOT`, `UNPIVOT`, `DESCRIBE`, `SHOW`, `SUMMARIZE`, `EXPLAIN [ANALYZE]` |
  | **temp DDL** | `CREATE [OR REPLACE] TEMP\|TEMPORARY TABLE\|VIEW <name> …`; `DROP TABLE\|VIEW [IF EXISTS] <name>`. Refused when `<name>` is `layer`, the file-name alias, or any `__se_*` internal object. |
  | **refused** | everything else, with a specific reason. Examples: `CREATE TABLE` without `TEMP` ("use CREATE TEMP TABLE: objects live only in this viewer"), `COPY` ("exporting is not available yet"), `INSTALL`/`LOAD`/`ATTACH`/`SET`/`PRAGMA`/`CALL`, and DML. |

**Rationale**:
- DuckDB-WASM exposes no statement-type API.
- `json_serialize_sql()` only accepts `SELECT`.
- A leading-keyword allowlist over a correct tokenizer is small, fully
  testable, and fails closed.

**Alternatives considered**:
- A full SQL parser dependency, e.g. `node-sql-parser`. It's heavy, and its
  dialect doesn't match DuckDB's (FROM-first, `PIVOT`, `SUMMARIZE`).
- Regex over raw text. Breaks on strings and comments.

---

## 4. Result CRS (FR-014)

**Finding**: in DuckDB v1.4.3, `GEOMETRY` carries **no CRS**.
- `DESCRIBE` of `ST_Read` output, of a materialized table, and of
  `ST_Transform(...)` results all report a plain `GEOMETRY`.
- `ST_SRID` doesn't exist.

The engine cannot tell us which CRS a result's geometry is in. (The DuckDB
CLI 1.5.6 used during spec 001 *does* type `GEOMETRY('EPSG:…')`. That is a
newer DuckDB than the pinned WASM.)

**Decision**: the result CRS is tracked by the app, in this order:

1. **Explicit user override**: a "Result CRS" chip in the query area
   (`EPSG:<code>` input, or "same as layer").
2. **Engine-reported CRS**: used when the runtime types `GEOMETRY('EPSG:x')`,
   so a future DuckDB-WASM upgrade gets this for free.
3. **Extent check**: when the layer CRS is projected but the result's extent
   fits in lon/lat bounds (±180/±90) and the layer's own extent does not, the
   result is treated as **EPSG:4326** (the common `ST_Transform(geom, …,
   'EPSG:4326')` case). The chip shows "detected".
4. **Otherwise the layer's CRS**, stated on the chip.

Display reprojection reuses spec 001's `reprojectToWgs84Sql`, which is
`ST_Transform(…, always_xy := true)`.

**Alternatives considered**:
- Parsing `ST_Transform` targets out of the query text. Brittle: aliases,
  CTEs, nesting.
- Always assuming the layer CRS. Silently misplaces correctly transformed
  results.

---

## 5. Executing a query and building the result

**Decision**:

- **Queries** (`SELECT`, `WITH`, `FROM`, `VALUES`, `TABLE`, `PIVOT`,
  `UNPIVOT`), on the query connection, all cancellable:
  1. Materialize with `CREATE OR REPLACE TEMP TABLE __se_result AS` followed
     by a **newline** and the user statement. The newline keeps the engine's
     `LINE n` numbering mappable to the editor: user line = n - 1. This is
     spec 001's parse-once lesson: the query executes **once**, however many
     passes follow.
  2. `DESCRIBE __se_result` to find the `GEOMETRY` columns. The first one is
     mapped; the others are shown as text (`ST_AsText`, truncated) in the
     table.
  3. One aggregate gives row count, mapped count, invalid count, extent (in
     the result CRS) and geometry types.
  4. Apply the FR-012 threshold of **50,000 rows**. Above it, the UI asks
     Show all / Show first 50,000 / Cancel before any rows are fetched.
  5. Stream the rows with `send`: attributes, plus `ST_AsGeoJSON` of the
     reprojected primary geometry. Batches are converted with a yield to the
     event loop between them (GeoLibre's post-launch fix #2858 for UI
     freezes), and progress is shown.
- **Utility statements** (`DESCRIBE`, `SHOW`, `SUMMARIZE`, `EXPLAIN`) cannot
  be the body of a CTAS. They are streamed directly into a table-only result.
- **Temp DDL** is executed. The query area reports "Created temp table
  `buffers` (1,204 rows)". The completion catalog is refreshed and the
  displayed result is unchanged.

**The `layer` view.** `layer` (and the file-name alias) is a **VIEW** with
spec 001's attribute rules applied:
- the source geometry is exposed as `geom`, in the original CRS (FR-014);
- GDAL's `OGC_FID` is dropped;
- GeoPackage's `fid` is kept.

It sits over:
- an internal materialized table for files up to 64 MB (spec 001's
  parse-once rule);
- the reader directly for larger files, which stays readable thanks to
  `allowed_directories`.

Being a view, it refuses writes by itself (§2).

**Invalid geometry in results** (spec amendment, see plan "Spec
amendments"):
- Rows whose geometry is NULL or invalid now **stay in the table** and are
  skipped on the map with a count ("180 rows · 179 mapped").
- Spec 001 removed them from the table. In a query tool, silently dropping
  rows the user selected would misrepresent the result.

**Alternatives considered**:
- Running the user query once to count and again to fetch. Doubles the work
  and can differ between runs.
- Wrapping with `SELECT … FROM (<user query>)` without materializing. The
  same double execution.

---

## 6. Editor component

**Decision: CodeMirror 6** (`@codemirror/view`, `state`, `commands`,
`language`, `autocomplete`, `lang-sql`, `@lezer/highlight`; all MIT).

- **Measured size**: a bundle with line numbers, history, bracket matching,
  SQL highlighting, autocomplete and keymaps is **379 KB minified, 126 KB
  gzipped**. The current webview `main.js` is 1.27 MB; the engine is a
  33 MB wasm.
- **No workers and no injected stylesheets.** It works under the existing
  webview CSP. Its DOM styling takes the `--se-*` CSS variables directly,
  unlike canvas.
- **Accessibility**: an accessible contenteditable with ARIA, plus the
  keyboard model required by Constitution VII.

**Theming**: VS Code doesn't expose its token colors to webviews, so syntax
colors come from the closest theme variables that do exist:

| Syntax element | VS Code variable |
|---|---|
| keywords | `--vscode-symbolIcon-keywordForeground` |
| strings | `--vscode-symbolIcon-stringForeground` |
| numbers | `--vscode-symbolIcon-numberForeground` |
| functions | `--vscode-symbolIcon-functionForeground` |
| operators | `--vscode-symbolIcon-operatorForeground` |
| comments | `--vscode-descriptionForeground` |

The editor surface uses `--vscode-editor-*` (background, foreground,
selection, cursor, line numbers, find match). The web shell maps the same
`--se-sql-*` tokens to the brand palette.

**Measured in the product (T021)**: the webview `main.js` went from
1,331,711 to 1,754,640 bytes (+423 KB minified). That is the editor plus lint
plus the new query code, in line with the 379 KB estimate.

**Alternatives considered**:
- **Monaco**, the VS Code editor. Several MB plus language workers, which
  need `worker-src` and style-injection exemptions in the webview CSP, and
  it doesn't follow the host theme when embedded. Rejected (Constitution X).
- **A native `.sql` document.** CLAUDE.md says "embedded SQL editor first; a
  native .sql document is a later option". It also wouldn't exist in the web
  shell.

---

## 7. Autocomplete from the live catalog (FR-015)

**Decision**: a catalog snapshot queried from the engine, rebuilt after open
and after temp DDL:

- **Tables, views and columns**: `duckdb_tables()`, `duckdb_views()` and
  `duckdb_columns()` (non-internal, with types). `__se_*` objects are
  hidden.
- **Functions**: `duckdb_functions()`, giving every overload's parameters,
  return type and description. The spike counted **157 distinct `ST_*`
  functions**, e.g. `ST_Area(geom) → DOUBLE`, "Compute the area of a
  geometry…". Spatial functions are ranked first. The description and
  signature appear in the completion's info panel.
- **Keywords**: `duckdb_keywords()` (489 entries).

These feed CodeMirror's SQL `schema` option (table to column completion)
plus a custom function source.

---

## 8. Error messages and positions (FR-008)

**Format observed:**

```
Parser Error: syntax error at or near "layer"

LINE 2: FORM layer
             ^
```

- **Shape**: the first line is `<Type> Error: <message>`, then optional
  hints ("Candidate bindings: …", "Did you mean …"), then `LINE n:`, an echo
  of the line, and a caret line.
- **Duplication**: syntax errors repeat the LINE block, which must be
  de-duplicated.
- **Column**: the caret's column minus the `LINE n: ` prefix width.

**Decision**: `parseEngineError()` in `packages/core` returns
`{ kind, message, hints[], position?: { line, column } }`.
- The position is mapped back through the CTAS newline offset (§5) and the
  statement's offset in the editor, then marked with a CodeMirror
  diagnostic.
- "Did you mean" hints that point at engine internals (`pg_*`, `duckdb_*`,
  `list_aggregate`, …) are dropped as noise. In the spike they did, e.g. for
  `ST_Aera` and for the missing table.

---

## 9. Query history persistence (FR-016)

**Decision**:
- Stored through spec 001's `HostAdapter.loadState`/`saveState` (VS Code
  `globalState`, web `localStorage`), keyed per file by a new
  `OpenedFileRef.stateKey`:
  - VS Code: the document URI;
  - web: name + size + lastModified, since the browser offers no path.
- Up to 20 entries: text, ISO time, outcome (row count or error summary),
  newest first.
- Text-only, local-only (FR-018).

---

## 10. Where query timings go (FR-010)

**Decision**: add optional `HostAdapter.log(line)`.
- VS Code: the "Spatial Explorer" output channel (the same channel spec 001
  logs opens to).
- Web: no-op.

The query area always shows the duration and row count itself.

---

## Residual risks

| Risk | Mitigation |
|---|---|
| A crafted statement slips past the allowlist | The engine lockdown still blocks file, network, extension and settings access (§2), and both layers have tests. |
| "Show all" on a multi-million-row result exhausts memory | Confirmation first. If it still fails, catch it, show a clear message, and keep the previous result. Viewport loading is a later slice. |
| The extent heuristic misjudges a result CRS | The chip always states the assumed CRS and can be overridden (§4). |
| A future DuckDB-WASM types `GEOMETRY` with a CRS | Picked up automatically at precedence step 2 (§4). |
