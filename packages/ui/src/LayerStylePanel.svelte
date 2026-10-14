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
    measureColumns,
    extrusionUnavailableReason,
    DEFAULT_EXTRUSION_SCALE,
    type Extrusion,
    METHOD_NAMES,
    MIN_CLASS_COUNT,
    MAX_CLASS_COUNT,
    type GraduatedMethod,
    rendererOf,
    startStyle,
    addRule,
    updateRule,
    removeRule,
    moveRule,
    setRulesElse,
    suggestedRules,
    type RuleSuggestions,
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
    setBivariateAxis,
    setBivariatePalette,
    setCellVisible,
    swapBivariateAxes,
    setSizeChannel,
    setSizeClassBound,
    setSizeClassCount,
    setSizeClassLabel,
    setSizeClassVisible,
    setSizeMethod,
    setSizeMode,
    setSizeRange,
    sizeSymbols as sizeSymbolsOf,
    baseSymbol,
    LINE_DASHES,
    LINE_DASH_NAMES,
    MARKER_SHAPES,
    MARKER_SHAPE_NAMES,
    type LineDash,
    type MarkerShape,
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
  import ValueHistogram from './style/ValueHistogram.svelte'
  import SaveStyleButton from './style/SaveStyleButton.svelte'
  import SymbolSwatch from './style/SymbolSwatch.svelte'
  import BivariatePicker from './style/BivariatePicker.svelte'
  import BivariateLegend from './style/BivariateLegend.svelte'
  import RulesEditor from './style/RulesEditor.svelte'
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
    /** Spec 007: rows being classified by the engine (shown after 300 ms), or null. */
    classifyingRows?: number | null
    /** Spec 008 US6: polygons drawn flat by the extrusion (missing, zero or negative height), or null. */
    extrusionFlat?: number | null
    /** Spec 008 US6: a height scale that makes a column visible at the layer's extent. */
    onSuggestScale?: (column: string) => Promise<number>
    /** Spec 010: inside the side panel (no title or close button of its own). */
    embedded?: boolean
    /** Spec 010: example rules from the data, for a first rules style. */
    onSuggestRules?: () => Promise<RuleSuggestions>
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
    classifyingRows = null,
    extrusionFlat = null,
    onSuggestScale,
    embedded = false,
    onSuggestRules,
  }: Props = $props()

  // --- Spec 008 US6: 3D extrusion ---------------------------------------
  const CONSTANT = '__constant'
  const extrusionReason = $derived(extrusionUnavailableReason(geometryType))
  const ext = $derived(style.extrusion)
  const heightColumns = $derived(eligibleColumns(layer?.columns, 'graduated'))
  /** A column whose name says height: its values are taken as meters (no automatic scale). */
  const HEIGHT_NAME = /height|elev|floor|storey|stories|levels|hgt/i
  /** A first guess at the height column: a name that says height, else the first numeric column. */
  function defaultHeightSource(): Extrusion['source'] {
    const cols = heightColumns
    const named = cols.find((c) => HEIGHT_NAME.test(c.name))
    const col = named ?? cols[0]
    return col ? { kind: 'column', column: col.name } : { kind: 'constant', meters: 10 }
  }
  function setExtrusion(patch: Partial<Extrusion>): void {
    const base: Extrusion = ext ?? { enabled: false, source: defaultHeightSource(), scale: DEFAULT_EXTRUSION_SCALE }
    onChange({ extrusion: { ...base, ...patch } })
  }
  function chooseHeight(value: string): void {
    setExtrusion({ source: value === CONSTANT ? { kind: 'constant', meters: ext?.source.kind === 'constant' ? ext.source.meters : 10 } : { kind: 'column', column: value } })
    if (value !== CONSTANT && !HEIGHT_NAME.test(value)) void autoScale(value)
  }
  function toggleExtrusion(): void {
    const first = !ext
    setExtrusion({ enabled: !ext?.enabled })
    // Raw values are rarely meters: the first time, pick a scale that shows them.
    const src = style.extrusion?.source
    if (first && src?.kind === 'column' && !HEIGHT_NAME.test(src.column)) void autoScale(src.column)
  }
  let scaling = $state(false)
  /** Sets the scale suggested for `column`, unless the height column changed meanwhile. */
  async function autoScale(column: string): Promise<void> {
    if (!onSuggestScale) return
    scaling = true
    try {
      const scale = await onSuggestScale(column)
      const now = style.extrusion
      if (now?.source.kind === 'column' && now.source.column === column) setExtrusion({ scale })
    } finally {
      scaling = false
    }
  }

  const RENDERERS: Array<{ kind: Renderer['kind']; label: string; hint: string }> = [
    { kind: 'single', label: 'Single', hint: 'One color for every feature' },
    { kind: 'categorized', label: 'Categorized', hint: 'A color per value of a column' },
    { kind: 'graduated', label: 'Graduated', hint: 'Colors by ranges of a numeric column' },
    { kind: 'bivariate', label: 'Bivariate', hint: 'Colors by two numeric columns, from a 3×3 square' },
    { kind: 'rules', label: 'Rules', hint: 'Colors by SQL conditions: the first that holds colors a feature' },
  ]
  const renderer = $derived(rendererOf(style))
  const thematic = $derived(renderer.kind !== 'single')
  const columnsFor = (kind: 'categorized' | 'graduated') => eligibleColumns(layer?.columns, kind)
  /** Why a renderer can't be chosen, or null. */
  function unavailable(kind: Renderer['kind']): string | null {
    if (kind === 'single') return null
    if (kind === 'bivariate') return columnsFor('graduated').length >= 2 ? null : 'Bivariate maps need two numeric columns.'
    if (kind === 'rules') return layer?.columns.length ? null : 'This result has no attribute columns.'
    if (columnsFor(kind).length) return null
    return kind === 'graduated' ? 'Graduated styling needs a numeric column.' : 'This result has no attribute columns.'
  }

  function chooseRenderer(kind: Renderer['kind']): void {
    if (kind === renderer.kind || unavailable(kind)) return
    onChange(startStyle(style, kind, layer))
    if (kind === 'rules') void suggestRules()
  }

  // --- Spec 010: rules and graduated by expression ----------------------------
  /** A first rules style gets two example rules from the data (unless rules were added meanwhile). */
  async function suggestRules(): Promise<void> {
    const s = await onSuggestRules?.().catch(() => ({}))
    const now = rendererOf(style)
    if (!s || now.kind !== 'rules' || now.rules.length) return
    const rules = suggestedRules(s)
    if (rules.length) onChange({ renderer: { ...now, rules } })
  }

  const EXPRESSION = '__expression'
  /** "Expression…" chosen in the Value select, before an expression is written. */
  let expressionMode = $state(false)
  const usingExpression = $derived(renderer.kind === 'graduated' && (!!renderer.expression || expressionMode))
  function chooseValue(value: string): void {
    if (value === EXPRESSION) {
      expressionMode = true
      return
    }
    expressionMode = false
    chooseColumn(value)
  }
  function commitExpression(text: string): void {
    if (renderer.kind !== 'graduated') return
    const expression = text.trim()
    if (!expression) return
    if (expression === renderer.expression) return
    // A new expression starts new classes (as a new column does); the label follows the text.
    apply({ ...style, renderer: { ...renderer, expression, column: '', method: renderer.method === 'manual' ? 'quantile' : renderer.method, classes: [] } })
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
    if (renderer.kind === 'single' || renderer.kind === 'rules') return
    onChange({ renderer: startStyle(style, renderer.kind, layer, column).renderer })
  }

  let hasFill = $derived(geometryType !== 'LineString')
  let hasPoints = $derived(geometryType === 'Point' || geometryType === 'Mixed')
  let hasLines = $derived(geometryType !== 'Point')
  let strokeLabel = $derived(geometryType === 'LineString' ? 'Line' : 'Outline')

  // --- Spec 009: the size channel (marker size on points, line width on lines; none on polygons).
  const sizeGeometry = $derived<'point' | 'line'>(geometryType === 'LineString' ? 'line' : 'point')
  const size = $derived(style.size)
  const sizeOn = $derived(!!size && renderer.kind !== 'bivariate')
  const numericColumns = $derived(eligibleColumns(layer?.columns, 'graduated'))
  const sizeSymbols = $derived(sizeOn && resolved.size?.status === 'ok' ? { symbols: sizeSymbolsOf(style, resolved), kind: sizeGeometry } : null)
  function toggleSize(): void {
    if (sizeOn) return apply(setSizeChannel(style, null, sizeGeometry))
    // Identifier-like columns go last (spec 009 SC-001: a useful default in one click).
    const column = measureColumns(layer?.columns)[0]?.name
    if (column) apply(setSizeChannel(style, column, sizeGeometry))
  }
  function chooseSize(side: 'min' | 'max', value: number): void {
    if (!size || !Number.isFinite(value)) return
    apply(setSizeRange(style, side === 'min' ? value : size.sizeMin, side === 'max' ? value : size.sizeMax))
  }

  // --- Marker shape and line pattern.
  const shape = $derived<MarkerShape>(style.markerShape ?? 'circle')
  const dash = $derived<LineDash>(style.lineDash ?? 'solid')
  const preview = $derived(baseSymbol(style))
  function shapeKeydown(e: KeyboardEvent): void {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const next = MARKER_SHAPES[(MARKER_SHAPES.indexOf(shape) + dir + MARKER_SHAPES.length) % MARKER_SHAPES.length]
    onChange({ markerShape: next })
    const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]')
    queueMicrotask(() => group?.querySelector<HTMLElement>(`[data-shape="${next}"]`)?.focus())
  }

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

<div class="panel" class:embedded aria-label="Layer style" role={embedded ? 'region' : 'dialog'} tabindex="-1" onkeydown={handleKeydown}>
  {#if embedded}
    <div class="source-row">
      <span class="source" title={styleSource ?? undefined}>
        {styleSource ?? 'Default'}{styleDirty ? ' · modified' : ''}
      </span>
    </div>
  {:else}
    <header>
      <h2>Layer style</h2>
      <span class="source" title={styleSource ?? undefined}>
        {styleSource ?? 'Default'}{styleDirty ? ' · modified' : ''}
      </span>
      <button type="button" class="icon-button" aria-label="Close" title="Close" onclick={onClose}><Icon name="close" /></button>
    </header>
  {/if}

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
    </section>

    {#if renderer.kind === 'categorized' || renderer.kind === 'graduated'}
      <section aria-labelledby="style-sec-by">
        <h3 id="style-sec-by">Color by</h3>
        <div class="row field">
          <label class="label" for="style-column">Column</label>
          <select id="style-column" value={usingExpression ? EXPRESSION : renderer.column} onchange={(e) => chooseValue(e.currentTarget.value)}>
            {#if !usingExpression && !columnsFor(renderer.kind).some((c) => c.name === renderer.column)}
              <option value={renderer.column}>{renderer.column || 'Choose…'}</option>
            {/if}
            {#each columnsFor(renderer.kind) as c (c.name)}
              <option value={c.name}>{c.name} · {c.type}</option>
            {/each}
            {#if renderer.kind === 'graduated'}
              <option value={EXPRESSION}>Expression…</option>
            {/if}
          </select>
        </div>
        {#if renderer.kind === 'graduated' && usingExpression}
          <div class="expression">
            <input
              type="text"
              class="mono"
              aria-label="Expression"
              aria-describedby="style-expression-hint"
              placeholder="gdp_md * 1e6 / pop_est"
              spellcheck="false"
              autocomplete="off"
              value={renderer.expression ?? ''}
              onkeydown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
              onchange={(e) => commitExpression(e.currentTarget.value)}
            />
            <p class="hint" id="style-expression-hint">A SQL expression over this layer's columns, e.g. gdp_md * 1e6 / pop_est</p>
          </div>
        {/if}
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

    <!-- Spec 010: rules (the first matching condition colors a feature). -->
    {#if renderer.kind === 'rules'}
      <section aria-labelledby="style-sec-rules">
        <h3 id="style-sec-rules">Rules</h3>
        <p class="hint">SQL conditions on this layer's columns. The first rule a feature matches colors it.</p>
        <RulesEditor
          {renderer}
          {resolved}
          onUpdate={(id, patch) => apply(updateRule(style, id, patch))}
          onAdd={() => apply(addRule(style))}
          onRemove={(id) => apply(removeRule(style, id))}
          onMove={(id, by) => apply(moveRule(style, id, by))}
          onElse={(patch) => apply(setRulesElse(style, patch))}
        />
        {#if editError}
          <p class="inline-note warning" role="alert"><Icon name="warning" size={14} />{editError}</p>
        {/if}
      </section>
    {/if}

    <!-- Spec 009 US1/US2: an independent size channel (contracts/ui.md "Size"). -->
    <!-- Spec 009 US4: bivariate (contracts/ui.md "Style panel"). -->
    {#if renderer.kind === 'bivariate'}
      <section aria-labelledby="style-sec-axes">
        <h3 id="style-sec-axes">Columns</h3>
        <BivariatePicker
          {renderer}
          columns={columnsFor('graduated')}
          onAxis={(axis, patch) => apply(setBivariateAxis(style, axis, patch))}
          onSwap={() => apply(swapBivariateAxes(style))}
          onPalette={(id) => apply(setBivariatePalette(style, id))}
        />
        {#if editError}
          <p class="inline-note warning" role="alert"><Icon name="warning" size={14} />{editError}</p>
        {/if}
      </section>
      <section aria-labelledby="style-sec-cells">
        <h3 id="style-sec-cells">Cells</h3>
        {#if resolved.status === 'fallback'}
          <p class="inline-note warning" role="status"><Icon name="warning" size={14} />{resolved.reason} Showing the single symbol.</p>
        {:else}
          <BivariateLegend {resolved} cell={28} onToggle={(key, visible) => apply(setCellVisible(style, key, visible))} />
          {#each resolved.notes as note (note)}
            <p class="inline-note" role="status"><Icon name="info" size={14} />{note}</p>
          {/each}
        {/if}
      </section>
    {/if}

    <section aria-labelledby="style-sec-size">
      <h3 id="style-sec-size">Size</h3>
      {#if geometryType === 'Polygon'}
        <p class="inline-note" role="status"><Icon name="info" size={14} />Polygons have no size: the size channel is for points and lines.</p>
      {:else if renderer.kind === 'bivariate'}
        <p class="inline-note" role="status"><Icon name="info" size={14} />Bivariate maps have no size channel.</p>
      {:else}
        <div class="row field">
          <span class="label" id="size-by-label">Size by</span>
          <button
            type="button"
            role="switch"
            class="switch"
            aria-label="Size by column"
            aria-checked={sizeOn}
            disabled={!sizeOn && numericColumns.length === 0}
            title={numericColumns.length === 0 ? 'Sizing needs a numeric column.' : undefined}
            onclick={toggleSize}
          >
            <span class="track" aria-hidden="true"><span class="thumb"></span></span>
            <span class="state">{sizeOn ? 'On' : 'Off'}</span>
          </button>
        </div>
        {#if sizeOn && size}
          <div class="row field">
            <span class="label" aria-hidden="true">Column</span>
            <select id="style-size-column" aria-label="Size column" value={size.column} onchange={(e) => apply(setSizeChannel(style, e.currentTarget.value, sizeGeometry))}>
              {#if !numericColumns.some((c) => c.name === size.column)}
                <option value={size.column}>{size.column || 'Choose…'}</option>
              {/if}
              {#each numericColumns as c (c.name)}
                <option value={c.name}>{c.name} · {c.type}</option>
              {/each}
            </select>
          </div>
          <div class="row field">
            <span class="label" id="size-scale-label">Scale</span>
            <div class="renderers two" role="radiogroup" aria-label="Size scale">
              {#each [{ mode: 'classed', label: 'Classed', hint: 'Sizes in steps, by classes of the column' }, { mode: 'proportional', label: 'Proportional', hint: 'Sizes that follow the values smoothly' }] as const as m (m.mode)}
                <button
                  type="button"
                  role="radio"
                  aria-checked={size.mode === m.mode}
                  tabindex={size.mode === m.mode ? 0 : -1}
                  title={m.hint}
                  onclick={() => apply(setSizeMode(style, m.mode))}
                  onkeydown={(e) => {
                    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                      e.preventDefault()
                      const next = size.mode === 'classed' ? 'proportional' : 'classed'
                      apply(setSizeMode(style, next))
                      const group = (e.currentTarget as HTMLElement).parentElement
                      queueMicrotask(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
                    }
                  }}>{m.label}</button
                >
              {/each}
            </div>
          </div>
          {#if size.mode === 'classed'}
          <div class="pair">
            <div class="row field">
              <span class="label" aria-hidden="true">Method</span>
              <select id="style-size-method" aria-label="Size method" value={size.method} onchange={(e) => apply(setSizeMethod(style, e.currentTarget.value as Exclude<GraduatedMethod, 'manual'>))}>
                {#each METHODS as m (m)}
                  <option value={m}>{m === 'jenks' ? 'Natural breaks (Jenks)' : METHOD_NAMES[m]}</option>
                {/each}
                {#if size.method === 'manual'}
                  <option value="manual">Manual</option>
                {/if}
              </select>
            </div>
            <div class="row field">
              <span class="label" aria-hidden="true">Classes</span>
              <select id="style-size-count" class="narrow" aria-label="Size class count" value={size.classCount} onchange={(e) => apply(setSizeClassCount(style, Number(e.currentTarget.value)))}>
                {#each CLASS_COUNTS as n (n)}
                  <option value={n}>{n}</option>
                {/each}
              </select>
            </div>
          </div>
          {:else}
            <p class="hint">Sizes scale smoothly from the smallest to the largest value of {size.column}{sizeGeometry === 'point' ? ', by marker area' : ''}.</p>
          {/if}
          <div class="row field">
            <span class="label" aria-hidden="true">{sizeGeometry === 'line' ? 'Widths' : 'Sizes'}</span>
            <span class="size-range">
              <input id="style-size-min" class="number" type="number" aria-label="Smallest size" min="0.5" max="100" step="0.5" value={size.sizeMin} onchange={(e) => chooseSize('min', Number(e.currentTarget.value))} />
              <span aria-hidden="true">to</span>
              <input class="number" type="number" aria-label="Largest size" min="0.5" max="100" step="0.5" value={size.sizeMax} onchange={(e) => chooseSize('max', Number(e.currentTarget.value))} />
              <span>px</span>
            </span>
          </div>
          {#if resolved.size?.status === 'fallback'}
            <p class="inline-note warning" role="status"><Icon name="warning" size={14} />{resolved.size.reason}</p>
          {:else if resolved.size && sizeSymbols && size.mode === 'classed'}
            <ClassList
              {resolved}
              kind="graduated"
              classes={resolved.size.classes}
              caption={resolved.size.caption}
              listLabel="Size classes"
              canAdd={false}
              {sizeSymbols}
              manual={size.method === 'manual'}
              onColor={() => {}}
              onLabel={(key, label) => apply(setSizeClassLabel(style, key, label))}
              onVisible={(key, visible) => apply(setSizeClassVisible(style, key, visible))}
              onValue={() => {}}
              onBound={(index, side, value) => apply(setSizeClassBound(style, resolved, index, side, value))}
              onAdd={() => {}}
              onDelete={() => {}}
            />
            {#each resolved.size.notes as note (note)}
              <p class="inline-note" role="status"><Icon name="info" size={14} />{note}</p>
            {/each}
          {/if}
        {/if}
      {/if}
    </section>

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

      {#if hasLines}
        <div class="row">
          <label class="label" for="style-dash">Pattern</label>
          <span class="preview" aria-hidden="true"><SymbolSwatch symbol={{ ...preview, lineWidth: Math.min(Math.max(preview.lineWidth, 1.5), 3) }} kind="line" size={26} /></span>
          <select id="style-dash" class="span" value={dash} onchange={(e) => onChange({ lineDash: e.currentTarget.value as LineDash })}>
            {#each LINE_DASHES as d (d)}
              <option value={d}>{LINE_DASH_NAMES[d]}</option>
            {/each}
          </select>
        </div>
      {/if}

      {#if hasPoints}
        <div class="row">
          <span class="label" id="shape-label">Shape</span>
          <div class="shapes" role="radiogroup" aria-labelledby="shape-label">
            {#each MARKER_SHAPES as m (m)}
              <button
                type="button"
                role="radio"
                data-shape={m}
                aria-checked={shape === m}
                aria-label={MARKER_SHAPE_NAMES[m]}
                title={MARKER_SHAPE_NAMES[m]}
                tabindex={shape === m ? 0 : -1}
                onclick={() => onChange({ markerShape: m })}
                onkeydown={shapeKeydown}
              >
                <SymbolSwatch symbol={{ ...preview, shape: m, radius: 6, strokeWidth: Math.min(preview.strokeWidth, 1.5), fillOpacity: Math.max(preview.fillOpacity, 0.6) }} kind="point" size={18} />
              </button>
            {/each}
          </div>
        </div>
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
            onclick={toggleExtrusion}
          >
            <span class="track" aria-hidden="true"><span class="thumb"></span></span>
            <span class="state">{ext?.enabled ? 'On' : 'Off'}</span>
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
          <div class="row field with-action">
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
            {#if ext.source.kind === 'column' && onSuggestScale}
              {@const column = ext.source.column}
              <button type="button" class="auto-scale" disabled={scaling} title="Pick a scale that shows the heights at this layer's extent" onclick={() => void autoScale(column)}>Auto</button>
            {/if}
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
    width: 344px;
    background: var(--se-bg-elevated);
    color: var(--se-text-primary);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
    outline: none;
  }
  /* Spec 010: inside the side panel, which has the title and the close button. */
  .panel.embedded {
    /* The side panel can be as narrow as 240 px: the renderer choice wraps (below). */
    container-type: inline-size;
    flex: 1;
    width: auto;
    min-height: 0;
    max-height: none;
    background: transparent;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .source-row {
    display: flex;
    flex: none;
    padding: 0 12px 4px;
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
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    overflow: hidden;
  }
  .renderers button {
    height: 24px;
    padding: 0 4px;
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
  /* Spec 010: five style types don't fit a side panel on one row: three per row. */
  @container (max-width: 420px) {
    .renderers {
      grid-auto-flow: row;
      grid-template-columns: 1fr 1fr 1fr;
    }
    .renderers button:nth-child(3n + 1) {
      border-left: 0;
    }
    .renderers button:nth-child(n + 4) {
      border-top: 1px solid var(--se-input-border);
    }
  }
  .expression {
    display: grid;
    gap: 3px;
  }
  .expression input {
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-input-bg);
    color: var(--se-input-fg, var(--se-text-primary));
    font-family: var(--se-font-mono);
    font-size: 0.92em;
  }
  .expression input:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.88em;
    line-height: 1.35;
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
  .row.field.with-action {
    grid-template-columns: 72px auto 1fr;
  }
  .auto-scale {
    justify-self: start;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--se-input-border);
    border-radius: var(--se-radius-sm);
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
    font: inherit;
    cursor: pointer;
  }
  .auto-scale:hover:not(:disabled) {
    background: var(--se-button-secondary-hover);
    color: var(--se-text-primary);
  }
  .auto-scale:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .auto-scale:focus-visible,
  input.number:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .hint {
    margin: 0;
    color: var(--se-text-secondary);
    font-size: 0.92em;
  }
  @media (prefers-reduced-motion: reduce) {
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
  .row .span {
    grid-column: 3 / 5;
  }
  .preview {
    display: grid;
    place-items: center;
  }
  .renderers.two {
    grid-template-columns: repeat(2, 1fr);
  }
  .size-range {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--se-text-secondary);
  }
  .size-range input.number {
    width: 64px;
  }
  /* Marker shapes: a row of toggles, each drawn in the layer's own colors. */
  .shapes {
    grid-column: 2 / 5;
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }
  .shapes button {
    display: grid;
    place-items: center;
    width: 26px;
    height: 24px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--se-radius-sm);
    background: transparent;
    cursor: pointer;
  }
  .shapes button:hover {
    background: var(--se-control-hover);
  }
  .shapes button[aria-checked='true'] {
    border-color: var(--se-selected-indicator, var(--se-focus));
    background: var(--se-control-hover);
  }
  .shapes button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
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
    flex-wrap: wrap;
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
  /* A VS Code-style toggle: a clear off state in every theme, the accent when on. */
  .switch {
    display: inline-flex;
    justify-self: start;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    padding: 0 4px 0 0;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-primary);
    font: inherit;
    font-weight: normal;
    cursor: pointer;
  }
  .switch:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .switch .track {
    position: relative;
    flex: none;
    box-sizing: border-box;
    width: 30px;
    height: 16px;
    border-radius: 8px;
    border: 1px solid var(--se-input-border);
    background: color-mix(in srgb, var(--se-text-secondary) 22%, var(--se-input-bg));
    transition:
      background-color 0.15s,
      border-color 0.15s;
  }
  .switch .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--se-text-primary);
    opacity: 0.75;
    transition:
      transform 0.15s,
      opacity 0.15s;
  }
  .switch:not(:disabled):hover .track {
    border-color: var(--se-text-secondary);
  }
  .switch[aria-checked='true'] .track {
    background: var(--se-button-bg);
    border-color: var(--se-button-bg);
  }
  .switch[aria-checked='true'] .thumb {
    transform: translateX(14px);
    background: var(--se-button-fg);
    opacity: 1;
  }
  .switch .state {
    color: var(--se-text-secondary);
  }
  .switch:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .switch .track,
    .switch .thumb {
      transition: none;
    }
  }
</style>
