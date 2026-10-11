// DuckDB-WASM bootstrap service. Uses the `eh` (exception-handling) bundle,
// not `mvp` — see research.md §1: `mvp` fails every GDAL-driver format with
// "ReferenceError: _setThrew is not defined" (missing WASM exception-handling
// glue GDAL's C++ code needs). `eh` remains single-threaded (no
// SharedArrayBuffer), so it stays compatible with VS Code webviews.
//
// Worker/module instantiation follows the exact technique proven in the T005
// spike (specs/001-quick-look/research.md §4): a classic `new Worker(url)`
// against any absolute URL — including a correctly-resolved
// `webview.asWebviewUri()` URL — throws a SecurityError in a VS Code webview,
// because the webview document's origin never matches the origin VS Code
// serves local resources from. Separately, a worker's own `fetch()` of
// anything (a foreign-realm blob:, a same-realm blob:, or VS Code's virtual
// resource host) never reliably completes from inside a worker in this
// environment. The fix applied uniformly here (harmless in the plain web
// shell, required in the VS Code webview): fetch both the worker script and
// the wasm module as bytes on the calling thread (always proven reliable),
// construct the worker from a same-realm `blob:` URL, and patch that
// worker's own `self.fetch` to resolve DuckDB-WASM's one wasm-module request
// directly from bytes delivered via `postMessage`, so the worker never
// performs a network fetch of its own at all.
import * as duckdb from '@duckdb/duckdb-wasm'
import { testOverrides } from './source/readModes.js'

export interface DuckDbAssetUrls {
  /** Fetchable URL for the `eh` bundle's worker script (e.g. a webview.asWebviewUri() result). */
  workerUrl: string
  /** Fetchable URL for the `eh` bundle's wasm module. */
  wasmUrl: string
  /** Spec 008: sql.js's wasm, fetched only when a GeoPackage is exported (research §3). */
  sqlWasmUrl?: string
}

const SENTINEL_WASM_URL = 'https://duckdb-wasm.local/module.wasm'

/**
 * Fetches the DuckDB-WASM `eh` bundle's worker + wasm bytes from the given
 * URLs and instantiates `AsyncDuckDB`. Never lets the worker fetch anything
 * itself — see the module doc comment above.
 */
export async function createDuckDb(assets: DuckDbAssetUrls): Promise<duckdb.AsyncDuckDB> {
  const workerScriptText = await (await fetch(assets.workerUrl)).text()

  // self.TransformStream = undefined forces DuckDB-WASM off its
  // progress-tracking instantiateStreaming branch, which reconstructs the
  // fetch Response via `new Response(body, response)` — not a valid
  // ResponseInit shape, and can silently drop the Content-Type header
  // instantiateStreaming requires (see research.md §4). Our patched fetch
  // below always returns a clean Response, so this isn't strictly required
  // once that fix is in place, but is kept as defense in depth against that
  // upstream bug.
  const patchedScript = `self.TransformStream = undefined;
const __duckdbWasmBytesPromise = new Promise((resolve) => {
  self.addEventListener('message', function handler(e) {
    if (e && e.data && e.data.__duckdbWasmBytes) {
      self.removeEventListener('message', handler);
      resolve(e.data.__duckdbWasmBytes);
    }
  });
});
const __origFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url && url.indexOf('${SENTINEL_WASM_URL}') !== -1) {
    const bytes = await __duckdbWasmBytesPromise;
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/wasm' } });
  }
  return __origFetch(input, init);
};
${workerScriptText}
`
  const blobUrl = URL.createObjectURL(new Blob([patchedScript], { type: 'application/javascript' }))
  const worker = new Worker(blobUrl)

  const wasmBytes = await (await fetch(assets.wasmUrl)).arrayBuffer()
  worker.postMessage({ __duckdbWasmBytes: wasmBytes }, [wasmBytes])

  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
  const db = new duckdb.AsyncDuckDB(logger, worker)
  await db.instantiate(SENTINEL_WASM_URL)
  // Spec 007 research §3: registered URLs (VS Code's loopback server) must be
  // read with Range requests. With the defaults, DuckDB-WASM silently
  // downloaded a whole 762 MB file instead; this makes a server without
  // range support fail loudly rather than fall back to a full read.
  await db.open({ filesystem: { reliableHeadRequests: true, allowFullHTTPReads: false, forceFullHTTPReads: false } })
  return db
}

/**
 * Loads the spatial extension over the real network (CDN). research.md §3
 * originally planned to bundle this extension for fully offline use, but
 * T007 found that extension loading is handled by a lower-level mechanism
 * inside the compiled Emscripten/WASM runtime, not a JS-level `fetch()` this
 * project can intercept the same way as the core module — so the
 * bundle-and-serve-locally approach proven for the core module does not
 * directly apply here. CLAUDE.md already permits network use for "the
 * DuckDB spatial extension, if needed", so this is an accepted interim
 * approach, not a principle violation. The caller's webview CSP
 * `connect-src` must allow the DuckDB extension CDN host
 * (`extensions.duckdb.org`) for this to succeed.
 */
export async function loadSpatialExtension(conn: duckdb.AsyncDuckDBConnection): Promise<void> {
  await conn.query('INSTALL spatial;')
  await conn.query('LOAD spatial;')
}

/** Every source file is registered under this directory (spec 002 research §2). */
export const SOURCE_DIR = '/se-source/'

/**
 * Engine lockdown, applied once per instance right after spatial loads
 * (spec 002, FR-013 / Constitution IV). Users can type arbitrary SQL from
 * spec 002 on, so the engine itself must refuse anything outside the source
 * files, whatever the statement allowlist lets through:
 * - Only SOURCE_DIR is readable: no other virtual files, no URLs, no path
 *   traversal (verified).
 * - No more extension loading.
 * - Configuration locked, so none of this can be SET back.
 * Verified on DuckDB-WASM 1.32.0 (DuckDB v1.4.3): spatial stays usable, and
 * GDAL can still probe sibling files (`/se-source/name.*`) for shapefiles.
 * Order matters: allowed_directories must be set before access is disabled,
 * and both before the configuration is locked.
 */
async function lockDown(conn: duckdb.AsyncDuckDBConnection): Promise<void> {
  // Extensions DuckDB would otherwise autoload on first use must be loaded
  // now: after the lockdown, autoloading is refused. `parquet` is
  // autoloaded by read_parquet() (GeoParquet, FR-018), and the
  // format-matrix suite failed without this.
  await conn.query('INSTALL parquet')
  await conn.query('LOAD parquet')
  // Spec 008: JSON export is the engine's COPY ... (FORMAT JSON) (~230 ms
  // here, during prewarm). Not fatal: without it only JSON export fails.
  await conn.query('INSTALL json').catch(() => {})
  await conn.query('LOAD json').catch(() => {})
  await conn.query(`SET allowed_directories = ['${SOURCE_DIR}']`)
  await conn.query('SET enable_external_access = false')
  await conn.query('SET lock_configuration = true')
}

let sharedDb: Promise<duckdb.AsyncDuckDB> | null = null

/**
 * One DuckDB instance (with spatial loaded) per webview / page, shared by
 * every open in that session (CLAUDE.md: each custom-editor webview owns its
 * own instance). Previously every openFile() instantiated and terminated its
 * own, re-paying the ~36 MB wasm compile and the spatial extension's CDN
 * fetch on each open.
 *
 * Self-healing (GeoLibre post-launch fix #1045): a rejected init is not
 * memoized, so a transient failure (offline extension CDN, a webview that
 * was briefly hidden) can be retried by the next open instead of being
 * cached forever. The identity check stops a stale failure from clearing a
 * newer, healthy attempt.
 */
export function getDuckDb(assets: DuckDbAssetUrls): Promise<duckdb.AsyncDuckDB> {
  if (!sharedDb) {
    const attempt = (async () => {
      const db = await createDuckDb(assets)
      try {
        const conn = await db.connect()
        try {
          await loadSpatialExtension(conn)
          // e2e only (spec 007 out-of-memory tests): a smaller engine. Must
          // precede the lockdown, which locks the configuration.
          const memoryLimit = testOverrides().memoryLimit
          if (memoryLimit) await conn.query(`SET memory_limit = '${memoryLimit}'`)
          await lockDown(conn)
        } finally {
          await conn.close()
        }
        return db
      } catch (err) {
        await db.terminate().catch(() => {})
        throw err
      }
    })()
    sharedDb = attempt
    attempt.catch(() => {
      if (sharedDb === attempt) sharedDb = null
    })
  }
  return sharedDb
}

/** The shared engine's start, if one is under way or done; never starts one (the web landing page's status). */
export function peekDuckDb(): Promise<duckdb.AsyncDuckDB> | null {
  return sharedDb
}

/**
 * Ends the shared engine and its worker (spec 007 T050: a cancelled whole-file
 * parse that doesn't stop in time). Everything it held is gone; the next
 * getDuckDb() starts a fresh instance.
 */
export async function resetDuckDb(): Promise<void> {
  const current = sharedDb
  sharedDb = null
  const db = await current?.catch(() => null)
  await db?.terminate().catch(() => {})
}

/**
 * Starts DuckDB + spatial initialization early, so it overlaps with the file
 * transfer (VS Code) or with the user choosing a file (web) instead of
 * starting only once the bytes have arrived. Never throws: a failure here
 * resurfaces, with its real message, from the open that awaits it.
 */
export function prewarmDuckDb(assets: DuckDbAssetUrls): void {
  getDuckDb(assets).catch(() => {})
}
