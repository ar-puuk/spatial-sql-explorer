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
    <dl>
      {#each entries as [key, value] (key)}
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
    width: 300px;
    max-height: min(420px, calc(100% - 20px));
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
    margin: 0;
    padding: 6px 0;
    overflow: auto;
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
