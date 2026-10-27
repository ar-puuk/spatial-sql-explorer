<script lang="ts">
  // Spec 027 US3 and US4: what a line or an area drawn over the raster says. A profile is a chart of the value along the
  // line (gaps where there is no data or the line leaves the raster) with the figures that matter and a CSV; the keys
  // and the pointer move a marker along the line on the map. The same table is there as text for screen readers.
  import { areaCsv, formatArea, formatLength, profileCsv, summarizeProfile, valueText } from '@spatial-explorer/core'
  import Icon from '../Icon.svelte'
  import type { ViewerStore } from '../viewerStore.svelte.ts'

  interface Props {
    store: ViewerStore
  }
  let { store }: Props = $props()

  const probe = $derived(store.rasterProbe)
  const profile = $derived(probe?.profile ?? null)
  const area = $derived(probe?.area ?? null)
  const units = $derived(store.drawUnits)

  const W = 600
  const H = 140
  const PAD = { l: 44, r: 8, t: 8, b: 20 }
  const COLORS = ['var(--se-chart-1, #4e79a7)', 'var(--se-chart-2, #e15759)', 'var(--se-chart-3, #59a14f)']
  const BAND_COLORS = ['#d9382f', '#2f9e44', '#2563eb']

  const all = $derived(profile ? profile.bands.flatMap((b) => b.values).filter((v): v is number => v !== null) : [])
  const lo = $derived(all.length ? Math.min(...all) : 0)
  const hi = $derived(all.length ? Math.max(...all) : 1)
  const span = $derived(hi > lo ? hi - lo : 1)
  const n = $derived(profile?.samples.points.length ?? 0)
  const total = $derived(profile?.samples.totalMeters ?? 0)

  const x = (i: number): number => PAD.l + (n > 1 ? (i / (n - 1)) * (W - PAD.l - PAD.r) : 0)
  const y = (v: number): number => PAD.t + (1 - (v - lo) / span) * (H - PAD.t - PAD.b)

  /** The line as separate runs: a gap ends one and starts the next. */
  function paths(values: ReadonlyArray<number | null>): string[] {
    const out: string[] = []
    let run = ''
    values.forEach((v, i) => {
      if (v === null) {
        if (run) out.push(run)
        run = ''
      } else run += `${run ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
    })
    if (run) out.push(run)
    return out
  }

  const summaries = $derived(profile ? profile.bands.map((b) => ({ band: b, s: summarizeProfile(b.values) })) : [])
  const bandColor = (k: number): string => (profile && profile.bands.length === 3 ? BAND_COLORS[k] : COLORS[0])

  let at = $state<number | null>(null)
  $effect(() => {
    const p = profile && at !== null ? profile.samples.points[at] : null
    store.setProbeMarker(p ?? null)
  })
  $effect(() => {
    // A new answer starts without a marker.
    void profile
    at = null
  })

  function pointerMove(e: PointerEvent): void {
    if (!n) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * W
    at = Math.min(n - 1, Math.max(0, Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))))
  }
  function keyMove(e: KeyboardEvent): void {
    if (!n) return
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') at = Math.min(n - 1, (at ?? -1) + step)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') at = Math.max(0, (at ?? 1) - step)
    else if (e.key === 'Home') at = 0
    else if (e.key === 'End') at = n - 1
    else return
    e.preventDefault()
  }

  const readout = $derived.by(() => {
    if (!profile || at === null) return ''
    const d = formatLength(profile.samples.distances[at], units)
    const vals = profile.bands.map((b) => `${profile.bands.length > 1 ? `${b.name} ` : ''}${valueText(b.values[at!])}`).join(', ')
    return `${d}: ${vals}`
  })

  /** Every n-th place for the table, so a 2,000 place profile is not 2,000 rows. */
  const tableRows = $derived.by(() => {
    if (!profile) return []
    const step = Math.max(1, Math.ceil(n / 40))
    const rows: number[] = []
    for (let i = 0; i < n; i += step) rows.push(i)
    if (rows[rows.length - 1] !== n - 1 && n > 0) rows.push(n - 1)
    return rows
  })

  const count = (n: number): string => n.toLocaleString('en-US')
  /** A tiny bar chart of the values inside the area. */
  const bars = (h: number[]): Array<{ x: number; y: number; w: number; h: number }> => {
    const top = Math.max(1, ...h)
    return h.map((c, i) => ({ x: (i / h.length) * 100, y: 100 - (c / top) * 100, w: 100 / h.length, h: (c / top) * 100 }))
  }

  async function saveCsv(): Promise<void> {
    if (profile) await store.saveRasterProfileCsv(profileCsv(profile.samples, profile.bands))
    else if (area) await store.saveRasterProfileCsv(areaCsv(area.bands), 'area-statistics.csv')
  }
</script>

{#if probe}
  <section class="probe" aria-label={probe.kind === 'profile' ? 'Profile along the line' : 'Statistics inside the area'}>
    <header>
      <Icon name={probe.kind === 'profile' ? 'profile' : 'sigma'} size={14} />
      <h2>{probe.kind === 'profile' ? 'Profile' : 'Area statistics'}</h2>
      {#if probe.status === 'running'}<span class="muted" role="status">Reading the raster…</span>{/if}
      <span class="spacer"></span>
      {#if profile || area}
        <button type="button" class="text" onclick={() => void saveCsv()} title="Distance, longitude, latitude and the value of each band">Save CSV</button>
      {/if}
      <button type="button" class="icon" aria-label="Close the {probe.kind === 'profile' ? 'profile' : 'statistics'}" title="Close (the line comes off the map)" onclick={() => store.clearRasterProbe()}><Icon name="close" size={14} /></button>
    </header>

    {#if probe.status === 'error'}
      <p class="error" role="alert">{probe.message}</p>
    {:else if area}
      <div class="figures" aria-label="Figures">
        <span>Area <b>{formatArea(area.areaM2, units)}</b></span>
        {#if area.cellMeters}<span class="muted">Cells of about {valueText(Math.round(area.cellMeters * 100) / 100)} m</span>{/if}
        {#if area.approximate}<span class="muted" role="note">Approximate: the area is large, so a reduced level of the file was read.</span>{/if}
      </div>
      <table aria-label="Statistics per band">
        <thead>
          <tr><th scope="col">Band</th><th scope="col">Cells</th><th scope="col">No data</th><th scope="col">Min</th><th scope="col">Max</th><th scope="col">Mean</th><th scope="col">Sum</th><th scope="col">Std. dev.</th></tr>
        </thead>
        <tbody>
          {#each area.bands as b (b.band)}
            <tr>
              <th scope="row">{b.name}</th>
              <td>{count(b.count)}</td>
              <td>{count(b.excluded)}</td>
              <td>{valueText(b.min)}</td>
              <td>{valueText(b.max)}</td>
              <td>{valueText(b.mean)}</td>
              <td>{valueText(b.sum)}</td>
              <td>{valueText(b.std)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#each area.bands as b (b.band)}
        {#if b.histogram.length}
          <svg class="hist" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Histogram of {b.name} inside the area, from {valueText(b.min)} to {valueText(b.max)}">
            {#each bars(b.histogram) as r, i (i)}<rect x={r.x} y={r.y} width={r.w} height={r.h} fill={bandColor(area.bands.indexOf(b))} />{/each}
          </svg>
        {:else}
          <p class="muted">{b.name}: no values inside the area{b.excluded ? ' (' + count(b.excluded) + ' cells have no data)' : ''}.</p>
        {/if}
      {/each}
    {:else if profile}
      <div class="figures" aria-label="Figures">
        <span>Length <b>{formatLength(total, units)}</b></span>
        {#each summaries as { band, s } (band.band)}
          {#if summaries.length > 1}<span class="band">{band.name}</span>{/if}
          {#if s.valid}
            <span>Min <b>{valueText(s.min)}</b></span>
            <span>Max <b>{valueText(s.max)}</b></span>
            <span>Mean <b>{valueText(s.mean)}</b></span>
            {#if summaries.length === 1}<span title="The sum of the climbs and of the descents along the line">Rise <b>{valueText(s.rise)}</b></span><span>Fall <b>{valueText(s.fall)}</b></span>{/if}
          {:else}
            <span>No values on this line</span>
          {/if}
          {#if s.gaps}<span class="muted">{s.gaps} of {s.total} places have no data</span>{/if}
        {/each}
        {#if profile.samples.coarse}<span class="muted">Places are further apart than cells.</span>{/if}
      </div>

      <div
        class="chart"
        role="slider"
        tabindex="0"
        aria-label="Position along the profile (arrow keys move it; the place is marked on the map)"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, n - 1)}
        aria-valuenow={at ?? 0}
        aria-valuetext={readout || 'No place chosen'}
        onpointermove={pointerMove}
        onpointerleave={() => (at = null)}
        onkeydown={keyMove}
      >
      <svg viewBox="0 0 {W} {H}" aria-hidden="true">
        <line class="axis" x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} />
        <line class="axis" x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} />
        <text class="tick" x={PAD.l - 4} y={PAD.t + 8} text-anchor="end">{valueText(hi)}</text>
        <text class="tick" x={PAD.l - 4} y={H - PAD.b} text-anchor="end">{valueText(lo)}</text>
        <text class="tick" x={PAD.l} y={H - 4} text-anchor="start">0</text>
        <text class="tick" x={W - PAD.r} y={H - 4} text-anchor="end">{formatLength(total, units)}</text>
        {#if profile}
          {#each profile.bands as b, k (b.band)}
            {#each paths(b.values) as d, i (i)}
              <path {d} fill="none" stroke={bandColor(k)} stroke-width="1.5" vector-effect="non-scaling-stroke" />
            {/each}
          {/each}
        {/if}
        {#if at !== null}
          <line class="cursor" x1={x(at)} y1={PAD.t} x2={x(at)} y2={H - PAD.b} />
        {/if}
      </svg>
      </div>
      <p class="readout" role="status" aria-live="polite">{readout || 'Move along the chart to see the values; the place is marked on the map.'}</p>

      <details>
        <summary>Table of values</summary>
        <table>
          <thead>
            <tr><th scope="col">Distance</th><th scope="col">Longitude</th><th scope="col">Latitude</th>{#each profile.bands as b (b.band)}<th scope="col">{b.name}</th>{/each}</tr>
          </thead>
          <tbody>
            {#each tableRows as i (i)}
              <tr>
                <td>{formatLength(profile.samples.distances[i], units)}</td>
                <td>{profile.samples.points[i][0].toFixed(5)}</td>
                <td>{profile.samples.points[i][1].toFixed(5)}</td>
                {#each profile.bands as b (b.band)}<td>{valueText(b.values[i])}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
        {#if n > tableRows.length}<p class="muted">Every {Math.ceil(n / 40)}th place; the CSV has all {n}.</p>{/if}
      </details>
    {/if}
  </section>
{/if}

<style>
  .probe {
    display: grid;
    gap: 6px;
    padding: 8px 10px;
    background: var(--se-bg-overlay);
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow, 0 2px 8px rgba(0, 0, 0, 0.25));
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    max-height: 60vh;
    overflow: auto;
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  h2 {
    margin: 0;
    font-size: 1em;
    font-weight: 600;
  }
  .spacer {
    flex: 1;
  }
  .muted {
    color: var(--se-text-secondary);
  }
  .error {
    margin: 0;
    color: var(--se-error);
  }
  .figures {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }
  .figures .band {
    font-weight: 600;
  }
  svg {
    width: 100%;
    height: auto;
    max-height: 170px;
    border-radius: var(--se-radius-sm);
    background: var(--se-bg-input, transparent);
  }
  .chart {
    border-radius: var(--se-radius-sm);
  }
  .chart:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .axis {
    stroke: var(--se-border);
    stroke-width: 1;
  }
  .cursor {
    stroke: var(--se-text-secondary);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .tick {
    fill: var(--se-text-secondary);
    font-size: 10px;
  }
  .hist {
    width: 100%;
    height: 48px;
    background: var(--se-bg-input, transparent);
    border-radius: var(--se-radius-sm);
  }
  .readout {
    margin: 0;
    min-height: 1.4em;
    color: var(--se-text-secondary);
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  button.text {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
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
  button.icon:hover,
  button.text:hover {
    background: var(--se-bg-hover);
  }
  button:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 2px 8px;
    text-align: right;
    border-bottom: 1px solid var(--se-border);
  }
  th {
    color: var(--se-text-secondary);
    font-weight: 500;
  }
  summary {
    cursor: pointer;
    color: var(--se-text-secondary);
  }
</style>
