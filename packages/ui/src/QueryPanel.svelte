<script lang="ts">
  // The query panel (spec 002, contracts/ui-query-panel.md): header with the
  // queryable table and the controls, the SQL editor, and a status line that
  // always says what happened (FR-010) plus the Result CRS chip (FR-014).
  import { onDestroy } from 'svelte'
  import type { Diagnostic } from '@codemirror/lint'
  import type { CompletionSource } from '@codemirror/autocomplete'
  import type { SQLNamespace } from '@codemirror/lang-sql'
  import SqlEditor from './SqlEditor.svelte'
  import { functionSource, pathSource, schemaFromCatalog } from './completion.js'
  import ResultCrsChip from './ResultCrsChip.svelte'
  import QueryHistory from './QueryHistory.svelte'
  import Icon from './Icon.svelte'
  import UnavailableNotice from './UnavailableNotice.svelte'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
    collapsed: boolean
    onToggle: () => void
    /** Spec 010: inside the bottom panel's SQL tab, which shows and hides it (no toggle of its own). */
    embedded?: boolean
    schema?: SQLNamespace
    completionSources?: CompletionSource[]
  }
  let { store, collapsed, onToggle, embedded = false, schema: schemaProp, completionSources: sourcesProp }: Props = $props()
  // FR-015: completion from the live catalog unless a caller supplies its own.
  const schema = $derived(schemaProp ?? schemaFromCatalog(store.catalog))
  const completionSources = $derived<CompletionSource[]>(sourcesProp ?? [functionSource(store.catalog), pathSource(store.workspaceFiles)])

  const DOCS_URL = 'https://duckdb.org/docs/stable/core_extensions/spatial/functions'
  const nf = new Intl.NumberFormat('en-US')

  let editor = $state<SqlEditor>()
  /** Inline confirmation (webviews block window.confirm). */
  let confirmReset = $state(false)
  let historyOpen = $state(false)
  let historyButton = $state<HTMLButtonElement>()

  function closeHistory(refocus = true): void {
    historyOpen = false
    if (refocus) historyButton?.focus()
  }

  function reset(): void {
    if (store.queryEdited && !confirmReset) {
      confirmReset = true
      return
    }
    confirmReset = false
    void store.resetQuery()
  }
  let now = $state(performance.now())
  let timer: ReturnType<typeof setInterval> | null = null

  const busy = $derived(store.queryPhase === 'running')
  // A live "Running… 1.2 s" while a query runs (contract: status line).
  $effect(() => {
    if (busy && !timer) {
      // Start from now: a stale clock read as a negative time until the first tick.
      now = performance.now()
      timer = setInterval(() => (now = performance.now()), 100)
    }
    if (!busy && timer) {
      clearInterval(timer)
      timer = null
    }
  })
  onDestroy(() => {
    if (timer) clearInterval(timer)
  })

  const statusText = $derived.by(() => {
    if (store.queryPhase === 'running') {
      const s = store.runStartedAt === null ? 0 : Math.max(0, now - store.runStartedAt) / 1000
      return `Running… ${s.toFixed(1)} s`
    }
    return store.queryStatus
  })

  const diagnostics = $derived.by((): Diagnostic[] => {
    const r = store.queryErrorRange
    const e = store.queryError
    if (!r || !e) return []
    return [{ from: r.from, to: Math.max(r.to, r.from), severity: 'error', message: `${e.kind} Error: ${e.message}` }]
  })

  function run(selection?: { from: number; to: number }): void {
    // The Run button runs the statement at the start of the editor when the
    // editor never had focus; the shortcut passes the real selection.
    void store.runQuery(selection ?? { from: 0, to: 0 })
  }

  /** Focus the editor (Ctrl/Cmd+Shift+Q opens the panel and focuses it). */
  export function focusEditor(): void {
    editor?.focus()
  }

  /** Spec 010: inserts text at the editor's cursor (a file name from the Files list). */
  export function insertText(text: string): void {
    editor?.insertText(text)
  }
</script>

<!-- Esc cancels a running query from anywhere in the panel, handled in the
     capture phase so the editor's own Escape bindings can't swallow it. -->
<section
  class="query-panel"
  class:collapsed
  aria-label="Query"
  onkeydowncapture={(e) => {
    if (e.key === 'Escape' && busy) {
      e.preventDefault()
      e.stopPropagation()
      void store.cancelQuery()
    }
  }}
>
  <header>
    {#if !embedded}
      <button type="button" class="toggle" aria-expanded={!collapsed} aria-controls="query-body" onclick={onToggle} title="Toggle the query panel (Ctrl+Shift+Q)">
        <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={14} />
        <span class="title">Query</span>
      </button>
    {/if}
    {#if store.queryTable}
      <span class="query-table" title="Query the opened file as this table">
        <code>{store.queryTable.name}</code>{#if store.queryTable.alias}<span class="alias"> / <code>{store.queryTable.alias}</code></span>{/if}
        · {store.queryTable.crsLabel} · {nf.format(store.queryTable.rows)} rows
      </span>
    {/if}
    <span class="spacer"></span>
    {#if !collapsed}
      <a class="icon-link" href={DOCS_URL} target="_blank" rel="noreferrer" title="Spatial SQL function reference" aria-label="Spatial SQL function reference">?</a>
      <button
        type="button"
        class="icon-button"
        class:pressed={historyOpen}
        bind:this={historyButton}
        onclick={() => (historyOpen = !historyOpen)}
        title="Recent queries for this file"
        aria-label="Query history"
        aria-haspopup="listbox"
        aria-expanded={historyOpen}
        disabled={busy}
      >
        <Icon name="history" size={14} />
      </button>
      <button type="button" class="icon-button" onclick={reset} title="Reset to the original view" aria-label="Reset to the original view">
        <Icon name="reset" size={14} />
      </button>
      {#if busy}
        <button type="button" class="secondary" onclick={() => void store.cancelQuery()} title="Cancel (Esc)"><Icon name="close" size={14} />Cancel</button>
      {:else}
        <button type="button" class="primary" onclick={() => run()} title={store.tilesOnlyReason ?? 'Run (Ctrl+Enter)'}
          disabled={!!store.tilesOnlyReason}
          ><Icon name="arrow-up" size={14} />Run</button
        >
      {/if}
    {/if}
  </header>

  {#if historyOpen && !collapsed}
    <QueryHistory
      entries={store.history}
      onClose={() => closeHistory()}
      onPick={(entry) => {
        store.loadFromHistory(entry)
        closeHistory(false)
        editor?.focus()
      }}
    />
  {/if}
  {#if confirmReset && !collapsed}
    <div class="confirm" role="alertdialog" aria-label="Discard your query changes?">
      <span>Discard your query changes?</span>
      <button type="button" class="primary" onclick={reset}>Discard</button>
      <button type="button" class="secondary" onclick={() => (confirmReset = false)}>Keep</button>
    </div>
  {/if}
  <div class="body" id="query-body" hidden={collapsed}>
    {#if store.tilesOnlyReason}
      <UnavailableNotice text={store.tilesOnlyReason} />
    {/if}
    <div class="editor">
      <SqlEditor
        bind:this={editor}
        value={store.queryText}
        onChange={(v) => store.setQueryText(v)}
        onRun={(sel) => run(sel)}
        onCancel={() => void store.cancelQuery()}
        running={busy}
        {diagnostics}
        {schema}
        {completionSources}
      />
    </div>
    <footer>
      <div class="query-status" role="status" aria-live="polite" class:error={store.queryPhase === 'failed'} class:refused={store.queryPhase === 'refused'}>
        {#if store.queryPhase === 'failed' && store.queryError}
          <span class="badge">{store.queryError.kind} Error</span>
          <span class="msg">{store.queryError.message}</span>
          {#each store.queryError.hints as hint (hint)}<span class="hint">{hint}</span>{/each}
        {:else}
          {statusText}
        {/if}
      </div>
      {#if store.resultCrs}
        <ResultCrsChip label={store.resultCrs.label} source={store.resultCrs.source} override={store.crsOverride} onOverride={(c) => store.setCrsOverride(c)} />
      {/if}
    </footer>
  </div>
</section>

<style>
  .query-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    background: var(--se-bg-base);
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: 28px;
    padding: 0 6px 0 4px;
    background: var(--se-bg-panel);
    border-bottom: 1px solid var(--se-border);
    white-space: nowrap;
    overflow: hidden;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 6px 0 2px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-section-title-fg);
    cursor: pointer;
  }
  .toggle:hover {
    background: var(--se-control-hover);
  }
  .toggle:focus-visible,
  header button:focus-visible,
  .icon-link:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .title {
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
  }
  .query-table {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .query-table code {
    font-family: var(--se-font-mono);
    color: var(--se-text-primary);
  }
  .spacer {
    flex: 1;
  }
  header .primary,
  header .secondary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    font: inherit;
    cursor: pointer;
  }
  .primary {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  .primary:hover:not(:disabled) {
    background: var(--se-button-hover);
  }
  .primary:disabled {
    opacity: 0.45;
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
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .icon-button.pressed {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .icon-button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .icon-button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .confirm {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--se-warning) 12%, var(--se-bg-base));
    border-bottom: 1px solid var(--se-border);
  }
  .confirm span {
    flex: 1;
  }
  .confirm button {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    font: inherit;
    cursor: pointer;
  }
  .icon-link {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid var(--se-input-border);
    color: var(--se-text-secondary);
    font-size: 11px;
    text-decoration: none;
  }
  .body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: 6px;
    padding: 6px 8px 6px;
  }
  .body[hidden] {
    display: none;
  }
  .editor {
    flex: 1;
    min-height: 60px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    min-height: 22px;
  }
  .query-status {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    color: var(--se-text-secondary);
    font-family: var(--se-font-mono);
    font-size: 0.92em;
    font-variant-numeric: tabular-nums;
  }
  .query-status.refused {
    color: var(--se-warning-fg);
  }
  .badge {
    padding: 0 6px;
    border-radius: var(--se-radius-sm);
    border: 1px solid var(--se-error-border);
    background: var(--se-error-bg);
    color: var(--se-error-fg);
    font-weight: 600;
  }
  .msg {
    color: var(--se-text-primary);
  }
  .hint {
    color: var(--se-text-secondary);
  }
</style>
