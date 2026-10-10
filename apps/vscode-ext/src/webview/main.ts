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
    const blobUrl = URL.createObjectURL(new Blob([scriptText], { type: 'application/javascript' }))
    worker = new Worker(blobUrl)
    post({ type: 'log', detail: 'blob Worker constructed OK' })
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
    post({ type: 'log', detail: `fetched wasm module (${wasmBytes.byteLength} bytes), constructing blob URL…` })
    const wasmBlobUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }))

    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING)
    const db = new duckdb.AsyncDuckDB(logger, worker)
    post({ type: 'log', detail: `instantiating DuckDB-WASM with wasm blob URL…` })
    const timeoutMs = 15000
    await Promise.race([
      db.instantiate(wasmBlobUrl),
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
