<script lang="ts">
  // Spec 026 US2: what the open raster is, in words: the coordinate system, the size, the bands, the type, no data,
  // how it is stored. It sits where the layer picker sits (top left, under the search box), closed to one line until
  // the person opens it, and says where the SQL went (FR-013). The rows are made in core (describeRaster, tested).
  import { RASTER_NO_QUERY_NOTE, describeRaster, type RasterFacts } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'

  interface Props {
    facts: RasterFacts
    open: boolean
    onToggle: () => void
  }
  let { facts, open, onToggle }: Props = $props()

  const nf = new Intl.NumberFormat('en-US')
  const rows = $derived(describeRaster(facts))
  const summary = $derived(`${nf.format(facts.width)} × ${nf.format(facts.height)} pixels, ${facts.bands.length} ${facts.bands.length === 1 ? 'band' : 'bands'}`)
  const bodyId = 'raster-card-body'
</script>

<section class="raster-card" class:open aria-label="Raster">
  <button type="button" class="head" aria-expanded={open} aria-controls={bodyId} onclick={onToggle} title={open ? 'Hide the raster’s facts' : 'Show the raster’s facts'}>
    <Icon name="image" />
    <span class="title">Raster</span>
    <span class="summary">{summary}</span>
    <Icon name={open ? 'chevron-up' : 'chevron-down'} />
  </button>
  {#if open}
    <div id={bodyId} class="body">
      <dl>
        {#each rows as row (row.label)}
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        {/each}
      </dl>
      {#each facts.warnings as warning (warning)}
        <p class="note warning">{warning}</p>
      {/each}
      <p class="note">{RASTER_NO_QUERY_NOTE}</p>
    </div>
  {/if}
</section>

<style>
  .raster-card {
    display: flex;
    flex-direction: column;
    /* The same width as the search box above it (--se-stack-width, MapView). */
    width: var(--se-stack-width, 300px);
    max-width: 100%;
    /* In the map's left column the card gives way to what is below it, and its list scrolls. */
    min-height: 0;
    max-height: 480px;
    box-sizing: border-box;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    user-select: text;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: var(--se-radius);
  }
  .head:hover {
    background: var(--se-hover-bg, transparent);
  }
  .head:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .title {
    font-weight: 600;
  }
  .summary {
    flex: 1;
    min-width: 0;
    color: var(--se-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .raster-card.open .head {
    border-bottom: 1px solid var(--se-border);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: auto;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(92px, auto) 1fr;
    grid-auto-rows: max-content;
    gap: 3px 12px;
    margin: 0;
    padding: 8px 10px 4px;
  }
  dt {
    color: var(--se-text-secondary);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .note {
    margin: 0;
    padding: 4px 10px 8px;
    color: var(--se-text-secondary);
    font-size: 0.95em;
    line-height: 1.4;
  }
  .note.warning {
    color: var(--se-text-primary);
  }
</style>
