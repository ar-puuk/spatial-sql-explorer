<script lang="ts">
  // Spec 014: 3D terrain, in the Basemap panel (a height source, not a second basemap: the one basemap and
  // the data are lifted onto it). An on/off switch and the vertical exaggeration.
  import { TERRAIN_EXAGGERATION } from '@spatial-explorer/core'
  import Switch from './kit/Switch.svelte'
  import Slider from './kit/Slider.svelte'

  interface Props {
    on: boolean
    exaggeration: number
    onToggle: (on: boolean) => void
    onExaggeration: (value: number) => void
  }
  let { on, exaggeration, onToggle, onExaggeration }: Props = $props()
</script>

<section class="terrain" aria-label="Terrain">
  <div class="switch">
    <Switch checked={on} onChange={onToggle} labelledby="terrain-name" />
    <span class="text">
      <span class="name" id="terrain-name">3D terrain</span>
      <span class="hint">Lifts the map and your data onto the ground, with relief shading. Tilt the map to see it; the status bar shows elevation.</span>
    </span>
  </div>
  {#if on}
  <div class="slider">
    <span class="label">Exaggeration</span>
    <Slider
      value={exaggeration}
      min={TERRAIN_EXAGGERATION.min}
      max={TERRAIN_EXAGGERATION.max}
      step={TERRAIN_EXAGGERATION.step}
      label="Terrain exaggeration"
      unit="×"
      onChange={onExaggeration}
    />
  </div>
  {/if}
</section>

<style>
  .terrain {
    display: grid;
    gap: 10px;
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
    gap: 10px;
  }
  .switch :global(.se-switch) {
    margin-top: 2px;
  }
  .text {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .name {
    font-weight: 500;
  }
  .hint {
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .slider {
    display: grid;
    grid-template-columns: 84px 1fr;
    align-items: center;
    gap: 8px;
    padding-left: 38px;
  }
  .label {
    color: var(--se-text-secondary);
  }
</style>
