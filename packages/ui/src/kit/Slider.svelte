<script lang="ts">
  // A value on a range, by dragging or typing: the platform's range input (keyboard, pointer, screen readers, and
  // nothing to mount; a headless slider cost about 45 ms at 6x CPU on panel open) beside a number field. Styled in
  // kit/base.css.
  interface Props {
    value: number
    min: number
    max: number
    step: number
    onChange: (value: number) => void
    label: string
    disabled?: boolean
    /** Shown after the number, e.g. "×". */
    unit?: string
  }
  let { value, min, max, step, onChange, label, disabled = false, unit = '' }: Props = $props()

  function typed(e: Event): void {
    const n = Number((e.currentTarget as HTMLInputElement).value)
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
  }
  const fill = $derived(((value - min) / (max - min)) * 100)
</script>

<div class="se-slider-row">
  <input class="se-range" type="range" {min} {max} {step} {value} {disabled} aria-label={label} style:--fill="{fill}%" oninput={(e) => onChange(e.currentTarget.valueAsNumber)} />
  <label class="se-slider-num">
    <input type="number" {min} {max} {step} {value} {disabled} aria-label="{label}, value" onchange={typed} />
    {#if unit}<span>{unit}</span>{/if}
  </label>
</div>

<style>
  .se-slider-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .se-range {
    flex: 1;
    min-width: 0;
  }
  /* The filled part of the track, in the accent. */
  .se-range::-webkit-slider-runnable-track {
    background: linear-gradient(to right, var(--se-accent) var(--fill), color-mix(in srgb, var(--se-text-secondary) 35%, transparent) var(--fill));
  }
  .se-range::-moz-range-progress {
    height: 4px;
    border-radius: 2px;
    background: var(--se-accent);
  }
  .se-slider-num {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--se-text-secondary);
    font-family: var(--se-font-mono);
    font-size: 12px;
  }
  .se-slider-num input {
    width: 46px;
    box-sizing: border-box;
    height: 24px;
    padding: 0 4px;
    text-align: right;
    font: inherit;
    color: var(--se-text-primary);
    background: var(--se-input-bg);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
  }
  .se-slider-num input:focus-visible {
    outline: 2px solid var(--se-focus);
    outline-offset: 0;
  }
</style>
