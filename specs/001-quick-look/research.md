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

**Decision**: Reuse the CSP shape already shipped and working in
`../omx-viewer`'s custom editor, and budget real engineering time for DuckDB-WASM's
worker bootstrapping specifically — treat it as the highest-risk item in this
plan, not a routine integration step.

**Rationale / Evidence gathered**:
- omx-viewer's shipped, working CSP for a WASM-plus-worker VS Code webview
  (`apps/vscode-ext/src/extension.ts`):
  ```
  default-src 'none'; script-src 'wasm-unsafe-eval' ${csp}; style-src ${csp} 'unsafe-inline';
  worker-src ${csp} blob: data:; img-src ${csp} data:; font-src ${csp};
  ```
  (`${csp}` is `webview.cspSource`.) This matches CLAUDE.md's stated
  requirement (`worker-src blob:`, `script-src 'wasm-unsafe-eval'`) and is
  real, shipped, working policy — adopt it as the starting point, extending
  `img-src`/`connect-src` for basemap tile/style/sprite/glyph hosts per
  CLAUDE.md's basemap CSP notes (omx-viewer has no basemaps, so that part is
  new).
- **Worker bootstrapping is a confirmed, non-hypothetical risk**, documented
  firsthand in omx-viewer's own source comments
  (`packages/engine/src/services/duckdbService.ts`): constructing a Worker via
  `new Worker(new URL(..., import.meta.url), {type:'module'})` throws
  *synchronously* inside a VS Code webview, because the webview document's
  origin (`vscode-webview://<uuid>`) does not match the origin scripts are
  actually served from (`vscode-resource.vscode-cdn.net`), and browsers
  require same-origin for Worker construction. Their *second* attempted
  workaround — `fetch()` the same script as text and construct a `blob:` URL
  Worker from it — **also failed** ("Failed to fetch"), apparently hitting the
  same cross-origin restriction even for programmatic fetch. Their working
  fix was Vite's `?worker&inline` suffix, which inlines the worker as a
  base64 `data:` URL at build time, so there is no separate cross-origin
  resource to load at all. This worked because their worker is tiny (~1KB).
  **DuckDB-WASM's main worker is not tiny** (tens to low hundreds of KB per
  the published bundle sizes) and is normally instantiated from a *separate*
  worker script file via `duckdb.selectBundle()` + `new Worker(bundle.mainWorker)`
  — the standard DuckDB-WASM pattern does not inline the worker. Whether the
  same-origin failure omx-viewer hit also applies when the worker URL is
  produced via `webview.asWebviewUri()` (same webview-resource origin as the
  main script, rather than a dev-server-relative `import.meta.url`) is
  untested and is the single most important open question for Spike 4.
- The from-scratch Node DuckDB-WASM harness attempted for Spike 1 (see
  above) independently reinforces that this library's worker instantiation
  is sensitive to the exact host environment's Worker semantics — it is not
  a "just works everywhere" dependency.

**Follow-up task**: the very first implementation task touching DuckDB-WASM
must prove worker instantiation inside an actual `resolveCustomEditor`
webview before any feature logic is built on top of it — either (a) a plain
`new Worker(asWebviewUriToWorkerScript)` works because both main script and
worker share the webview-resource origin, or (b) it needs the same
inline/blob workaround omx-viewer used, scaled up for a much larger script,
or (c) a different bootstrapping approach entirely. Record the real outcome
here before Phase 1 design assumptions about "one DuckDB instance per
webview" are treated as settled.

**Alternatives considered**: Assume the standard browser DuckDB-WASM
instantiation pattern "just works" in a webview because it works in an
ordinary web page. Rejected — omx-viewer's own documented, tested experience
with a *different* but analogous worker in the exact same kind of webview
directly contradicts that assumption for at least one construction method.

## Summary of residual risk going into Phase 1

| # | Spike | Status | Residual risk if wrong |
|---|-------|--------|-------------------------|
| 1 | Format support | Documentation + real prior-art evidence gathered; hands-on WASM test not completed in this environment (tooling limitation, see above) | GeoPackage support claim in FR-018 could be false; mitigated by sql.js fallback plan |
| 2 | Range reads | Deferred — not required by spec 001's clarified (small-file) scope | None for 001; relevant again once large-file hardening begins |
| 3 | Extension delivery / VSIX size | Override mechanism confirmed to exist; exact size not measured against pinned versions | VSIX could exceed a reasonable size budget; mitigated by an early build-time size check |
| 4 | Worker bootstrapping / CSP | CSP shape confirmed working (omx-viewer); worker instantiation confirmed risky by direct analogy, not yet proven for DuckDB-WASM specifically | Could block the entire "DuckDB-WASM per webview" architecture decision if it fails; HIGHEST priority spike to run first in tasks.md |

All four items are carried into `tasks.md` as explicit, early, spike-first
tasks per the constitution's Verified Claims principle and the project's
working rule to spike before building on a risky assumption.
