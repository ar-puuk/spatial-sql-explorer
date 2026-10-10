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
import { createDuckDb, loadSpatialExtension } from '@spatial-explorer/core'

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

async function runWorkerBootstrapSpike(
  duckdbWorkerUrl: string,
  duckdbWasmUrl: string,
  fixtureUris: Record<string, string>
): Promise<void> {
  // T009: this now exercises the REAL, shared packages/core/src/duckdbService.ts
  // (not an inline duplicate of the spike logic) — see that file's doc
  // comment, and research.md §4, for the full root-cause story: a classic
  // `new Worker(asWebviewUriString)` throws a SecurityError in a VS Code
  // webview (origin mismatch), and a worker's own `fetch()` of anything never
  // reliably completes here either, so `createDuckDb()` fetches both the
  // worker script and wasm module as bytes on this thread and patches the
  // worker's own `self.fetch` to resolve its one wasm-module request locally.
  try {
    post({ type: 'log', detail: 'running pre-flight WASM diagnostics…' })
    const wasmBytes = await (await fetch(duckdbWasmUrl)).arrayBuffer()
    const wasmBlobUrl = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }))
    await runWasmDiagnostics(wasmBytes, wasmBlobUrl)

    post({ type: 'log', detail: 'creating DuckDB-WASM via packages/core/duckdbService…' })
    const db = await createDuckDb({ workerUrl: duckdbWorkerUrl, wasmUrl: duckdbWasmUrl })
    post({ type: 'log', detail: 'DuckDB-WASM instantiated OK, connecting…' })

    const conn = await db.connect()
    post({ type: 'log', detail: 'connected OK, running SELECT 1…' })
    const result = await conn.query('SELECT 1 AS one')
    const rows = result.toArray().map((r) => r.toJSON())

    post({
      type: 'spikeResult',
      ok: true,
      stage: 'query',
      detail: `DuckDB-WASM instantiated and queried successfully inside the webview: ${JSON.stringify(rows)}`,
    })

    // T006 (format support spike) — reuses the same live connection.
    await runFormatSupportSpike(db, conn, fixtureUris)

    await conn.close()
    await db.terminate()
  } catch (err) {
    post({ type: 'spikeResult', ok: false, stage: 'instantiate-or-query', detail: String(err) })
  }
}

/**
 * T006 (specs/001-quick-look/tasks.md): confirms, per format, whether the
 * real DuckDB-WASM spatial extension can read it — per the project's
 * Verified Claims principle, FR-018's format list must be backed by this,
 * not assumed from documentation. Results are posted as `formatResult`
 * messages, one per format, and also collected into a final `formatSummary`.
 */
async function runFormatSupportSpike(
  db: duckdb.AsyncDuckDB,
  conn: duckdb.AsyncDuckDBConnection,
  fixtureUris: Record<string, string>
): Promise<void> {
  async function reportFormat(label: string, fn: () => Promise<string>): Promise<{ label: string; ok: boolean; detail: string }> {
    try {
      const detail = await fn()
      post({ type: 'formatResult', label, ok: true, detail })
      return { label, ok: true, detail }
    } catch (err) {
      const detail = String(err).split('\n')[0]
      post({ type: 'formatResult', label, ok: false, detail })
      return { label, ok: false, detail }
    }
  }

  const results: Array<{ label: string; ok: boolean; detail: string }> = []

  results.push(
    await reportFormat('spatial extension LOAD', async () => {
      await loadSpatialExtension(conn)
      return 'spatial extension installed and loaded'
    })
  )

  if (!results[0].ok) {
    // Can't test any spatial format without the extension — report and stop.
    post({ type: 'formatSummary', results })
    return
  }

  // T007 (VSIX size budget): attempted to find the real size of the spatial
  // extension binary fetched from the default CDN. duckdb_extensions() in
  // this version has no size column, and the download doesn't pass through
  // a JS-level fetch() we can intercept (see the self.fetch override's
  // comment above) — so exact size remains unmeasured; this just confirms
  // INSTALL is a no-op (installed: false) and loading over the real network
  // succeeds when CSP allows it (research.md §3).
  results.push(
    await reportFormat('spatial extension LOAD details (duckdb_extensions())', async () => {
      const res = await conn.query(`SELECT * FROM duckdb_extensions() WHERE extension_name = 'spatial'`)
      const rows = res.toArray().map((r) => r.toJSON())
      return JSON.stringify(rows)
    })
  )

  results.push(
    await reportFormat('ST_Drivers()', async () => {
      const driversRes = await conn.query(`SELECT short_name FROM ST_Drivers() ORDER BY short_name`)
      const names = driversRes.toArray().map((r) => r.toJSON().short_name as string)
      return `${names.length} GDAL drivers compiled into this WASM build: ${names.join(', ')}`
    })
  )

  // spec 001 only needs READ (write/export is spec 005) — so the primary
  // format tests register real file bytes directly into DuckDB-WASM's
  // virtual filesystem (no write step at all) and read them straight back,
  // which is the actual capability FR-018 depends on. The GeoJSON test uses
  // the project's real sample dataset (samples/world-boundaries.geojson,
  // 180 countries, mixed Polygon/MultiPolygon geometry) rather than a
  // synthetic one-point file, so it also exercises FR-013 (mixed geometry
  // types) for real.
  results.push(
    await reportFormat('GeoJSON (ST_Read, pure read, real 180-feature file)', async () => {
      const url = fixtureUris['world-boundaries.geojson']
      if (!url) throw new Error('no fixture URI provided for world-boundaries.geojson')
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
      await db.registerFileBuffer('/tmp/world-boundaries.geojson', bytes)
      const res = await conn.query(`SELECT * FROM ST_Read('/tmp/world-boundaries.geojson')`)
      return `${res.toArray().length} row(s) read directly from the real file (no write involved)`
    })
  )

  results.push(
    await reportFormat('CSV + ST_Point (pure read)', async () => {
      await db.registerFileText('/tmp/read-spike.csv', 'name,lon,lat\nPoint A,-111.9,40.76\n')
      const res = await conn.query(`SELECT name, ST_Point(lon, lat) AS geom FROM read_csv_auto('/tmp/read-spike.csv')`)
      return `${res.toArray().length} row(s) read directly (no write involved)`
    })
  )

  results.push(
    await reportFormat('GeoParquet (read_parquet, native write+read)', async () => {
      await conn.query(`COPY (SELECT 'Point A' AS name, ST_AsWKB(ST_Point(-111.9, 40.76)) AS geometry)
        TO '/tmp/spike.parquet' (FORMAT PARQUET)`)
      const res = await conn.query(`SELECT name, ST_GeomFromWKB(geometry) AS geom FROM read_parquet('/tmp/spike.parquet')`)
      return `${res.toArray().length} row(s) round-tripped through GeoParquet (DuckDB's native parquet writer, not GDAL)`
    })
  )

  // The remaining candidate formats (FlatGeobuf, GeoPackage, Shapefile, GML,
  // MapInfo TAB) have REAL sample files generated outside the WASM sandbox
  // via geopandas/GDAL (this WASM build's own GDAL *write* path is itself
  // unreliable — see the write-check results further below), fetched on the
  // main thread (proven reliable throughout this investigation) and
  // registered directly into DuckDB-WASM's virtual filesystem. This is a
  // genuine read-capability test, not a write+read round trip.
  const registerFixture = async (name: string, vfsPath: string): Promise<void> => {
    const url = fixtureUris[name]
    if (!url) throw new Error(`no fixture URI provided for ${name}`)
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer())
    await db.registerFileBuffer(vfsPath, bytes)
  }

  const gdalRealFileRead = async (
    primaryFixture: string,
    companionFixtures: string[],
    driverLabel: string
  ): Promise<string> => {
    for (const name of [primaryFixture, ...companionFixtures]) {
      await registerFixture(name, `/tmp/${name}`)
    }
    const res = await conn.query(`SELECT * FROM ST_Read('/tmp/${primaryFixture}')`)
    return `${res.toArray().length} row(s) read from a REAL ${driverLabel} file (generated via geopandas/GDAL outside the WASM sandbox)`
  }

  results.push(await reportFormat('FlatGeobuf (real file, pure read)', () => gdalRealFileRead('sample.fgb', [], 'FlatGeobuf')))
  results.push(await reportFormat('GeoPackage (real file, pure read)', () => gdalRealFileRead('sample.gpkg', [], 'GeoPackage')))
  results.push(
    await reportFormat('Shapefile (real file, pure read)', () =>
      gdalRealFileRead('sample.shp', ['sample.shx', 'sample.dbf', 'sample.prj', 'sample.cpg'], 'Shapefile')
    )
  )
  results.push(await reportFormat('GML (real file, pure read)', () => gdalRealFileRead('sample.gml', ['sample.xsd'], 'GML')))
  results.push(
    await reportFormat('MapInfo TAB (real file, pure read)', () =>
      gdalRealFileRead('sample.tab', ['sample.dat', 'sample.id', 'sample.map'], 'MapInfo TAB')
    )
  )

  // Separately, confirm the earlier finding that this WASM build's own GDAL
  // *write* path is unreliable (spec 001 doesn't need write — export is spec
  // 005 — but this is useful, verified evidence for that later spec).
  const gdalWriteCheck = async (ext: string, driver: string): Promise<string> => {
    const path = `/tmp/write-spike.${ext}`
    await conn.query(`CREATE OR REPLACE TABLE _spike_src AS SELECT 'Point A' AS name, ST_Point(-111.9, 40.76) AS geom`)
    await conn.query(`COPY _spike_src TO '${path}' WITH (FORMAT GDAL, DRIVER '${driver}')`)
    const res = await conn.query(`SELECT * FROM ST_Read('${path}')`)
    return `${res.toArray().length} row(s) round-tripped through ${driver} write+read`
  }

  results.push(await reportFormat('FlatGeobuf (write check)', () => gdalWriteCheck('fgb', 'FlatGeobuf')))
  results.push(await reportFormat('GeoPackage (write check)', () => gdalWriteCheck('gpkg', 'GPKG')))
  results.push(await reportFormat('Shapefile (write check)', () => gdalWriteCheck('shp', 'ESRI Shapefile')))
  results.push(await reportFormat('GML (write check)', () => gdalWriteCheck('gml', 'GML')))
  results.push(await reportFormat('MapInfo TAB (write check)', () => gdalWriteCheck('tab', 'MapInfo File')))

  post({ type: 'formatSummary', results })
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as {
    type: string
    duckdbWorkerUrl?: string
    duckdbWasmUrl?: string
    fixtureUris?: Record<string, string>
  }
  if (msg.type === 'assets' && msg.duckdbWorkerUrl && msg.duckdbWasmUrl) {
    void runWorkerBootstrapSpike(msg.duckdbWorkerUrl, msg.duckdbWasmUrl, msg.fixtureUris ?? {})
  }
})

post({ type: 'ready' })
