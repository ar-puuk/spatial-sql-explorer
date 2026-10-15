<script lang="ts">
  // Spec 014: what to do with the shapes drawn on the map. They are scratch geometry for queries and filters
  // (never edits to the data): select the rows they cover, keep the rows narrowed to them, write a query with
  // them, show them as a layer (so every export format applies), save them as GeoJSON, or clear them.
  import { SPATIAL_PREDICATES, shapeLabel, type SpatialPredicate } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import Select from './kit/Select.svelte'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
  }
  let { store }: Props = $props()

  const shapes = $derived(store.shapes)
  const summary = $derived.by(() => {
    const n = shapes.length
    if (n === 1) return shapeLabel(shapes[0], store.drawUnits) ?? '1 shape'
    return `${n} shapes`
  })
  const hint = $derived(SPATIAL_PREDICATES.find((p) => p.id === store.shapePredicate)?.hint ?? '')
</script>

<div class="bar" role="group" aria-label="Drawn shapes">
  <span class="summary" title="Shapes you drew: scratch geometry for queries and filters, never edits to the data">{summary}</span>
  <span class="predicate" title={hint}>
    <Select
      compact
      label="Rows that"
      value={store.shapePredicate}
      options={SPATIAL_PREDICATES.map((p) => ({ value: p.id, label: p.label }))}
      onChange={(v) => store.setShapePredicate(v as SpatialPredicate)}
    />
  </span>
  <button type="button" title="Select the rows that meet this condition against the shapes (Ctrl or Cmd adds to the selection)" onclick={(e) => void store.selectInShapes(e.ctrlKey || e.metaKey)}>
    <Icon name="select-shape" size={14} /><span>Select rows</span>
  </button>
  <button type="button" aria-pressed={store.shapeFilterOn} class:active={store.shapeFilterOn} title="Keep only the rows that meet this condition against the shapes, as you change the shapes" onclick={() => store.setShapeFilter(!store.shapeFilterOn)}>
    <Icon name="filter" size={14} /><span>Filter</span>
  </button>
  <button type="button" title="Write a query for these shapes in the SQL editor" onclick={() => store.insertShapesQuery()}>
    <Icon name="list" size={14} /><span>SQL</span>
  </button>
  <button type="button" title="Show the shapes as a layer (SELECT * FROM drawn); then every export format applies" onclick={() => void store.showShapesAsLayer()}>
    <Icon name="layers" size={14} /><span>As layer</span>
  </button>
  <button type="button" title="Save the shapes as GeoJSON" onclick={() => void store.exportShapes()}>
    <Icon name="export" size={14} /><span>GeoJSON</span>
  </button>
  <button type="button" title="Remove all the shapes" onclick={() => store.clearShapes()}>
    <Icon name="trash" size={14} /><span>Clear</span>
  </button>
  {#if store.shapesNotice}
    <span class="notice" role="status">{store.shapesNotice}</span>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    max-width: 100%;
    padding: 4px 6px;
    background: var(--se-control-bg);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-card);
    backdrop-filter: var(--se-overlay-blur);
    color: var(--se-text-primary);
    font: var(--se-font-size) var(--se-font-ui);
  }
  .summary {
    padding: 0 4px;
    font-family: var(--se-font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--se-text-secondary);
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: var(--se-control-hover);
  }
  button.active {
    background: var(--se-control-active-bg);
    color: var(--se-control-active-fg);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .notice {
    flex-basis: 100%;
    padding: 0 4px;
    color: var(--se-text-secondary);
  }
</style>
