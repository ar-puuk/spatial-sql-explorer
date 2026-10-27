<script lang="ts">
  // Spec 026 US3: what the colors of a raster mean. A continuous band is a gradient bar with its lowest and highest
  // value; a colour table raster is a row per class. Data colors are fixed (not theme colors), like every ramp.
  import { valueText, type RasterPaletteEntry } from '@spatial-explorer/core'

  interface Props {
    /** The colormap from low to high as #rrggbb; null before the engine is up. */
    colors?: string[] | null
    min?: number
    max?: number
    /** A colour table's classes: shown instead of a gradient. */
    classes?: readonly RasterPaletteEntry[] | null
    /** What the bar is of ("Band 1"). */
    label: string
  }
  let { colors = null, min = 0, max = 1, classes = null, label }: Props = $props()
</script>

{#if classes && classes.length > 0}
  <ul class="classes" aria-label="{label}: classes">
    {#each classes as c (c.value)}
      <li><span class="swatch" style:background={c.color} aria-hidden="true"></span><span class="value">{c.value}</span></li>
    {/each}
  </ul>
{:else if colors && colors.length > 0}
  <div class="bar-wrap">
    <div class="bar" role="img" aria-label="{label}: {valueText(min)} to {valueText(max)}" style:background="linear-gradient(to right, {colors.join(', ')})"></div>
    <div class="ends" aria-hidden="true"><span>{valueText(min)}</span><span>{valueText(max)}</span></div>
  </div>
{/if}

<style>
  .bar-wrap {
    display: grid;
    gap: 2px;
  }
  .bar {
    height: 12px;
    border-radius: var(--se-radius-sm);
    box-shadow: inset 0 0 0 1px var(--se-border);
  }
  .ends {
    display: flex;
    justify-content: space-between;
    color: var(--se-text-secondary);
    font: 11px/1.3 var(--se-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .classes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .classes li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px var(--se-border);
  }
  .value {
    font: 11px/1.3 var(--se-font-mono);
    color: var(--se-text-secondary);
  }
</style>
