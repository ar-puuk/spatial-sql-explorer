<script lang="ts">
  // Spec 008 US7 (FR-030) and spec 016: the current map view as a page, saved
  // as a PNG, a PDF or an SVG (GeoLibre's Print options): the size of the map
  // on screen or a sheet of paper, with a title, the legend (when one is
  // shown), a north arrow, a scale bar and the basemap's attribution. Saved
  // through the host (VS Code: a save dialog next to the data; web: a download).
  import { onMount, tick } from 'svelte'
  import Icon from './Icon.svelte'
  import Segmented from './kit/Segmented.svelte'
  import Select from './kit/Select.svelte'
  import { legendHasContent, type LegendSpec } from './mapImage.js'
  import { PAPERS, type PageOrientation, type PaperId, type PrintFormat } from './printMap.js'
  import type { MapImageOutcome, ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
    /** The legend as shown on the map, or null when none is shown. */
    legend: LegendSpec | null
    onClose: () => void
  }
  let { store, legend, onClose }: Props = $props()

  const hasLegend = $derived(legendHasContent(legend))
  let format = $state<PrintFormat>('png')
  let paper = $state<PaperId>('map')
  let orientation = $state<PageOrientation>('auto')
  let scale = $state<1 | 2>(2)
  let dpi = $state<150 | 300>(150)
  let title = $state('')
  // svelte-ignore state_referenced_locally
  let withLegend = $state(hasLegend)
  let scaleBar = $state(true)
  let northArrow = $state(true)
  let running = $state(false)
  let outcome = $state.raw<MapImageOutcome | null>(null)
  let dialog = $state<HTMLDivElement>()

  const onPaper = $derived(paper !== 'map')

  async function save(): Promise<void> {
    if (running) return
    running = true
    outcome = null
    try {
      outcome = await store.exportMapImage({
        format,
        paper,
        orientation,
        title,
        legend: withLegend && hasLegend ? legend : null,
        scaleBar,
        northArrow,
        units: store.drawUnits,
        scale,
        dpi,
      })
    } finally {
      running = false
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (!running) onClose()
      return
    }
    if (e.key === 'Tab' && dialog) {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')).filter((el) => el.tabIndex >= 0)
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

  function scaleKeys(e: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    scale = scale === 1 ? 2 : 1
    void tick().then(() => dialog?.querySelector<HTMLElement>(`[data-scale="${scale}"]`)?.focus())
  }

  onMount(() => {
    void tick().then(() => dialog?.querySelector<HTMLElement>('button.primary')?.focus())
  })
</script>

<div class="backdrop" role="presentation" onkeydown={onKeydown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Print map" bind:this={dialog}>
    <header>
      <h2>Print map</h2>
      <button type="button" class="icon-button" aria-label="Close" title="Close" disabled={running} onclick={onClose}><Icon name="close" /></button>
    </header>
    <div class="body">
      <div class="field">
        <span class="label">Format</span>
        <Segmented
          label="Format"
          value={format}
          onChange={(v) => (format = v as PrintFormat)}
          options={[
            { value: 'png', label: 'PNG', title: 'A picture' },
            { value: 'pdf', label: 'PDF', title: 'A document to print or share' },
            { value: 'svg', label: 'SVG', title: 'Text, legend and scale stay editable in Inkscape or Illustrator' },
          ]}
        />
        <span class="hint">{format === 'svg' ? 'The title, legend and scale bar stay editable; the map is a picture in it.' : format === 'pdf' ? 'One page, ready to print or share.' : 'A picture, sharp in print and slides.'}</span>
      </div>
      <div class="field">
        <span class="label">Page</span>
        <div class="control"><Select label="Page" value={paper} onChange={(v) => (paper = v as PaperId)} options={PAPERS.map((p) => ({ value: p.id, label: p.label }))} /></div>
      </div>
      {#if onPaper}
        <div class="field">
          <span class="label">Turned</span>
          <Segmented
            label="Orientation"
            value={orientation}
            onChange={(v) => (orientation = v as PageOrientation)}
            options={[
              { value: 'auto', label: 'Fit the map', title: 'Portrait for a tall map, landscape for a wide one' },
              { value: 'portrait', label: 'Portrait' },
              { value: 'landscape', label: 'Landscape' },
            ]}
          />
        </div>
        {#if format !== 'svg'}
          <div class="field">
            <span class="label">Detail</span>
            <Segmented
              label="Detail"
              value={String(dpi)}
              onChange={(v) => (dpi = v === '300' ? 300 : 150)}
              options={[
                { value: '150', label: '150 dpi', title: 'Screen and office printers' },
                { value: '300', label: '300 dpi', title: 'Print shop quality; a bigger file' },
              ]}
            />
          </div>
        {/if}
      {:else}
        <div class="field">
          <span class="label" id="image-size">Size</span>
          <div class="options" role="radiogroup" aria-labelledby="image-size">
            {#each [1, 2] as s (s)}
              <button
                type="button"
                role="radio"
                data-scale={s}
                aria-checked={scale === s}
                tabindex={scale === s ? 0 : -1}
                disabled={running}
                onclick={() => (scale = s as 1 | 2)}
                onkeydown={scaleKeys}>{s}×</button
              >
            {/each}
          </div>
          <span class="hint">{scale === 2 ? 'Twice the map’s size on screen: sharp in print and slides.' : 'The map’s size on screen.'}</span>
        </div>
      {/if}
      <div class="field">
        <label class="label" for="print-title">Title</label>
        <input id="print-title" class="text" type="text" placeholder="None" bind:value={title} disabled={running} />
      </div>
      <div class="checks">
        <label class="check" class:disabled={!hasLegend}>
          <input type="checkbox" bind:checked={withLegend} disabled={!hasLegend || running} />
          <span>Include legend</span>
          {#if !hasLegend}<span class="hint">(no legend is shown)</span>{/if}
        </label>
        <label class="check"><input type="checkbox" bind:checked={scaleBar} disabled={running} /><span>Scale bar</span></label>
        <label class="check"><input type="checkbox" bind:checked={northArrow} disabled={running} /><span>North arrow</span></label>
      </div>
      {#if outcome?.kind === 'saved'}
        <p class="result ok" role="status"><Icon name="check" size={14} />Saved {outcome.location} ({outcome.size}).</p>
      {:else if outcome?.kind === 'failed'}
        <p class="result error" role="alert"><Icon name="error" size={14} />{outcome.message}</p>
      {/if}
      {#if outcome?.kind === 'saved' && outcome.notes.length}
        <ul class="notices">
          {#each outcome.notes as n (n)}<li><Icon name="info" size={14} /><span>{n}</span></li>{/each}
        </ul>
      {/if}
    </div>
    <footer>
      {#if running}<span class="progress" role="status">Making the {format.toUpperCase()}…</span>{/if}
      <span class="spacer"></span>
      <button type="button" class="secondary" disabled={running} onclick={onClose}>{outcome?.kind === 'saved' ? 'Done' : 'Cancel'}</button>
      <button type="button" class="primary" disabled={running} onclick={() => void save()}><Icon name="printer" size={14} />Save</button>
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
    background: color-mix(in srgb, black 40%, transparent);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(460px, 100%);
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
    gap: 12px;
    padding: 12px;
  }
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .label {
    width: 56px;
    color: var(--se-text-secondary);
  }
  .control {
    flex: 1;
    min-width: 0;
  }
  .text {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font: inherit;
  }
  .text:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .checks {
    display: grid;
    gap: 6px;
  }
  .hint {
    flex-basis: 100%;
    padding-left: 64px;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .check .hint {
    flex-basis: auto;
    padding-left: 0;
  }
  .options {
    display: flex;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    overflow: hidden;
  }
  .options button {
    height: 24px;
    padding: 0 14px;
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
    box-shadow: inset 0 0 0 1px var(--se-selected-indicator);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 64px;
    cursor: pointer;
  }
  .check.disabled {
    color: var(--se-text-secondary);
    cursor: default;
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
  .secondary {
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
  }
  .secondary:hover {
    background: var(--se-button-secondary-hover);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
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
  footer button:focus-visible,
  .icon-button:focus-visible,
  .check input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
