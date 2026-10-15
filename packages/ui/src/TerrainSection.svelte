<script lang="ts">
  // Spec 014: 3D terrain, in the Basemap panel (a height source, not a second basemap: the one basemap and
  // the data are lifted onto it). An on/off switch and the vertical exaggeration.
  import { TERRAIN_EXAGGERATION } from '@spatial-explorer/core'

  interface Props {
    on: boolean
    exaggeration: number
    onToggle: (on: boolean) => void
    onExaggeration: (value: number) => void
  }
  let { on, exaggeration, onToggle, onExaggeration }: Props = $props()
</script>

<section class="terrain" aria-label="Terrain">
  <label class="switch">
    <input type="checkbox" checked={on} onchange={(e) => onToggle(e.currentTarget.checked)} />
    <span class="text">
      <span class="name">3D terrain</span>
      <span class="hint">Lifts the map and your data onto the ground, with relief shading. Tilt the map to see it; the status bar shows elevation.</span>
    </span>
  </label>
  <label class="slider" class:off={!on}>
    <span class="label">Exaggeration</span>
    <input
      type="range"
      min={TERRAIN_EXAGGERATION.min}
      max={TERRAIN_EXAGGERATION.max}
      step={TERRAIN_EXAGGERATION.step}
      value={exaggeration}
      aria-label="Terrain exaggeration"
      oninput={(e) => onExaggeration(e.currentTarget.valueAsNumber)}
    />
    <span class="value">{exaggeration.toFixed(1)}×</span>
  </label>
</section>

<style>
  .terrain {
    display: grid;
    gap: 8px;
    flex: none;
    padding: 12px;
    border-bottom: 1px solid var(--se-border);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    color: var(--se-text-primary);
  }
  .switch {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
  }
  .switch input {
    margin: 2px 0 0;
    accent-color: var(--se-accent);
  }
  .text {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .hint {
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .slider {
    display: grid;
    grid-template-columns: 84px 1fr 40px;
    align-items: center;
    gap: 8px;
    padding-left: 24px;
  }
  .slider.off {
    opacity: 0.55;
  }
  .label {
    color: var(--se-text-secondary);
  }
  .value {
    text-align: right;
    font-family: var(--se-font-mono);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
    color: var(--se-text-secondary);
  }
  input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--se-accent);
  }
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
