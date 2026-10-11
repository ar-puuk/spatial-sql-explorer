<script lang="ts">
  // Layer style popover (design-plan.md §8.1/§8.5; spec 003
  // contracts/ui-style-panel.md; spec 008 US1, contracts/ui.md "Style panel").
  // One flow, top to bottom: style type, then the column to color by, then
  // classes (with the value distribution), colors, and appearance. Edits
  // apply live, with no Apply step. Save is one split button: QML (the
  // QGIS-convention sidecar, saved next to the data or downloaded), or any
  // format from its menu. Import reads any of the three formats.
  import {
    eligibleColumns,
    extrusionUnavailableReason,
    DEFAULT_EXTRUSION_SCALE,
    type Extrusion,
    METHOD_NAMES,
    MIN_CLASS_COUNT,
    MAX_CLASS_COUNT,
    type GraduatedMethod,
    rendererOf,
    startStyle,
    addClass,
    deleteClass,
    setCategorizedAuto,
    setCategoryValue,
    setClassBound,
    setClassColor,
    setClassCount,
    setClassLabel,
    setClassVisible,
    setMethod,
    setRamp,
    validateStyle,
    previewExportNotice,
    type GeometryType,
    type LayerStyle,
    type Renderer,
    type ResolveInput,
    type ResolvedStyle,
    type StyleFormat,
    type ValueHistogram as Histogram,
  } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import RampPicker from './RampPicker.svelte'
  import ClassList from './ClassList.svelte'
  import LoadWholeNotice from './LoadWholeNotice.svelte'
  import ValueHistogram from './style/ValueHistogram.svelte'
  import SaveStyleButton from './style/SaveStyleButton.svelte'
  import type { StyleNotice } from './viewerStore.svelte.js'

  interface Props {
    style: LayerStyle
    resolved: ResolvedStyle
    /** The displayed result (unproxied): columns for the pickers, rows for defaults. */
    layer: ResolveInput | null
    geometryType: GeometryType
    sidecarName: string
    styleSource: string | null
    styleDirty: boolean
    canSaveSidecar: boolean
    notice: StyleNotice | null
    onChange: (patch: Partial<LayerStyle>) => void
    /** FR-004: a style shown while browsing ramps, or null to restore the committed one. */
    onPreview?: (next: LayerStyle | null) => void
    /** FR-003: the graduated column's value distribution (null while loading). */
    histogram?: Histogram | null
    onSave: () => void
    onExport: (format: StyleFormat) => void
    onImport: () => void
    onReset: () => void
    onDismissNotice: () => void
    onClose: () => void
    /** Spec 007 T044: a FlatGeobuf read in parts; thematic styles need the whole file. */
    needsLoad?: { sizeLabel: string } | null
    onLoad?: () => void
    /** Spec 007: rows being classified by the engine (shown after 300 ms), or null. */
    classifyingRows?: number | null
    /** Spec 008 US6: polygons drawn flat by the extrusion (missing, zero or negative height), or null. */
    extrusionFlat?: number | null
  }
  let {
    style,
    resolved,
    layer,
    geometryType,
    sidecarName,
    styleSource,
    styleDirty,
    canSaveSidecar,
    notice,
    onChange,
    onPreview = () => {},
    histogram = null,
    onSave,
    onExport,
    onImport,
    onReset,
    onDismissNotice,
    onClose,
    needsLoad = null,
    onLoad = () => {},
    classifyingRows = null,
    extrusionFlat = null,
  }: Props = $props()

  // --- Spec 008 US6: 3D extrusion ---------------------------------------
  const CONSTANT = '__constant'
  const extrusionReason = $derived(extrusionUnavailableReason(geometryType))
  const ext = $derived(style.extrusion)
  const heightColumns = $derived(eligibleColumns(layer?.columns, 'graduated'))
  /** A first guess at the height column: a name that says height, else the first numeric column. */
  function defaultHeightSource(): Extrusion['source'] {
    const cols = heightColumns
    const named = cols.find((c) => /height|elev|floor|storey|stories|levels|hgt/i.test(c.name))
    const col = named ?? cols[0]
    return col ? { kind: 'column', column: col.name } : { kind: 'constant', meters: 10 }
  }
  function setExtrusion(patch: Partial<Extrusion>): void {
    const base: Extrusion = ext ?? { enabled: false, source: defaultHeightSource(), scale: DEFAULT_EXTRUSION_SCALE }
    onChange({ extrusion: { ...base, ...patch } })
  }
  function chooseHeight(value: string): void {
    setExtrusion({ source: value === CONSTANT ? { kind: 'constant', meters: ext?.source.kind === 'constant' ? ext.source.meters : 10 } : { kind: 'column', column: value } })
  }

  const RENDERERS: Array<{ kind: Renderer['kind']; label: string; hint: string }> = [
    { kind: 'single', label: 'Single', hint: 'One color for every feature' },
    { kind: 'categorized', label: 'Categorized', hint: 'A color per value of a column' },
    { kind: 'graduated', label: 'Graduated', hint: 'Colors by ranges of a numeric column' },
  ]
  const renderer = $derived(rendererOf(style))
  const thematic = $derived(renderer.kind !== 'single')
  const columnsFor = (kind: 'categorized' | 'graduated') => eligibleColumns(layer?.columns, kind)
  /** Why a renderer can't be chosen, or null. */
  function unavailable(kind: Renderer['kind']): string | null {
    if (kind === 'single') return null
    if (needsLoad) return 'Load the whole file to style by its values.'
    if (columnsFor(kind).length) return null
    return kind === 'graduated' ? 'Graduated styling needs a numeric column.' : 'This result has no attribute columns.'
  }

  function chooseRenderer(kind: Renderer['kind']): void {
    if (kind === renderer.kind || unavailable(kind)) return
    onChange(startStyle(style, kind, layer))
  }

  /** Radio group keys: arrows move and apply, skipping unavailable entries (WAI-ARIA radio group). */
  function radioKeydown(e: KeyboardEvent): void {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const enabled = RENDERERS.filter((r) => !unavailable(r.kind))
    const i = enabled.findIndex((r) => r.kind === renderer.kind)
    const next = enabled[(i + dir + enabled.length) % enabled.length]
    chooseRenderer(next.kind)
    const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]')
    queueMicrotask(() => group?.querySelector<HTMLElement>(`[data-kind="${next.kind}"]`)?.focus())
  }

  const METHODS: GraduatedMethod[] = ['equal', 'quantile', 'jenks']
  const CLASS_COUNTS = Array.from({ length: MAX_CLASS_COUNT - MIN_CLASS_COUNT + 1 }, (_, i) => MIN_CLASS_COUNT + i)

  function chooseMethod(method: GraduatedMethod): void {
    if (renderer.kind !== 'graduated' || method === renderer.method || method === 'manual') return
    apply(setMethod(style, method))
  }

  function chooseClassCount(classCount: number): void {
    apply(setClassCount(style, classCount))
  }

  /** The last rejected edit (FR-009 validation), shown under the class list. */
  let editError = $state<string | null>(null)

  /** Applies an edited style unless it breaks a rule (e.g. overlapping manual ranges). */
  function apply(next: LayerStyle): void {
    const errors = validateStyle(next)
    if (errors.length) {
      editError = errors[0]
      return
    }
    editError = null
    onChange(next)
  }

  function chooseColumn(column: string): void {
    if (renderer.kind === 'single') return
    onChange({ renderer: startStyle(style, renderer.kind, layer, column).renderer })
  }

  let hasFill = $derived(geometryType !== 'LineString')
  let hasPoints = $derived(geometryType === 'Point' || geometryType === 'Mixed')
  let strokeLabel = $derived(geometryType === 'LineString' ? 'Line' : 'Outline')

  const pct = (n: number): string => `${Math.round(n * 100)}%`
  const numberFormat = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 })
  const fmt = (v: number): string => numberFormat.format(v)
  /** The class breaks (each range's upper bound but the last), with its class color. */
  const histogramBreaks = $derived(
    resolved.classes
      .filter((c) => c.kind === 'range')
      .slice(0, -1)
      .map((c) => ({ value: c.upper ?? 0, color: c.color }))
  )

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      onClose()
      e.stopPropagation()
    }
  }
</script>

<div class="panel" aria-label="Layer style" role="dialog" tabindex="-1" onkeydown={handleKeydown}>
  <header>
    <h2>Layer style</h2>
    <span class="source" title={styleSource ?? undefined}>
      {styleSource ?? 'Default'}{styleDirty ? ' · modified' : ''}
    </span>
    <button type="button" class="icon-button" aria-label="Close" title="Close" onclick={onClose}><Icon name="close" /></button>
  </header>

  <div class="body">
    <!-- Spec 008 FR-001: one flow, top to bottom; only the sections that apply to the chosen type. -->
    <!-- The whole layer's opacity, on top of the fill and outline opacities (QGIS's layer opacity). -->
    <div class="row">
      <span class="label" id="layer-opacity-label">Opacity</span>
      <input
        type="range"
        class="wide"
        aria-label="Layer opacity"
        aria-valuetext={pct(style.layerOpacity ?? 1)}
        min="0"
        max="1"
        step="0.05"
        value={style.layerOpacity ?? 1}
        oninput={(e) => onChange({ layerOpacity: Number(e.currentTarget.value) })}
      />
      <span class="value">{pct(style.layerOpacity ?? 1)}</span>
    </div>

    <section aria-labelledby="style-sec-type">
      <h3 id="style-sec-type">Style</h3>
      <div class="renderers" role="radiogroup" aria-label="Style type">
        {#each RENDERERS as r (r.kind)}
          {@const why = unavailable(r.kind)}
          <button
            type="button"
            role="radio"
            data-kind={r.kind}
            aria-checked={renderer.kind === r.kind}
            tabindex={renderer.kind === r.kind ? 0 : -1}
            aria-disabled={why !== null}
            title={why ?? r.hint}
            onclick={() => chooseRenderer(r.kind)}
            onkeydown={radioKeydown}>{r.label}</button
          >
        {/each}
      </div>
      {#if classifyingRows !== null}
        <p class="classifying" role="status">Classifying {classifyingRows.toLocaleString('en-US')} rows…</p>
      {/if}
      {#if needsLoad}
        <LoadWholeNotice sizeLabel={needsLoad.sizeLabel} purpose="style by its values" {onLoad} />
      {/if}
    </section>

    {#if renderer.kind !== 'single'}
      <section aria-labelledby="style-sec-by">
        <h3 id="style-sec-by">Color by</h3>
        <div class="row field">
          <label class="label" for="style-column">Column</label>
          <select id="style-column" value={renderer.column} onchange={(e) => chooseColumn(e.currentTarget.value)}>
            {#if !columnsFor(renderer.kind).some((c) => c.name === renderer.column)}
              <option value={renderer.column}>{renderer.column || 'Choose…'}</option>
            {/if}
            {#each columnsFor(renderer.kind) as c (c.name)}
              <option value={c.name}>{c.name} · {c.type}</option>
            {/each}
          </select>
        </div>
      </section>

      {#if renderer.kind === 'graduated'}
        <section aria-labelledby="style-sec-classes">
          <h3 id="style-sec-classes">Classification</h3>
          <div class="pair">
            <div class="row field">
              <label class="label" for="style-method">Method</label>
              <select id="style-method" value={renderer.method} onchange={(e) => chooseMethod(e.currentTarget.value as GraduatedMethod)}>
                {#each METHODS as m (m)}
                  <option value={m}>{m === 'jenks' ? 'Natural breaks (Jenks)' : METHOD_NAMES[m]}</option>
                {/each}
                {#if renderer.method === 'manual'}
                  <option value="manual">Manual</option>
                {/if}
              </select>
            </div>
            <div class="row field">
              <label class="label" for="style-classes">Classes</label>
              <select id="style-classes" class="narrow" value={renderer.classCount} onchange={(e) => chooseClassCount(Number(e.currentTarget.value))}>
                {#each CLASS_COUNTS as n (n)}
                  <option value={n}>{n}</option>
                {/each}
              </select>
            </div>
          </div>
          {#if resolved.status !== 'fallback'}
            <ValueHistogram {histogram} breaks={histogramBreaks} format={fmt} />
          {/if}
        </section>
      {/if}

      <section aria-labelledby="style-sec-colors">
        <h3 id="style-sec-colors">Colors</h3>
        {#if resolved.status === 'fallback'}
          <p class="inline-note warning" role="status"><Icon name="warning" size={14} />{resolved.reason} Showing the single symbol.</p>
        {:else}
          <RampPicker
            value={renderer.ramp}
            renderer={renderer.kind}
            classCount={resolved.classes.filter((c) => c.kind === 'value' || c.kind === 'range').length}
            onChange={(ramp) => apply(setRamp(style, ramp))}
            onPreview={(ramp) => onPreview(ramp ? setRamp(style, ramp) : null)}
          />
          <ClassList
            {resolved}
            kind={renderer.kind}
            manual={renderer.kind === 'graduated' ? renderer.method === 'manual' : renderer.manual}
            onColor={(key, color) => apply(setClassColor(style, key, color))}
            onLabel={(key, label) => apply(setClassLabel(style, key, label))}
            onVisible={(key, visible) => apply(setClassVisible(style, key, visible))}
            onValue={(key, value) => apply(setCategoryValue(style, resolved, key, value))}
            onBound={(index, side, value) => apply(setClassBound(style, resolved, index, side, value))}
            onAdd={() => apply(addClass(style, resolved))}
            onDelete={(key) => apply(deleteClass(style, resolved, key))}
          />
          {#if editError}
            <p class="inline-note warning" role="alert"><Icon name="warning" size={14} />{editError}</p>
          {/if}
          {#if renderer.kind === 'categorized' && renderer.manual}
            <p class="inline-note">
              <Icon name="info" size={14} /><span>Fixed classes (Manual). <button type="button" class="link" onclick={() => apply(setCategorizedAuto(style))}>Back to automatic</button></span>
            </p>
          {:else if renderer.kind === 'graduated' && renderer.method === 'manual'}
            <p class="inline-note"><Icon name="info" size={14} />Fixed classes (Manual): choose a method to recompute them.</p>
          {/if}
          {#each resolved.notes as note (note)}
            <p class="inline-note" role="status"><Icon name="info" size={14} />{note}</p>
          {/each}
        {/if}
      </section>
    {/if}

    <section aria-labelledby="style-sec-look">
      <h3 id="style-sec-look">Appearance</h3>
      {#if hasFill}
        <div class="row">
          <span class="label" id="fill-label">Fill</span>
          {#if thematic}
            <span class="by-class" title="Class colors come from the classes above">·</span>
          {:else}
            <input type="color" aria-labelledby="fill-label" value={style.fillColor} oninput={(e) => onChange({ fillColor: e.currentTarget.value })} />
          {/if}
          <input
            type="range"
            aria-label="Fill opacity"
            aria-valuetext={pct(style.fillOpacity)}
            min="0"
            max="1"
            step="0.05"
            value={style.fillOpacity}
            oninput={(e) => onChange({ fillOpacity: Number(e.currentTarget.value) })}
          />
          <span class="value">{pct(style.fillOpacity)}</span>
        </div>
      {/if}

      <div class="row">
        <span class="label" id="stroke-label">{strokeLabel}</span>
        <input type="color" aria-labelledby="stroke-label" value={style.strokeColor} oninput={(e) => onChange({ strokeColor: e.currentTarget.value })} />
        <input
          type="range"
          aria-label="{strokeLabel} opacity"
          aria-valuetext={pct(style.strokeOpacity)}
          min="0"
          max="1"
          step="0.05"
          value={style.strokeOpacity}
          oninput={(e) => onChange({ strokeOpacity: Number(e.currentTarget.value) })}
        />
        <span class="value">{pct(style.strokeOpacity)}</span>
      </div>

      <div class="row">
        <span class="label" id="width-label">Width</span>
        <input
          type="range"
          class="wide"
          aria-labelledby="width-label"
          aria-valuetext="{style.strokeWidth} pixels"
          min="0"
          max="10"
          step="0.5"
          value={style.strokeWidth}
          oninput={(e) => onChange({ strokeWidth: Number(e.currentTarget.value) })}
        />
        <span class="value">{style.strokeWidth} px</span>
      </div>

      {#if hasPoints}
        <div class="row">
          <span class="label" id="radius-label">Point size</span>
          <input
            type="range"
            class="wide"
            aria-labelledby="radius-label"
            aria-valuetext="{style.pointRadius} pixels"
            min="1"
            max="20"
            step="0.5"
            value={style.pointRadius}
            oninput={(e) => onChange({ pointRadius: Number(e.currentTarget.value) })}
          />
          <span class="value">{style.pointRadius} px</span>
        </div>
      {/if}
    </section>

    <!-- Spec 008 US6 (FR-025): polygons raised by a column or a constant height. -->
    <section aria-labelledby="style-sec-3d">
      <h3 id="style-sec-3d">3D</h3>
      {#if extrusionReason}
        <p class="inline-note" role="status"><Icon name="info" size={14} />{extrusionReason}</p>
      {:else}
        <div class="row field">
          <span class="label" id="extrude-label">Extrude</span>
          <button
            type="button"
            role="switch"
            class="switch"
            aria-label="Extrude polygons"
            aria-checked={ext?.enabled === true}
            onclick={() => setExtrusion({ enabled: !ext?.enabled })}
          >
            <span class="track" aria-hidden="true"><span class="thumb"></span></span>
            <span>{ext?.enabled ? 'On' : 'Off'}</span>
          </button>
        </div>
        {#if ext?.enabled}
          <div class="row field">
            <label class="label" for="extrude-height">Height</label>
            <select id="extrude-height" aria-label="Height from" value={ext.source.kind === 'column' ? ext.source.column : CONSTANT} onchange={(e) => chooseHeight(e.currentTarget.value)}>
              {#if ext.source.kind === 'column' && !heightColumns.some((c) => ext.source.kind === 'column' && c.name === ext.source.column)}
                <option value={ext.source.column}>{ext.source.column}</option>
              {/if}
              {#each heightColumns as c (c.name)}
                <option value={c.name}>{c.name} · {c.type}</option>
              {/each}
              <option value={CONSTANT}>Constant height</option>
            </select>
          </div>
          {#if ext.source.kind === 'constant'}
            <div class="row field">
              <label class="label" for="extrude-meters">Meters</label>
              <input
                id="extrude-meters"
                class="number"
                type="number"
                aria-label="Constant height"
                min="0"
                step="any"
                value={ext.source.meters}
                onchange={(e) => {
                  const v = Number(e.currentTarget.value)
                  if (Number.isFinite(v) && v >= 0) setExtrusion({ source: { kind: 'constant', meters: v } })
                }}
              />
            </div>
          {/if}
          <div class="row field">
            <label class="label" for="extrude-scale">Scale</label>
            <input
              id="extrude-scale"
              class="number"
              type="number"
              aria-label="Height scale"
              aria-describedby="extrude-scale-hint"
              min="0"
              step="any"
              value={ext.scale}
              onchange={(e) => {
                const v = Number(e.currentTarget.value)
                if (Number.isFinite(v) && v > 0) setExtrusion({ scale: v })
              }}
            />
          </div>
          <p class="hint" id="extrude-scale-hint">Height in meters = {ext.source.kind === 'column' ? `${ext.source.column} × ${ext.scale}` : `${ext.source.meters} × ${ext.scale}`}. Right-drag or Shift+arrows to tilt and rotate.</p>
          {#if extrusionFlat}
            <p class="inline-note" role="status"><Icon name="info" size={14} />{extrusionFlat.toLocaleString('en-US')} {extrusionFlat === 1 ? 'polygon' : 'polygons'} drawn flat (no height, zero or negative).</p>
          {/if}
        {/if}
      {/if}
    </section>
  </div>

  {#if notice}
    <div class="notice {notice.kind}" role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={notice.kind === 'info' ? 'info' : notice.kind} size={14} />
      <span>{notice.text}</span>
      <button type="button" class="icon-button" aria-label="Dismiss" onclick={onDismissNotice}><Icon name="close" size={14} /></button>
    </div>
  {/if}

  <footer>
    <SaveStyleButton {canSaveSidecar} {sidecarName} losses={(f) => previewExportNotice(style, f, resolved).items} {onSave} onSaveAs={onExport} />
    <!-- Spec 008 (user request): loading a style is as visible as saving one (QGIS: Load Style…). -->
    <button type="button" class="secondary" aria-label="Load style…" title="Load a style: QGIS .qml, OGC .sld or Mapbox GL style .json" onclick={onImport}><Icon name="import" size={14} />Load…</button>
    <span class="spacer"></span>
    <button type="button" class="icon-button" aria-label="Reset style" title="Reset to the default style" onclick={onReset}><Icon name="reset" /></button>
  </footer>
</div>

<style>
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
  .pair {
    display: grid;
    gap: 6px;
  }
  .classifying {
    margin: 0;
    color: var(--se-text-secondary);
  }
  .panel {
    display: flex;
    flex-direction: column;
    max-height: 100%;
    width: 320px;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    outline: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--se-border);
  }
  h2 {
    margin: 0;
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
    white-space: nowrap;
  }
  .source {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .body {
    display: grid;
    align-content: start;
    gap: 8px;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
  }
  .renderers {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    overflow: hidden;
  }
  .renderers button {
    height: 24px;
    padding: 0 6px;
    border: 0;
    border-left: 1px solid var(--se-input-border);
    background: var(--se-input-bg);
    color: var(--se-text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .renderers button:first-child {
    border-left: 0;
  }
  .renderers button[aria-checked='true'] {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    /* High contrast has no filled button: the active contrast border marks the choice. */
    box-shadow: inset 0 0 0 1px var(--se-selected-indicator);
  }
  .renderers button[aria-disabled='true'] {
    opacity: 0.5;
    cursor: default;
  }
  .renderers button:focus-visible,
  select:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .row.field {
    grid-template-columns: 72px 1fr;
  }
  input.number {
    justify-self: start;
    width: 96px;
    height: 24px;
    box-sizing: border-box;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  input.number:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  .switch {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: 8px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .switch .track {
    position: relative;
    width: 28px;
    height: 16px;
    box-sizing: border-box;
    border-radius: 8px;
    background: var(--se-input-bg);
    border: 1px solid var(--se-input-border);
  }
  .switch .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--se-text-secondary);
    transition: left 0.12s;
  }
  .switch[aria-checked='true'] .track {
    background: var(--se-button-bg);
    border-color: var(--se-button-bg);
  }
  .switch[aria-checked='true'] .thumb {
    left: 14px;
    background: var(--se-button-fg);
  }
  .switch:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .switch .thumb {
      transition: none;
    }
  }
  select.narrow {
    justify-self: start;
    width: 64px;
  }
  select {
    min-width: 0;
    height: 24px;
    padding: 0 4px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font: inherit;
  }
  .link {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-link, var(--se-accent));
    font: inherit;
    cursor: pointer;
  }
  .inline-note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
    line-height: 1.4;
  }
  .inline-note.warning :global(.icon) {
    color: var(--se-warning);
  }
  .by-class {
    text-align: center;
    color: var(--se-text-muted);
  }
  .row {
    display: grid;
    grid-template-columns: 72px 28px 1fr 44px;
    align-items: center;
    gap: 8px;
  }
  .row .wide {
    grid-column: 2 / 4;
  }
  .label {
    color: var(--se-text-secondary);
  }
  .value {
    text-align: right;
    font-family: var(--se-font-mono);
    font-size: 0.9em;
    font-variant-numeric: tabular-nums;
    color: var(--se-text-secondary);
  }
  input[type='color'] {
    width: 28px;
    height: 22px;
    padding: 1px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    cursor: pointer;
  }
  input[type='color']::-webkit-color-swatch-wrapper {
    padding: 0;
  }
  input[type='color']::-webkit-color-swatch {
    border: 0;
    border-radius: calc(var(--se-radius-sm) - 1px);
  }
  input[type='range'] {
    width: 100%;
    margin: 0;
    accent-color: var(--se-accent);
  }
  input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .notice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 12px 12px;
    padding: 6px 4px 6px 8px;
    border-left: 2px solid var(--notice-accent);
    background: color-mix(in srgb, var(--notice-accent) 12%, transparent);
    border-radius: var(--se-radius-sm);
    font-size: 0.92em;
    line-height: 1.4;
  }
  .notice > :global(.icon) {
    margin-top: 2px;
    color: var(--notice-accent);
  }
  .notice span {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .notice.info {
    --notice-accent: var(--se-info);
  }
  .notice.warning {
    --notice-accent: var(--se-warning);
  }
  .notice.error {
    --notice-accent: var(--se-error);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 8px 12px;
    border-top: 1px solid var(--se-border);
  }
  .spacer {
    flex: 1;
  }
  .secondary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }
  .secondary:hover {
    background: var(--se-button-secondary-hover);
  }
  footer :global(button:focus-visible) {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .icon-button {
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
  .icon-button:hover {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
</style>
