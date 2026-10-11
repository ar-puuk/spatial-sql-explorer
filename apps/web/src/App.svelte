<script lang="ts">
  // Web shell chrome (design-plan.md §4.3, §5.4): a slim branded header, the
  // legacy app's drop zone as the empty state, and the shared ViewerLayout
  // with the status bar docked over the map. VS Code renders none of this —
  // it has native chrome for each.
  import { ViewerLayout, StatusBar, Icon, createViewerStore } from '@spatial-explorer/ui'
  import { createWebHostAdapter, provideFiles, rangeReads } from './hostAdapter.js'

  // Served from public/duckdb/ — see scripts/copy-wasm-assets.js.
  const duckdbAssets = { workerUrl: '/duckdb/duckdb-browser-eh.worker.js', wasmUrl: '/duckdb/duckdb-eh.wasm', sqlWasmUrl: '/sqljs/sql-wasm.wasm' }
  const hostAdapter = createWebHostAdapter()
  const store = createViewerStore(hostAdapter, duckdbAssets)

  // Warm DuckDB up while the user is still choosing a file (design-plan.md
  // §8.2), but after first paint so the drop zone shows immediately.
  const idle = (cb: () => void): void => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(cb, { timeout: 2000 })
    else setTimeout(cb, 300)
  }
  idle(() => store.prewarm())

  // Test-only escape hatch (spec 002 T036), enabled by ?e2e=1: runs SQL with
  // NO statement policy, so browser tests can prove the ENGINE lockdown on its
  // own. The lockdown (duckdbService.lockDown), not this hook, is the
  // security boundary: everything sent here is still refused file, network,
  // extension and settings access.
  if (new URLSearchParams(location.search).has('e2e')) {
    ;(window as unknown as { __spatialExplorerE2E: unknown }).__spatialExplorerE2E = {
      runRaw: (sql: string) => {
        const qs = store.querySession
        if (!qs) throw new Error('No file is open.')
        return qs.runRaw(sql)
      },
      /**
       * Spec 005 T014: reads an exported Parquet file back in the real
       * engine (row count, column names, the `geo` metadata), then drops it.
       */
      inspectParquet: async (base64: string) => {
        const { getDuckDb } = await import('@spatial-explorer/core')
        const db = await getDuckDb(duckdbAssets)
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        // A new name per call: re-registering one path keeps the first (transferred) buffer.
        const path = `/se-source/__se_check-${Date.now()}-${Math.random().toString(36).slice(2)}.parquet`
        await db.registerFileBuffer(path, bytes)
        const conn = await db.connect()
        try {
          const n = await conn.query(`SELECT count(*)::INTEGER AS n FROM read_parquet('${path}')`)
          const cols = await conn.query(`SELECT name FROM parquet_schema('${path}') WHERE name <> 'duckdb_schema'`)
          const kv = await conn.query(`SELECT decode(key) AS k, decode(value) AS v FROM parquet_kv_metadata('${path}')`)
          const geo = kv.toArray().map((r) => r.toJSON()).find((r) => r.k === 'geo')
          return {
            rows: Number(n.toArray()[0].toJSON().n),
            columns: cols.toArray().map((r) => String(r.toJSON().name)),
            geo: geo ? JSON.parse(String(geo.v)) : null,
            geoKeys: kv.toArray().filter((r) => r.toJSON().k === 'geo').length,
          }
        } finally {
          await conn.close()
          await db.dropFile(path)
        }
      },
      /** Spec 008 T024: the table filters and the narrowed row count. */
      filterState: () =>
        JSON.parse(JSON.stringify({ filters: store.filters, matching: store.filterCounts?.matching ?? null, total: store.filterCounts?.total ?? store.tableTotal, rendered: store.viewFeatures?.inView ?? null })),
      /** Spec 008 T025: the ticked rows. */
      selectionState: () => ({ kind: store.selection.kind, count: store.selectedCount, ids: store.selection.kind === 'ids' ? [...store.selection.ids] : null }),
      /** Spec 008 T025: the map's current bounds (zoom to selection). */
      mapBounds: () => store.lastViewBbox,
      /**
       * Spec 008 T049: reads exported files back in the real engine with GDAL
       * (ST_Read): row count, geometry types, CRS code. `files` are the
       * format's files (a Shapefile's parts unzipped by the test); the first
       * is the one read. Dropped afterwards.
       */
      inspectExport: async (files: Array<{ name: string; base64: string }>) => {
        const { getDuckDb } = await import('@spatial-explorer/core')
        const db = await getDuckDb(duckdbAssets)
        const dir = `/se-source/__se_check-${Date.now()}-${Math.random().toString(36).slice(2)}/`
        for (const f of files) await db.registerFileBuffer(dir + f.name, Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0)))
        const conn = await db.connect()
        const path = dir + files[0].name
        try {
          const n = await conn.query(`SELECT count(*)::INTEGER AS n, list(DISTINCT ST_GeometryType(geom)::VARCHAR) AS types FROM ST_Read('${path}')`)
          const meta = await conn.query(`SELECT layers[1].geometry_fields[1].crs.auth_code AS code FROM ST_Read_Meta('${path}')`)
          const cols = await conn.query(`SELECT column_name FROM (DESCRIBE SELECT * FROM ST_Read('${path}'))`)
          const row = n.toArray()[0].toJSON() as { n: number; types: { toArray(): unknown[] } | null }
          return {
            rows: Number(row.n),
            types: (row.types?.toArray() ?? []).map(String).sort(),
            crs: (meta.toArray()[0]?.toJSON() as { code: string | null } | undefined)?.code ?? null,
            columns: cols.toArray().map((r) => String(r.toJSON().column_name)),
          }
        } finally {
          await conn.close()
          for (const f of files) await db.dropFile(dir + f.name).catch(() => {})
        }
      },
      /** Spec 005 T023: export files still in the engine's memory (should be none). */
      exportFiles: () => {
        const qs = store.querySession
        if (!qs) throw new Error('No file is open.')
        return qs.runRaw(`SELECT file FROM glob('/se-source/__se_export*')`)
      },
      /** Spec 005 T003: what an export knows about the displayed result. */
      resultFacts: () => JSON.parse(JSON.stringify(store.querySession?.lastResult ?? null)),
      /** Spec 007 T053: range reads served by the host (PMTiles reads only parts). */
      rangeReads: () => ({ ...rangeReads }),
      /** Spec 007 T018: the open's phase and whole-file facts. */
      openState: () =>
        JSON.parse(
          JSON.stringify({
            phase: store.session.loadState === 'ready' ? 'ready' : (store.openPhase ?? store.session.loadState),
            facts: store.session.layer?.facts ?? store.openFacts,
          })
        ),
      /** Spec 007 T026: the drawn map view. */
      viewState: () => {
        const v = store.viewFeatures
        return v ? { generation: v.generation, drawn: v.features.length, inView: v.inView, thinned: v.thinned, ms: v.ms } : null
      },
      jumpTo: (lon: number, lat: number, zoom: number) => store.jumpTo([lon, lat], zoom),
      zoomToFeature: (id: number) => store.zoomToFeature(id),
      /** The first point of the drawn feature closest to the view center: a click target. */
      drawnCenter: () => {
        const v = store.lastViewBbox
        const cx = v ? (v[0] + v[2]) / 2 : 0
        const cy = v ? (v[1] + v[3]) / 2 : 0
        let best: [number, number] = [cx, cy]
        let bestD = Infinity
        for (const f of store.viewFeatures?.features ?? []) {
          if (f.geometry?.type !== 'Polygon') continue
          const ring = f.geometry.coordinates[0]
          const x = ring.reduce((s, c) => s + c[0], 0) / ring.length
          const y = ring.reduce((s, c) => s + c[1], 0) / ring.length
          const d = (x - cx) ** 2 + (y - cy) ** 2
          if (d < bestD) {
            bestD = d
            best = [x, y]
          }
        }
        return best
      },
      outsideFeatureId: () => store.outsideFeature?.id ?? null,
      drawnIds: () => [...(store.viewFeatures?.features.map((f) => f.id) ?? []), ...(store.outsideFeature ? [store.outsideFeature.id] : [])],
      /** Every drawn feature's bbox meets the last requested view (no stale view drawn). */
      drawnInsideView: () => {
        const v = store.lastViewBbox
        const features = store.viewFeatures?.features ?? []
        if (!v) return false
        const within = (c: unknown): boolean => {
          if (Array.isArray(c) && typeof c[0] === 'number') return true
          return false
        }
        return features.every((f) => {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
          const visit = (c: unknown): void => {
            if (within(c)) {
              const [x, y] = c as number[]
              x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
            } else if (Array.isArray(c)) c.forEach(visit)
          }
          if (f.geometry && 'coordinates' in f.geometry) visit(f.geometry.coordinates)
          return x0 <= v[2] && x1 >= v[0] && y0 <= v[3] && y1 >= v[1]
        })
      },
      /** Spec 003 T006: the displayed result's attribute columns and types. */
      layerColumns: () => JSON.parse(JSON.stringify(store.session.layer?.columns ?? null)),
    }
  }

  const FORMATS = ['GeoJSON', 'GeoPackage', 'FlatGeobuf', 'Shapefile', 'GeoParquet', 'CSV', 'GML', 'PMTiles']

  let isDragOver = $state(false)
  let fileName = $state<string | null>(null)
  let input: HTMLInputElement

  function handleFiles(fileList: FileList): void {
    const files = Array.from(fileList)
    if (files.length === 0) return
    // Order matters: store.load() must run first so its internal
    // hostAdapter.openFiles() call registers its pending-resolve callback
    // (synchronously, inside the Promise executor, before load()'s first
    // `await` yields control back here) BEFORE provideFiles() tries to
    // resolve it. Calling provideFiles() first resolves nothing (no pending
    // callback registered yet) and load() then awaits a promise that never
    // resolves — a real bug caught via Playwright testing, not a platform
    // issue (see tasks.md T029/T030's notes).
    void store.load()
    provideFiles(files)
    fileName = files.find((f) => !/\.(shx|dbf|prj|cpg|qml|sld)$/i.test(f.name))?.name ?? files[0].name
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault()
    isDragOver = false
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files)
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault()
    isDragOver = true
  }

  function handlePickerChange(): void {
    if (input.files && input.files.length > 0) handleFiles(input.files)
    // Allow re-picking the same file.
    input.value = ''
  }

  let idleState = $derived(store.session.loadState === 'idle')
  // A cancelled open (spec 007 FR-002/FR-004) returns to the empty state: put
  // focus back on its "Choose a file" button rather than leaving it nowhere.
  let chooseButton = $state<HTMLButtonElement>()
  $effect(() => {
    if (idleState && store.openPhase === 'cancelled') chooseButton?.focus()
  })
</script>

<input bind:this={input} type="file" multiple class="visually-hidden" tabindex="-1" aria-hidden="true" onchange={handlePickerChange} />

<!-- File drag-and-drop target for the whole window; the drop zone and the
     "Open file" button are the keyboard-accessible ways to open a file. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="shell" ondragover={handleDragOver} ondragleave={() => (isDragOver = false)} ondrop={handleDrop}>
  <header class="app-header">
    <h1 class="brand"><span class="glyph" aria-hidden="true">⬡</span>Spatial Explorer</h1>
    {#if fileName && !idleState}
      <span class="file" title={fileName}><Icon name="file" size={14} />{fileName}</span>
    {/if}
    <span class="spacer"></span>
    {#if !idleState}
      <button type="button" class="open" onclick={() => input.click()}><Icon name="import" size={14} />Open file</button>
    {/if}
  </header>

  <main class="content">
    {#if idleState}
      <!-- Empty state (no file loaded yet) — distinct from a loaded zero-feature
           file, which reaches 'ready' and is rendered by ViewerLayout instead. -->
      <div class="empty">
        <div class="drop-zone" class:drag-over={isDragOver} role="region" aria-label="Drop a geospatial file here">
          <div class="drop-icon" aria-hidden="true"><Icon name="file" size={28} /></div>
          <p class="title">Drag a geospatial file here</p>
          <p class="or">or</p>
          <button type="button" class="primary" bind:this={chooseButton} onclick={() => input.click()}>Choose a file</button>
          <ul class="formats" aria-label="Supported formats">
            {#each FORMATS as f (f)}<li>{f}</li>{/each}
          </ul>
          <p class="footnote">
            Shapefiles: select the .shp together with its .shx, .dbf and .prj. Add a same-name .qml to load its QGIS style.<br />
            Files are read in your browser and never uploaded.
          </p>
        </div>
      </div>
    {:else}
      <ViewerLayout {store} {fileName}>
        {#snippet mapOverlay()}
          <StatusBar session={store.session} facts={store.openFacts} />
        {/snippet}
      </ViewerLayout>
    {/if}
    {#if isDragOver && !idleState}
      <div class="drop-overlay" aria-hidden="true"><span>Drop to open</span></div>
    {/if}
  </main>
</div>

<style>
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .app-header {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
    height: 40px;
    padding: 0 12px 0 14px;
    background: var(--se-header-bg);
    border-bottom: 1px solid var(--se-header-border);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  .brand {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 700 11px var(--se-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--se-brand-text);
    white-space: nowrap;
  }
  .glyph {
    font-size: 16px;
    letter-spacing: 0;
  }
  .file {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 2px 8px;
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-bg-base);
    color: var(--se-text-secondary);
    font-family: var(--se-font-mono);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: 500 12px var(--se-font-ui);
    cursor: pointer;
  }
  .open:hover {
    background: var(--se-button-secondary-hover);
    color: var(--se-text-primary);
  }
  button:focus-visible {
    outline: 2px solid var(--se-focus);
    outline-offset: 2px;
  }

  .content {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .empty {
    display: grid;
    place-items: center;
    height: 100%;
    padding: 24px;
    box-sizing: border-box;
  }
  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: min(560px, 100%);
    padding: 48px 32px 32px;
    box-sizing: border-box;
    border: 2px dashed var(--se-dropzone-border);
    border-radius: 12px;
    background: var(--se-bg-elevated);
    text-align: center;
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }
  .drop-zone.drag-over {
    background: var(--se-dropzone-active-bg);
    border-color: var(--se-accent);
    border-style: solid;
  }
  .drop-icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--se-control-active-bg);
    color: var(--se-accent);
  }
  .title {
    margin: 6px 0 0;
    font: 600 15px var(--se-font-ui);
    color: var(--se-text-primary);
  }
  .or {
    margin: 0;
    font: 500 10px var(--se-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--se-text-muted);
  }
  .primary {
    height: 34px;
    padding: 0 18px;
    border: 0;
    border-radius: var(--se-radius);
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    font: 600 13px var(--se-font-ui);
    box-shadow: var(--se-shadow-card);
    cursor: pointer;
  }
  .primary:hover {
    background: var(--se-button-hover);
  }
  .formats {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }
  .formats li {
    padding: 2px 8px;
    border: 1px solid var(--se-border);
    border-radius: 999px;
    background: var(--se-bg-base);
    color: var(--se-text-secondary);
    font: 500 10.5px var(--se-font-mono);
  }
  .footnote {
    margin: 8px 0 0;
    color: var(--se-text-muted);
    font-size: 11px;
    line-height: 1.6;
  }
  .drop-overlay {
    position: absolute;
    inset: 8px;
    z-index: 50;
    display: grid;
    place-items: center;
    border: 2px solid var(--se-accent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--se-dropzone-active-bg) 70%, transparent);
    pointer-events: none;
  }
  .drop-overlay span {
    padding: 8px 14px;
    border-radius: var(--se-radius);
    background: var(--se-bg-elevated);
    box-shadow: var(--se-shadow-elevated);
    font: 600 13px var(--se-font-ui);
  }
</style>
