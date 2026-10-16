<script lang="ts">
  // Spec 016: the map's scale on paper and its print extent (GeoLibre's MapScaleEditor and PrintExtentEditor).
  import Icon from '../Icon.svelte'
  import Segmented from '../kit/Segmented.svelte'
  import Select from '../kit/Select.svelte'
  import type { PrintComposer } from './composer.svelte.js'

  interface Props {
    c: PrintComposer
  }
  let { c }: Props = $props()
  const l = $derived(c.layout)

  /** The common scales, offered as presets. */
  const PRESETS = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]
  // Kept in step with the captured view's scale, unless the box is being typed in.
  let draft = $state('')
  let focused = $state(false)
  $effect(() => {
    const ratio = c.currentRatio
    if (!focused) draft = ratio > 0 ? String(Math.round(ratio)) : ''
  })
  /** A drawn extent fixes the ground area, so a typed scale could not be reached. */
  const editable = $derived(!!c.captured && l.captureMode !== 'extent')

  function commit(): void {
    focused = false
    const n = Number(draft)
    if (n > 0) void c.applyScale(n)
    else draft = c.currentRatio > 0 ? String(Math.round(c.currentRatio)) : ''
  }
</script>

{#if c.isMmPage}
  <section aria-label="Scale">
    <h3>Scale</h3>
    <div class="row">
      <label for="print-scale">Scale (1:N)</label>
      <span class="colon">1:</span>
      <input
        id="print-scale"
        type="text"
        inputmode="numeric"
        value={draft}
        disabled={!editable}
        placeholder="Capture first"
        onfocus={() => (focused = true)}
        oninput={(e) => (draft = e.currentTarget.value.replace(/[^0-9]/g, ''))}
        onblur={commit}
        onkeydown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <div class="presets">
        <Select compact label="Scale presets" value="" onChange={(v) => void c.applyScale(Number(v))} options={PRESETS.map((n) => ({ value: String(n), label: `1:${n.toLocaleString('en-US')}` }))} />
      </div>
    </div>
    {#if c.scaleNotice}<p class="error" role="alert">{c.scaleNotice}</p>{/if}
  </section>
{/if}

<section aria-label="Print extent">
  <h3>Print extent</h3>
  <div class="row">
    <button type="button" class="secondary" disabled={c.drawingExtent || !c.captured} onclick={() => void c.drawExtent()}><Icon name="select-shape" size={14} />{l.extentBbox ? 'Redraw extent on map' : 'Draw extent on map'}</button>
  </div>
  {#if l.extentBbox}
    <div class="row">
      <Segmented
        label="What the page shows"
        value={l.captureMode}
        onChange={(v) => c.setCaptureMode(v as 'viewport' | 'extent')}
        options={[
          { value: 'viewport', label: 'Active viewport' },
          { value: 'extent', label: 'Clip to extent' },
        ]}
      />
      <button type="button" class="secondary" onclick={() => c.clearExtent()}>Clear extent</button>
    </div>
  {/if}
  <p class="hint">Drag a box on the map to set the exact print area; hold Shift to match the page's proportions.</p>
</section>

<style>
  section {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    min-width: 0;
  }
  h3 {
    margin: 0 0 2px;
    font: var(--se-section-title-font);
    color: var(--se-text-primary);
  }
  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    min-height: 24px;
    min-width: 0;
  }
  label {
    flex: none;
    width: 96px;
    color: var(--se-text-secondary);
  }
  .colon {
    color: var(--se-text-secondary);
  }
  input {
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
  input:disabled {
    opacity: 0.5;
  }
  input:focus-visible,
  button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .presets {
    flex: none;
    width: 110px;
  }
  .secondary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .secondary:hover:not(:disabled) {
    background: var(--se-button-secondary-hover);
  }
  .secondary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .error {
    margin: 0;
    color: var(--se-error-fg, var(--se-error));
  }
</style>
