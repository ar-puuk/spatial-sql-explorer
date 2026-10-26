<script lang="ts">
  // Spec 026 US3 (FR-009): the values of a band as a histogram, with the low and high of the stretch marked and
  // movable by two handles under it. The counts are an estimate from a reduced level of the file (the card says so).
  // Adapted from GeoLibre (MIT): apps/geolibre-desktop/src/lib/raster-histogram.ts (the idea of marking the stretch on a histogram).
  import { valueText } from '@spatial-explorer/core'
  import RangeSlider from '../kit/RangeSlider.svelte'

  interface Props {
    /** Counts per equal-width bin from `dataMin` to `dataMax`; missing when the file gave no statistics. */
    counts?: number[]
    dataMin?: number
    dataMax?: number
    /** The stretch's low and high. */
    lo: number
    hi: number
    onChange: (lo: number, hi: number) => void
    /** What it is of ("Band 1"). */
    label: string
  }
  let { counts, dataMin, dataMax, lo, hi, onChange, label }: Props = $props()

  const known = $derived(typeof dataMin === 'number' && typeof dataMax === 'number' && dataMax > dataMin)
  const bins = $derived(counts ?? [])
  const peak = $derived(Math.max(1, ...bins))
  const W = 128
  const H = 44
  const x = (v: number): number => (known ? Math.min(1, Math.max(0, (v - (dataMin as number)) / ((dataMax as number) - (dataMin as number)))) : 0)
  // Square root: a few tall bins do not flatten the rest.
  const barH = (c: number): number => Math.round(Math.sqrt(c / peak) * H)
  const step = $derived(known ? ((dataMax as number) - (dataMin as number)) / 1000 : 1)
  const sliderFrom = $derived(known ? Math.min(Math.max(lo, dataMin as number), (dataMax as number) - step) : 0)
  const sliderTo = $derived(known ? Math.max(Math.min(hi, dataMax as number), (dataMin as number) + step) : 1)
</script>

<div class="hist">
  {#if known && bins.length > 0}
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="{label}: histogram of values from {valueText(dataMin ?? 0)} to {valueText(dataMax ?? 0)}; stretch from {valueText(lo)} to {valueText(hi)}">
      {#each bins as c, i (i)}
        {@const bw = W / bins.length}
        <rect x={i * bw} y={H - barH(c)} width={Math.max(bw - 0.3, 0.3)} height={barH(c)} class="bar" class:out={(i + 0.5) / bins.length < x(lo) || (i + 0.5) / bins.length > x(hi)} />
      {/each}
      <line x1={x(lo) * W} x2={x(lo) * W} y1="0" y2={H} class="mark" />
      <line x1={x(hi) * W} x2={x(hi) * W} y1="0" y2={H} class="mark" />
    </svg>
  {:else}
    <p class="none">No histogram: the file has no level to estimate it from.</p>
  {/if}
  {#if known}
    <RangeSlider from={sliderFrom} to={sliderTo} min={dataMin as number} max={dataMax as number} {step} fromLabel="Low end of the range" toLabel="High end of the range" onChange={(a, b) => onChange(a, b)} />
    <div class="ends" aria-hidden="true"><span>{valueText(dataMin as number)}</span><span>{valueText(dataMax as number)}</span></div>
  {/if}
</div>

<style>
  .hist {
    display: grid;
    gap: 4px;
  }
  svg {
    display: block;
    width: 100%;
    height: 56px;
    background: var(--se-input-bg);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
  }
  .bar {
    fill: var(--se-accent);
  }
  .bar.out {
    fill: var(--se-text-muted, var(--se-text-secondary));
    opacity: 0.55;
  }
  .mark {
    stroke: var(--se-text-primary);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .ends {
    display: flex;
    justify-content: space-between;
    color: var(--se-text-secondary);
    font: 11px/1.3 var(--se-font-mono);
    font-variant-numeric: tabular-nums;
  }
  .none {
    margin: 0;
    color: var(--se-text-secondary);
  }
</style>
