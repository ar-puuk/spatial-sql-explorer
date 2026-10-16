<script lang="ts">
  // Spec 016: the Print Layout composer (GeoLibre's, in a Svelte dialog): the
  // page's controls on the left, a live preview on the right, and the exports
  // (PNG, PDF, SVG, the clipboard) underneath. The preview is built from a
  // capture of the live map: after panning, zooming or restyling the map,
  // Recapture map refreshes it. Opening the composer captures at once.
  import { onMount, tick, untrack } from 'svelte'
  import Icon from '../Icon.svelte'
  import type { LegendSpec } from '../mapImage.js'
  import type { ViewerStore } from '../viewerStore.svelte.js'
  import { PrintComposer } from './composer.svelte.js'
  import AtlasEditor from './AtlasEditor.svelte'
  import Controls from './Controls.svelte'
  import DataBlocks from './DataBlocks.svelte'
  import LegendEditor from './LegendEditor.svelte'
  import ScaleExtent from './ScaleExtent.svelte'
  import { drawLayout, resolvePageSize } from './layout.js'

  interface Props {
    store: ViewerStore
    /** The legend as shown on the map, or null when none is shown. */
    legend: LegendSpec | null
    onClose: () => void
  }
  let { store, legend, onClose }: Props = $props()

  // svelte-ignore state_referenced_locally
  const c = new PrintComposer(store, () => legend)
  let dialog = $state<HTMLDivElement>()
  let canvas = $state<HTMLCanvasElement>()
  let pane = $state<HTMLDivElement>()
  const busy = $derived(c.exporting || c.capturing || c.atlas.busy)

  // The preview: the page fitted into the pane, redrawn when anything about it changes or the pane is resized.
  let frame = 0
  function drawPreview(): void {
    frame = 0
    if (!canvas || !pane) return
    const size = resolvePageSize(c.display)
    const aspect = size.width / size.height
    const availW = Math.max(1, pane.clientWidth - 24)
    const availH = Math.max(1, pane.clientHeight - 24)
    let w = availW
    let h = availW / aspect
    if (h > availH) {
      h = availH
      w = availH * aspect
    }
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
    canvas.style.width = `${Math.round(w)}px`
    canvas.style.height = `${Math.round(h)}px`
    drawLayout(canvas, c.display)
  }
  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(drawPreview)
  }
  // The atlas reads its coverage features from the engine, again when the layer or the coverage changes.
  $effect(() => {
    void c.atlasLoadKey
    // Read untracked: only the load key says when to read again, not every setting the read looks at.
    if (c.atlas.enabled) untrack(() => void c.atlas.load())
  })
  // The preview follows the series: when the pages or how they are framed change, the map is driven to the current page
  // again (after a pause, so typing does not thrash the live map).
  $effect(() => {
    void c.atlas.driveKey
    if (!c.atlas.active) return
    const timer = setTimeout(() => void c.goToAtlasPage(Math.min(c.atlas.index, c.atlas.count - 1)), 500)
    return () => clearTimeout(timer)
  })
  // A fixed scale means physical paper: on a pixel page the series falls back to a margin.
  $effect(() => {
    if (!c.isMmPage && c.layout.atlasExtentMode === 'scale') c.set({ atlasExtentMode: 'margin' })
  })
  // The table and the chart come from the engine: asked again when what they depend on changes.
  $effect(() => {
    void c.blocksKey
    void c.refreshBlocks()
  })
  $effect(() => {
    void c.display // every setting, the legend, the capture and the atlas page's tokens
    void canvas
    schedule()
  })

  function onKeydown(e: KeyboardEvent): void {
    // The dialog is hidden while the extent is drawn: Escape then belongs to that drawing.
    if (c.drawingExtent) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (!busy) onClose()
      return
    }
    if (e.key === 'Tab' && dialog) {
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter((el) => el.tabIndex >= 0 && el.offsetParent !== null)
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
    const observer = new ResizeObserver(schedule)
    if (pane) observer.observe(pane)
    void c.recapture()
    c.attach()
    void tick().then(() => dialog?.querySelector<HTMLElement>('button.primary')?.focus())
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      c.detach()
    }
  })
</script>

<div class="backdrop" class:drawing={c.drawingExtent} role="presentation" onkeydown={onKeydown}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Print map" bind:this={dialog}>
    <header>
      <h2>Print map</h2>
      <button type="button" class="icon-button" aria-label="Close" title="Close" disabled={busy} onclick={onClose}><Icon name="close" /></button>
    </header>
    <div class="body">
      <div class="controls-pane">
        <Controls {c}>
          {#snippet scale()}<ScaleExtent {c} />{/snippet}
          {#snippet atlas()}<AtlasEditor {c} />{/snippet}
          {#snippet blocks()}<DataBlocks {c} />{/snippet}
          {#snippet legendEditor()}<LegendEditor {c} />{/snippet}
        </Controls>
      </div>
      <div class="preview-pane">
        <div class="preview-head">
          <span>Preview</span>
          {#if c.atlas.active}
            <span class="pager" role="group" aria-label="Atlas pages">
              <button type="button" class="icon-button" aria-label="Previous page" disabled={busy || c.atlas.clampedIndex === 0} onclick={() => void c.goToAtlasPage(c.atlas.clampedIndex - 1)}><Icon name="chevron-left" size={14} /></button>
              <span role="status">Page {c.atlas.clampedIndex + 1} of {c.atlas.count}</span>
              <button type="button" class="icon-button" aria-label="Next page" disabled={busy || c.atlas.clampedIndex >= c.atlas.count - 1} onclick={() => void c.goToAtlasPage(c.atlas.clampedIndex + 1)}><Icon name="chevron-right" size={14} /></button>
            </span>
          {/if}
          <button type="button" class="secondary" disabled={busy} onclick={() => void c.recapture()}><Icon name="refresh" size={14} />Recapture map</button>
        </div>
        <div class="preview" bind:this={pane}>
          <canvas bind:this={canvas} aria-label="Preview of the page" role="img"></canvas>
          {#if c.capturing}<span class="overlay" role="status">Capturing the map…</span>{/if}
        </div>
        {#if c.error}<p class="result error" role="alert"><Icon name="error" size={14} />{c.error}</p>{/if}
        {#if c.saved}
          <p class="result ok" role="status"><Icon name="check" size={14} />Saved {c.saved.location} ({c.saved.size}).</p>
        {/if}
        {#if (c.saved?.notes ?? c.captureNotes).length}
          <ul class="notices">
            {#each c.saved?.notes ?? c.captureNotes as n (n)}<li><Icon name="info" size={14} /><span>{n}</span></li>{/each}
          </ul>
        {/if}
      </div>
    </div>
    <footer>
      {#if c.atlas.progress}<span class="progress" role="status">Page {c.atlas.progress.current} of {c.atlas.progress.total}…</span>{:else if c.exporting}<span class="progress" role="status">Making the file…</span>{/if}
      <span class="spacer"></span>
      <button type="button" class="secondary" disabled={busy || !c.captured} onclick={() => void c.copy()}><Icon name={c.copied ? 'check' : 'copy'} size={14} />{c.copied ? 'Copied' : 'Copy to clipboard'}</button>
      {#if c.atlas.active}
        <button type="button" class="secondary" disabled={busy || !c.captured || c.atlas.configBlocked} onclick={() => void c.exportAtlas('pdf')}>Export PDF ({c.atlas.count} pages)</button>
        <button type="button" class="primary" disabled={busy || !c.captured || c.atlas.configBlocked} onclick={() => void c.exportAtlas('zip')}><Icon name="printer" size={14} />Export PNG ZIP</button>
      {:else}
        <button type="button" class="secondary" disabled={busy || !c.captured} onclick={() => void c.export('svg')}>Export SVG</button>
        <button type="button" class="secondary" disabled={busy || !c.captured} onclick={() => void c.export('pdf')}>Export PDF</button>
        <button type="button" class="primary" disabled={busy || !c.captured} onclick={() => void c.export('png')}><Icon name="printer" size={14} />Export PNG</button>
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
    background: color-mix(in srgb, black 40%, transparent);
  }
  .backdrop.drawing {
    display: none;
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(1080px, 100%);
    height: min(680px, 100%);
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
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(300px, 380px) minmax(0, 1fr);
    gap: 0;
  }
  .controls-pane {
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
    border-right: 1px solid var(--se-border);
  }
  .preview-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }
  .pager {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--se-text-primary);
  }
  .preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--se-text-secondary);
  }
  .preview {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    place-items: center;
    background: var(--se-bg-hover);
    border-radius: var(--se-radius-sm);
    overflow: hidden;
  }
  canvas {
    background: #fff;
    box-shadow: var(--se-shadow-elevated);
  }
  .overlay {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 2px 8px;
    border-radius: var(--se-radius-sm);
    background: var(--se-bg-elevated);
    color: var(--se-text-secondary);
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
  .primary,
  .secondary {
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
  .primary:hover:not(:disabled) {
    background: var(--se-button-hover);
  }
  .secondary {
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
  }
  .secondary:hover:not(:disabled) {
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
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  @media (max-width: 760px) {
    .body {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
    }
    .controls-pane {
      border-right: 0;
      border-bottom: 1px solid var(--se-border);
    }
  }
</style>
