<script lang="ts">
  // Spec 027 US4: the statistics inside a drawn area, in the bottom panel: the figures of each band as a table, and a
  // histogram of the values with the mean marked. The panel is opaque and below the map, so the shape stays in view.
  import { areaCsv, formatArea, histogramCsv, histogramSvg, valueText } from '@spatial-explorer/core'
  import { svgToPng } from './chartImage.js'
  import SaveMenu from './SaveMenu.svelte'
  import Icon from '../Icon.svelte'
  import type { ViewerStore } from '../viewerStore.svelte.ts'

  interface Props {
    store: ViewerStore
  }
  let { store }: Props = $props()

  const probe = $derived(store.areaProbe)
  const area = $derived(probe?.area ?? null)
  const units = $derived(store.drawUnits)
  const BAND_COLORS = ['#d9382f', '#2f9e44', '#2563eb']
  const bandColor = (k: number): string => (area && area.bands.length === 3 ? BAND_COLORS[k] : 'var(--se-accent, #2563eb)')
  const count = (n: number): string => n.toLocaleString('en-US')

  /** Bars of a histogram as percentages of the box. */
  const bars = (h: number[]): Array<{ x: number; y: number; w: number; h: number }> => {
    const top = Math.max(1, ...h)
    return h.map((c, i) => ({ x: (i / h.length) * 100, y: 100 - (c / top) * 100, w: 100 / h.length, h: (c / top) * 100 }))
  }
  /** Where the mean falls along the histogram, 0 to 100. */
  const meanAt = (b: { min: number | null; max: number | null; mean: number | null }): number | null =>
    b.min !== null && b.max !== null && b.mean !== null && b.max > b.min ? ((b.mean - b.min) / (b.max - b.min)) * 100 : null

  const SAVE_ITEMS = [
    { id: 'csv', label: 'Statistics (CSV)', hint: 'One row per band, with the file, the area, the cell size and whether it is approximate' },
    { id: 'hist', label: 'Histogram (CSV)', hint: 'One row per bin of each band' },
    { id: 'svg', label: 'Histogram (SVG)', hint: 'The histograms as an editable vector picture, on white' },
    { id: 'png', label: 'Histogram (PNG)', hint: 'The histograms as a picture, on white' },
  ]
  async function save(id: string): Promise<void> {
    if (!area) return
    const file = store.openFileName ?? 'raster'
    const base = file.replace(/\.[^.]+$/, '')
    if (id === 'csv') return store.saveRasterExport(`${base}-area-statistics.csv`, areaCsv(area, file))
    if (id === 'hist') return store.saveRasterExport(`${base}-area-histogram.csv`, histogramCsv(area.bands))
    const chart = histogramSvg(area.bands, { title: `Values inside the area: ${file}` })
    if (id === 'svg') return store.saveRasterExport(`${base}-area-histogram.svg`, chart.svg)
    await store.saveRasterExport(`${base}-area-histogram.png`, await svgToPng(chart.svg, chart.width, chart.height))
  }
</script>

<section class="view" aria-label="Statistics inside the area">
  {#if !probe}
    <p class="empty">Choose <b>Area statistics</b> on the map and draw a polygon, rectangle or circle over the raster to read the cells inside it.</p>
  {:else}
    <header>
      <Icon name="sigma" size={14} />
      <h2>Area statistics</h2>
      {#if probe.status === 'running'}<span class="muted" role="status">Reading the raster…</span>{/if}
      <span class="spacer"></span>
      {#if area}
        <SaveMenu items={SAVE_ITEMS} onPick={save} />
      {/if}
      <button type="button" class="icon" aria-label="Close the statistics" title="Close (the area comes off the map)" onclick={() => store.clearRasterProbe('area')}><Icon name="close" size={14} /></button>
    </header>

    {#if probe.status === 'error'}
      <p class="error" role="alert">{probe.message}</p>
    {:else if area}
      <div class="main">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="stage" role="region" aria-label="Histograms" tabindex="0">
          {#each area.bands as b, k (b.band)}
            {#if b.histogram.length}
              <figure>
                <figcaption>{area.bands.length > 1 ? b.name : 'Values inside the area'}</figcaption>
                <div class="plot">
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Histogram of {b.name} inside the area, from {valueText(b.min)} to {valueText(b.max)}, mean {valueText(b.mean)}">
                    {#each [25, 50, 75] as g (g)}<line x1="0" x2="100" y1={g} y2={g} class="grid" vector-effect="non-scaling-stroke" />{/each}
                    {#each bars(b.histogram) as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} fill={bandColor(k)} />{/each}
                  </svg>
                  {#if meanAt(b) !== null}<span class="mean" style:left="{meanAt(b)}%"><span class="mean-label" class:flip={(meanAt(b) ?? 0) > 70}>mean {valueText(b.mean)}</span></span>{/if}
                </div>
                <div class="ends"><span>{valueText(b.min)}</span><span>{valueText(b.max)}</span></div>
              </figure>
            {:else}
              <p class="muted">{b.name}: no values inside the area{b.excluded ? ' (' + count(b.excluded) + ' cells have no data)' : ''}.</p>
            {/if}
          {/each}
        </div>

        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <aside aria-label="Figures" tabindex="0">
          <dl>
            <dt>Area</dt>
            <dd>{formatArea(area.areaM2, units)}</dd>
            {#if area.cellMeters}<dt>Cell size</dt><dd>about {valueText(Math.round(area.cellMeters * 100) / 100)} m</dd>{/if}
          </dl>
          <table aria-label="Statistics per band">
            <thead>
              <tr><th scope="col"><span class="sr">Figure</span></th>{#each area.bands as b (b.band)}<th scope="col">{b.name}</th>{/each}</tr>
            </thead>
            <tbody>
              <tr><th scope="row">Cells</th>{#each area.bands as b (b.band)}<td>{count(b.count)}</td>{/each}</tr>
              <tr><th scope="row">No data</th>{#each area.bands as b (b.band)}<td>{count(b.excluded)}</td>{/each}</tr>
              <tr><th scope="row">Minimum</th>{#each area.bands as b (b.band)}<td>{valueText(b.min)}</td>{/each}</tr>
              <tr><th scope="row">Maximum</th>{#each area.bands as b (b.band)}<td>{valueText(b.max)}</td>{/each}</tr>
              <tr><th scope="row">Mean</th>{#each area.bands as b (b.band)}<td>{valueText(b.mean)}</td>{/each}</tr>
              <tr><th scope="row">Sum</th>{#each area.bands as b (b.band)}<td>{valueText(b.sum)}</td>{/each}</tr>
              <tr><th scope="row">Std. dev.</th>{#each area.bands as b (b.band)}<td>{valueText(b.std)}</td>{/each}</tr>
            </tbody>
          </table>
          {#if area.approximate}<p class="approx" role="note">Approximate: the area is large, so a reduced level of the file was read.</p>{/if}
        </aside>
      </div>
    {/if}
  {/if}
</section>

<style>
  .view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    padding: 6px 12px 8px;
    gap: 6px;
    background: var(--se-bg-base);
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    box-sizing: border-box;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }
  h2 {
    margin: 0;
    font-size: 1em;
    font-weight: 600;
  }
  .spacer {
    flex: 1;
  }
  .muted,
  .empty {
    color: var(--se-text-secondary);
  }
  .empty {
    margin: 8px 0;
  }
  .error {
    margin: 0;
    color: var(--se-error);
  }
  .main {
    display: flex;
    gap: 14px;
    flex: 1;
    min-height: 0;
  }
  .stage {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
  }
  .stage:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  figure {
    flex: 1;
    min-height: 90px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  figcaption {
    font-weight: 600;
  }
  .plot {
    position: relative;
    flex: 1;
    min-height: 60px;
    border-bottom: 1px solid var(--se-border);
    border-left: 1px solid var(--se-border);
  }
  .plot svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .plot rect {
    opacity: 0.85;
  }
  .grid {
    stroke: var(--se-border);
    stroke-width: 1;
    opacity: 0.6;
  }
  .mean {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1.5px dashed var(--se-text-primary);
  }
  .mean-label {
    position: absolute;
    top: 2px;
    left: 4px;
    padding: 0 4px;
    white-space: nowrap;
    font-size: 11px;
    border-radius: 3px;
    background: var(--se-bg-base);
  }
  .mean-label.flip {
    left: auto;
    right: 4px;
  }
  .ends {
    display: flex;
    justify-content: space-between;
    color: var(--se-text-secondary);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  aside {
    flex: none;
    width: 270px;
    overflow: auto;
    display: grid;
    align-content: start;
    gap: 10px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 12px;
    margin: 0;
  }
  dt {
    color: var(--se-text-secondary);
  }
  dd {
    margin: 0;
    text-align: right;
    font-weight: 600;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 3px 0 3px 12px;
    text-align: right;
    border-bottom: 1px solid var(--se-border);
  }
  tbody th {
    padding-left: 0;
    text-align: left;
    color: var(--se-text-secondary);
    font-weight: 400;
  }
  thead th {
    font-weight: 600;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .approx {
    margin: 0;
    color: var(--se-warning);
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  button.icon {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: inherit;
  }
  button.icon:hover {
    background: var(--se-bg-hover);
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
  }
</style>
