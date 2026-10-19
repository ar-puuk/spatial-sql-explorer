<script lang="ts">
  // Two handles on one track, for a from and a to (the layer's zoom range). Two platform range inputs laid over
  // each other, only their handles taking the pointer, as the time slider does (keyboard, pointer and screen readers
  // for free, nothing to mount). The handles never cross: the one you move pushes the other, one step away.
  // The marker is a small hollow dot ON the track at that value, under the handles and no bigger than them (the map's
  // current zoom, say). It is a dashed outline when the value is outside what the handles hold. Its tooltip says what it is.
  interface Props {
    from: number
    to: number
    min: number
    max: number
    step?: number
    onChange: (from: number, to: number) => void
    fromLabel: string
    toLabel: string
    disabled?: boolean
    /** Where something else stands on the same scale (the map's current zoom). */
    marker?: number | null
    markerLabel?: string
  }
  let { from, to, min, max, step = 1, onChange, fromLabel, toLabel, disabled = false, marker = null, markerLabel = '' }: Props = $props()

  const pct = (v: number): number => ((v - min) / (max - min)) * 100
  const markerPct = $derived(marker === null ? null : Math.min(100, Math.max(0, pct(marker))))
  const outside = $derived(marker !== null && (marker < from || marker >= to))
  function moveFrom(v: number): void {
    const next = Math.min(v, max - step)
    onChange(next, Math.max(to, next + step))
  }
  function moveTo(v: number): void {
    const next = Math.max(v, min + step)
    onChange(Math.min(from, next - step), next)
  }
</script>

<span class="se-range2" style:--from="{pct(from)}%" style:--to="{pct(to)}%" class:disabled>
  <span class="track" aria-hidden="true"></span>
  {#if markerPct !== null}
    <span class="dot" class:outside style:left="{markerPct}%" title={markerLabel} aria-hidden="true"></span>
  {/if}
  <input type="range" {min} {max} {step} value={from} {disabled} aria-label={fromLabel} oninput={(e) => moveFrom(e.currentTarget.valueAsNumber)} />
  <input type="range" {min} {max} {step} value={to} {disabled} aria-label={toLabel} oninput={(e) => moveTo(e.currentTarget.valueAsNumber)} />
</span>

<style>
  .se-range2 {
    position: relative;
    display: block;
    flex: 1;
    min-width: 80px;
    height: 24px;
  }
  .se-range2.disabled {
    opacity: 0.5;
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
  /* The marker: a hollow dot on the track, under the handles (which take the pointer first where they overlap it). */
  .dot {
    position: absolute;
    top: 6px;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    border: 2px solid var(--se-text-primary);
    border-radius: 50%;
    background: color-mix(in srgb, var(--se-bg-elevated, #fff) 55%, transparent);
  }
  .dot.outside {
    border-color: var(--se-text-secondary);
    border-style: dashed;
  }
  input {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 24px;
    margin: 0;
    background: transparent;
    pointer-events: none;
    appearance: none;
    -webkit-appearance: none;
  }
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  input::-webkit-slider-runnable-track {
    background: transparent;
    height: 24px;
  }
  input::-moz-range-track {
    background: transparent;
  }
  input::-webkit-slider-thumb {
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
  input::-moz-range-thumb {
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
