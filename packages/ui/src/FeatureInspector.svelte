<script lang="ts">
  // T043 (User Story 5, FR-010): click a rendered feature to inspect it.
  // The table row is selected and scrolled to as well (T025's sync path),
  // but the table may be collapsed or the row's columns off-screen, so the
  // map click also opens this card with every attribute of that feature,
  // like QGIS's Identify results. It sits in the map's top-left corner rather
  // than following the feature, so it never covers what was clicked.
  import type { Feature } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import { valueKind, isNumericKind } from './valueKind.js'

  interface Props {
    feature: Feature
    /** Declared column types by name (the layer's), when known: they tell a decimal from an integer. */
    types?: Record<string, string>
    /** The map is too short for the attributes: only the header shows, and stays so until the map is taller. */
    collapsed?: boolean
    /** An attribute whose value is an identifier worth copying (spec 017: a grid cell's `cell_id`): it gets a copy button. */
    copyKey?: string | null
    onZoom: () => void
    onClose: () => void
  }
  let { feature, types, collapsed = false, copyKey = null, onZoom, onClose }: Props = $props()

  /** The key whose value was just copied: its button shows a check for a moment. */
  let copied = $state<string | null>(null)
  async function copyValue(key: string, value: unknown): Promise<void> {
    try {
      await navigator.clipboard.writeText(display(value))
      copied = key
      setTimeout(() => (copied = null), 1500)
    } catch {
      // No clipboard (a restricted webview): the value is selectable text.
    }
  }

  let entries = $derived(Object.entries(feature.attributes))
  // Spec 008 (user request): wide data scrolls, and many attributes get a filter.
  const FILTER_FROM = 12
  let filter = $state('')
  const shown = $derived.by(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(([k, v]) => k.toLowerCase().includes(q) || display(v).toLowerCase().includes(q))
  })

  function display(v: unknown): string {
    if (v === null || v === undefined) return 'NULL'
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v)
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
  class="inspector"
  class:collapsed
  aria-label="Feature attributes"
  tabindex="-1"
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      onClose()
      e.stopPropagation()
    }
  }}
>
  <header>
    <h2>Feature</h2>
    {#if feature.sourceLayer !== undefined}
      <!-- PMTiles (spec 007 US5): the archive layer, not a row number. -->
      <span class="id" title="Archive layer">{feature.sourceLayer}</span>
    {:else}
      <span class="id">#{typeof feature.id === 'number' ? feature.id + 1 : feature.id}</span>
    {/if}
    <span class="spacer"></span>
    {#if feature.sourceLayer === undefined}
      <button type="button" class="icon-button" title="Zoom to feature" aria-label="Zoom to feature" onclick={onZoom}><Icon name="zoom" /></button>
    {/if}
    <button type="button" class="icon-button" title="Close" aria-label="Close" onclick={onClose}><Icon name="close" /></button>
  </header>
  {#if collapsed}
    <!-- Nothing: the header alone, until the map has room. -->
  {:else if entries.length === 0}
    <p class="empty">This feature has no attributes.</p>
  {:else}
    {#if entries.length > FILTER_FROM}
      <div class="filter">
        <Icon name="search" size={14} />
        <input type="text" bind:value={filter} aria-label="Filter attributes" placeholder="Filter {entries.length} attributes" autocomplete="off" spellcheck="false" />
        {#if filter.trim()}<span class="count" role="status">{shown.length} of {entries.length}</span>{/if}
      </div>
    {/if}
    {#if shown.length === 0}
      <p class="empty">No attribute matches “{filter.trim()}”.</p>
    {/if}
    <dl>
      {#each shown as [key, value] (key)}
        <dt title={key}>{key}</dt>
        {@const kind = valueKind(value, types?.[key])}
        <dd class="v-{kind}" class:null={kind === 'null'} class:num={isNumericKind(kind)}>{display(value)}{#if key === copyKey && value !== null && value !== undefined}<button type="button" class="copy" title="Copy {key}" aria-label="Copy {key}" onclick={() => void copyValue(key, value)}><Icon name={copied === key ? 'check' : 'copy'} size={12} /></button>{/if}</dd>
      {/each}
    </dl>
  {/if}
</section>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    /* The same width as the search box and the layer picker above it (--se-stack-width, MapView). */
    width: var(--se-stack-width, 300px);
    max-width: 100%;
    max-height: 480px;
    /* In the map's left column the card gives way to the legend below it (flex shrink), and its list scrolls. */
    min-height: 0;
    /* Borders inside that height, so the card ends where its slot does. */
    box-sizing: border-box;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    outline: none;
    user-select: text;
  }
  .inspector.collapsed header {
    border-bottom: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    padding: 4px 4px 4px 12px;
    border-bottom: 1px solid var(--se-border);
  }
  h2 {
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .id {
    color: var(--se-text-secondary);
    font-family: var(--se-font-mono);
    font-size: 0.92em;
  }
  .spacer {
    flex: 1;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(72px, auto) 1fr;
    /* Rows keep their height and the list scrolls (cells clip, so auto rows could shrink to nothing). */
    grid-auto-rows: max-content;
    align-content: start;
    flex: 1 1 auto;
    min-height: 0;
    margin: 0;
    padding: 6px 0;
    overflow: auto;
  }
  .filter {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    margin: 6px 8px 0;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
  }
  .filter:focus-within {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .filter input {
    flex: 1;
    min-width: 0;
    height: 22px;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
  }
  .filter .count {
    flex: none;
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
  }
  dt,
  dd {
    margin: 0;
    padding: 3px 12px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  dt {
    max-width: 130px;
    color: var(--se-text-secondary);
    white-space: nowrap;
  }
  dd {
    font-family: var(--se-font-data);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
    padding-left: 0;
  }
  /* The value's type, in color (spec 015), as in the table. */
  dd.v-text {
    color: var(--se-type-text);
  }
  dd.v-integer {
    color: var(--se-type-integer);
  }
  dd.v-decimal {
    color: var(--se-type-decimal);
  }
  dd.v-boolean {
    color: var(--se-type-boolean);
  }
  dd.v-datetime {
    color: var(--se-type-datetime);
  }
  dd.v-nested {
    color: var(--se-type-nested);
    font-family: var(--se-font-mono);
    font-size: 0.92em;
  }
  dd.v-geometry {
    color: var(--se-type-geometry);
    font-style: italic;
  }
  dd.null {
    color: var(--se-text-muted);
    font-family: var(--se-font-mono);
    font-size: 0.85em;
  }
  .empty {
    margin: 0;
    padding: 12px;
    color: var(--se-text-secondary);
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
  .icon-button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .icon-button:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .copy {
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 18px;
    margin-left: 4px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    vertical-align: middle;
    cursor: pointer;
  }
  .copy:hover {
    background: var(--se-bg-hover);
    color: var(--se-text-primary);
  }
  .copy:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
