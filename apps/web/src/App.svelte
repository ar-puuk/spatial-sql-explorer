<script lang="ts">
  // Web shell chrome (design-plan.md §4.3, §5.4): a slim branded header, the
  // legacy app's drop zone as the empty state, and the shared ViewerLayout
  // with the status bar docked over the map. VS Code renders none of this —
  // it has native chrome for each.
  import { ViewerLayout, StatusBar, Icon, createViewerStore, type LegendSpec } from '@spatial-explorer/ui'
  import { decodeShareState, encodeShareState, peekDuckDb, SHARE_MAX_LENGTH, type ShareState } from '@spatial-explorer/core'
  import { createWebHostAdapter, provideFiles, rangeReads, setThemePreference, type ThemePreference } from './hostAdapter.js'
  import ThemeMenu from './ThemeMenu.svelte'
  import Landing from './Landing.svelte'
  /** The project's source code, linked from the header. */
  const REPO_URL = 'https://github.com/ar-puuk/spatial-sql-explorer'

  // Spec 008 research §15: the engine is downloaded from pinned URLs and
  // hash-checked (core engineAssets.ts); test builds serve the same files
  // from the app's own origin (VITE_ENGINE_MIRROR).
  const hostAdapter = createWebHostAdapter()
  // The host keeps a local copy (Cache Storage): offline after the first start.
  const duckdbAssets = { mirror: (import.meta.env.VITE_ENGINE_MIRROR as string | undefined) || undefined, host: hostAdapter }

  // Spec 008 FR-022: the theme choice (System follows the OS), remembered.
  let themePreference = $state<ThemePreference>('system')
  void hostAdapter
    .loadState<ThemePreference>('theme')
    .then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        themePreference = saved
        setThemePreference(saved)
      }
    })
    .catch(() => {})
  function chooseTheme(value: ThemePreference): void {
    themePreference = value
    setThemePreference(value)
    void hostAdapter.saveState('theme', value).catch(() => {})
  }
  const store = createViewerStore(hostAdapter, duckdbAssets)

  // Warm DuckDB up while the user is still choosing a file (design-plan.md
  // §8.2), but after first paint so the drop zone shows immediately.
  const idle = (cb: () => void): void => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(cb, { timeout: 2000 })
    else setTimeout(cb, 300)
  }
  // The landing page shows when the engine is ready: it watches the start
  // prewarm began, and never starts one itself.
  let engine = $state<'warming' | 'ready' | 'failed'>('warming')
  idle(() => {
    store.prewarm()
    peekDuckDb()?.then(
      () => (engine = 'ready'),
      () => (engine = 'failed')
    )
  })

  // Test-only escape hatch (spec 002 T036), enabled by ?e2e=1: runs SQL with
  // NO statement policy, so browser tests can prove the ENGINE lockdown on its
  // own. The lockdown (duckdbService.lockDown), not this hook, is the
  // security boundary: everything sent here is still refused file, network,
  // extension and settings access.
  // MapView publishes data-rendered-features for tests (?e2e=1, or a browser under automation).
  if (navigator.webdriver || new URLSearchParams(location.search).has('e2e')) document.documentElement.dataset.seTestHooks = ''
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
        JSON.parse(JSON.stringify({ filters: store.filters, matching: store.filterCounts?.matching ?? null, total: store.filterCounts?.total ?? store.tableTotal, rendered: store.mapData?.features.length ?? null })),
      /** Spec 008 T025: the ticked rows. */
      selectionState: () => ({ kind: store.selection.kind, count: store.selectedCount, ids: store.selection.kind === 'ids' ? [...store.selection.ids] : null }),
      /** Spec 008 T064: the map's projection and camera. */
      mapState: () => ({ projection: store.projection, extrusion: store.extruded, ...(store.mapCamera ?? {}) }),
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
      /** Spec 010: how the map draws the result: the mode, the features in memory (GeoJSON), the tile URL. */
      drawState: () => ({ mode: store.drawMode, features: store.mapData?.features.length ?? null, tileUrl: store.tileUrl, loading: store.drawLoading, loadedAll: store.loadedAll }),
      /** Spec 010: engine calls made to draw (allFeatures and tiles); none while panning in GeoJSON mode. */
      drawCalls: () => store.drawCalls,
      /** Spec 010: engine tiles built, and served from the tile cache. */
      tileStats: async () => (await import('@spatial-explorer/ui')).engineTileStats(),
      jumpTo: (lon: number, lat: number, zoom: number) => store.jumpTo([lon, lat], zoom),
      /** Spec 008 US7: the link Copy link would copy. */
      shareLink: () => shareUrl(),
      /** Spec 008 US7: the map as a PNG (base64), without saving. */
      captureMap: async (scale: 1 | 2, legend: boolean | LegendSpec = false) => {
        // A test legend: one red row, or the spec the test passes (spec 009: groups).
        const legendSpec = typeof legend === 'object' ? legend : legend ? { title: 'Legend', shape: 'area' as const, alpha: 1, rows: [{ color: '#ff0000', label: 'Test' }] } : null
        const r = await store.captureMapImage({ scale, legend: legendSpec })
        if (!r) return null
        let bin = ''
        for (let i = 0; i < r.bytes.length; i += 0x8000) bin += String.fromCharCode(...r.bytes.subarray(i, i + 0x8000))
        return { width: r.width, height: r.height, notes: r.notes, base64: btoa(bin) }
      },
      zoomToFeature: (id: number) => store.zoomToFeature(id),
      /** The first point of the drawn feature closest to the view center: a click target. */
      drawnCenter: () => {
        const v = store.lastViewBbox
        const cx = v ? (v[0] + v[2]) / 2 : 0
        const cy = v ? (v[1] + v[3]) / 2 : 0
        let best: [number, number] = [cx, cy]
        let bestD = Infinity
        for (const f of store.mapData?.features ?? []) {
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
      drawnIds: () => [...(store.mapData?.features.map((f) => f.id) ?? []), ...(store.outsideFeature ? [store.outsideFeature.id] : [])],
      /** Spec 003 T006: the displayed result's attribute columns and types. */
      layerColumns: () => JSON.parse(JSON.stringify(store.session.layer?.columns ?? null)),
    }
  }

  let isDragOver = $state(false)
  let fileName = $state<string | null>(null)
  let input: HTMLInputElement

  function handleFiles(fileList: FileList | File[]): void {
    const files = Array.from(fileList)
    isSample = files.length === 1 && files[0] === sampleFile
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

  // --- Spec 008 US7 (FR-031): the share link -----------------------------
  // `#v1=…` holds the query, style, basemap, projection and view, and the
  // file's name and size; never data or paths. Opening one asks for that
  // file (or opens the sample), then applies what it holds.
  const SAMPLE_URL = `${import.meta.env.BASE_URL}sample/us-counties.parquet`
  let sampleFile: File | null = null
  let isSample = false
  let pendingShare = $state.raw<{ state: Partial<ShareState>; dropped: string[] } | null>(null)
  let shareNotice = $state<{ kind: 'info' | 'warning'; text: string } | null>(null)
  let copyStatus = $state<string | null>(null)
  let longQuery = $state<string | null>(null)
  let applying = false

  async function openSample(): Promise<void> {
    try {
      const res = await fetch(SAMPLE_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      sampleFile = new File([await res.blob()], 'us-counties.parquet')
      handleFiles([sampleFile])
    } catch (err) {
      shareNotice = { kind: 'warning', text: `The sample data could not be loaded: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  if (location.hash.startsWith('#v1=')) {
    const parsed = decodeShareState(location.hash)
    if (!parsed) shareNotice = { kind: 'warning', text: 'This link could not be read: it may be cut short or from a newer version.' }
    else {
      pendingShare = parsed
      if (parsed.state.source?.kind === 'sample') void openSample()
    }
  }

  /** What a link made now would hold. */
  function currentShare(): ShareState | null {
    if (!fileName || store.session.loadState !== 'ready') return null
    const cam = store.mapCamera
    return {
      v: 1,
      source: isSample ? { kind: 'sample' } : { kind: 'file', name: fileName, size: store.openedSize ?? 0 },
      ...(store.activeLayer ? { layer: store.activeLayer } : {}),
      query: store.lastRunText ?? '',
      style: JSON.parse(JSON.stringify(store.style)),
      basemap: store.basemap.id,
      projection: store.projection,
      view: cam ? { center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing } : { center: [0, 0], zoom: 1, pitch: 0, bearing: 0 },
    }
  }
  function shareUrl(): string | null {
    const s = currentShare()
    return s ? `${location.origin}${location.pathname}#${encodeShareState(s)}` : null
  }

  async function copyText(text: string, done: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      copyStatus = done
    } catch {
      copyStatus = 'The clipboard is not available here.'
    }
    setTimeout(() => (copyStatus = null), 2500)
  }
  async function copyLink(): Promise<void> {
    const url = shareUrl()
    if (!url) return
    longQuery = null
    if (url.length > SHARE_MAX_LENGTH) {
      // Spec edge case: an over-long link (a long query) is refused; the query can still be copied.
      longQuery = store.lastRunText
      shareNotice = { kind: 'warning', text: `A link would be ${url.length.toLocaleString('en-US')} characters long (the limit is ${SHARE_MAX_LENGTH.toLocaleString('en-US')}), because of the query.` }
      return
    }
    await copyText(url, 'Link copied')
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  /** After the file opened: layer, query, style, basemap, projection, view, in that order (contracts/host-and-shells.md). */
  async function applyShare(share: { state: Partial<ShareState>; dropped: string[] }): Promise<void> {
    const { state } = share
    const failed = share.dropped.map((d) => (d === 'file' ? 'the file name' : `the ${d}`))
    const notes: string[] = []
    if (state.source?.kind === 'file' && !isSample && (state.source.name !== fileName || (store.openedSize !== null && state.source.size && store.openedSize !== state.source.size))) {
      notes.push(`The link was made with ${state.source.name}; you opened ${fileName}, which may differ.`)
    }
    if (state.layer && state.layer !== store.activeLayer) {
      if (store.fileLayers.some((l) => l.name === state.layer)) await store.switchLayer(state.layer).catch(() => failed.push('the layer'))
      else failed.push(`the layer "${state.layer}"`)
    }
    if (state.query?.trim()) {
      store.setQueryText(state.query)
      await store.runQuery({ from: 0, to: state.query.length })
      if (store.queryError) failed.push(`the query (${store.queryError.message})`)
    }
    if (state.style) store.setStyle(state.style)
    if (state.basemap) store.setBasemap(state.basemap)
    if (state.projection) store.setProjection(state.projection)
    if (state.view) {
      // After the new result's fit to its extent, which would move the map again.
      await wait(400)
      store.jumpTo(state.view.center, state.view.zoom, state.view.pitch, state.view.bearing)
    }
    const parts = [...notes]
    if (failed.length) parts.push(`Not applied: ${failed.join(', ')}.`)
    shareNotice = parts.length ? { kind: 'warning', text: parts.join(' ') } : { kind: 'info', text: 'The shared view was applied.' }
    // Applied once: a reload doesn't ask again.
    history.replaceState(null, '', location.pathname + location.search)
  }
  $effect(() => {
    const share = pendingShare
    if (!share || applying || store.session.loadState !== 'ready' || !fileName) return
    applying = true
    pendingShare = null
    void applyShare(share).finally(() => (applying = false))
  })

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
    <h1 class="brand"><img class="glyph" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="20" height="20" />Spatial Explorer</h1>
    {#if fileName && !idleState}
      <span class="file" title={fileName}><Icon name="file" size={14} />{fileName}</span>
    {/if}
    <span class="spacer"></span>
    {#if copyStatus}<span class="copy-status" role="status">{copyStatus}</span>{/if}
    <!-- Actions on the open file, then (after a divider) the app's own: theme and source code. -->
    {#if !idleState}
      <div class="actions">
        <button type="button" class="open" disabled={store.session.loadState !== 'ready'} title="Copy a link to this view (the file itself is not shared)" onclick={() => void copyLink()}
          ><Icon name="link" size={14} />Copy link</button
        >
        <button type="button" class="open primary" onclick={() => input.click()}><Icon name="import" size={14} />Open file</button>
      </div>
      <span class="divider" aria-hidden="true"></span>
    {/if}
    <div class="utilities">
      <ThemeMenu value={themePreference} onChange={chooseTheme} />
      <a class="icon-link" href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="Spatial Explorer on GitHub (opens a new tab)" title="Source code on GitHub">
        <!-- GitHub's mark (Octicons mark-github, MIT; see THIRD-PARTY-NOTICES.md). -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" /></svg>
      </a>
    </div>
  </header>

  {#if shareNotice}
    <div class="share-notice {shareNotice.kind}" role={shareNotice.kind === 'warning' ? 'alert' : 'status'}>
      <Icon name={shareNotice.kind === 'warning' ? 'warning' : 'info'} size={14} />
      <span>{shareNotice.text}</span>
      {#if longQuery}
        <button type="button" class="open" onclick={() => void copyText(longQuery ?? '', 'Query copied')}>Copy query</button>
      {/if}
      <button type="button" class="dismiss" aria-label="Dismiss" onclick={() => ((shareNotice = null), (longQuery = null))}><Icon name="close" size={14} /></button>
    </div>
  {/if}

  <main class="content">
    {#if idleState}
      <!-- Empty state (no file loaded yet) — distinct from a loaded zero-feature
           file, which reaches 'ready' and is rendered by ViewerLayout instead. -->
      <Landing
        {isDragOver}
        {engine}
        sharedFileName={pendingShare?.state.source?.kind === 'file' ? pendingShare.state.source.name : null}
        onChoose={() => input.click()}
        onSample={() => void openSample()}
        bind:chooseButton
      />
    {:else}
      <ViewerLayout {store} {fileName}>
        {#snippet statusBar()}
          <StatusBar
            docked
            session={store.session}
            facts={store.openFacts}
            draw={{
              mode: store.drawMode,
              features: store.mapData?.features.length ?? null,
              loading: store.drawLoading,
              progress: store.drawProgress,
              loadedAll: store.loadedAll,
              onLoadAll: () => store.loadAll(),
              onDrawAsTiles: () => store.drawAsTiles(),
            }}
          />
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
  }
  .brand {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 600 14px var(--se-font-ui);
    letter-spacing: -0.005em;
    color: var(--se-brand-text);
    white-space: nowrap;
  }
  .glyph {
    display: block;
    width: 20px;
    height: 20px;
    flex: none;
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
    color: var(--se-text-primary);
    font-size: 12.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .actions,
  .utilities {
    display: flex;
    align-items: center;
  }
  .actions {
    gap: 8px;
  }
  .utilities {
    gap: 2px;
  }
  .divider {
    width: 1px;
    height: 18px;
    background: var(--se-header-border);
  }
  /* The primary action: the accent button, as VS Code's primary buttons. */
  .open.primary {
    border-color: transparent;
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  .open.primary:hover {
    background: var(--se-button-hover);
    color: var(--se-button-fg);
  }
  /* As the theme button: an icon, quiet until hovered. */
  .icon-link {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--se-radius-sm);
    color: var(--se-text-secondary);
  }
  .icon-link:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .icon-link:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .open {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 11px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: 500 13px var(--se-font-ui);
    cursor: pointer;
  }
  .open:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .copy-status {
    color: var(--se-text-secondary);
    font-size: 12px;
  }
  .share-notice {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 6px 12px;
    border-bottom: 1px solid var(--se-border);
    font-size: 12px;
  }
  .share-notice.info {
    background: color-mix(in srgb, var(--se-info) 10%, var(--se-bg-base));
  }
  .share-notice.warning {
    background: var(--se-warning-bg);
    color: var(--se-warning-fg, var(--se-text-primary));
  }
  .share-notice span {
    flex: 1;
  }
  .share-notice .dismiss {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
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
