<script lang="ts">
  // Spec 026 US3 (FR-009): the color bar on the map: what the colors of the open raster mean. A card like the vector legend
  // (collapsible, in the legend's place): a gradient with its lowest and highest value, a row of classes for a colour
  // table, or the three band names of a colour image.
  import type { RasterFacts, RasterStyle } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'
  import ColorBar from './ColorBar.svelte'
  import { colormapColors } from './engine.js'

  interface Props {
    facts: RasterFacts
    style: RasterStyle
    /** The file's name, for the title when the raster has no band names of its own. */
    collapsed: boolean
    onToggleCollapsed: () => void
  }
  let { facts, style, collapsed, onToggleCollapsed }: Props = $props()

  const band = $derived(facts.bands[(style.bands[0] ?? 1) - 1])
  const title = $derived(style.mode === 'rgb' ? 'Colors' : (band?.name ?? 'Band 1'))
  const ramp = $derived(style.mode === 'single' ? colormapColors(style.colormap, 32, style.reversed) : null)
  const channels = $derived(style.mode === 'rgb' ? ['Red', 'Green', 'Blue'].map((c, i) => `${c}: ${facts.bands[(style.bands[i] ?? i + 1) - 1]?.name ?? `Band ${style.bands[i] ?? i + 1}`}`) : [])
</script>

<section class="legend" class:collapsed aria-label="Legend">
  <button type="button" class="head" aria-expanded={!collapsed} onclick={onToggleCollapsed}>
    <span class="title">{title}</span>
    <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={14} />
  </button>
  {#if !collapsed}
    <div class="body">
      {#if style.mode === 'paletted'}
        <ColorBar classes={facts.palette ?? null} label={title} />
      {:else if style.mode === 'rgb'}
        <ul class="channels">
          {#each channels as c (c)}<li>{c}</li>{/each}
        </ul>
      {:else}
        <ColorBar colors={ramp} min={style.min} max={style.max} label={title} />
      {/if}
    </div>
  {/if}
</section>

<style>
  .legend {
    width: var(--se-stack-width, 220px);
    max-width: 100%;
    box-sizing: border-box;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 5px 10px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    border-radius: var(--se-radius);
  }
  .head:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .body {
    padding: 2px 10px 8px;
  }
  .channels {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
    color: var(--se-text-secondary);
  }
</style>
