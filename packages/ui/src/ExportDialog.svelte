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
  const available = $derived(EXPORT_FORMATS.filter((f) => plan?.formats.find((x) => x.id === f.id)?.available))
  const hasGeometry = $derived(plan?.geometryColumn !== null && plan?.geometryColumn !== undefined)

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

  function chooseFormat(id: ExportFormatId): void {
    store.setExportRequest({ format: id })
  }

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
    if (e.key === 'Enter' && !running && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement)) {
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

  /** Radio groups: arrows move and select (WAI-ARIA radio group). */
  function radioKeys(e: KeyboardEvent, values: string[], current: string, pick: (v: string) => void): void {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const next = values[(values.indexOf(current) + dir + values.length) % values.length]
    pick(next)
    const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]')
    void tick().then(() => group?.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus())
  }

  onMount(() => {
    void tick().then(() => dialog?.querySelector<HTMLElement>('[aria-checked="true"], button.primary')?.focus())
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
          <div class="field">
            <span class="label" id="export-rows">Rows</span>
            <div class="options" role="radiogroup" aria-labelledby="export-rows">
              {#each plan.scopes as sc (sc.id)}
                {@const label = `${sc.id === 'all' ? 'All' : sc.id === 'filtered' ? 'Filtered' : 'Selected'} (${sc.rows.toLocaleString('en-US')})`}
                <button
                  type="button"
                  role="radio"
                  data-value={sc.id}
                  aria-checked={plan.scope === sc.id}
                  tabindex={plan.scope === sc.id ? 0 : -1}
                  disabled={running}
                  onclick={() => store.setExportRequest({ scope: sc.id })}
                  onkeydown={(e) =>
                    radioKeys(
                      e,
                      plan.scopes.map((x) => x.id),
                      plan.scope,
                      (v) => store.setExportRequest({ scope: v as ExportScope })
                    )}>{label}</button
                >
              {/each}
            </div>
          </div>
        {/if}
        <div class="field">
          <span class="label" id="export-format">Format</span>
          <div class="options" role="radiogroup" aria-labelledby="export-format">
            {#each available as f (f.id)}
              <button
                type="button"
                role="radio"
                data-value={f.id}
                aria-checked={plan.format === f.id}
                tabindex={plan.format === f.id ? 0 : -1}
                disabled={running}
                onclick={() => chooseFormat(f.id)}
                onkeydown={(e) =>
                  radioKeys(
                    e,
                    available.map((x) => x.id),
                    plan.format,
                    (v) => chooseFormat(v as ExportFormatId)
                  )}>{f.label}</button
              >
            {/each}
          </div>
        </div>

        {#if hasGeometry && plan.format !== 'parquet'}
          <div class="field">
            <label class="label" for="export-crs">CRS</label>
            <select
              id="export-crs"
              value={plan.crs.forced ? 'wgs84' : request.crs}
              disabled={running || plan.crs.forced}
              title={plan.crs.reason}
              onchange={(e) => store.setExportRequest({ crs: e.currentTarget.value as 'result' | 'wgs84' })}
            >
              {#if plan.crs.forced}
                <option value="wgs84">EPSG:4326 (WGS84), required by GeoJSON</option>
              {:else}
                <option value="result">{plan.crs.output === 'result' ? plan.crs.label : 'Result CRS'} (result)</option>
                <option value="wgs84">EPSG:4326 (WGS84)</option>
              {/if}
            </select>
          </div>
          {#if plan.crs.forced}<p class="hint">{plan.crs.reason}</p>{/if}
        {/if}

        {#if plan.format === 'csv' && hasGeometry}
          <div class="field">
            <span class="label" id="export-geometry">Geometry</span>
            <div class="options" role="radiogroup" aria-labelledby="export-geometry">
              {#each [{ v: 'wkt', label: 'WKT text' }, { v: 'xy', label: 'X / Y columns' }] as o (o.v)}
                <button
                  type="button"
                  role="radio"
                  data-value={o.v}
                  aria-checked={plan.csvGeometry === o.v}
                  tabindex={plan.csvGeometry === o.v ? 0 : -1}
                  disabled={running || (o.v === 'xy' && !plan.xyAvailable)}
                  title={o.v === 'xy' && !plan.xyAvailable ? 'X / Y columns are for point layers only.' : undefined}
                  onclick={() => store.setExportRequest({ csvGeometry: o.v as 'wkt' | 'xy' })}
                  onkeydown={(e) => radioKeys(e, plan.xyAvailable ? ['wkt', 'xy'] : ['wkt'], plan.csvGeometry, (v) => store.setExportRequest({ csvGeometry: v as 'wkt' | 'xy' }))}
                  >{o.label}</button
                >
              {/each}
            </div>
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
          disabled={!plan || !!plan.blocked || !!store.exportDisabled}
          title={store.exportDisabled ?? undefined}
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
    gap: 10px;
    padding: 12px;
    overflow-y: auto;
  }
  .blocked {
    margin: 0;
    padding: 16px 12px;
    color: var(--se-text-secondary);
  }
  .field {
    display: grid;
    grid-template-columns: 72px 1fr;
    align-items: center;
    gap: 8px;
  }
  .label {
    color: var(--se-text-secondary);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    overflow: hidden;
    justify-self: start;
  }
  .options button {
    height: 24px;
    padding: 0 10px;
    border: 0;
    border-left: 1px solid var(--se-input-border);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .options button:first-child {
    border-left: 0;
  }
  .options button[aria-checked='true'] {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    /* High contrast has no filled button: the active contrast border marks the choice. */
    box-shadow: inset 0 0 0 1px var(--se-selected-indicator);
  }
  .options button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  select {
    min-width: 0;
    height: 24px;
    padding: 0 4px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  .hint {
    margin: -4px 0 0 80px;
    color: var(--se-text-secondary);
    font-size: 0.9em;
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
  .options button:focus-visible,
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
