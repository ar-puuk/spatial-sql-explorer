<script lang="ts">
  // T043 (User Story 5, FR-010): click a rendered feature to inspect it.
  // The table row is selected and scrolled to as well (T025's sync path),
  // but the table may be collapsed or the row's columns off-screen, so the
  // map click also opens this card with every attribute of that feature,
  // like QGIS's Identify results. It sits in the map's top-left corner rather
  // than following the feature, so it never covers what was clicked.
  import type { Feature } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  interface Props {
    feature: Feature
    onZoom: () => void
    onClose: () => void
  }
  let { feature, onZoom, onClose }: Props = $props()

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
  {#if entries.length === 0}
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
        <dd class:null={value === null || value === undefined} class:num={typeof value === 'number'}>{display(value)}</dd>
      {/each}
    </dl>
  {/if}
</section>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    /* The search box's width: the card sits right under it. */
    width: 300px;
    max-width: 100%;
    max-height: min(480px, 100%);
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
  dd.num {
    color: var(--se-table-number-fg);
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
</style>
