<script lang="ts">
  // Spec 027 US3: the profile along a drawn line, in the bottom panel: the chart fills the panel (axes, gridlines, a marker
  // that follows the pointer or the arrow keys and is shown on the map), the figures beside it, and the same values as a
  // table. The panel is opaque and below the map, so the line stays in view.
  import { distanceAxis, extremeIndex, formatLength, niceTicks, profileCsv, profileSvg, summarizeProfile, valueText } from '@spatial-explorer/core'
  import { svgToPng } from './chartImage.js'
  import SaveMenu from './SaveMenu.svelte'
  import Icon from '../Icon.svelte'
  import Segmented from '../kit/Segmented.svelte'
  import type { ViewerStore } from '../viewerStore.svelte.ts'

  interface Props {
    store: ViewerStore
  }
  let { store }: Props = $props()

  const probe = $derived(store.profileProbe)
  const profile = $derived(probe?.profile ?? null)
  const units = $derived(store.drawUnits)

  let view = $state<'chart' | 'table'>('chart')
  let width = $state(600)
  let height = $state(200)
  const M = { l: 58, r: 14, t: 12, b: 28 }
  const BAND_COLORS = ['#d9382f', '#2f9e44', '#2563eb']

  const n = $derived(profile?.samples.points.length ?? 0)
  const total = $derived(profile?.samples.totalMeters ?? 0)
  const axis = $derived(distanceAxis(total, units === 'imperial'))
  const all = $derived(profile ? profile.bands.flatMap((b) => b.values).filter((v): v is number => v !== null) : [])
  const lo = $derived(all.length ? Math.min(...all) : 0)
  const hi = $derived(all.length ? Math.max(...all) : 1)
  // A little room above and below, so the line does not sit on the frame.
  const pad = $derived((hi > lo ? hi - lo : 1) * 0.06)
  const yMin = $derived(lo - pad)
  const yMax = $derived(hi + pad)
  const plotW = $derived(Math.max(10, width - M.l - M.r))
  const plotH = $derived(Math.max(10, height - M.t - M.b))
  const x = (meters: number): number => M.l + (total > 0 ? (meters / total) * plotW : 0)
  const xi = (i: number): number => x(profile?.samples.distances[i] ?? 0)
  const y = (v: number): number => M.t + (1 - (v - yMin) / (yMax - yMin)) * plotH
  const yTicks = $derived(niceTicks(yMin, yMax, Math.max(2, Math.floor(plotH / 40))))
  const xTicks = $derived(niceTicks(0, total / axis.perUnit, Math.max(2, Math.floor(plotW / 90))))
  /** An axis number: round, with at most two decimals and thousands separators. */
  const tickText = (v: number): string => Number(v.toFixed(2)).toLocaleString('en-US')
  const bandColor = (k: number): string => (profile && profile.bands.length === 3 ? BAND_COLORS[k] : 'var(--se-accent, #2563eb)')

  /** The line as separate runs: a gap ends one and starts the next. */
  function runs(values: ReadonlyArray<number | null>): Array<Array<[number, number]>> {
    const out: Array<Array<[number, number]>> = []
    let run: Array<[number, number]> = []
    values.forEach((v, i) => {
      if (v === null) {
        if (run.length) out.push(run)
        run = []
      } else run.push([xi(i), y(v)])
    })
    if (run.length) out.push(run)
    return out
  }
  const line = (r: Array<[number, number]>): string => r.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('')
  const fillOf = (r: Array<[number, number]>): string => `${line(r)}L${r[r.length - 1][0].toFixed(1)},${(M.t + plotH).toFixed(1)}L${r[0][0].toFixed(1)},${(M.t + plotH).toFixed(1)}Z`

  const summaries = $derived(profile ? profile.bands.map((b) => ({ band: b, s: summarizeProfile(b.values) })) : [])

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
  // Leaving the tab (or closing the answer) takes the marker off the map.
  $effect(() => () => store.setProbeMarker(null))

  function pointerMove(e: PointerEvent): void {
    if (!n) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const px = e.clientX - r.left - M.l
    at = Math.min(n - 1, Math.max(0, Math.round((px / plotW) * (n - 1))))
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

  /** The highest and lowest place, for the buttons and the table (one band only: with three, which one would it be?). */
  const extremes = $derived.by(() => {
    if (!profile || profile.bands.length !== 1) return null
    const values = profile.bands[0].values
    const max = extremeIndex(values, 'max')
    const min = extremeIndex(values, 'min')
    return max < 0 ? null : { max, min }
  })
  /** Chooses a place: it is marked on the chart, the table and the map. */
  function goTo(i: number): void {
    if (i >= 0 && i < n) at = i
  }
  // A place chosen from the chart, a key or a button is brought into view in the table.
  let tableWrap = $state<HTMLDivElement>()
  $effect(() => {
    const i = at
    if (view !== 'table' || i === null || !tableWrap) return
    tableWrap.querySelector<HTMLElement>(`[data-row="${i}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  const readout = $derived.by(() => {
    if (!profile || at === null) return ''
    const i = at
    const d = formatLength(profile.samples.distances[i], units)
    const vals = profile.bands.map((b) => `${profile.bands.length > 1 ? `${b.name} ` : ''}${valueText(b.values[i])}`).join(', ')
    return `${d}: ${vals}`
  })

  const SAVE_ITEMS = [
    { id: 'csv', label: 'Values (CSV)', hint: 'Distance, longitude, latitude and the value of each band' },
    { id: 'svg', label: 'Chart (SVG)', hint: 'The chart as an editable vector picture, on white' },
    { id: 'png', label: 'Chart (PNG)', hint: 'The chart as a picture, on white' },
  ]
  async function save(id: string): Promise<void> {
    if (!profile) return
    const base = (store.openFileName ?? 'raster').replace(/\.[^.]+$/, '')
    if (id === 'csv') return store.saveRasterExport(`${base}-profile.csv`, profileCsv(profile.samples, profile.bands))
    const chart = profileSvg(profile.samples, profile.bands, { title: `Profile: ${store.openFileName ?? 'raster'}`, imperial: units === 'imperial' })
    if (id === 'svg') return store.saveRasterExport(`${base}-profile.svg`, chart.svg)
    await store.saveRasterExport(`${base}-profile.png`, await svgToPng(chart.svg, chart.width, chart.height))
  }
</script>

<section class="view" aria-label="Profile along the line">
  {#if !probe}
    <p class="empty">Choose <b>Profile</b> on the map and draw a line over the raster (click each point, then Enter) to read its values along it.</p>
  {:else}
    <header>
      <Icon name="profile" size={14} />
      <h2>Profile</h2>
      {#if probe.status === 'running'}<span class="muted" role="status">Reading the raster…</span>{/if}
      <span class="spacer"></span>
      {#if profile}
        <Segmented
          label="Show the profile as"
          options={[
            { value: 'chart', label: 'Chart', title: 'The values against distance' },
            { value: 'table', label: 'Table', title: 'The same values, place by place' },
          ]}
          value={view}
          onChange={(v) => (view = v === 'table' ? 'table' : 'chart')}
        />
        <SaveMenu items={SAVE_ITEMS} onPick={save} />
      {/if}
      <button type="button" class="icon" aria-label="Close the profile" title="Close (the line comes off the map)" onclick={() => store.clearRasterProbe('profile')}><Icon name="close" size={14} /></button>
    </header>

    {#if probe.status === 'error'}
      <p class="error" role="alert">{probe.message}</p>
    {:else if profile}
      <div class="main">
        <div class="stage">
          {#if view === 'chart'}
            <div
              class="chart"
              role="slider"
              tabindex="0"
              aria-label="Position along the profile (arrow keys move it; the place is marked on the map)"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, n - 1)}
              aria-valuenow={at ?? 0}
              aria-valuetext={readout || 'No place chosen'}
              bind:clientWidth={width}
              bind:clientHeight={height}
              onpointermove={pointerMove}
              onkeydown={keyMove}
            >
              <svg {width} {height} aria-hidden="true">
                {#each yTicks as t (t)}
                  <line class="grid" x1={M.l} x2={M.l + plotW} y1={y(t)} y2={y(t)} />
                  <text class="tick" x={M.l - 6} y={y(t) + 3.5} text-anchor="end">{tickText(t)}</text>
                {/each}
                {#each xTicks as t (t)}
                  <line class="grid v" x1={x(t * axis.perUnit)} x2={x(t * axis.perUnit)} y1={M.t} y2={M.t + plotH} />
                  <text class="tick" x={x(t * axis.perUnit)} y={M.t + plotH + 16} text-anchor="middle">{tickText(t)}</text>
                {/each}
                <text class="tick unit" x={M.l + plotW} y={height - 2} text-anchor="end">{axis.unit}</text>
                <rect class="frame" x={M.l} y={M.t} width={plotW} height={plotH} fill="none" />
                {#each profile.bands as b, k (b.band)}
                  {#each runs(b.values) as r, i (i)}
                    {#if profile.bands.length === 1 && r.length > 1}<path d={fillOf(r)} class="area" fill={bandColor(k)} />{/if}
                    {#if r.length === 1}
                      <circle cx={r[0][0]} cy={r[0][1]} r="2.5" fill={bandColor(k)} />
                    {:else}
                      <path d={line(r)} fill="none" stroke={bandColor(k)} stroke-width="2" stroke-linejoin="round" />
                    {/if}
                  {/each}
                {/each}
                {#if at !== null}
                  <line class="cursor" x1={xi(at)} x2={xi(at)} y1={M.t} y2={M.t + plotH} />
                  {#each profile.bands as b, k (b.band)}
                    {#if b.values[at] !== null}<circle cx={xi(at)} cy={y(b.values[at] as number)} r="4" fill={bandColor(k)} stroke="var(--se-bg-base)" stroke-width="1.5" />{/if}
                  {/each}
                {/if}
              </svg>
            </div>
          {:else}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <div class="table-wrap" role="region" aria-label="Profile values, scrollable" tabindex="0" bind:this={tableWrap}>
              <table aria-label="Profile values">
                <thead>
                  <tr><th scope="col" class="id"><span class="sr">Place</span></th><th scope="col" class="num">Distance</th><th scope="col" class="num">Longitude</th><th scope="col" class="num">Latitude</th>{#each profile.bands as b (b.band)}<th scope="col" class="num">{b.name}</th>{/each}<th scope="col" class="filler" aria-hidden="true"></th></tr>
                </thead>
                <tbody>
                  {#each profile.samples.points as p, i (i)}
                    <tr data-row={i} class:selected={at === i} onclick={() => goTo(i)}>
                      <td class="id"><button type="button" class="place" aria-label="Mark place {i + 1} on the map" aria-pressed={at === i} onclick={(e) => { e.stopPropagation(); goTo(i) }}>{i + 1}</button></td>
                      <td class="num v-decimal">{formatLength(profile.samples.distances[i], units)}</td>
                      <td class="num v-decimal">{p[0].toFixed(5)}</td>
                      <td class="num v-decimal">{p[1].toFixed(5)}</td>
                      {#each profile.bands as b (b.band)}{#if b.values[i] === null}<td class="num null">no data</td>{:else}<td class="num v-decimal">{valueText(b.values[i])}</td>{/if}{/each}
                      <td class="filler">{#if extremes && i === extremes.max}<span class="tag">highest</span>{:else if extremes && i === extremes.min}<span class="tag">lowest</span>{/if}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <aside aria-label="Figures" tabindex="0">
          <dl>
            <dt>Length</dt>
            <dd>{formatLength(total, units)}</dd>
            {#each summaries as { band, s } (band.band)}
              {#if summaries.length > 1}<dt class="band">{band.name}</dt><dd></dd>{/if}
              {#if s.valid}
                <dt>Minimum</dt><dd>{valueText(s.min)}</dd>
                <dt>Maximum</dt><dd>{valueText(s.max)}</dd>
                <dt>Mean</dt><dd>{valueText(s.mean)}</dd>
                {#if summaries.length === 1}
                  <dt title="The sum of the climbs along the line">Rise</dt><dd>{valueText(s.rise)}</dd>
                  <dt title="The sum of the descents along the line">Fall</dt><dd>{valueText(s.fall)}</dd>
                {/if}
              {:else}
                <dt>Values</dt><dd>none on this line</dd>
              {/if}
              {#if s.gaps}<dt>No data</dt><dd>{s.gaps} of {s.total} places</dd>{/if}
            {/each}
          </dl>
          {#if extremes}
            <div class="goto">
              <button type="button" onclick={() => goTo(extremes.max)} title="Mark the highest place on the chart, the table and the map">Go to highest</button>
              <button type="button" onclick={() => goTo(extremes.min)} title="Mark the lowest place on the chart, the table and the map">Go to lowest</button>
            </div>
          {/if}
          {#if profile.samples.coarse}<p class="muted">The line is long: places are further apart than cells.</p>{/if}
          {#if view === 'chart'}
            <p class="readout" role="status" aria-live="polite">{readout || 'Move along the chart, or use the arrow keys, to read a place. It is marked on the map.'}</p>
          {/if}
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
  }
  .chart {
    flex: 1;
    min-width: 0;
    min-height: 120px;
    position: relative;
    border-radius: var(--se-radius-sm);
    overflow: hidden;
    cursor: crosshair;
  }
  .chart:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  svg {
    display: block;
    position: absolute;
    inset: 0;
  }
  .grid {
    stroke: var(--se-border);
    stroke-width: 1;
    opacity: 0.6;
  }
  .frame {
    stroke: var(--se-border);
    stroke-width: 1;
  }
  .area {
    opacity: 0.14;
  }
  .cursor {
    stroke: var(--se-text-secondary);
    stroke-width: 1;
    stroke-dasharray: 3 3;
  }
  .tick {
    fill: var(--se-text-secondary);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  aside {
    flex: none;
    width: 210px;
    overflow: auto;
    display: grid;
    align-content: start;
    gap: 8px;
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
    font-variant-numeric: tabular-nums;
  }
  dt.band {
    grid-column: 1 / -1;
    margin-top: 4px;
    color: var(--se-text-primary);
    font-weight: 600;
  }
  dt.band + dd {
    display: none;
  }
  .readout {
    margin: 0;
    padding: 6px 8px;
    border-radius: var(--se-radius-sm);
    background: var(--se-bg-hover);
    line-height: 1.4;
  }
  .table-wrap {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: var(--se-table-bg, var(--se-bg-base));
    border: 1px solid var(--se-border);
    border-radius: var(--se-radius-sm);
  }
  .table-wrap:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    height: 24px;
    padding: 0 8px;
    background: var(--se-table-header-bg);
    color: var(--se-table-header-fg);
    border-bottom: var(--se-table-header-border);
    font: var(--se-table-header-font);
    text-transform: var(--se-table-header-transform);
    letter-spacing: var(--se-table-header-tracking);
    white-space: nowrap;
  }
  th.num,
  td.num {
    text-align: right;
  }
  th.id,
  td.id {
    width: 44px;
    text-align: right;
  }
  th.filler,
  td.filler {
    width: 100%;
    padding: 0;
  }
  td {
    height: 24px;
    padding: 0 8px;
    white-space: nowrap;
    border-bottom: 1px solid var(--se-table-row-border);
    font-family: var(--se-font-data);
    font-variant-numeric: tabular-nums;
  }
  td.id {
    color: var(--se-text-muted);
    font-family: var(--se-font-mono);
    font-size: 0.92em;
  }
  td.v-decimal {
    color: var(--se-type-decimal);
  }
  td.null {
    color: var(--se-text-muted);
    font-family: var(--se-font-mono);
    font-size: 0.85em;
  }
  tbody tr {
    cursor: pointer;
  }
  tbody tr:hover {
    background: var(--se-bg-hover);
  }
  tbody tr.selected {
    background: var(--se-selected-inactive-bg);
    color: var(--se-selected-inactive-fg);
    box-shadow: inset 2px 0 0 var(--se-selected-indicator);
  }
  button.place {
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: right;
    cursor: pointer;
  }
  button.place:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 2px;
  }
  .tag {
    padding-left: 12px;
    color: var(--se-text-secondary);
    font-family: var(--se-font-ui);
    font-size: 0.9em;
  }
  .goto {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .goto button {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .goto button:hover {
    background: var(--se-button-secondary-hover, var(--se-bg-hover));
  }
  .goto button:focus-visible {
    outline: 1px solid var(--se-focus);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
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
