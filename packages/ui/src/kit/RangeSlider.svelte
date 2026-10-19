<script lang="ts">
  // Two handles on one track, for a from and a to (the layer's zoom range). Two platform range inputs laid over
  // each other, only their handles taking the pointer, as the time slider does (keyboard, pointer and screen readers
  // for free, nothing to mount). The handles never cross: the one you move pushes the other, one step away.
  // The marker is a pair of small triangles, one above the track pointing down and one below pointing up, both at that
  // value (the map's current zoom, say): like a caliper closing on the track. They are grey when the value is outside
  // what the handles hold. The tooltip says what they are.
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
    <span class="mark top" class:outside style:left="{markerPct}%" title={markerLabel} aria-hidden="true"></span>
    <span class="mark bottom" class:outside style:left="{markerPct}%" title={markerLabel} aria-hidden="true"></span>
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
    height: 30px;
  }
  .se-range2.disabled {
    opacity: 0.5;
  }
  .track {
    position: absolute;
    left: 0;
    right: 0;
    top: 13px;
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
  /* The marker: two small triangles closing on the track from above and below, under the handles. */
  .mark {
    position: absolute;
    width: 0;
    height: 0;
    margin-left: -4px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    color: var(--se-text-primary);
  }
  .mark.top {
    top: 6px;
    border-top: 5px solid currentColor;
  }
  .mark.bottom {
    top: 19px;
    border-bottom: 5px solid currentColor;
  }
  .mark.outside {
    color: var(--se-text-secondary);
    opacity: 0.65;
  }
  input {
    position: absolute;
    left: 0;
    top: 3px;
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
