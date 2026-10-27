<script lang="ts">
  // Spec 022: Dot density. The choices write a query that goes to the SQL tab as it runs (a preview is a run, and Esc brings the
  // old query back), like Bin into cells, and floats over the map's top left corner for the same reason: the map has to stay visible.
  // Esc cancels (and puts everything back), Enter keeps the dots.
  import { onDestroy, onMount, tick } from 'svelte'
  import { MAX_DOT_COLUMNS, dotLabel, perDotLadder } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import Select from './kit/Select.svelte'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
    /** The map pane's height (px): the dialog stays inside it, and its body scrolls. 0: not known. */
    mapHeight?: number
  }
  let { store, mapHeight = 0 }: Props = $props()

  const dots = $derived(store.dotDialog)
  const spec = $derived(dots.spec)
  const numeric = $derived(dots.info?.numericColumns ?? [])
  const nf = new Intl.NumberFormat('en-US')

  const total = $derived(spec.columns.reduce((sum, c) => sum + (dots.info?.totals[c] ?? 0), 0))
  // The amounts per dot on offer run from 1 to what gives a single dot; the current one is on the list even when it is not 1, 2 or 5 times a power of ten.
  const perDotOptions = $derived.by(() => {
    const values = perDotLadder(Math.max(1, total))
    if (!values.includes(spec.perDot)) values.push(spec.perDot)
    return values.sort((a, b) => a - b).map((v) => ({ value: String(v), label: nf.format(v) }))
  })
  const estimateText = $derived(dots.estimate === 0 ? '' : `About ${nf.format(dots.estimate)} ${dots.estimate === 1 ? 'dot' : 'dots'}`)

  function toggle(column: string, box: HTMLInputElement): void {
    const on = box.checked
    const next = on ? [...spec.columns, column] : spec.columns.filter((c) => c !== column)
    // At least one column stays (the checkbox goes back to checked), so it stays focusable.
    if (next.length === 0) {
      box.checked = true
      return
    }
    store.setDotSpec({ columns: numeric.filter((c) => next.includes(c)) })
  }

  let panel = $state<HTMLDivElement>()
  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      void store.cancelDots()
      return
    }
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement) && !dots.overLimit) {
      e.preventDefault()
      void store.applyDots()
    }
  }

  // Focus goes to the first column on open and back to what opened the dialog on close.
  const opener = typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)
  onMount(() => {
    void tick().then(() => panel?.querySelector<HTMLElement>('input[type="checkbox"]')?.focus())
  })
  onDestroy(() => {
    if (opener && opener !== document.body && opener.isConnected) void tick().then(() => opener.focus())
  })
</script>

<div class="panel" role="dialog" aria-label="Dot density" bind:this={panel} onkeydown={onKeydown} tabindex="-1" style:max-height={mapHeight > 0 ? `${Math.max(180, mapHeight - 58)}px` : undefined}>
  <header>
    <Icon name="dots" size={14} />
    <h2>Dot density</h2>
    <button type="button" class="icon-button" aria-label="Close" title="Close (Esc)" onclick={() => void store.cancelDots()}><Icon name="close" size={14} /></button>
  </header>

  <div class="body">
    <div class="field">
      <span class="label" id="dots-columns">Draw</span>
      <div class="control">
        <div class="columns" role="group" aria-labelledby="dots-columns">
          {#each numeric as column (column)}
            {@const on = spec.columns.includes(column)}
            <label class="check">
              <input type="checkbox" checked={on} disabled={!on && spec.columns.length >= MAX_DOT_COLUMNS} onchange={(e) => toggle(column, e.currentTarget)} />
              <span>{column}</span>
            </label>
          {/each}
        </div>
        <p class="hint">{spec.columns.length > 1 ? 'Each column gets its own color.' : `Up to ${MAX_DOT_COLUMNS} columns, each its own color.`}</p>
      </div>
    </div>

    <div class="field">
      <span class="label">One dot</span>
      <div class="control">
        <Select label="Amount one dot stands for" value={String(spec.perDot)} options={perDotOptions} onChange={(v) => store.setDotSpec({ perDot: Number(v) })} />
        <p class="hint estimate" role="status" aria-live="polite">{estimateText}{dots.running ? ' · drawing…' : ''}</p>
      </div>
    </div>

    {#if dots.problem}
      <p class="notice invalid" role="alert"><Icon name="info" size={14} /><span>{dots.problem}</span></p>
    {:else if dots.overLimit}
      <p class="notice warn" role="alert"><Icon name="info" size={14} /><span>That is more than 100,000 dots: it draws from tiles and takes longer. Let one dot stand for more, or run it anyway.</span></p>
    {:else if dots.estimate > 20000}
      <p class="notice" role="status"><Icon name="info" size={14} /><span>Many dots: press Show to draw them and put the SQL in the SQL tab.</span></p>
    {:else}
      <p class="notice" role="note"><Icon name="info" size={14} /><span>{dotLabel(spec.perDot)}. Dots are placed at random inside each polygon.</span></p>
    {/if}
  </div>

  <footer>
    <button type="button" class="secondary" onclick={() => void store.cancelDots()}>Cancel</button>
    {#if dots.overLimit && !dots.problem}
      <button type="button" class="primary" disabled={dots.running} onclick={() => void store.applyDots(true)}>Run anyway</button>
    {:else}
      <button type="button" class="primary" disabled={!!dots.problem || dots.running} onclick={() => void store.applyDots()}>{dots.estimate > 20000 && !dots.previewed ? 'Show' : 'Keep'}</button>
    {/if}
  </footer>
</div>

<style>
  .panel {
    position: absolute;
    /* Under the search box, on its left edge. */
    top: 48px;
    left: 10px;
    z-index: 25;
    display: flex;
    flex-direction: column;
    /* The width of the search box, the layer picker and the feature card at the map's top left (--se-stack-width, MapView). */
    width: min(var(--se-stack-width, 300px), calc(100% - 24px));
    max-height: calc(100% - 64px);
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
  .columns {
    display: grid;
    gap: 2px;
    max-height: 132px;
    overflow-y: auto;
    padding: 2px 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    cursor: pointer;
  }
  .check span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  input[type='checkbox'] {
    flex: none;
    margin: 0;
    accent-color: var(--se-accent);
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
  button:focus-visible,
  input:focus-visible {
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
