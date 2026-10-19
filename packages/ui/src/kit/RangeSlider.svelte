<script lang="ts">
  // Two handles on one track, for a from and a to (the layer's zoom range). Two platform range inputs laid over
  // each other, only their handles taking the pointer, as the time slider does (keyboard, pointer and screen readers
  // for free, nothing to mount). The handles never cross: the one you move pushes the other, one step away.
  // The marker is a flag with the value, and a thin line down through the track at that value (a playhead), the way a
  // map's scale-range slider shows where the map is now. It goes grey when the value is outside what the handles hold.
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

<span class="se-range2" style:--from="{pct(from)}%" style:--to="{pct(to)}%" class:disabled class:has-marker={markerPct !== null}>
  <span class="track" aria-hidden="true"></span>
  {#if markerPct !== null && marker !== null}
    <span class="line" class:outside style:left="{markerPct}%" aria-hidden="true"></span>
    <span class="flag" class:outside style:--at="{markerPct}%" title={markerLabel} aria-hidden="true">{marker.toFixed(1)}</span>
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
    --lane: 0px;
  }
  /* With the marker: a lane above the track for its flag, and the track and handles move down into the rest. */
  .se-range2.has-marker {
    height: 38px;
    --lane: 14px;
  }
  .se-range2.disabled {
    opacity: 0.5;
  }
  .track {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(var(--lane) + 10px);
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
  /* The marker: a line through the track at the value, under the handles, and the value in a flag on top of it. */
  .line {
    position: absolute;
    top: calc(var(--lane) - 2px);
    width: 2px;
    height: 28px;
    margin-left: -1px;
    border-radius: 1px;
    background: var(--se-text-primary);
    pointer-events: none;
  }
  .flag {
    position: absolute;
    top: 0;
    /* Centered on the line, but never past the ends of the track. */
    left: clamp(15px, var(--at), calc(100% - 15px));
    transform: translateX(-50%);
    box-sizing: border-box;
    min-width: 30px;
    padding: 0 4px;
    border-radius: var(--se-radius-sm);
    background: var(--se-text-primary);
    color: var(--se-bg-elevated, #fff);
    font-family: var(--se-font-mono);
    font-size: 10px;
    line-height: 14px;
    text-align: center;
    white-space: nowrap;
    pointer-events: none;
  }
  /* Where the layer is hidden: the marker is a quiet outline. */
  .line.outside {
    background: var(--se-text-secondary);
    opacity: 0.6;
  }
  .flag.outside {
    background: transparent;
    color: var(--se-text-secondary);
    box-shadow: inset 0 0 0 1px var(--se-text-secondary);
  }
  input {
    position: absolute;
    left: 0;
    top: var(--lane);
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
