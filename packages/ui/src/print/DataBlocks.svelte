<script lang="ts">
  // Spec 016: the attribute table and the chart on the page (GeoLibre's DataTableEditor and DataChartEditor), of the
  // rows the layer shows. The engine reads them: see PrintComposer.refreshBlocks.
  import { DEFAULT_TABLE_COLUMNS, MAX_TABLE_ROWS } from '@spatial-explorer/core'
  import Segmented from '../kit/Segmented.svelte'
  import Select from '../kit/Select.svelte'
  import Switch from '../kit/Switch.svelte'
  import type { PrintComposer } from './composer.svelte.js'

  interface Props {
    c: PrintComposer
  }
  let { c }: Props = $props()
  const l = $derived(c.layout)
  const fields = $derived(c.fields)
  const names = $derived(fields.map((f) => f.name))
  const numeric = $derived(fields.filter((f) => f.numeric).map((f) => f.name))

  const CORNERS = [
    { value: 'top-left', label: 'Top left' },
    { value: 'top-right', label: 'Top right' },
    { value: 'bottom-left', label: 'Bottom left' },
    { value: 'bottom-right', label: 'Bottom right' },
  ]
  const FILTERS = [
    { value: 'all', label: 'All features' },
    { value: 'contained', label: 'Completely within the page' },
    { value: 'intersecting', label: 'Intersecting the page' },
  ]
  const optionsOf = (list: string[], none?: string): Array<{ value: string; label: string }> => [...(none === undefined ? [] : [{ value: '', label: none }]), ...list.map((n) => ({ value: n, label: n }))]
  const picked = $derived(c.tableColumns)

  function toggleColumn(name: string, on: boolean): void {
    const next = on ? [...picked, name] : picked.filter((n) => n !== name)
    // In the layer's own order: the printed order stays stable.
    c.set({ tableColumns: names.filter((n) => next.includes(n)) })
  }
</script>

{#snippet toggle(label: string, checked: boolean, onChange: (v: boolean) => void)}
  <div class="toggle">
    <span id="b-{label.replace(/[^a-zA-Z0-9]+/g, '-')}">{label}</span>
    <Switch labelledby="b-{label.replace(/[^a-zA-Z0-9]+/g, '-')}" {checked} {onChange} />
  </div>
{/snippet}

{@render toggle('Attribute table', l.showDataTable, (v) => c.set({ showDataTable: v }))}
{#if l.showDataTable}
  <div class="block" role="group" aria-label="Attribute table">
    {#if !names.length}
      <p class="hint">Open a layer with attributes to put its table on the page.</p>
    {:else}
      <label class="row"><span>Heading</span><input type="text" value={l.tableTitle} placeholder={c.options.title} oninput={(e) => c.set({ tableTitle: e.currentTarget.value })} /></label>
      <div class="row top">
        <span>Columns</span>
        <div class="checks">
          {#each names as n (n)}
            <label><input type="checkbox" checked={picked.includes(n)} onchange={(e) => toggleColumn(n, e.currentTarget.checked)} />{n}</label>
          {/each}
        </div>
      </div>
      <p class="hint">Shows the first {DEFAULT_TABLE_COLUMNS} until you pick.</p>
      <div class="row">
        <span>Sort by</span>
        <div class="grow"><Select label="Table sort field" value={l.tableSortField} onChange={(v) => c.set({ tableSortField: v })} options={optionsOf(names, 'Source order')} /></div>
      </div>
      <div class="row">
        <span>Order</span>
        <Segmented label="Table sort order" value={l.tableSortDesc ? 'desc' : 'asc'} onChange={(v) => c.set({ tableSortDesc: v === 'desc' })} options={[{ value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' }]} />
      </div>
      <label class="row"><span>Max rows</span><input type="number" min="1" max={MAX_TABLE_ROWS} disabled={l.tableFitRows} value={l.tableMaxRows} oninput={(e) => c.set({ tableMaxRows: Math.max(1, Math.min(MAX_TABLE_ROWS, Number(e.currentTarget.value) || 1)) })} /></label>
      {@render toggle('Adjust the rows to fit the page', l.tableFitRows, (v) => c.set({ tableFitRows: v }))}
      <div class="row">
        <span>Position</span>
        <div class="grow"><Select label="Table position" value={l.tablePosition} onChange={(v) => c.set({ tablePosition: v as typeof l.tablePosition })} options={CORNERS} /></div>
      </div>
      <div class="row">
        <span>Page extent</span>
        <div class="grow"><Select label="Table page extent filter" value={l.tablePageFilter} onChange={(v) => c.set({ tablePageFilter: v as typeof l.tablePageFilter })} options={FILTERS} /></div>
      </div>
    {/if}
  </div>
{/if}

{@render toggle('Chart', l.showDataChart, (v) => c.set({ showDataChart: v }))}
{#if l.showDataChart}
  <div class="block" role="group" aria-label="Chart">
    {#if !names.length}
      <p class="hint">Open a layer with attributes to put a chart of it on the page.</p>
    {:else}
      <label class="row"><span>Heading</span><input type="text" value={l.chartTitle} placeholder={c.options.title} oninput={(e) => c.set({ chartTitle: e.currentTarget.value })} /></label>
      <div class="row">
        <span>Chart type</span>
        <Segmented label="Chart type" value={l.chartType} onChange={(v) => c.set({ chartType: v as typeof l.chartType })} options={[{ value: 'bar', label: 'Bar' }, { value: 'pie', label: 'Pie' }, { value: 'line', label: 'Line' }]} />
      </div>
      {#if l.chartType !== 'line'}
        <div class="row">
          <span>Category field</span>
          <div class="grow"><Select label="Chart category field" value={l.chartCategoryField} onChange={(v) => c.set({ chartCategoryField: v })} options={optionsOf(names, 'Choose a field')} /></div>
        </div>
        <div class="row">
          <span>Aggregate</span>
          <Segmented label="Chart aggregate" value={l.chartAggregation} onChange={(v) => c.set({ chartAggregation: v as typeof l.chartAggregation })} options={[{ value: 'count', label: 'Count' }, { value: 'sum', label: 'Sum' }, { value: 'mean', label: 'Mean' }]} />
        </div>
      {/if}
      {#if l.chartType === 'line' || l.chartAggregation !== 'count'}
        <div class="row">
          <span>Value field</span>
          <div class="grow"><Select label="Chart value field" value={l.chartValueField} onChange={(v) => c.set({ chartValueField: v })} options={optionsOf(numeric, 'Choose a numeric field')} /></div>
        </div>
      {/if}
      <div class="row">
        <span>Position</span>
        <div class="grow"><Select label="Chart position" value={l.chartPosition} onChange={(v) => c.set({ chartPosition: v as typeof l.chartPosition })} options={CORNERS} /></div>
      </div>
      <div class="row">
        <span>Page extent</span>
        <div class="grow"><Select label="Chart page extent filter" value={l.chartPageFilter} onChange={(v) => c.set({ chartPageFilter: v as typeof l.chartPageFilter })} options={FILTERS} /></div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 24px;
  }
  .block {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    margin: 0 0 4px 14px;
    padding: 8px;
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-sm);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    min-width: 0;
  }
  .row.top {
    align-items: flex-start;
  }
  .row > span:first-child {
    flex: none;
    width: 92px;
    color: var(--se-text-secondary);
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  input[type='text'],
  input[type='number'] {
    flex: 1;
    min-width: 0;
    height: 24px;
    box-sizing: border-box;
    padding: 2px 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font: inherit;
  }
  input[type='number'] {
    flex: none;
    width: 72px;
  }
  input:disabled {
    opacity: 0.5;
  }
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .checks {
    flex: 1;
    display: grid;
    gap: 3px;
    max-height: 140px;
    overflow: auto;
    padding: 4px 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
  }
  .checks label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
</style>
