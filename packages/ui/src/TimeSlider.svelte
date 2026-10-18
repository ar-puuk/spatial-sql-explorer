<script lang="ts">
  // Spec 020: the time slider. A window over a date or timestamp column of the displayed result, moved by two handles
  // or played from the start to the end. It is that column's filter, so the map, the table and the counts follow.
  import { TIME_STEPS, positionToTime, timeLabel, timeToPosition } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import Select from './kit/Select.svelte'
  import type { ViewerStore } from './viewerStore.svelte.ts'

  interface Props {
    store: ViewerStore
  }
  let { store }: Props = $props()

  const t = $derived(store.timeSlider)
  const kind = $derived(t.columns.find((c) => c.name === t.column)?.kind ?? 'date')
  const domain = $derived(t.domain)
  const fromPos = $derived(domain ? timeToPosition(t.from, domain) : 0)
  const toPos = $derived(domain ? timeToPosition(t.to, domain) : TIME_STEPS)
  const fromText = $derived(domain ? timeLabel(t.from, kind, domain) : '')
  const toText = $derived(domain ? timeLabel(t.to, kind, domain) : '')

  function moveFrom(pos: number): void {
    if (!domain) return
    // The handles never cross: the one you drag pushes the other.
    const from = positionToTime(pos, domain)
    store.setTimeWindow(from, Math.max(from, t.to))
  }
  function moveTo(pos: number): void {
    if (!domain) return
    const to = positionToTime(pos, domain)
    store.setTimeWindow(Math.min(to, t.from), to)
  }
</script>

<div class="bar" role="group" aria-label="Time slider">
  <button type="button" class="icon" aria-label={t.playing ? 'Pause' : 'Play'} title={t.playing ? 'Pause' : 'Play the window across the whole span'} disabled={!domain} onclick={() => store.toggleTimePlay()}>
    <Icon name={t.playing ? 'pause' : 'play'} size={14} />
  </button>
  {#if t.columns.length > 1}
    <span class="column">
      <Select compact label="Time column" value={t.column ?? ''} options={t.columns.map((c) => ({ value: c.name, label: c.name }))} onChange={(v) => void store.setTimeColumn(v)} />
    </span>
  {:else if t.column}
    <span class="name" title="The column the slider filters">{t.column}</span>
  {/if}
  {#if t.loading}
    <span class="note" role="status">Reading the dates…</span>
  {:else if !domain}
    <span class="note" role="status">No row has a date in {t.column}.</span>
  {:else}
    <span class="time from" aria-hidden="true">{fromText}</span>
    <span class="range" style:--from="{fromPos / 10}%" style:--to="{toPos / 10}%">
      <span class="track" aria-hidden="true"></span>
      <input type="range" min="0" max={TIME_STEPS} step="1" value={fromPos} aria-label="From" aria-valuetext={fromText} oninput={(e) => moveFrom(e.currentTarget.valueAsNumber)} />
      <input type="range" min="0" max={TIME_STEPS} step="1" value={toPos} aria-label="To" aria-valuetext={toText} oninput={(e) => moveTo(e.currentTarget.valueAsNumber)} />
    </span>
    <span class="time to" aria-hidden="true">{toText}</span>
    {#if domain.missing > 0}
      <span class="note small" title="Rows with no date are left out while the window is narrower than the whole span">{domain.missing.toLocaleString('en-US')} undated</span>
    {/if}
  {/if}
  <button type="button" class="icon" aria-label="Close the time slider" title="Close (shows every row again)" onclick={() => store.closeTimeSlider()}>
    <Icon name="close" size={14} />
  </button>
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    width: min(640px, 100%);
    padding: 4px 6px;
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    background: var(--se-control-bg);
    box-shadow: var(--se-shadow-card);
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .icon {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .icon:hover:not(:disabled) {
    background: var(--se-bg-hover);
    color: var(--se-text-primary);
  }
  .icon:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible,
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .name,
  .column {
    flex: none;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--se-text-secondary);
  }
  .time {
    flex: none;
    font-family: var(--se-font-mono);
    font-size: 12px;
    color: var(--se-text-secondary);
    white-space: nowrap;
  }
  .note {
    flex: 1;
    color: var(--se-text-secondary);
  }
  .note.small {
    flex: none;
    font-size: 12px;
    white-space: nowrap;
  }
  /* Two range inputs on one track: only their handles take the pointer. */
  .range {
    position: relative;
    flex: 1;
    min-width: 80px;
    height: 24px;
  }
  .track {
    position: absolute;
    left: 0;
    right: 0;
    top: 10px;
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(
      to right,
      color-mix(in srgb, var(--se-text-secondary) 35%, transparent) var(--from),
      var(--se-accent) var(--from),
      var(--se-accent) var(--to),
      color-mix(in srgb, var(--se-text-secondary) 35%, transparent) var(--to)
    );
  }
  .range input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 24px;
    margin: 0;
    background: transparent;
    pointer-events: none;
    appearance: none;
    -webkit-appearance: none;
  }
  .range input::-webkit-slider-runnable-track {
    background: transparent;
    height: 24px;
  }
  .range input::-moz-range-track {
    background: transparent;
  }
  .range input::-webkit-slider-thumb {
    pointer-events: auto;
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    margin-top: 5px;
    border-radius: 50%;
    border: 2px solid var(--se-accent);
    background: var(--se-bg-elevated, #fff);
    cursor: grab;
  }
  .range input::-moz-range-thumb {
    pointer-events: auto;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--se-accent);
    background: var(--se-bg-elevated, #fff);
    cursor: grab;
  }
  @media (forced-colors: active) {
    .track {
      background: Highlight;
    }
  }
</style>
