// Webview entry point. This is the T005 worker-bootstrap spike
// (specs/001-quick-look/tasks.md): it receives the DuckDB-WASM worker/wasm
// asset URLs from the extension host and proves that DuckDB-WASM can be
// instantiated and queried inside this webview. See
// specs/001-quick-look/research.md §4 for the full investigation — the
// short version: a Worker in a VS Code webview cannot complete ANY network
// request (fetch or XHR) for VS Code's virtual resource host at all, so the
// worker's own `self.fetch` is patched to resolve the one URL DuckDB-WASM
// asks for directly from bytes delivered via `postMessage`, rather than
// ever letting the worker fetch anything itself. packages/core's real
// duckdbService.ts (T009) must reuse this same technique.

import * as duckdb from '@duckdb/duckdb-wasm'

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void
}

const vscode = acquireVsCodeApi()

function post(msg: unknown): void {
  vscode.postMessage(msg)
}

/**
 * Isolates two variables before attempting the full DuckDB-WASM path:
 * (A) does raw `WebAssembly.compile()` on this 41MB module even work on the
 *     webview's MAIN thread at all?
 * (B) does raw `WebAssembly.compile()` work inside a minimal, non-DuckDB
 *     blob-constructed Worker (same construction technique, zero DuckDB-WASM
 *     complexity)?
 * This tells us whether a hang is generic to "WASM in any worker here" vs.
 * specific to DuckDB-WASM's own instantiate code path.
 */
async function runWasmDiagnostics(wasmBytes: ArrayBuffer, wasmBlobUrl: string): Promise<void> {
  const mainThreadStart = Date.now()
  try {
    await Promise.race([
      WebAssembly.compile(wasmBytes.slice(0)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 15000ms')), 15000)),
    ])
    post({ type: 'log', detail: `[diag A] main-thread WebAssembly.compile() OK in ${Date.now() - mainThreadStart}ms` })
  } catch (err) {
    post({ type: 'log', detail: `[diag A] main-thread WebAssembly.compile() FAILED: ${String(err)}` })
  }

  const diagWorkerSrc = `
    self.onmessage = async (e) => {
      const start = Date.now();
      try {
        await WebAssembly.compile(e.data);
        self.postMessage({ ok: true, ms: Date.now() - start });
      } catch (err) {
        self.postMessage({ ok: false, error: String(err), ms: Date.now() - start });
      }
    };
  `
  const diagBlobUrl = URL.createObjectURL(new Blob([diagWorkerSrc], { type: 'application/javascript' }))
  const diagWorker = new Worker(diagBlobUrl)

  const diagResult = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('[diag B] TIMED OUT after 15000ms with no message/error from diag worker'), 15000)
    diagWorker.addEventListener('message', (e) => {
      clearTimeout(timer)
      resolve(`[diag B] worker WebAssembly.compile() -> ${JSON.stringify(e.data)}`)
    })
    diagWorker.addEventListener('error', (e) => {
      clearTimeout(timer)
      resolve(`[diag B] worker error event: ${e.message}`)
    })
    diagWorker.postMessage(wasmBytes.slice(0))
  })
  post({ type: 'log', detail: diagResult })
  diagWorker.terminate()

  // Diag C: duckdb-browser-mvp.worker.js uses WebAssembly.instantiateStreaming(fetch(url))
  // internally (confirmed by grepping the bundled worker source), not a
  // postMessage-delivered ArrayBuffer like diag B used. This tests the one
  // remaining untested variable: does `fetch()` of a MAIN-THREAD-CREATED
  // blob: URL even resolve when called from INSIDE a worker at all?
  const diagCWorkerSrc = `
    self.onmessage = async (e) => {
      const start = Date.now();
      try {
        const res = await fetch(e.data);
        const buf = await res.arrayBuffer();
        self.postMessage({ ok: true, status: res.status, bytes: buf.byteLength, ms: Date.now() - start });
      } catch (err) {
        self.postMessage({ ok: false, error: String(err), ms: Date.now() - start });
      }
    };
  `
  const diagCBlobUrl = URL.createObjectURL(new Blob([diagCWorkerSrc], { type: 'application/javascript' }))
  const diagCWorker = new Worker(diagCBlobUrl)
  const diagCResult = await new Promise<string>((resolve) => {
    const timer = setTimeout(() => resolve('[diag C] TIMED OUT after 15000ms — worker fetch() of a main-thread blob: URL never resolved'), 15000)
    diagCWorker.addEventListener('message', (e) => {
      clearTimeout(timer)
      resolve(`[diag C] worker fetch(blobUrl) -> ${JSON.stringify(e.data)}`)
    })
    diagCWorker.addEventListener('error', (e) => {
      clearTimeout(timer)
      resolve(`[diag C] worker error event: ${e.message}`)
    })
    diagCWorker.postMessage(wasmBlobUrl)
  })
  post({ type: 'log', detail: diagCResult })
  diagCWorker.terminate()
}

async function runWorkerBootstrapSpike(duckdbWorkerUrl: string, duckdbWasmUrl: string): Promise<void> {
  // A classic `new Worker(asWebviewUriString)` throws a SecurityError: the
  // webview document's origin (vscode-webview://<uuid>) differs from where
  // VS Code serves local resources (vscode-resource.vscode-cdn.net), and
  // browsers require same-origin (or blob:/data:) for Worker construction.
  // The standard workaround: fetch the script's source as text (allowed —
  // our CSP's connect-src includes ${csp}, the webview's own resource
  // origin) and construct the Worker from a blob: URL instead, which browsers
  // always treat as same-origin-safe. See research.md §4.
  const SPIKE_WASM_URL = 'https://spike-wasm.invalid/duckdb-mvp.wasm'
  let worker: Worker
  try {
    post({ type: 'log', detail: 'fetching worker script…' })
    const scriptText = await (await fetch(duckdbWorkerUrl)).text()
    post({ type: 'log', detail: `fetched worker script (${scriptText.length} bytes), constructing blob Worker…` })
    // Root cause (see research.md §4, traced through DuckDB-WASM's own
    // source maps + confirmed by diagnostics): ANY network request a Worker
    // in this webview makes for a `vscode-resource.vscode-cdn.net` /
    // asWebviewUri URL simply never completes (no error, no response —
    // VS Code's resource virtualization appears wired up only for the main
    // frame, not dedicated Workers), and separately, a Worker's `fetch()` of
    // a *different-realm* `blob:` URL fails immediately, while a *same-realm*
    // blob fetched via XHR fails with a generic, unhelpful ProgressEvent
    // error. None of the three "let the worker fetch something itself"
    // strategies work. The robust fix: never let the worker do its own
    // network fetch at all. The MAIN thread fetch of the asWebviewUri already
    // works perfectly (proven: 41MB in well under a second) — so intercept
    // `self.fetch` *inside* the worker (patched onto its script before
    // blobbing it) to resolve the one URL DuckDB-WASM asks for directly from
    // bytes delivered via `postMessage`, with a clean, correctly-content-typed
    // Response object. This also sidesteps the two real DuckDB-WASM bugs
    // found during this investigation: `instantiateStreaming`'s progress-path
    // reconstructs the fetch Response via `new Response(body, response)`
    // (not a valid ResponseInit shape — can silently drop the
    // `Content-Type: application/wasm` header instantiateStreaming requires)
    // and its whole `.then(success)` chain has no `.catch()` at all, so any
    // rejection is swallowed — our Response always succeeds and is clean, so
    // neither bug is ever triggered.
    const patchedScript = `self.TransformStream = undefined;
const __spikeWasmBytesPromise = new Promise((resolve) => {
  self.addEventListener('message', function handler(e) {
    if (e && e.data && e.data.__spikeWasmBytes) {
      self.removeEventListener('message', handler);
      resolve(e.data.__spikeWasmBytes);
    }
  });
});
const __origFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url && url.indexOf('${SPIKE_WASM_URL}') !== -1) {
    const bytes = await __spikeWasmBytesPromise;
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/wasm' } });
  }
  return __origFetch(input, init);
};
${scriptText}
`
    const blobUrl = URL.createObjectURL(new Blob([patchedScript], { type: 'application/javascript' }))
    worker = new Worker(blobUrl)
    post({ type: 'log', detail: 'blob Worker constructed OK (patched)' })
  } catch (err) {
    post({ type: 'spikeResult', ok: false, stage: 'new Worker() via blob', detail: String(err) })
    return
  }

  worker.addEventListener('error', (e) => {
    post({ type: 'log', detail: `worker error event: ${e.message}` })
  })
  worker.addEventListener('message', (e) => {
    post({ type: 'log', detail: `worker message: ${JSON.stringify(e.data).slice(0, 300)}` })
  })

  try {
    // Fetch the wasm bytes on the main thread — this demonstrably works
    // (41MB, well under a second via asWebviewUri). The worker NEVER fetches
    // anything itself; it receives these bytes via postMessage and its
    // patched self.fetch override (see above) resolves DuckDB-WASM's own
    // internal fetch(SPIKE_WASM_URL) call from them directly.
    post({ type: 'log', detail: 'fetching wasm module…' })
    const wasmBytes = await (await fetch(duckdbWasmUrl)).arrayBuffer()
    post({ type: 'log', detail: `fetched wasm module (${wasmBytes.byteLength} bytes), running diagnostics…` })
    const wasmBlobUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }))
    await runWasmDiagnostics(wasmBytes, wasmBlobUrl)

    post({ type: 'log', detail: 'delivering wasm bytes to the worker via postMessage…' })
    worker.postMessage({ __spikeWasmBytes: wasmBytes.slice(0) })

    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    post({ type: 'log', detail: `instantiating DuckDB-WASM (worker's fetch() is patched to resolve locally)…` })
    const timeoutMs = 15000
    await Promise.race([
      db.instantiate(SPIKE_WASM_URL),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`db.instantiate() did not resolve within ${timeoutMs}ms`)), timeoutMs)
      ),
    ])
    post({ type: 'log', detail: 'DuckDB-WASM instantiated OK, connecting…' })

    const conn = await db.connect()
    post({ type: 'log', detail: 'connected OK, running SELECT 1…' })
    const result = await conn.query('SELECT 1 AS one')
    const rows = result.toArray().map((r) => r.toJSON())

    await conn.close()
    await db.terminate()
    worker.terminate()

    post({
      type: 'spikeResult',
      ok: true,
      stage: 'query',
      detail: `DuckDB-WASM instantiated and queried successfully inside the webview: ${JSON.stringify(rows)}`,
    })
  } catch (err) {
    post({ type: 'spikeResult', ok: false, stage: 'instantiate-or-query', detail: String(err) })
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; duckdbWorkerUrl?: string; duckdbWasmUrl?: string }
  if (msg.type === 'assets' && msg.duckdbWorkerUrl && msg.duckdbWasmUrl) {
    void runWorkerBootstrapSpike(msg.duckdbWorkerUrl, msg.duckdbWasmUrl)
  }
})

post({ type: 'ready' })
