<script lang="ts">
  // Spec 026 US3 (FR-008, FR-009): how the raster is drawn. One band with a color ramp, or three bands as a colour image
  // (a colour table raster draws its own classes); the range the colors run between, started from the file's 2nd and 98th
  // percentile and marked on a histogram; the curve; the colormap, picked from previews; how no data is shown; opacity.
  // Every edit is a pure function in core (withMode, withBand, withRangePreset, ...), so this only shows and calls them.
  import { DEFAULT_RELIEF, NEUTRAL_DISPLAY, RELIEF_METHODS, canOfferRelief, isNeutralDisplay, isReliefStored, type RasterRelief, type ReliefMethod, withBand, withChannel, withCommonRange, withMode, withRangePreset, type RasterDisplay, type RasterResampling, type RasterStretch, type RasterStyle } from '@spatial-explorer/core'
  import type { ViewerStore } from '../viewerStore.svelte.ts'
  import Segmented from '../kit/Segmented.svelte'
  import Select from '../kit/Select.svelte'
  import Slider from '../kit/Slider.svelte'
  import Switch from '../kit/Switch.svelte'
  import ColorBar from './ColorBar.svelte'
  import ColormapPicker from './ColormapPicker.svelte'
  import { colormapColors } from './engine.js'
  import RasterHistogram from './RasterHistogram.svelte'
  import ValueField from './ValueField.svelte'

  interface Props {
    store: ViewerStore
    /** The name the style is saved as (`dem.qml`). */
    sidecarName: string
  }
  let { store, sidecarName }: Props = $props()

  const facts = $derived(store.raster?.facts ?? null)
  const style = $derived(store.rasterStyle)
  const notice = $derived(store.styleNotice)

  const bandOptions = $derived((facts?.bands ?? []).map((b) => ({ value: String(b.index), label: `${b.index}: ${b.name}` })))
  const typeOptions = $derived([
    { value: 'single', label: 'One band', title: 'One band drawn with a color ramp' },
    ...((facts?.bands.length ?? 0) >= 3 ? [{ value: 'rgb', label: 'Colors', title: 'Three bands as red, green and blue' }] : []),
  ])
  const band = $derived(facts && style ? facts.bands[(style.bands[0] ?? 1) - 1] : undefined)
  // The ramp, sampled from the tiler (null until the engine is up).
  const ramp = $derived(style ? colormapColors(style.colormap, 32, style.reversed) : null)
  const barRange = $derived(style ?? { min: 0, max: 1 })
  const commonRange = $derived(style ? (style.mode === 'rgb' ? (style.rescale?.[0] ?? [style.min, style.max]) : [style.min, style.max]) : [0, 1])

  const edit = (next: RasterStyle): void => store.replaceRasterStyle(next)
  const patch = (p: Partial<RasterStyle>): void => store.setRasterStyle(p)
  const setRange = (lo: number, hi: number): void => {
    if (!style || !(lo < hi)) return
    edit(withCommonRange(style, lo, hi))
  }
  const STRETCHES: Array<{ value: string; label: string; title: string }> = [
    { value: 'linear', label: 'Linear', title: 'Values map straight onto the colors' },
    { value: 'sqrt', label: 'Square root', title: 'Lifts the low values' },
    { value: 'log', label: 'Log', title: 'Spreads values that span orders of magnitude' },
  ]
  const NODATA: Array<{ value: string; label: string; title: string }> = [
    { value: 'file', label: 'From file', title: 'Transparent where the file says there is no data' },
    { value: 'value', label: 'A value', title: 'Transparent where the cells have this value' },
    { value: 'none', label: 'None', title: 'Nothing is transparent: the no-data value is drawn like any other' },
  ]
  // Spec 027 US1: picture adjustments, applied by the graphics card (no tiles are read again).
  const display = $derived<RasterDisplay>(style?.display ?? NEUTRAL_DISPLAY)
  const RESAMPLING: Array<{ value: string; label: string; title: string }> = [
    { value: 'auto', label: 'Automatic', title: 'Sharp cells for classes, smooth for everything else' },
    { value: 'linear', label: 'Smooth', title: 'Blends between cells' },
    { value: 'nearest', label: 'Sharp', title: 'Shows each cell as a square' },
  ]
  const adjust = (p: Partial<RasterDisplay>): void => {
    const next = { ...display, ...p }
    // Neutral is stored as no display at all.
    patch({ display: isNeutralDisplay(next) ? undefined : next })
  }
  // Spec 027 US2: shaded relief from one band of heights.
  const relief = $derived<RasterRelief>(style?.relief ?? DEFAULT_RELIEF)
  const offer = $derived(facts && style ? canOfferRelief(facts, style) : { ok: false })
  const reliefMethods = RELIEF_METHODS.map((m) => ({ value: m.id, label: m.label }))
  const shade = (p: Partial<RasterRelief>): void => {
    const next = { ...relief, ...p }
    patch({ relief: isReliefStored(next) ? next : undefined })
  }
  const fileNodata = $derived(facts ? (facts.nodata === null ? 'none recorded' : facts.nodata === 'nan' ? 'NaN' : String(facts.nodata)) : '')
</script>

{#if !facts || !style}
  <p class="empty">Open a raster to style it.</p>
{:else}
  <div class="panel">
    <div class="body">
      {#if notice}
        <p class="notice {notice.kind}" role="status">{notice.text}</p>
      {/if}

      <div class="row">
        <span class="label" id="rs-opacity">Opacity</span>
        <span class="wide"><Slider value={Math.round(style.opacity * 100)} min={0} max={100} step={1} unit="%" label="Opacity" onChange={(v) => patch({ opacity: v / 100 })} /></span>
      </div>

      {#if facts.hasPalette && style.mode === 'paletted'}
        <section aria-labelledby="rs-classes">
          <h3 id="rs-classes">Classes</h3>
          <p class="hint">Drawn with the color table in the file.</p>
          <ColorBar classes={facts.palette ?? null} label={band?.name ?? 'Band 1'} />
        </section>
      {:else}
        {#if typeOptions.length > 1}
          <section aria-labelledby="rs-type">
            <h3 id="rs-type">Draw as</h3>
            <Segmented label="Draw as" options={typeOptions} value={style.mode} onChange={(v) => edit(withMode(style, facts, v === 'rgb' ? 'rgb' : 'single'))} />
          </section>
        {/if}

        <section aria-labelledby="rs-bands">
          <h3 id="rs-bands">{style.mode === 'rgb' ? 'Bands' : 'Band'}</h3>
          {#if style.mode === 'rgb'}
            {#each ['Red', 'Green', 'Blue'] as channel, i (channel)}
              <div class="row field">
                <span class="label">{channel}</span>
                <Select label="{channel} band" options={bandOptions} value={String(style.bands[i] ?? i + 1)} onChange={(v) => edit(withChannel(style, facts, i as 0 | 1 | 2, Number(v)))} />
              </div>
            {/each}
          {:else}
            <Select label="Band" options={bandOptions} value={String(style.bands[0] ?? 1)} onChange={(v) => edit(withBand(style, facts, Number(v)))} />
          {/if}
        </section>

        <section aria-labelledby="rs-range">
          <h3 id="rs-range">Range</h3>
          {#if style.mode === 'single'}
            <RasterHistogram counts={band?.histogram} dataMin={band?.min} dataMax={band?.max} lo={style.min} hi={style.max} label={band?.name ?? 'Band'} onChange={setRange} />
          {/if}
          <div class="row field">
            <span class="label">Low</span>
            <ValueField label="Low end of the range" value={commonRange[0]} onChange={(v) => setRange(v, commonRange[1])} />
          </div>
          <div class="row field">
            <span class="label">High</span>
            <ValueField label="High end of the range" value={commonRange[1]} onChange={(v) => setRange(commonRange[0], v)} />
          </div>
          <div class="presets">
            <button type="button" title="The 2nd to 98th percentile of the values: ignores the few extremes" onclick={() => edit(withRangePreset(style, facts, 'percentile'))}>2 to 98 percent</button>
            <button type="button" title="From the lowest to the highest value" onclick={() => edit(withRangePreset(style, facts, 'full'))}>Lowest to highest</button>
          </div>
          {#if style.mode === 'rgb'}<p class="hint">One range for all three bands. The presets give each band its own.</p>{/if}
          <p class="hint">The values come from a reduced level of the file, so they are estimates.</p>
        </section>

        <section aria-labelledby="rs-curve">
          <h3 id="rs-curve">Curve</h3>
          <Segmented label="Curve" options={STRETCHES} value={style.stretch} onChange={(v) => patch({ stretch: v as RasterStretch })} />
          <div class="row">
            <span class="label">Gamma</span>
            <span class="wide"><Slider value={style.gamma} min={0.2} max={3} step={0.05} label="Gamma" onChange={(v) => patch({ gamma: v })} /></span>
          </div>
        </section>

        {#if style.mode === 'single'}
          <section aria-labelledby="rs-colors">
            <h3 id="rs-colors">Colors</h3>
            <ColormapPicker label="Colormap" value={style.colormap} reversed={style.reversed} onChange={(name) => patch({ colormap: name })} colorsFor={(name, reversed) => colormapColors(name, 32, reversed)} />
            <div class="row switch">
              <span class="label" id="rs-reverse">Reverse</span>
              <Switch checked={style.reversed} labelledby="rs-reverse" onChange={(on) => patch({ reversed: on })} />
            </div>
            <ColorBar colors={ramp} min={barRange.min} max={barRange.max} label={band?.name ?? 'Band'} />
          </section>
        {/if}
      {/if}

      <section aria-labelledby="rs-nodata">
        <h3 id="rs-nodata">No data</h3>
        <Segmented label="No data" options={NODATA} value={style.nodata.mode} onChange={(v) => patch({ nodata: v === 'value' ? { mode: 'value', value: style.nodata.mode === 'value' ? style.nodata.value : typeof facts.nodata === 'number' ? facts.nodata : 0 } : { mode: v === 'none' ? 'none' : 'file' } })} />
        {#if style.nodata.mode === 'value'}
          <div class="row field">
            <span class="label">Value</span>
            <ValueField label="No data value" value={style.nodata.value} onChange={(v) => patch({ nodata: { mode: 'value', value: v } })} />
          </div>
        {:else if style.nodata.mode === 'file'}
          <p class="hint">The file says: {fileNodata}.</p>
        {/if}
      </section>

      <section aria-labelledby="rs-relief">
        <h3 id="rs-relief">Relief</h3>
        {#if !offer.ok}
          <p class="hint">{offer.reason}</p>
        {:else}
          <div class="row switch">
            <span class="label" id="rs-relief-on">Shaded relief</span>
            <Switch checked={relief.on} labelledby="rs-relief-on" onChange={(on) => shade({ on })} />
          </div>
          {#if relief.on}
            <div class="row field">
              <span class="label">Method</span>
              <Select label="Relief method" options={reliefMethods} value={relief.method} onChange={(v) => shade({ method: v as ReliefMethod })} />
            </div>
            {#if relief.method !== 'multidirectional'}
              <div class="row">
                <span class="label">Light from</span>
                <span class="wide"><Slider value={relief.direction} min={0} max={359} step={1} unit="°" label="Light direction" onChange={(v) => shade({ direction: v })} /></span>
              </div>
            {/if}
            <div class="row">
              <span class="label">Light height</span>
              <span class="wide"><Slider value={relief.altitude} min={0} max={90} step={1} unit="°" label="Light height" onChange={(v) => shade({ altitude: v })} /></span>
            </div>
            <div class="row">
              <span class="label">Strength</span>
              <span class="wide"><Slider value={relief.exaggeration} min={0} max={1} step={0.01} label="Relief strength" onChange={(v) => shade({ exaggeration: v })} /></span>
            </div>
            <div class="row colors">
              <span class="label">Colors</span>
              <span class="swatches">
                <label>Shadow <input type="color" value={relief.shadow} aria-label="Shadow color" onchange={(e) => shade({ shadow: e.currentTarget.value })} /></label>
                <label>Light <input type="color" value={relief.highlight} aria-label="Highlight color" onchange={(e) => shade({ highlight: e.currentTarget.value })} /></label>
                <label>Edge <input type="color" value={relief.accent} aria-label="Accent color" onchange={(e) => shade({ accent: e.currentTarget.value })} /></label>
              </span>
            </div>
            <div class="presets"><button type="button" onclick={() => patch({ relief: undefined })} title="Switch the relief off and put its settings back">Reset relief</button></div>
            <p class="hint">The values are taken as meters. Ground with no data is flat, so its edge shows as a step.</p>
          {/if}
        {/if}
      </section>

      <section aria-labelledby="rs-appearance">
        <h3 id="rs-appearance">Appearance</h3>
        <div class="row">
          <span class="label">Black level</span>
          <span class="wide"><Slider value={display.brightnessMin} min={0} max={1} step={0.01} label="Black level" onChange={(v) => adjust({ brightnessMin: Math.min(v, display.brightnessMax) })} /></span>
        </div>
        <div class="row">
          <span class="label">White level</span>
          <span class="wide"><Slider value={display.brightnessMax} min={0} max={1} step={0.01} label="White level" onChange={(v) => adjust({ brightnessMax: Math.max(v, display.brightnessMin) })} /></span>
        </div>
        <div class="row">
          <span class="label">Contrast</span>
          <span class="wide"><Slider value={display.contrast} min={-1} max={1} step={0.01} label="Contrast" onChange={(v) => adjust({ contrast: v })} /></span>
        </div>
        <div class="row">
          <span class="label">Saturation</span>
          <span class="wide"><Slider value={display.saturation} min={-1} max={1} step={0.01} label="Saturation" onChange={(v) => adjust({ saturation: v })} /></span>
        </div>
        <div class="row">
          <span class="label">Hue</span>
          <span class="wide"><Slider value={display.hue} min={0} max={360} step={1} unit="°" label="Hue" onChange={(v) => adjust({ hue: v })} /></span>
        </div>
        <Segmented label="Pixels" options={RESAMPLING} value={display.resampling} onChange={(v) => adjust({ resampling: v as RasterResampling })} />
        <div class="presets">
          <button type="button" disabled={isNeutralDisplay(style.display)} onclick={() => patch({ display: undefined })} title="Brightness, contrast, saturation, hue and pixels back to neutral">Reset appearance</button>
        </div>
        <p class="hint">These change how the picture looks on the map and the print page. The color bar and legend show the colors as set above.</p>
      </section>

      <section aria-labelledby="rs-file">
        <h3 id="rs-file">Style file</h3>
        <div class="presets">
          <button type="button" class="primary" onclick={() => void store.saveRasterStyle()} title="QGIS loads {sidecarName} automatically with the data">
            {store.canSaveSidecar ? `Save ${sidecarName}` : `Download ${sidecarName}`}
          </button>
          <button type="button" onclick={() => store.resetRasterStyle()} title="Back to the style the file starts with">Reset</button>
        </div>
        <p class="hint">{store.styleSource ? `From ${store.styleSource}${store.styleDirty ? ', modified' : ''}.` : store.styleDirty ? 'Modified, not saved to a file. It is remembered for this file in this viewer.' : 'The file’s default.'}</p>
      </section>
    </div>
  </div>
{/if}

<style>
  .empty {
    margin: 0;
    padding: 12px;
    color: var(--se-text-secondary);
  }
  .panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    container-type: inline-size;
  }
  .body {
    display: grid;
    align-content: start;
    gap: 8px;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 12px 16px;
  }
  section {
    display: grid;
    gap: 6px;
  }
  section + section {
    padding-top: 10px;
    border-top: 1px solid var(--se-border);
  }
  h3 {
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
  }
  .row {
    display: grid;
    grid-template-columns: 72px 1fr;
    align-items: center;
    gap: 8px;
  }
  .row.switch {
    grid-template-columns: 1fr auto;
  }
  .row .wide {
    min-width: 0;
  }
  .label {
    color: var(--se-text-secondary);
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.95em;
    line-height: 1.4;
  }
  .notice {
    margin: 0;
    padding: 6px 8px;
    border-radius: var(--se-radius-sm);
    border-left: 3px solid var(--se-border);
    background: var(--se-bg-hover);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .notice.warning {
    border-left-color: var(--se-warning);
  }
  .notice.error {
    border-left-color: var(--se-error);
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--se-text-secondary);
  }
  .swatches label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .swatches input[type="color"] {
    width: 28px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: transparent;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .presets button {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .presets button:hover {
    background: var(--se-button-secondary-hover);
  }
  .presets button.primary {
    border-color: transparent;
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  .presets button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
</style>
