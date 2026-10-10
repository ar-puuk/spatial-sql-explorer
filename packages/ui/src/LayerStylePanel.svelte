<script lang="ts">
  // Single-symbol layer style popover (design-plan.md §8.1/§8.5). Edits apply
  // live. "Save" writes the QGIS-convention `<file>.qml` sidecar (VS Code) or
  // downloads it (web); "Export" writes QML, SLD or Mapbox GL style JSON;
  // "Import" reads any of the three.
  import { STYLE_FORMATS, type GeometryType, type LayerStyle, type StyleFormat } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import type { StyleNotice } from './viewerStore.svelte.js'

  interface Props {
    style: LayerStyle
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
    {#if hasFill}
      <div class="row">
        <span class="label" id="fill-label">Fill</span>
        <input type="color" aria-labelledby="fill-label" value={style.fillColor} oninput={(e) => onChange({ fillColor: e.currentTarget.value })} />
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
            <button
              type="button"
              role="menuitem"
              onclick={() => {
                exportOpen = false
                onExport(f.format)
              }}>{f.label}</button
            >
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
    width: 288px;
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
    gap: 8px;
    padding: 12px;
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
  .menu button:hover {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
  }
</style>
