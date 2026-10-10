# Phase 0 Research: Quick Look (001)

This document resolves the four spikes `plan.md`'s Technical Context gates on,
plus the monorepo layout question left open after inspecting `../omx-viewer`.
Per the constitution's Verified Claims principle, nothing here is accepted as
"supported" from documentation alone where a hands-on check was possible —
and where a hands-on check was NOT fully possible in this environment, that
limitation is stated explicitly rather than glossed over, with a concrete
follow-up task identified.

## 0. Monorepo layout vs. `../omx-viewer`

**Decision**: `apps/web`, `apps/vscode-ext`, `packages/core`, `packages/ui` (as
CLAUDE.md specifies), diverging from omx-viewer's single `packages/engine`.

**Rationale**: omx-viewer was inspected directly (`../omx-viewer/apps/*`,
`../omx-viewer/packages/engine`). Its layout is `apps/web`, `apps/vscode-ext`,
`packages/engine` — one shared package containing services, Svelte components,
state, and workers together, with no `vscode`/File API leakage into it (it
receives bytes via a HostAdapter-shaped message protocol, not a formalized
interface). For Spatial Explorer, CLAUDE.md's constitution-enforced
host-agnostic boundary (Principle II) is stricter and lint-enforced, and the
product has a materially larger shared surface (map state, SQL catalog,
styling, basemap catalog) that benefits from separating pure logic
(`packages/core`: HostAdapter contract, DuckDB queries, CRS handling, basemap
catalog data) from presentation (`packages/ui`: Svelte components). Matching
omx-viewer's monorepo *tooling* conventions (npm workspaces, Vite, esbuild for
the extension host, Svelte 5 + strict TypeScript) while diverging on this one
internal package boundary is the smaller deviation.

**Alternatives considered**: Copy omx-viewer's single `packages/engine`
structure exactly. Rejected because it would make the lint rule in Principle
II harder to scope (one package mixing core logic and Svelte UI either has to
allow `vscode`-adjacent imports somewhere inside it, or the rule has to reason
about file subpaths instead of package boundaries).

## 1. Format support in the WASM spatial build

**Decision**: Target format list for spec 001 is GeoJSON, GeoParquet,
FlatGeobuf, GeoPackage, Shapefile, GML, and MapInfo TAB via DuckDB spatial's
`ST_Read`/`read_parquet`, **except** GeoPackage is treated as "likely
supported for read, NOT to be trusted without a live spike" and the first
implementation task (T001, see tasks.md) must run `ST_Drivers()` and a
per-format `ST_Read` smoke test against the real browser/webview WASM bundle
before any format is documented as working in user-facing copy.

**Rationale / Evidence gathered**:
- DuckDB's spatial extension's `ST_Read` table function is GDAL-backed and
  documented to read "dozens" of vector formats; `ST_Drivers()` is the
  documented, authoritative way to enumerate which GDAL drivers are actually
  compiled into a given build — this is exactly the mechanism Phase 0's spike
  task should run against the real WASM bundle. ([DuckDB spatial GDAL docs](https://duckdb.org/docs/current/core_extensions/spatial/gdal.html))
- DuckDB-WASM specifically is documented to support GeoParquet, FlatGeobuf,
  GML, DXF, TAB (MapInfo), on top of general spatial SQL — this is
  browser/WASM-specific documentation, not just native DuckDB. The spatial
  extension bundles its own GDAL, so the WASM build's driver set can be a
  *subset* of a system GDAL install's.
- **Real production counter-evidence on GeoPackage**: GeoLibre (opengeos/GeoLibre,
  cloned to `../_refs/GeoLibre` for this project) ships the same DuckDB-WASM +
  MapLibre stack and, per its own format-support documentation
  (`docs/tutorials/supported-formats-en.md`), explicitly does **NOT** use
  DuckDB for `.gpkg` — it reads GeoPackage via `sql.js` (SQLite WASM) instead,
  because "DuckDB-WASM cannot write GeoPackage" and because of
  "`gpkg_ogr_contents`" repair needs. This is a real engineering team's lived
  experience with the exact stack this project is adopting, not a documentation
  gap — it is the strongest signal we have that GeoPackage read support via
  DuckDB-WASM specifically (as opposed to native DuckDB) is the single riskiest
  format claim in spec 001's FR-018, and a non-DuckDB (sql.js) fallback reader
  is the documented contingency if the spike finds it unreliable.
- A from-scratch hands-on spike was attempted in this environment: `@duckdb/duckdb-wasm`'s
  Node (`duckdb-node-mvp`) bundle was installed and driven directly to run
  `INSTALL spatial; LOAD spatial; SELECT * FROM ST_Drivers();` and per-format
  `ST_Read`/`COPY ... WITH (FORMAT GDAL, DRIVER ...)` round trips. This did
  **not** complete: DuckDB-WASM's worker scripts are written against a
  browser-Worker global shape (`self`, `importScripts`, `postMessage` as a
  global), and neither the `web-worker` npm shim (hits a confirmed Windows-only
  bug: it reparses an absolute Windows path like `C:\...` through
  `path.posix.normalize` + `new URL()`, and the `C:` drive letter is
  misread as a URL scheme) nor raw `node:worker_threads` (lacks the
  `addEventListener`-based `EventTarget` shape `AsyncDuckDB` expects, and the
  worker script itself assumes browser-Worker globals that don't exist in a
  raw worker thread) could host it cleanly from this native-Windows dev
  machine without deeper, out-of-scope tooling work. **This is a tooling
  limitation of testing DuckDB-WASM outside a real browser/webview on Windows,
  not a finding about the product's actual runtime** — the shipped product
  only ever instantiates DuckDB-WASM inside a real Chromium-based webview or
  browser tab, where the worker globals this library assumes are genuinely
  present. It does, however, reinforce that DuckDB-WASM's worker
  instantiation is a genuinely fragile part of this stack worth a dedicated,
  real-webview spike task rather than assuming it "just works" (see Spike 4).

**Follow-up task**: T001 in `tasks.md` runs `ST_Drivers()` plus a per-format
`ST_Read` smoke test inside an actual browser (or the real VS Code webview)
against one sample file per candidate format, and records pass/fail per
format in this file before FR-018's claims are relied upon by later tasks.

**Alternatives considered**: Hard-code the format list to only
GeoJSON+GeoParquet+FlatGeobuf (the three GeoLibre explicitly routes through
DuckDB with no caveats). Rejected for now because it's narrower than what the
user asked this spec to support ("everything DuckDB's spatial extension can
read natively") — T001 will narrow the list for real once it has verified
evidence, rather than this document guessing further.

## 2. Range reads / lazy loading in VS Code webviews (incl. Remote-SSH)

**Decision**: Design for range reads as an optimization, but do NOT block
spec 001 (small ~10MB files, per the clarified size target) on proving them.
Treat full verification as a Phase-2-or-later concern tracked as a research
gap, consistent with Part 3 of the handoff doc.

**Rationale**: Web search for VS Code's webview local-resource serving
(`asWebviewUri` + `localResourceRoots`) and HTTP Range support did not turn up
a definitive, current statement either way, and this can only be conclusively
answered by an actual running extension host (ideally also under Remote-SSH),
which is out of reach of this environment. Since spec 001's clarified scope is
small files loaded whole (~10MB / ~2s), nothing in the vertical slice
*requires* range reads to work. The performance rule in CLAUDE.md
("prefer range reads... VERIFY first (spike)") remains correctly deferred: it
matters once large-file handling becomes in-scope (a later hardening pass),
not for this slice.

**Related, resolved finding (binary transfer, not range reads specifically)**:
VS Code's `Webview.postMessage()` has supported efficient `ArrayBuffer`/
`TypedArray` transfer (correctly reconstructed on the receiving side, not
JSON-stringified) since VS Code 1.57+, **for `WebviewPanel`** (which
`customEditors` use) — this is current, not a Remote-SSH-only concern.
However, `../omx-viewer`'s own shipped extension (`src/extension.ts`)
explicitly does NOT rely on this: it empirically found `postMessage` did not
preserve typed arrays as expected and ships a base64-chunked transfer instead
(chunked to avoid V8's ~512MiB max string length on large files). This is a
direct conflict between official documentation and one team's tested,
shipped behavior on the exact same message-passing boundary this project will
use. **Do not assume binary postMessage works without testing it against the
specific VS Code engines version this project targets** — this is exactly the
kind of claim Principle VI (Verified Claims) exists for.

**Alternatives considered**: Block spec 001 until range reads are proven.
Rejected — it would gate the thinnest possible vertical slice on a capability
the slice's own clarified scope (small files) doesn't need yet.

## 3. Spatial extension delivery (bundled vs. CDN) and VSIX size

**Decision**: Bundle the DuckDB spatial extension's `.duckdb_extension` wasm
file inside the VSIX and serve it via a webview-local resource URI (not the
default CDN fetch), so the extension works offline and under restrictive CSP
(`connect-src`) / air-gapped environments, consistent with the Local-First
principle.

**Rationale**:
- DuckDB-WASM's extension loading model: `INSTALL` is a no-op (no durable
  cross-session storage in WASM), and `LOAD` fetches, verifies, and
  dynamically `dlopen`s the extension's `.wasm` file. By default this fetch
  goes to DuckDB's extension CDN, which requires network access and an
  explicit `connect-src` CSP allowance — undesirable for a local-first,
  possibly offline/air-gapped VS Code extension.
- `@duckdb/duckdb-wasm` supports pointing extension loading at a custom
  base URL/path instead of the default CDN (confirmed indirectly: GeoLibre's
  own deployment docs document a `VITE_DUCKDB_SPATIAL_EXTENSION_PATH` build-time
  env var specifically so intranet/offline deployments can point the spatial
  extension fetch at an internal mirror "no rebuild required" — i.e. this is a
  known, supported override point in the DuckDB-WASM ecosystem, not a one-off
  hack). The VS Code extension should set this to a `webview.asWebviewUri()`
  path into its own bundled copy of the extension file.
- **VSIX size budget, real reference point**: omx-viewer's entire shipped
  webview bundle (`apps/vscode-ext/dist-webview`) is ~4.9MB today, dominated
  by one HDF5 chunk (~4.6MB). DuckDB-WASM's core JS is small (~194KB min,
  ~44KB gzipped per the published package), but the `duckdb-mvp.wasm` core
  engine and the spatial extension's own `.wasm` file are each independently
  multi-megabyte (tens of MB uncompressed is typical for these; exact current
  sizes were not measured against the pinned dependency version in this
  research pass). MapLibre GL JS adds a few hundred KB more. **This makes
  total VSIX size a real, not hypothetical, constraint** worth measuring as
  a concrete build-time check (budget + CI gate), not just an aspiration.

**Follow-up task**: a build-time task should measure the actual `.vsix`
size once the spatial extension and MapLibre are wired in, and set a CI size
budget/alert from that measured baseline rather than a guessed number.

**Alternatives considered**: Rely on the default CDN fetch for the spatial
extension (simplest). Rejected as the default because it silently breaks
offline/air-gapped use and requires widening webview CSP `connect-src` to an
external host, which conflicts with the Local-First principle unless the user
explicitly opts into CDN delivery as a fallback.



## 4. Worker bootstrapping and CSP in a VS Code webview

**Decision**: CSP shape is settled (reuse `../omx-viewer`'s shipped policy).
Worker bootstrapping is **NOT settled** — it is a confirmed, reproduced
blocker. T005 was executed for real, three times, against an actual VS Code
instance, and none of the three attempts got DuckDB-WASM running inside the
webview. **This blocks T009 and all of US1's webview-dependent work until
resolved; do not build on top of it.**

**How T005 was actually run**: `tests/vscode-ext` was built as a real
`@vscode/test-electron` integration test, not a manual/GUI spike. It launches
an actual VS Code Extension Development Host, opens a sample `.geojson`
fixture via `vscode.openWith` against the real `spatialExplorer.editor`
custom editor (`apps/vscode-ext/src/extension.ts`, built with esbuild) and
the real Vite-built webview bundle (`apps/vscode-ext/src/webview/main.ts`,
including the actual `@duckdb/duckdb-wasm` npm package and its real `mvp`
worker + wasm files, copied into `dist-webview/duckdb/` by
`scripts/copy-duckdb-wasm.js`). The webview reports its result back to the
extension host via a `spikeResult` postMessage, retrievable by the test
through a `spatialExplorer._getSpikeResult` command (needed because the test
runs in the extension host process, which cannot directly observe the
webview's renderer-process postMessage traffic). This test is committed at
`tests/vscode-ext/src/suite/workerBootstrap.spike.test.ts` and can be re-run
with `npm run test --workspace=tests/vscode-ext`.

**Attempt 1 — plain `new Worker(webview.asWebviewUri(...))`**: not the
`import.meta.url` pattern omx-viewer found broken — this is the "obvious
fix" of using the correctly-resolved webview resource URI instead. **Result:
fails immediately**, with a real, captured browser-level error:

```
SecurityError: Failed to construct 'Worker': Script at
'https://file+.vscode-resource.vscode-cdn.net/d%3A/GitHub/spatial-sql-explorer/apps/vscode-ext/dist-webview/duckdb/duckdb-browser-mvp.worker.js'
cannot be accessed from origin
'vscode-webview://02o4of8gklgqjmkm3caaqjt556c7ctr8h26671bnm1508cs469ii'.
```

This proves the risk flagged from omx-viewer's analogy generalizes: it is
not specific to `import.meta.url`-style URL construction — any absolute
cross-origin URL fails classic Worker construction in a VS Code webview,
because the webview document's origin (`vscode-webview://<uuid>`) and the
origin VS Code serves local resources from
(`vscode-resource.vscode-cdn.net`) are never the same, regardless of how the
URL was obtained.

**Attempt 2 — fetch the worker script as text, construct from a `blob:`
URL** (the standard cross-origin-worker workaround, and also the first thing
omx-viewer tried before their fetch failed with "Failed to fetch"): the
fetch and the blob Worker construction both succeeded this time —
`fetched worker script (839642 bytes)` and `blob Worker constructed OK` were
both observed. This is new information beyond omx-viewer's experience: with
the CSP's `connect-src ${csp}` directive explicitly present (added for this
spike) and a correctly asWebviewUri-resolved URL (not a baked dev-time
`import.meta.url` path), the fetch that failed for omx-viewer succeeds here.
**However, instantiating DuckDB-WASM through that worker still did not
complete** — `db.instantiate(duckdbWasmUrl)` never resolved or rejected
within the test's wait window, with no worker `error` event fired either.

**Attempt 3 — also fetch the 41MB wasm module on the main thread and hand
the worker a `blob:` URL for it too** (eliminating the worker's own
cross-origin fetch of the `.wasm` file as a variable, since blob: URLs
created on the main thread are resolvable from a same-origin worker):
fetching 41,325,187 bytes of wasm on the main thread via `asWebviewUri`
worked and was fast (local disk, effectively instant). Constructing the blob
URL succeeded. **`db.instantiate()` still did not complete.** Wrapping the
call in an explicit 15-second race timeout confirmed it is a genuine hang,
not a slow-but-working call: `db.instantiate() did not resolve within
15000ms`. A raw `worker.addEventListener("message", ...)` listener was also
attached to catch any traffic AsyncDuckDB's internal protocol might produce
— zero messages of any kind were observed from the worker during the entire
15-second window. The worker neither errored nor responded; it appears to go
silent the moment `instantiate` asks it to do real work (compile/instantiate
the actual WebAssembly module), whereas the worker's outer script clearly
did start running (it received and presumably processed the initial
instantiate command without throwing).

**What this rules in and out**:
- It is **not** a CSP `connect-src`/`worker-src` blocking problem in the way
  initially hypothesized — both main-thread fetches (839KB and 41MB) worked
  fine under the CSP used (`worker-src ${csp} blob: data:; connect-src
  ${csp}`).
- It is **not** a slow-large-file problem — the 41MB wasm fetch was fast;
  the hang is specifically inside `instantiate`, after the worker has the
  bytes.
- It is consistent with either: (a) WebAssembly compilation being silently
  blocked inside a `blob:`-origin worker under this CSP (a worker spawned
  from a `blob:` URL may not cleanly inherit `wasm-unsafe-eval` the way the
  main document does — unconfirmed), or (b) some other Electron/Chromium
  sandboxing of worker-thread capabilities in a webview that doesn't
  manifest as a catchable JS error at all.
- **Diagnosing further requires live DevTools** (CLAUDE.md's own suggested
  tool, "Developer: Open Webview Developer Tools" — for the worker
  specifically, its devtools open from the main webview's devtools "Workers"
  panel) to see the worker's actual console output and any network or
  WebAssembly-related warnings Chromium would log there but does not surface
  as a JS-catchable error. **This automated test harness cannot open
  interactive DevTools**, so this is the limit of what could be verified
  here.

**This is a real, reproduced architectural blocker, not a documentation
gap.** Three independent, genuinely-executed attempts — the two obvious
"textbook" fixes for cross-origin Worker construction, applied to the real
dependency this project plans to build on — all failed to get DuckDB-WASM
running inside an actual VS Code custom editor webview.

**Candidate next steps** (none attempted further here — this needs either
interactive DevTools access or more iteration time than this pass budgeted):

1. Open the failing webview's dedicated worker DevTools interactively and
   read whatever Chromium actually logs during the hang.
2. Try the `eh` (exception-handling) or `coi` DuckDB-WASM bundles instead of
   `mvp`, in case the hang is specific to that bundle variant (though `coi`
   requires `SharedArrayBuffer`, which CLAUDE.md already rules out for VS
   Code webviews).
3. Try running DuckDB-WASM's worker un-wrapped (no blob proxy) but with the
   extension host pre-registering the resource via a custom
   `registerUriHandler`/webview message-channel approach instead of
   `asWebviewUri`, to see whether the issue is specific to the
   `vscode-resource.vscode-cdn.net` virtual host rather than blob origins.
4. As a fallback architecture if the worker approach cannot be made to work
   at all: investigate whether DuckDB-WASM can run directly on the webview's
   main thread without a dedicated Worker (likely at the cost of blocking
   the UI during queries — a real UX regression, not a free substitution).
5. Search DuckDB-WASM's own issue tracker for "vscode webview" or "blob
   worker instantiate hang" — this project did not have this specific
   combination of facts (VS Code webview + blob-proxied worker + mvp bundle)
   confirmed against DuckDB-WASM's own GitHub issues in this research pass.

## Summary of residual risk going into Phase 1

| # | Spike | Status | Residual risk if wrong |
|---|-------|--------|-------------------------|
| 1 | Format support | Documentation + real prior-art evidence gathered; hands-on WASM test not completed in this environment (tooling limitation, see §1) | GeoPackage support claim in FR-018 could be false; mitigated by sql.js fallback plan |
| 2 | Range reads | Deferred — not required by spec 001's clarified (small-file) scope | None for 001; relevant again once large-file hardening begins |
| 3 | Extension delivery / VSIX size | Override mechanism confirmed to exist; real size now measured: the `mvp` bundle alone is ~41.3MB (`duckdb-mvp.wasm`) + ~0.8MB (worker script) uncompressed, before the spatial extension (fetched separately at runtime) or MapLibre are added | VSIX will very likely need a dedicated size-budget decision, not just a CI alert; this is now a known, not estimated, number |
| 4 | Worker bootstrapping / CSP | **BLOCKED.** CSP shape confirmed working; three real, hands-on instantiation attempts in an actual VS Code webview all failed, the last one with no error signal at all. This is the single highest-risk open item in the entire plan | Blocks the "DuckDB-WASM per webview" architecture as currently designed. Implementation should not proceed past this point on the current architecture until resolved — either via interactive DevTools diagnosis or an architecture change (see candidate next steps above) |

Item 4 is not resolved. Per the constitution's Verified Claims principle and
the project's working rule to spike before building on a risky assumption,
`tasks.md` reflects T005 as attempted and blocked, not complete, and T009
(DuckDB bootstrap service) and the rest of US1's webview-dependent tasks are
held pending this finding being resolved or the architecture being
revisited.
