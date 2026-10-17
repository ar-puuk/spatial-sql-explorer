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
//
// Spec 008 research §15: nothing of the engine is bundled. The worker, the
// wasm and the extensions come from pinned URLs and are checked against the
// SHA-256 recorded at build time before they run (engineAssets.ts).
import * as duckdb from '@duckdb/duckdb-wasm'
import { testOverrides } from './source/readModes.js'
import { ENGINE_ASSETS, EngineLoadError, engineHashes, fetchVerified, type EngineSource, type ExtensionName } from './engineAssets.js'

/**
 * Where the shell's engine comes from. Spec 008: always the pinned CDNs,
 * hash-checked; `mirror` (tests) serves the same files from the app's origin.
 */
export type DuckDbAssetUrls = EngineSource

const SENTINEL_WASM_URL = 'https://duckdb-wasm.local/module.wasm'

/**
 * Fetches the DuckDB-WASM `eh` bundle's worker + wasm bytes from the given
 * URLs and instantiates `AsyncDuckDB`. Never lets the worker fetch anything
 * itself — see the module doc comment above.
 */
export async function createDuckDb(assets: DuckDbAssetUrls): Promise<duckdb.AsyncDuckDB> {
  const { worker: workerFile, wasm: wasmFile } = ENGINE_ASSETS.duckdb
  // Both downloads at once; neither runs unless its hash matches.
  const [workerBytes, wasmVerified] = await Promise.all([
    fetchVerified(workerFile.url, workerFile.sha256, 'DuckDB worker', assets),
    fetchVerified(wasmFile.url, wasmFile.sha256, 'DuckDB wasm', assets),
  ])
  const workerScriptText = new TextDecoder().decode(workerBytes)

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
// Spec 017: the a5 community extension reports its name and version to Query.Farm when it loads.
// Constitution IV: nothing leaves the machine but what the user asked for, so the engine cannot reach
// that host (the extension carries on without it). Everything else is unchanged.
const __telemetry = /(^|\\.)query-farm\\.services$/i;
const __blocked = (u) => { try { return __telemetry.test(new URL(String(u), self.location.href).hostname); } catch { return false; } };
const __origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  // Not a throw (that would trap inside the engine): the request goes to a URL that cannot load, an ordinary network failure.
  return __origOpen.call(this, method, __blocked(url) ? 'blob:blocked-telemetry' : url, ...rest);
};
const __origFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (__blocked(url)) throw new TypeError('blocked: telemetry');
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

  const wasmBytes = wasmVerified
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
 * Loads the extensions the app needs (spatial, parquet, json, and since spec 017 fts, h3 and a5), each downloaded
 * from its pinned URL and checked against its recorded SHA-256 (spec 008
 * research §15). Shells' CSP `connect-src` must allow extensions.duckdb.org and community-extensions.duckdb.org
 * (and `blob:`, which the worker reads the verified bytes from).
 */
export async function loadSpatialExtension(conn: duckdb.AsyncDuckDBConnection, assets: DuckDbAssetUrls = {}): Promise<void> {
  await loadExtensions(conn, assets)
}

/** Extensions the app can start without: only spatial and parquet are required. */
const OPTIONAL_EXTENSIONS: ReadonlySet<ExtensionName> = new Set(['json', 'excel', 'sqlite_scanner', 'fts', 'h3', 'a5'])

/**
 * Spec 008 research §15: spatial, parquet and json, each downloaded and
 * hash-checked here, then loaded from a blob URL. DuckDB names an extension
 * after its file, so the URL carries the name as a fragment (the fetch
 * ignores it). DuckDB's own autoinstall/autoload are off first, so nothing
 * is fetched behind the check; its signature check stays on.
 */
async function loadExtensions(conn: duckdb.AsyncDuckDBConnection, assets: DuckDbAssetUrls): Promise<void> {
  await conn.query('SET autoinstall_known_extensions = false')
  await conn.query('SET autoload_known_extensions = false')
  const release = String((await conn.query('SELECT library_version AS v FROM pragma_version()')).toArray()[0]?.toJSON().v ?? '')
  if (release !== ENGINE_ASSETS.extensions.duckdb) {
    throw new EngineLoadError(`The SQL engine is DuckDB ${release}, but its extensions were recorded for ${ENGINE_ASSETS.extensions.duckdb}: run scripts/engine-assets.mjs.`, 'integrity')
  }
  // DuckDB-WASM 1.5 (duckdb-wasm#2199, open): unless the default coordinate
  // systems are loaded BEFORE spatial, read_parquet fails with "stoi: no
  // conversion" on every GeoParquet whose CRS is OGC:CRS84 (the GeoParquet
  // default). Order matters: the same call after LOAD spatial is the bug.
  await conn.query('SELECT count(*) FROM duckdb_coordinate_systems()')
  const files = ENGINE_ASSETS.extensions.files
  const names = Object.keys(files) as ExtensionName[]
  // Downloads in parallel, loads in order.
  const verified = names.map((name) => fetchVerified(files[name].url, files[name].sha256, `${name} extension`, assets))
  verified.forEach((p) => p.catch(() => {}))
  for (const [i, name] of names.entries()) {
    let bytes: ArrayBuffer
    try {
      bytes = await verified[i]
    } catch (err) {
      // Spec 008: JSON only serves JSON export; spec 010: excel xlsx export and input, sqlite_scanner
      // a SQLite file's attribute tables; spec 017: fts, h3 and a5 (SQL only). The app works without them.
      if (OPTIONAL_EXTENSIONS.has(name)) continue
      throw err
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }))
    try {
      await conn.query(`LOAD '${url}#/${name}.duckdb_extension.wasm'`)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
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
 * Verified on DuckDB-WASM 1.32.0 (DuckDB v1.4.3), again on 1.33.1-dev65.0 (v1.5.6,
 * spec 010: the lockdown tests pass unchanged): spatial stays usable, and
 * GDAL can still probe sibling files (`/se-source/name.*`) for shapefiles.
 * Order matters: allowed_directories must be set before access is disabled,
 * and both before the configuration is locked.
 */
async function lockDown(conn: duckdb.AsyncDuckDBConnection): Promise<void> {
  // parquet (read_parquet, GeoParquet) and json (JSON export) were loaded with
  // spatial (loadExtensions): after the lockdown, nothing more can be loaded.
  // Spec 010: GDAL's writers (export) take coordinates as x/y, never in the
  // CRS's authority order (EPSG:4326 would be written latitude first).
  await conn.query('SET GLOBAL geometry_always_xy = true')
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
          await loadSpatialExtension(conn, assets)
          // e2e only (spec 007 out-of-memory tests): a smaller engine. Must
          // precede the lockdown, which locks the configuration.
          const memoryLimit = testOverrides().memoryLimit
          if (memoryLimit) await conn.query(`SET memory_limit = '${memoryLimit}'`)
          await lockDown(conn)
        } finally {
          await conn.close()
        }
        // Spec 008 research §15: an upgrade leaves old local copies behind.
        void assets.host?.pruneEngineFiles?.(engineHashes()).catch(() => {})
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
