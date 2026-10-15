<script lang="ts">
  // Spec 014: the "Map controls" side panel. One row per control (rendered from the core registry, so a new
  // control is a new row there): an on/off switch, its name, and the corner it sits in. The user is treated as
  // the developer of the map (after mapgl, which gives every control a `position`). The choice is the user's,
  // for every file. Controls in a corner stack in the order listed here.
  import {
    CONTROL_POSITIONS,
    CONTROL_GROUPS,
    DEFAULT_MAP_CONTROLS,
    isControlOn,
    isDefaultMapControls,
    positionOf,
    positionsFor,
    MAP_CONTROLS,
    setControlPosition,
    setControlOn,
    type ControlPosition,
    type MapControlId,
    type MapControlsPrefs,
  } from '@spatial-explorer/core'
  import Switch from './kit/Switch.svelte'

  interface Props {
    prefs: MapControlsPrefs
    /** Controls this host or layer cannot offer are not listed. */
    available?: (id: MapControlId) => boolean
    onChange: (prefs: MapControlsPrefs) => void
    /** The hover tooltip's columns for this layer (a chooser shows while the tooltip is on). */
    tooltip?: { available: string[]; chosen: string[]; onChange: (columns: string[]) => void } | null
  }
  let { prefs, available = () => true, onChange, tooltip = null }: Props = $props()

  function toggleColumn(name: string, on: boolean): void {
    if (!tooltip) return
    const next = on ? [...tooltip.chosen, name] : tooltip.chosen.filter((c) => c !== name)
    // Keep the layer's column order, not the order of clicking.
    tooltip.onChange(tooltip.available.filter((c) => next.includes(c)))
  }

  const groups = $derived(
    CONTROL_GROUPS.map((g) => ({ ...g, controls: MAP_CONTROLS.filter((c) => c.group === g.id && available(c.id)) })).filter((g) => g.controls.length > 0)
  )
</script>

<div class="controls-panel" role="region" aria-label="Map controls">
  <p class="intro">Choose which controls the map shows and where each sits. This applies to every file. The attribution stays at the bottom right.</p>
  {#each groups as g (g.id)}
    <section aria-labelledby="mc-{g.id}">
      <h3 id="mc-{g.id}">{g.label}</h3>
      {#each g.controls as c (c.id)}
        <div class="row" class:off={!isControlOn(prefs, c.id)} title={c.description}>
          <Switch checked={isControlOn(prefs, c.id)} onChange={(on) => onChange(setControlOn(prefs, c.id, on))} labelledby="mc-name-{c.id}" />
          <span class="name" id="mc-name-{c.id}">{c.label}</span>
          {#if positionsFor(c.id).length > 0}
            <div class="where">
              <!-- The platform's select on purpose: fifteen rows of a library select cost over 100 ms to open at 6x CPU. -->
              <select aria-label="{c.label} position" value={positionOf(prefs, c.id) ?? ''} onchange={(e) => onChange(setControlPosition(prefs, c.id, e.currentTarget.value as ControlPosition))}>
                {#each CONTROL_POSITIONS.filter((p) => positionsFor(c.id).includes(p.id)) as position (position.id)}
                  <option value={position.id}>{position.label}</option>
                {/each}
              </select>
            </div>
          {/if}
        </div>
        {#if c.id === 'tooltip' && isControlOn(prefs, 'tooltip') && tooltip && tooltip.available.length > 0}
          <fieldset class="columns">
            <legend>Tooltip columns (up to 5 are shown)</legend>
            {#each tooltip.available as name (name)}
              <label class="radio">
                <input type="checkbox" checked={tooltip.chosen.includes(name)} onchange={(e) => toggleColumn(name, e.currentTarget.checked)} />
                <span class="col-name">{name}</span>
              </label>
            {/each}
          </fieldset>
        {/if}
      {/each}
    </section>
  {/each}
  <div class="footer">
    <button type="button" disabled={isDefaultMapControls(prefs)} onclick={() => onChange(DEFAULT_MAP_CONTROLS)}>Reset to defaults</button>
  </div>
</div>

<style>
  .controls-panel {
    display: grid;
    align-content: start;
    gap: 14px;
    padding: 12px;
    overflow-y: auto;
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    color: var(--se-text-primary);
  }
  .intro {
    margin: 0;
    color: var(--se-text-secondary);
  }
  section {
    display: grid;
    gap: 0;
  }
  h3 {
    margin: 8px 0 0;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--se-border);
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  /* switch | name | position */
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) 118px;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    border-bottom: 1px solid var(--se-border);
  }
  .row.off .name {
    color: var(--se-text-secondary);
  }
  .where {
    min-width: 0;
  }
  .where select {
    width: 100%;
    min-width: 0;
  }

  .columns {
    display: grid;
    gap: 3px;
    max-height: 168px;
    margin: 0 0 0 24px;
    padding: 0;
    border: 0;
    overflow-y: auto;
  }
  .columns legend {
    padding: 0 0 3px;
    color: var(--se-text-secondary);
  }
  .radio {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .radio input {
    margin: 0;
    accent-color: var(--se-accent);
  }
  .col-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .footer button {
    padding: 3px 10px;
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
    cursor: pointer;
  }
  .footer button:hover:not(:disabled) {
    background: var(--se-control-hover);
  }
  .footer button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .footer button:focus-visible,
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
