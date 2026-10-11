<script lang="ts">
  // Layer style popover (design-plan.md §8.1/§8.5; spec 003
  // contracts/ui-style-panel.md). Renderer (Single / Categorized /
  // Graduated), column, classes, and the shared symbol settings. Edits apply
  // live. "Save" writes the QGIS-convention `<file>.qml` sidecar (VS Code) or
  // downloads it (web); "Export" writes QML, SLD or Mapbox GL style JSON;
  // "Import" reads any of the three.
  import {
    STYLE_FORMATS,
    eligibleColumns,
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
  } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import RampPicker from './RampPicker.svelte'
  import ClassList from './ClassList.svelte'
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
    onSave: () => void
    onExport: (format: StyleFormat) => void
    onImport: () => void
    onReset: () => void
    onDismissNotice: () => void
    onClose: () => void
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
    onSave,
    onExport,
    onImport,
    onReset,
    onDismissNotice,
    onClose,
  }: Props = $props()

  const RENDERERS: Array<{ kind: Renderer['kind']; label: string }> = [
    { kind: 'single', label: 'Single' },
    { kind: 'categorized', label: 'Categorized' },
    { kind: 'graduated', label: 'Graduated' },
  ]
  const renderer = $derived(rendererOf(style))
  const thematic = $derived(renderer.kind !== 'single')
  const columnsFor = (kind: 'categorized' | 'graduated') => eligibleColumns(layer?.columns, kind)
  /** Why a renderer can't be chosen, or null. */
  function unavailable(kind: Renderer['kind']): string | null {
    if (kind === 'single') return null
    if (columnsFor(kind).length) return null
    return kind === 'graduated' ? 'Graduated styling needs a numeric column.' : 'This result has no attribute columns.'
  }
  let symbolOpen = $state(false)

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

  let exportOpen = $state(false)
  let hasFill = $derived(geometryType !== 'LineString')
  let hasPoints = $derived(geometryType === 'Point' || geometryType === 'Mixed')
  let strokeLabel = $derived(geometryType === 'LineString' ? 'Line' : 'Outline')

  const pct = (n: number): string => `${Math.round(n * 100)}%`

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      if (exportOpen) exportOpen = false
      else onClose()
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
    <div class="renderers" role="radiogroup" aria-label="Renderer">
      {#each RENDERERS as r (r.kind)}
        {@const why = unavailable(r.kind)}
        <button
          type="button"
          role="radio"
          data-kind={r.kind}
          aria-checked={renderer.kind === r.kind}
          tabindex={renderer.kind === r.kind ? 0 : -1}
          aria-disabled={why !== null}
          title={why ?? undefined}
          onclick={() => chooseRenderer(r.kind)}
          onkeydown={radioKeydown}>{r.label}</button
        >
      {/each}
    </div>

    {#if renderer.kind !== 'single'}
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

      {#if renderer.kind === 'graduated'}
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
      {/if}

      {#if resolved.status === 'fallback'}
        <p class="inline-note warning" role="status"><Icon name="warning" size={14} />{resolved.reason} Showing the single symbol.</p>
      {:else}
        <div class="row field">
          <span class="label" id="ramp-label">Colors</span>
          <RampPicker
            value={renderer.ramp}
            renderer={renderer.kind}
            classCount={resolved.classes.filter((c) => c.kind === 'value' || c.kind === 'range').length}
            onChange={(ramp) => apply(setRamp(style, ramp))}
          />
        </div>
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

      <button type="button" class="disclosure" aria-expanded={symbolOpen} onclick={() => (symbolOpen = !symbolOpen)}>
        <Icon name={symbolOpen ? 'chevron-down' : 'chevron-up'} size={12} />Symbol
      </button>
    {/if}

    {#if !thematic || symbolOpen}
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
          min="1"
          max="20"
          step="0.5"
          value={style.pointRadius}
          oninput={(e) => onChange({ pointRadius: Number(e.currentTarget.value) })}
        />
        <span class="value">{style.pointRadius} px</span>
      </div>
    {/if}
    {/if}
  </div>

  {#if notice}
    <div class="notice {notice.kind}" role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon name={notice.kind === 'info' ? 'info' : notice.kind} size={14} />
      <span>{notice.text}</span>
      <button type="button" class="icon-button" aria-label="Dismiss" onclick={onDismissNotice}><Icon name="close" size={14} /></button>
    </div>
  {/if}

  <footer>
    <button
      type="button"
      class="primary"
      onclick={onSave}
      title={canSaveSidecar ? `Save ${sidecarName} next to the data. QGIS loads it automatically.` : `Download ${sidecarName}. Keep it next to the data so QGIS loads it automatically.`}
    >
      <Icon name="save" size={14} />{canSaveSidecar ? 'Save' : 'Download'}
    </button>
    <div class="menu-anchor">
      <button type="button" class="secondary" aria-haspopup="menu" aria-expanded={exportOpen} onclick={() => (exportOpen = !exportOpen)}>
        <Icon name="export" size={14} />Export<Icon name="chevron-down" size={12} />
      </button>
      {#if exportOpen}
        <div class="menu" role="menu">
          {#each STYLE_FORMATS as f (f.format)}
            {@const losses = previewExportNotice(style, f.format, resolved).items}
            <button
              type="button"
              role="menuitem"
              aria-describedby={losses.length ? `export-loss-${f.format}` : undefined}
              onclick={() => {
                exportOpen = false
                onExport(f.format)
              }}
              >{f.label}
              {#if losses.length}
                <span class="loss" id={`export-loss-${f.format}`}>{losses.join(' ')}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <button type="button" class="secondary" onclick={onImport} title="Import a QGIS .qml, OGC .sld or Mapbox GL style .json">
      <Icon name="import" size={14} />Import
    </button>
    <span class="spacer"></span>
    <button type="button" class="icon-button" aria-label="Reset to default style" title="Reset to default style" onclick={onReset}><Icon name="reset" /></button>
  </footer>
</div>

<style>
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
  .disclosure:focus-visible,
  select:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .row.field {
    grid-template-columns: 72px 1fr;
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
  .disclosure {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    justify-self: start;
    padding: 2px 0;
    border: 0;
    background: transparent;
    color: var(--se-section-title-fg);
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    cursor: pointer;
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
  footer button.primary,
  footer button.secondary {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--se-button-border);
    border-radius: var(--se-radius-sm);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .primary {
    background: var(--se-button-bg);
    color: var(--se-button-fg);
  }
  .primary:hover {
    background: var(--se-button-hover);
  }
  .secondary {
    background: var(--se-button-secondary-bg);
    color: var(--se-button-secondary-fg);
  }
  .secondary:hover {
    background: var(--se-button-secondary-hover);
  }
  footer button:focus-visible,
  .menu button:focus-visible {
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
  .menu-anchor {
    position: relative;
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    z-index: 10;
    min-width: 200px;
    max-width: 280px;
    padding: 4px;
    background: var(--se-menu-bg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
  }
  .menu button {
    display: block;
    width: 100%;
    padding: 4px 8px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-menu-fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .menu .loss {
    display: block;
    margin-top: 2px;
    color: var(--se-text-secondary);
    font-size: 0.85em;
    line-height: 1.35;
    white-space: normal;
  }
  .menu button:hover .loss {
    color: inherit;
  }
  .menu button:hover {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
</style>
