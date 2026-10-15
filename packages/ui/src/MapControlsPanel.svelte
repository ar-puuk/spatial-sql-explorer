<script lang="ts">
  // Spec 014: the "Map controls" side panel. One checkbox per map button (rendered from the core
  // registry, so a new control is a new row there), grouped as they sit on the map, and a corner
  // choice for each group that can move. The choice is the user's, for every file.
  import {
    CONTROL_CORNERS,
    CONTROL_GROUPS,
    isControlOn,
    isDefaultMapControls,
    MAP_CONTROLS,
    setControlOn,
    setGroupCorner,
    DEFAULT_MAP_CONTROLS,
    type ControlCorner,
    type ControlGroupId,
    type MapControlId,
    type MapControlsPrefs,
  } from '@spatial-explorer/core'

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

  function moveGroup(group: ControlGroupId, corner: ControlCorner): void {
    onChange(setGroupCorner(prefs, group, corner))
  }
</script>

<div class="controls-panel" role="region" aria-label="Map controls">
  <p class="intro">Choose the buttons on the map, and the corner each group sits in. This applies to every file.</p>
  {#each groups as g (g.id)}
    <section aria-labelledby="mc-{g.id}">
      <h3 id="mc-{g.id}">{g.label}</h3>
      {#each g.controls as c (c.id)}
        <label class="check">
          <input type="checkbox" checked={isControlOn(prefs, c.id)} onchange={(e) => onChange(setControlOn(prefs, c.id, e.currentTarget.checked))} />
          <span class="text">
            <span class="name">{c.label}</span>
            <span class="hint">{c.description}</span>
          </span>
        </label>
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
      {#if g.defaultCorner !== null}
        <div class="corners" role="radiogroup" aria-label="{g.label} position">
          <span class="label">Position</span>
          {#each CONTROL_CORNERS as corner (corner.id)}
            <label class="radio">
              <input type="radio" name="mc-corner-{g.id}" value={corner.id} checked={prefs.corners[g.id] === corner.id} onchange={() => moveGroup(g.id, corner.id)} />
              <span>{corner.label}</span>
            </label>
          {/each}
        </div>
      {/if}
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
    gap: 8px;
  }
  h3 {
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
  }
  .check input {
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
  .corners {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding-top: 2px;
  }
  .label {
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
