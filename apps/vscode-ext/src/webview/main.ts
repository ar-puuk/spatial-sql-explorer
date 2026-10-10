// Webview entry point. For the T005 worker-bootstrap spike, this file's
// only job (so far) is to receive the DuckDB-WASM worker/wasm asset URLs
// from the extension host and prove whether `new Worker(assetUrl)` can
// actually instantiate DuckDB-WASM inside this webview — see
// specs/001-quick-look/research.md §4 for why this is the highest-risk,
// highest-priority open question in the whole plan.

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
  let worker: Worker
  try {
    post({ type: 'log', detail: 'fetching worker script…' })
    const scriptText = await (await fetch(duckdbWorkerUrl)).text()
    post({ type: 'log', detail: `fetched worker script (${scriptText.length} bytes), constructing blob Worker…` })
    // Diag C proved: a worker's fetch() of a blob: URL created by a DIFFERENT
    // realm (the main thread) fails immediately ("Failed to fetch"), and
    // duckdb-browser-mvp.worker.js's internal
    // WebAssembly.instantiateStreaming(fetch(url)) swallows that rejection
    // instead of surfacing it, which is why db.instantiate() hangs instead of
    // erroring. Fix attempt: patch extra listener code onto the worker's own
    // script (before blobbing it) so the WORKER creates its OWN blob URL from
    // wasm bytes we hand it via postMessage (same-realm blob, should be
    // fetchable by that worker's own fetch()), and reports that blob URL
    // string back to us to pass into db.instantiate() instead.
    const patchedScript = `${scriptText}
self.addEventListener('message', (e) => {
  if (e && e.data && e.data.__spikeWasmBytes) {
    const blobUrl = URL.createObjectURL(new Blob([e.data.__spikeWasmBytes], { type: 'application/wasm' }));
    self.postMessage({ __spikeWasmBlobUrl: blobUrl });
  }
});
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
    // Same cross-origin problem as the worker script itself: a worker's own
    // fetch() of the vscode-resource.vscode-cdn.net-served .wasm file hangs
    // (VS Code's virtual resource interception appears to be scoped to the
    // webview's main thread, not worker threads). Fix: fetch the wasm bytes
    // on the main thread (demonstrably works — see the worker-script fetch
    // above) and hand the WORKER a blob: URL instead, which is resolvable
    // from any execution context sharing this webview's origin.
    post({ type: 'log', detail: 'fetching wasm module…' })
    const wasmBytes = await (await fetch(duckdbWasmUrl)).arrayBuffer()
    post({ type: 'log', detail: `fetched wasm module (${wasmBytes.byteLength} bytes), running diagnostics…` })
    const wasmBlobUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }))
    await runWasmDiagnostics(wasmBytes, wasmBlobUrl)

    // Ask the (patched) worker to create its OWN same-realm blob URL for the
    // wasm bytes, instead of handing it our main-thread-created one.
    post({ type: 'log', detail: 'asking worker to self-create a wasm blob URL…' })
    const selfCreatedBlobUrl = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker did not report a self-created blob URL within 10000ms')), 10000)
      const handler = (e: MessageEvent) => {
        if (e.data && e.data.__spikeWasmBlobUrl) {
          clearTimeout(timer)
          worker.removeEventListener('message', handler)
          resolve(e.data.__spikeWasmBlobUrl as string)
        }
      }
      worker.addEventListener('message', handler)
      worker.postMessage({ __spikeWasmBytes: wasmBytes.slice(0) })
    })
    post({ type: 'log', detail: `worker self-created blob URL OK: ${selfCreatedBlobUrl.slice(0, 60)}…` })

    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    post({ type: 'log', detail: `instantiating DuckDB-WASM with the worker's own self-created blob URL…` })
    const timeoutMs = 15000
    await Promise.race([
      db.instantiate(selfCreatedBlobUrl),
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
