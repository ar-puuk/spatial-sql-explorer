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

export interface DuckDbAssetUrls {
  /** Fetchable URL for the `eh` bundle's worker script (e.g. a webview.asWebviewUri() result). */
  workerUrl: string
  /** Fetchable URL for the `eh` bundle's wasm module. */
  wasmUrl: string
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
