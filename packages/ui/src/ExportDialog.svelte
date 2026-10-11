<script lang="ts">
  // Export dialog (spec 005 FR-001/FR-002/FR-006/FR-009/FR-014,
  // contracts/host-and-ui.md). Everything shown comes from the store's
  // ExportPlan, so what the dialog says is what the export does: rows,
  // format, CRS, CSV geometry, and every change a format forces, before
  // anything runs.
  import { onDestroy, onMount, tick } from 'svelte'
  import { EXPORT_FORMATS, type ExportFormatId, type ExportScope } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
    onClose: () => void
  }
  let { store, onClose }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const plan = $derived(store.exportPlan)
  const request = $derived(store.exportRequest)
  const running = $derived(store.exportPhase === 'running')
  const outcome = $derived(store.exportOutcome)
  const hasGeometry = $derived(plan?.geometryColumn !== null && plan?.geometryColumn !== undefined)
  const withGeometry = EXPORT_FORMATS.filter((f) => f.group !== 'attributes')
  const attributesOnly = EXPORT_FORMATS.filter((f) => f.group !== 'spatial')
  /** Spec 008 (user request): one line on what each format is good for. */
  const ABOUT: Record<ExportFormatId, string> = {
    geoparquet: 'Columnar and compact; keeps the CRS. Reads in QGIS, DuckDB and GeoPandas.',
    geopackage: "A single SQLite file; keeps the CRS. QGIS's default format.",
    geojson: 'Text, for the web. Always WGS 84.',
    flatgeobuf: 'Binary and streamable; keeps the CRS.',
    shapefile: '.shp, .dbf, .shx and .prj in one zip. Field names are cut to 10 characters.',
    kml: 'For Google Earth. Always WGS 84.',
    geojsonseq: 'One GeoJSON feature per line. Always WGS 84.',
    csv: 'A plain text table.',
    parquet: 'Columnar and compact.',
    xlsx: 'An Excel workbook, one sheet.',
    json: 'An array of row objects.',
  }
  const SCOPE_LABEL: Record<ExportScope, string> = { all: 'All rows', filtered: 'Filtered rows', selected: 'Selected rows' }

  // The CRS choice: the result's, WGS 84, Web Mercator, or any EPSG code (checked by the engine).
  const WEB_MERCATOR = 3857
  // svelte-ignore state_referenced_locally
  let otherChosen = $state(request.crs === 'custom' && request.crsCode !== WEB_MERCATOR)
  // svelte-ignore state_referenced_locally
  let epsgText = $state(request.crs === 'custom' && request.crsCode !== WEB_MERCATOR && request.crsCode ? String(request.crsCode) : '')
  let epsgInput = $state<HTMLInputElement>()
  const crsChoice = $derived(
    plan?.crs.forced ? 'wgs84' : request.crs !== 'custom' ? request.crs : !otherChosen && request.crsCode === WEB_MERCATOR ? 'webmercator' : 'other'
  )
  const resultIsWgs84 = $derived(plan?.crs.resultLabel.startsWith('EPSG:4326') ?? false)
  const check = $derived(store.exportCrsCheck)

  /** "26912", "EPSG:26912": the code; empty: none; anything else: 0 (the engine says why). */
  const parseCode = (text: string): number | undefined => {
    if (!text.trim()) return undefined
    const m = /^\s*(?:epsg\s*:?)?\s*(\d{1,6})\s*$/i.exec(text)
    return m ? Number(m[1]) : 0
  }
  let typing: ReturnType<typeof setTimeout> | null = null
  function commitCode(): void {
    if (typing) clearTimeout(typing)
    typing = null
    store.setExportRequest({ crs: 'custom', crsCode: parseCode(epsgText) })
  }
  function chooseCrs(v: string): void {
    otherChosen = v === 'other'
    if (!otherChosen && typing) clearTimeout(typing)
    if (v === 'result' || v === 'wgs84') store.setExportRequest({ crs: v })
    else if (v === 'webmercator') store.setExportRequest({ crs: 'custom', crsCode: WEB_MERCATOR })
    else {
      commitCode()
      void tick().then(() => epsgInput?.focus())
    }
  }

  /** Format options carry the geometry choice: CSV is in both groups. */
  const formatValue = $derived(plan ? `${plan.includeGeometry ? 'g' : 'a'}:${plan.format}` : '')
  function chooseFormat(value: string): void {
    const [g, id] = value.split(':')
    store.setExportRequest({ format: id as ExportFormatId, includeGeometry: g === 'g' })
  }

  let dialog = $state<HTMLDivElement>()
  let now = $state(performance.now())
  let timer: ReturnType<typeof setInterval> | null = null
  $effect(() => {
    if (running && !timer) timer = setInterval(() => (now = performance.now()), 250)
    if (!running && timer) {
      clearInterval(timer)
      timer = null
    }
  })
  onDestroy(() => {
    if (timer) clearInterval(timer)
    if (typing) clearTimeout(typing)
  })

  const progressText = $derived.by(() => {
    const p = store.exportProgress
    if (!p) return 'Preparing…'
    const s = (now - p.startedAt) / 1000
    const elapsed = s >= 1 ? ` · ${s.toFixed(1)} s` : ''
    return p.rows === null ? `Writing ${plan?.rowCount !== undefined ? nf.format(plan.rowCount) + ' rows' : ''}…${elapsed}` : `${nf.format(p.rows)} rows written${elapsed}`
  })

  const size = (bytes: number): string =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`

  function close(): void {
    if (running) return
    onClose()
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (running) void store.cancelExport()
      else close()
      return
    }
    if (e.key === 'Enter' && e.target === epsgInput) {
      e.preventDefault()
      commitCode()
      return
    }
    if (e.key === 'Enter' && !running && !store.exportDisabled && !store.exportCrsProblem && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault()
      void store.runExport()
      return
    }
    // Keep focus inside the modal.
    if (e.key === 'Tab' && dialog) {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  onMount(() => {
    void tick().then(() => dialog?.querySelector<HTMLElement>('.body select:not([disabled]), button.primary')?.focus())
  })
</script>

<div class="backdrop" role="presentation" onkeydown={onKeydown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Export data" bind:this={dialog}>
    <header>
      <h2>Export data</h2>
      <button type="button" class="icon-button" aria-label="Close" title="Close" disabled={running} onclick={close}><Icon name="close" /></button>
    </header>

    {#if !plan || plan.blocked}
      <p class="blocked" role="status">{plan?.blocked ?? store.exportDisabled ?? 'Nothing to export yet.'}</p>
    {:else}
      <div class="body">
        {#if plan.scopes.length > 1}
          <!-- Spec 008 FR-014: all rows, the filtered rows, or the selected rows. -->
          <div class="setting">
            <label for="export-rows">Rows</label>
            <select id="export-rows" value={plan.scope} disabled={running} onchange={(e) => store.setExportRequest({ scope: e.currentTarget.value as ExportScope })}>
              {#each plan.scopes as sc (sc.id)}
                <option value={sc.id}>{SCOPE_LABEL[sc.id]} ({nf.format(sc.rows)})</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- Spec 008 FR-019: the format list is grouped by whether the geometry is written. -->
        <div class="setting">
          <label for="export-format">Format</label>
          <select id="export-format" value={formatValue} disabled={running} aria-describedby="export-format-about" onchange={(e) => chooseFormat(e.currentTarget.value)}>
            {#if hasGeometry}
              <optgroup label="With geometry">
                {#each withGeometry as f (f.id)}<option value={`g:${f.id}`}>{f.label}</option>{/each}
              </optgroup>
            {/if}
            <optgroup label="Attributes only">
              {#each attributesOnly as f (f.id)}<option value={`a:${f.id}`}>{f.label}</option>{/each}
            </optgroup>
          </select>
          <p class="desc" id="export-format-about">
            {plan.format === 'csv' && plan.includeGeometry ? 'A plain text table, with the geometry as text or X / Y columns.' : ABOUT[plan.format]}
            <span class="file">{plan.fileName}</span>
          </p>
        </div>

        {#if plan.includeGeometry}
          <div class="setting">
            <label for="export-crs">Coordinate reference system</label>
            <select id="export-crs" value={crsChoice} disabled={running || plan.crs.forced} title={plan.crs.reason} onchange={(e) => chooseCrs(e.currentTarget.value)}>
              {#if plan.crs.forced}
                <option value="wgs84">EPSG:4326 · WGS 84</option>
              {:else}
                <option value="result">{plan.crs.resultLabel} · as the result</option>
                {#if !resultIsWgs84}<option value="wgs84">EPSG:4326 · WGS 84</option>{/if}
                <option value="webmercator">EPSG:3857 · Web Mercator</option>
                <option value="other">Other EPSG code…</option>
              {/if}
            </select>
            {#if plan.crs.forced}
              <p class="desc">{plan.crs.reason}</p>
            {:else if crsChoice === 'other'}
              <div class="epsg">
                <span class="prefix" aria-hidden="true">EPSG:</span>
                <input
                  id="export-epsg"
                  bind:this={epsgInput}
                  type="text"
                  inputmode="numeric"
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="EPSG code"
                  aria-describedby="export-epsg-status"
                  aria-invalid={check?.state === 'invalid'}
                  placeholder="26912"
                  disabled={running}
                  value={epsgText}
                  oninput={(e) => {
                    epsgText = e.currentTarget.value
                    if (typing) clearTimeout(typing)
                    typing = setTimeout(commitCode, 300)
                  }}
                  onblur={() => {
                    // Leaving "Other" removes the box, which blurs it: nothing to commit then.
                    if (otherChosen) commitCode()
                  }}
                />
              </div>
              <p class="desc" id="export-epsg-status" class:invalid={check?.state === 'invalid'} role="status">
                {#if !check}Enter an EPSG code, e.g. 26912.{:else if check.state === 'checking'}Checking…{:else if check.state === 'ok'}<Icon name="check" size={12} />{check.name}{:else}{check.reason}{/if}
              </p>
            {/if}
          </div>
        {/if}

        {#if plan.format === 'csv' && plan.includeGeometry}
          <div class="setting">
            <label for="export-csv-geometry">Geometry as</label>
            <select id="export-csv-geometry" value={plan.csvGeometry} disabled={running} onchange={(e) => store.setExportRequest({ csvGeometry: e.currentTarget.value as 'wkt' | 'xy' })}>
              <option value="wkt">WKT text</option>
              <option value="xy" disabled={!plan.xyAvailable}>X / Y columns{plan.xyAvailable ? '' : ' (points only)'}</option>
            </select>
          </div>
        {/if}

        {#if outcome?.kind === 'saved'}
          <p class="result ok" role="status">
            <Icon name="check" size={14} />Saved {outcome.location}: {nf.format(outcome.rows)}
            {outcome.rows === 1 ? 'row' : 'rows'} ({size(outcome.bytes)}).
          </p>
        {:else if outcome?.kind === 'failed'}
          <p class="result error" role="alert"><Icon name="error" size={14} />{outcome.message}</p>
        {:else if outcome?.kind === 'cancelled'}
          <p class="result" role="status">Export cancelled. Nothing was saved.</p>
        {/if}

        {#if (outcome?.kind === 'saved' ? outcome.notices : plan.notices).length}
          <ul class="notices" aria-label="What changes in this format">
            {#each outcome?.kind === 'saved' ? outcome.notices : plan.notices as n (n)}
              <li><Icon name="info" size={14} /><span>{n}</span></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <footer>
      {#if running}
        <div class="progress" role="status" aria-live="polite">
          <span class="bar" class:indeterminate={store.exportProgress?.rows === null}>
            <span style:width={store.exportProgress && store.exportProgress.rows !== null && plan ? `${Math.min(100, (store.exportProgress.rows / Math.max(plan.rowCount, 1)) * 100)}%` : undefined}></span>
          </span>
          <span class="text">{progressText}</span>
        </div>
        <button type="button" class="secondary" onclick={() => void store.cancelExport()}>Cancel export</button>
      {:else}
        <span class="spacer"></span>
        <button type="button" class="secondary" onclick={close}>{outcome?.kind === 'saved' ? 'Done' : 'Cancel'}</button>
        <button
          type="button"
          class="primary"
          disabled={!plan || !!plan.blocked || !!store.exportDisabled || !!store.exportCrsProblem}
          title={store.exportDisabled ?? store.exportCrsProblem ?? undefined}
          onclick={() => void store.runExport()}
        >
          <Icon name="export" size={14} />Export…
        </button>
      {/if}
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: 16px;
    /* A neutral scrim: the page background color would vanish over panels of the same color. */
    background: color-mix(in srgb, black 40%, transparent);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(460px, 100%);
    max-height: 100%;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--se-border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .body {
    display: grid;
    gap: 14px;
    padding: 14px 12px;
    overflow-y: auto;
  }
  .blocked {
    margin: 0;
    padding: 16px 12px;
    color: var(--se-text-secondary);
  }
  .setting {
    display: grid;
    gap: 4px;
  }
  .setting label {
    font-weight: 600;
  }
  .desc {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .desc.invalid {
    color: var(--se-error-fg, var(--se-error));
  }
  .desc .file {
    font-family: var(--se-font-mono, monospace);
    color: var(--se-text-muted, var(--se-text-secondary));
  }
  select,
  .epsg {
    width: 100%;
    min-width: 0;
    height: 26px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  select {
    padding: 0 4px;
  }
  select:disabled {
    opacity: 0.7;
  }
  .epsg {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    padding: 0 6px;
  }
  .epsg:focus-within {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .epsg .prefix {
    color: var(--se-text-secondary);
  }
  .epsg input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 2px;
    border: 0;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .notices {
    display: grid;
    gap: 4px;
    margin: 0;
    padding: 8px;
    list-style: none;
    background: color-mix(in srgb, var(--se-info) 8%, transparent);
    border-left: 2px solid var(--se-info);
    border-radius: var(--se-radius-sm);
    font-size: 0.92em;
  }
  .notices li {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .notices :global(.icon) {
    flex: none;
    margin-top: 2px;
    color: var(--se-info);
  }
  .result {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
  }
  .result.ok :global(.icon) {
    color: var(--se-success, var(--se-info));
  }
  .result.error {
    color: var(--se-error-fg, var(--se-error));
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--se-border);
  }
  .spacer {
    flex: 1;
  }
  .progress {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .bar {
    position: relative;
    flex: none;
    width: 120px;
    height: 4px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--se-border);
  }
  .bar span {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--se-accent);
  }
  .bar.indeterminate span {
    width: 35%;
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      left: -35%;
    }
    to {
      left: 100%;
    }
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: var(--se-text-secondary);
  }
  footer button.primary,
  footer button.secondary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    font: inherit;
    cursor: pointer;
  }
  .primary {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  .primary:hover {
    background: var(--se-button-hover);
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .secondary {
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
  }
  .secondary:hover {
    background: var(--se-button-secondary-hover);
  }
  .icon-button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  select:focus-visible,
  footer button:focus-visible,
  .icon-button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  @media (prefers-reduced-motion: reduce) {
    .bar.indeterminate span {
      animation: none;
      width: 100%;
      opacity: 0.5;
    }
  }
</style>
