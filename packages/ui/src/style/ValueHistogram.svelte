<script lang="ts">
  // Spec 008 FR-003 (research §10): the graduated column's value distribution
  // with the class breaks drawn over it, so users see where breaks fall. SVG,
  // no chart library. Bars use a chrome token; break lines use the class colors
  // (data colors are fixed, CLAUDE.md "Theming").
  import type { ValueHistogram } from '@spatial-explorer/core'

  interface Props {
    histogram: ValueHistogram | null
    /** Upper bounds of each class but the last, ascending, with that class's color. */
    breaks: Array<{ value: number; color: string }>
    /** Formats a data value for the description (same as the legend). */
    format: (v: number) => string
  }
  let { histogram, breaks, format }: Props = $props()

  const W = 280
  const H = 56
  const id = `histogram-${Math.random().toString(36).slice(2, 8)}`

  const max = $derived(histogram ? Math.max(1, ...histogram.counts) : 1)
  const lo = $derived(histogram?.edges[0] ?? 0)
  const hi = $derived(histogram?.edges[histogram.edges.length - 1] ?? 1)
  const x = (v: number): number => (hi > lo ? ((v - lo) / (hi - lo)) * W : W / 2)
  const description = $derived(
    histogram
      ? `${histogram.total.toLocaleString('en-US')} values from ${format(lo)} to ${format(hi)}. ` +
          (breaks.length ? `Class breaks at ${breaks.map((b) => format(b.value)).join(', ')}.` : 'One class.')
      : ''
  )
</script>

<figure class="histogram">
  {#if histogram}
    <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Value distribution" aria-describedby={id}>
      {#each histogram.counts as n, i (i)}
        {@const bw = W / histogram.counts.length}
        {@const h = n ? Math.max(1, (n / max) * (H - 2)) : 0}
        <rect class="bar" x={i * bw + 0.5} y={H - h} width={Math.max(0.5, bw - 1)} height={h} />
      {/each}
      {#each breaks as b (b.value)}
        {#if b.value > lo && b.value < hi}
          <line class="break" x1={x(b.value)} x2={x(b.value)} y1="0" y2={H} style:stroke={b.color} />
        {/if}
      {/each}
    </svg>
    <figcaption>
      <span>{format(lo)}</span>
      <span>{format(hi)}</span>
    </figcaption>
    <p class="sr-only" id={id}>{description}</p>
  {:else}
    <div class="loading" role="status">Reading values…</div>
  {/if}
</figure>

<style>
  .histogram {
    margin: 0;
  }
  svg {
    display: block;
    width: 100%;
    height: 56px;
    border-bottom: 1px solid var(--se-border);
  }
  .bar {
    fill: color-mix(in srgb, var(--se-text-secondary) 55%, transparent);
  }
  .break {
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
    /* Visible on any background: the class color with a contrasting halo. */
    filter: drop-shadow(0 0 1px var(--se-bg-elevated));
  }
  figcaption {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    color: var(--se-text-secondary);
    font-family: var(--se-font-mono);
    font-size: 0.85em;
    font-variant-numeric: tabular-nums;
  }
  .loading {
    height: 56px;
    display: grid;
    place-items: center;
    color: var(--se-text-secondary);
    font-size: 0.92em;
    border-bottom: 1px solid var(--se-border);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
