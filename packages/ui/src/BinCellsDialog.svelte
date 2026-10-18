<script lang="ts">
  // Spec 017: Bin into cells. The choices write a query (shown in the query panel once kept) and, while the result
  // would be small, the map previews it as they change. Not a modal: the map has to stay visible and clickable, so
  // it floats over its top left corner. Esc cancels (and puts everything back), Enter keeps the bin.
  import { onMount, tick } from 'svelte'
  import { GRID_SYSTEMS, getGridSystem, type BinMeasureKind } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import Segmented from './kit/Segmented.svelte'
  import Select from './kit/Select.svelte'
  import Slider from './kit/Slider.svelte'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
  }
  let { store }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const bin = $derived(store.binDialog)
  const spec = $derived(bin.spec)
  const system = $derived(getGridSystem(spec.system)!)
  const numeric = $derived(bin.info?.numericColumns ?? [])
  const supported = $derived(GRID_SYSTEMS.filter((s) => bin.support[s.id]))
  const noEngine = $derived(supported.length === 0)

  const MEASURES: Array<{ value: BinMeasureKind; label: string }> = [
    { value: 'count', label: 'Number of features' },
    { value: 'sum', label: 'Sum of a column' },
    { value: 'avg', label: 'Average of a column' },
    { value: 'min', label: 'Minimum of a column' },
    { value: 'max', label: 'Maximum of a column' },
    { value: 'median', label: 'Median of a column' },
  ]
  const measureOptions = $derived(numeric.length ? MEASURES : MEASURES.slice(0, 1))
  const column = $derived(spec.measure.kind === 'count' ? '' : spec.measure.column)

  function chooseMeasure(kind: string): void {
    if (kind === 'count') store.setBinSpec({ measure: { kind: 'count' } })
    else store.setBinSpec({ measure: { kind: kind as Exclude<BinMeasureKind, 'count'>, column: column || numeric[0] || '' } })
  }
  function chooseColumn(name: string): void {
    if (spec.measure.kind !== 'count') store.setBinSpec({ measure: { kind: spec.measure.kind, column: name } })
  }

  /** Metric sizes: an edge in meters under a kilometer, an area in square meters under one square kilometer. */
  const edgeText = (km: number): string => (km < 1 ? `${nf.format(Math.round(km * 1000))} m` : `${km < 10 ? km.toFixed(1) : nf.format(Math.round(km))} km`)
  const areaText = (km2: number): string => (km2 < 1 ? `${nf.format(Math.round(km2 * 1e6))} m²` : `${km2 < 10 ? km2.toFixed(1) : nf.format(Math.round(km2))} km²`)
  const sizeText = $derived(`Cells about ${edgeText(system.edgeKm[spec.resolution])} across, ${areaText(system.cellAreaKm2[spec.resolution])} each`)
  const estimateText = $derived(bin.estimate === 0 ? '' : `About ${nf.format(bin.estimate)} ${bin.estimate === 1 ? 'cell' : 'cells'}`)

  let panel = $state<HTMLDivElement>()

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      void store.cancelBin()
      return
    }
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement) && !bin.overLimit) {
      e.preventDefault()
      void store.applyBin()
    }
  }

  onMount(() => {
    void tick().then(() => panel?.querySelector<HTMLElement>('[role="radio"][data-state="on"]')?.focus())
  })
</script>

<div class="panel" role="dialog" aria-label="Bin into cells" bind:this={panel} onkeydown={onKeydown} tabindex="-1">
  <header>
    <Icon name="grid" size={14} />
    <h2>Bin into cells</h2>
    <button type="button" class="icon-button" aria-label="Close" title="Close (Esc)" onclick={() => void store.cancelBin()}><Icon name="close" size={14} /></button>
  </header>

  <div class="body">
    {#if noEngine}
      <p class="notice" role="status"><Icon name="info" size={14} /><span>The H3 and A5 grids could not be loaded. They download once, so the first start needs a connection.</span></p>
    {:else}
      <div class="field">
        <span class="label" id="bin-system">Grid</span>
        <div class="control">
          <Segmented
            label="Grid system"
            value={spec.system}
            options={GRID_SYSTEMS.map((s) => ({ value: s.id, label: s.label, title: bin.support[s.id] ? s.summary : `${s.label} could not be loaded.` }))}
            onChange={(v) => store.setBinSpec({ system: v as 'h3' | 'a5' })}
          />
          <p class="hint">{system.summary}</p>
        </div>
      </div>

      <div class="field">
        <span class="label">Size</span>
        <div class="control">
          <Slider label="Resolution" value={spec.resolution} min={system.minRes} max={system.maxRes} step={1} onChange={(v) => store.setBinSpec({ resolution: v })} />
          <p class="hint">{sizeText}</p>
          <p class="hint estimate" role="status" aria-live="polite">{estimateText}{bin.running ? ' · drawing…' : ''}</p>
        </div>
      </div>

      <div class="field">
        <span class="label">Show</span>
        <div class="control">
          <Select label="What each cell shows" value={spec.measure.kind} options={measureOptions} onChange={chooseMeasure} />
          {#if spec.measure.kind !== 'count'}
            <Select label="Column" value={column} options={numeric.map((c) => ({ value: c, label: c }))} onChange={chooseColumn} />
          {/if}
        </div>
      </div>

      {#if bin.problem}
        <p class="notice invalid" role="alert"><Icon name="info" size={14} /><span>{bin.problem}</span></p>
      {:else if bin.overLimit}
        <p class="notice warn" role="alert"><Icon name="info" size={14} /><span>That is more than 100,000 cells: it draws from tiles and takes longer. Pick a coarser size, or run it anyway.</span></p>
      {:else if bin.estimate > 5000}
        <p class="notice" role="status"><Icon name="info" size={14} /><span>Many cells: press Show to draw them.</span></p>
      {/if}
    {/if}
  </div>

  <footer>
    <button type="button" class="secondary" onclick={() => void store.cancelBin()}>Cancel</button>
    {#if bin.overLimit && !bin.problem}
      <button type="button" class="primary" disabled={noEngine || bin.running} onclick={() => void store.applyBin(true)}>Run anyway</button>
    {:else}
      <button type="button" class="primary" disabled={noEngine || !!bin.problem || bin.running} onclick={() => void store.applyBin()}>{bin.estimate > 5000 && !bin.previewed ? 'Show' : 'Keep'}</button>
    {/if}
  </footer>
</div>

<style>
  .panel {
    position: absolute;
    top: 56px;
    left: 12px;
    z-index: 25;
    display: flex;
    flex-direction: column;
    width: min(340px, calc(100% - 24px));
    max-height: calc(100% - 72px);
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .panel:focus {
    outline: none;
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
  .field {
    display: grid;
    grid-template-columns: 44px 1fr;
    align-items: start;
    gap: 8px;
  }
  .label {
    padding-top: 4px;
    color: var(--se-text-secondary);
  }
  .control {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.9em;
  }
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    color: var(--se-text-secondary);
  }
  .notice.warn {
    color: var(--se-warning-fg, var(--se-text-primary));
  }
  .notice.invalid {
    color: var(--se-error-fg, var(--se-error));
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid var(--se-border);
  }
  button.primary,
  button.secondary {
    height: 24px;
    padding: 0 12px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    font: inherit;
    cursor: pointer;
  }
  button.primary {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  button.primary:hover:not(:disabled) {
    background: var(--se-button-hover);
  }
  button.secondary {
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
  }
  button.secondary:hover {
    background: var(--se-button-secondary-hover);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
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
    background: var(--se-bg-hover);
    color: var(--se-text-primary);
  }
</style>
