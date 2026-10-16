<script lang="ts">
  // Spec 016: the page's legend (GeoLibre's legend editor): its title, and each class of the map's legend: rename it,
  // hide it, move it up or down. The edits are the page's: the legend on the map is untouched.
  import Icon from '../Icon.svelte'
  import type { PrintComposer } from './composer.svelte.js'

  interface Props {
    c: PrintComposer
  }
  let { c }: Props = $props()
  const edited = $derived(c.legendEdits.title !== null || Object.keys(c.legendEdits.rows).length > 0 || Object.keys(c.legendEdits.order).length > 0)
</script>

{#if c.legend}
  <div class="editor" role="group" aria-label="Legend entries">
    <div class="head">
      <span class="title">Legend</span>
      <button type="button" class="icon" aria-label="Reset the legend" title="Back to the map's legend" disabled={!edited} onclick={() => c.resetLegend()}><Icon name="reset" size={14} /></button>
    </div>
    <label class="row"><span>Legend title</span><input type="text" value={c.legendEdits.title ?? ''} placeholder={c.mapLegendTitle} oninput={(e) => c.setLegendTitle(e.currentTarget.value)} /></label>
    {#if c.editorRows.length}
      <ul>
        {#each c.editorRows as r, i (r.key)}
          {#if r.first && (r.group > 0 || c.editorRows.some((x) => x.group > 0))}
            <li class="group">{r.groupTitle || 'Legend'}</li>
          {/if}
          <li class:hidden={r.hidden}>
            <span class="swatch" style:background={r.color} aria-hidden="true"></span>
            <input type="text" aria-label={`Label of ${r.original}`} value={r.label} oninput={(e) => c.renameLegendRow(r.key, r.original, e.currentTarget.value)} />
            <button type="button" class="icon" aria-label={`Move ${r.original} up`} title="Move up" disabled={r.first} onclick={() => c.moveLegendRow(r.group, r.original, -1)}><Icon name="chevron-up" size={14} /></button>
            <button type="button" class="icon" aria-label={`Move ${r.original} down`} title="Move down" disabled={r.last} onclick={() => c.moveLegendRow(r.group, r.original, 1)}><Icon name="chevron-down" size={14} /></button>
            <button type="button" class="icon" aria-label={`${r.hidden ? 'Show' : 'Hide'} ${r.original}`} aria-pressed={r.hidden} title={r.hidden ? 'Show on the page' : 'Hide from the page'} onclick={() => c.toggleLegendRow(r.key, r.original, !r.hidden)}><Icon name={r.hidden ? 'eye-off' : 'eye'} size={14} /></button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">This legend has no classes to edit: its title is the only part you can change.</p>
    {/if}
  </div>
{/if}

<style>
  .editor {
    display: grid;
    gap: 6px;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid var(--se-border);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .title {
    font: var(--se-section-title-font);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .row > span {
    flex: none;
    width: 104px;
    color: var(--se-text-secondary);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 24px;
    box-sizing: border-box;
    padding: 2px 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-text-primary);
    font: inherit;
  }
  ul {
    display: grid;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  li.group {
    margin-top: 4px;
    color: var(--se-text-secondary);
    font-weight: 600;
  }
  li.hidden input {
    opacity: 0.5;
    text-decoration: line-through;
  }
  .swatch {
    flex: none;
    width: 14px;
    height: 14px;
    border: 1px solid var(--se-border);
    border-radius: 2px;
  }
  .icon {
    flex: none;
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
  .icon:hover:not(:disabled) {
    background: var(--se-bg-hover);
    color: var(--se-text-primary);
  }
  .icon:disabled {
    opacity: 0.35;
    cursor: default;
  }
  input:focus-visible,
  .icon:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
</style>
