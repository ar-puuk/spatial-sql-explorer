<script lang="ts">
  // Map-first viewer: the map fills the pane, the attribute table is a
  // resizable, collapsible bottom drawer (GeoLibre's drawer pattern, the
  // legacy app's drag handle — design-plan.md §5.1). No header or status bar
  // here: that's per-shell chrome (§4.3). The web shell injects its status bar
  // over the map through `mapOverlay`; VS Code uses its native status bar.
  import type { Snippet } from 'svelte'
  import { sidecarStyleFileName, DEFAULT_FEATURE_CAP } from '@spatial-explorer/core'
  import MapView from './MapView.svelte'
  import AttributeTable from './AttributeTable.svelte'
  import ErrorBanner from './ErrorBanner.svelte'
  import LayerWarningBanner from './LayerWarningBanner.svelte'
  import LayerStylePanel from './LayerStylePanel.svelte'
  import ProgressBar from './ProgressBar.svelte'
  import Icon from './Icon.svelte'
  import type { ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
    /** Rendered inside the map pane, above the canvas (web status bar). */
    mapOverlay?: Snippet
    /** Display name of the open file, for style file naming. */
    fileName?: string | null
  }
  let { store, mapOverlay, fileName = null }: Props = $props()

  const session = $derived(store.session)
  const layer = $derived(session.layer)
  const loading = $derived(session.loadState === 'loading')

  const MIN_FRACTION = 0.15
  const MAX_FRACTION = 0.85
  const HEADER_H = 28
  const COLLAPSE_BELOW_PX = HEADER_H + 36

  let fraction = $state(0.32)
  let collapsed = $state(false)
  let dragging = $state(false)
  let panesHeight = $state(0)
  let panes: HTMLDivElement
  let styleOpen = $state(false)

  let drawerHeight = $derived(collapsed ? HEADER_H : Math.round(fraction * panesHeight))

  // Close the style popover when the layer goes away (new file, error).
  $effect(() => {
    if (!layer) styleOpen = false
  })

  function startDrag(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    const sash = e.currentTarget as HTMLElement
    sash.setPointerCapture(e.pointerId)
    dragging = true
    const move = (ev: PointerEvent): void => {
      const rect = panes.getBoundingClientRect()
      const px = rect.bottom - ev.clientY
      if (px < COLLAPSE_BELOW_PX) {
        collapsed = true
        return
      }
      collapsed = false
      fraction = Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, px / rect.height))
    }
    const up = (): void => {
      dragging = false
      sash.removeEventListener('pointermove', move)
      sash.removeEventListener('pointerup', up)
      sash.removeEventListener('pointercancel', up)
    }
    sash.addEventListener('pointermove', move)
    sash.addEventListener('pointerup', up)
    sash.addEventListener('pointercancel', up)
  }

  function sashKeydown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 0.1 : 0.03
    if (e.key === 'ArrowUp') {
      collapsed = false
      fraction = Math.min(MAX_FRACTION, fraction + step)
    } else if (e.key === 'ArrowDown') {
      if (fraction - step < MIN_FRACTION) collapsed = true
      else fraction -= step
    } else if (e.key === 'Enter' || e.key === ' ') {
      collapsed = !collapsed
    } else return
    e.preventDefault()
  }

  const nf = new Intl.NumberFormat()
  let countLabel = $derived.by(() => {
    if (loading) return 'Loading…'
    if (!layer) return ''
    if (layer.truncated) return `Showing ${nf.format(Math.min(layer.features.length, DEFAULT_FEATURE_CAP))} of ${nf.format(layer.featureCount)} features`
    return `${nf.format(layer.featureCount)} ${layer.featureCount === 1 ? 'feature' : 'features'}`
  })
</script>

<div class="viewer-layout" class:dragging>
  {#if loading}
    <ProgressBar label="Loading file" />
  {/if}
  <ErrorBanner message={session.loadState === 'error' ? (session.loadError?.message ?? 'Unknown error') : null} />
  {#if layer}
    <LayerWarningBanner invalidGeometryCount={layer.invalidGeometryCount} />
  {/if}

  <div class="panes" bind:this={panes} bind:clientHeight={panesHeight}>
    <div class="map-pane">
      <MapView
        {layer}
        selectedFeatureId={session.selectedFeatureId}
        style={store.style}
        themeRevision={store.themeRevision}
        zoomRequest={store.zoomRequest}
        resizing={dragging}
        {styleOpen}
        onToggleStyle={() => (styleOpen = !styleOpen)}
        onSelectFeature={(id) => store.selectFeature(id)}
        onCursorMove={(c) => store.setCursor(c)}
      />
      {#if styleOpen && layer}
        <div class="style-popover">
          <LayerStylePanel
            style={store.style}
            geometryType={layer.geometryType}
            sidecarName={sidecarStyleFileName(fileName ?? 'layer')}
            styleSource={store.styleSource}
            styleDirty={store.styleDirty}
            canSaveSidecar={store.canSaveSidecar}
            notice={store.styleNotice}
            onChange={(patch) => store.setStyle(patch)}
            onSave={() => void store.saveStyle()}
            onExport={(format) => void store.exportStyle(format)}
            onImport={() => void store.importStyle()}
            onReset={() => store.resetStyle()}
            onDismissNotice={() => store.dismissStyleNotice()}
            onClose={() => (styleOpen = false)}
          />
        </div>
      {/if}
      {@render mapOverlay?.()}
    </div>

    <!-- A focusable separator is the WAI-ARIA "window splitter" pattern: it is
         interactive (drag, arrow keys, Enter to collapse). -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="sash"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize attribute table"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={collapsed ? 0 : Math.round(fraction * 100)}
      tabindex="0"
      onpointerdown={startDrag}
      onkeydown={sashKeydown}
      ondblclick={() => (collapsed = !collapsed)}
    >
      <span class="grip" aria-hidden="true"></span>
    </div>

    <div class="drawer" style:height="{drawerHeight}px">
      <div class="drawer-header">
        <button type="button" class="collapse" aria-expanded={!collapsed} aria-controls="attribute-drawer" onclick={() => (collapsed = !collapsed)}>
          <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={14} />
          <span class="title">Attributes</span>
        </button>
        <span class="count" class:truncated={layer?.truncated}>{countLabel}</span>
        <span class="spacer"></span>
        {#if layer && layer.features.length > 0 && !collapsed}
          <span class="hint">Double-click a row to zoom</span>
        {/if}
      </div>
      <div class="drawer-body" id="attribute-drawer" hidden={collapsed}>
        <AttributeTable
          {layer}
          {loading}
          selectedFeatureId={session.selectedFeatureId}
          onSelectFeature={(id) => store.selectFeature(id)}
          onZoomToFeature={(id) => store.zoomToFeature(id)}
        />
      </div>
    </div>
  </div>
</div>

<style>
  .viewer-layout {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--se-bg-base);
    color: var(--se-text-primary);
    font-family: var(--se-font-ui);
    font-size: var(--se-font-size);
  }
  .viewer-layout.dragging {
    cursor: row-resize;
    user-select: none;
  }
  .panes {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .map-pane {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .style-popover {
    position: absolute;
    top: 10px;
    right: 48px;
    z-index: 6;
  }

  /* VS Code-style sash: a thin line with a wider invisible hit area that
     lights up on hover/drag (--vscode-sash-hoverBorder in the extension). */
  .sash {
    position: relative;
    z-index: 4;
    flex: none;
    height: 1px;
    background: var(--se-border);
    cursor: row-resize;
    outline: none;
    touch-action: none;
  }
  .sash::before {
    content: '';
    position: absolute;
    inset: -3px 0;
  }
  .sash::after {
    content: '';
    position: absolute;
    inset: -1px 0;
    background: transparent;
    transition: background-color 0.1s ease-out 0.2s;
  }
  .sash:hover::after,
  .dragging .sash::after,
  .sash:focus-visible::after {
    background: var(--se-sash-hover);
    transition-delay: 0s;
  }
  .grip {
    display: var(--se-sash-grip-display, none);
    position: absolute;
    left: 50%;
    top: -4px;
    width: 28px;
    height: 9px;
    transform: translateX(-50%);
    border-radius: 4px;
    background:
      radial-gradient(circle, var(--se-text-muted) 1px, transparent 1.4px) 0 0 / 6px 4px,
      var(--se-bg-panel);
    border: 1px solid var(--se-border);
    pointer-events: none;
  }

  .drawer {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--se-bg-base);
  }
  .drawer-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: 28px;
    padding: 0 8px 0 4px;
    background: var(--se-bg-panel);
    border-bottom: 1px solid var(--se-border);
    white-space: nowrap;
    overflow: hidden;
  }
  .collapse {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 6px 0 2px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-section-title-fg);
    cursor: pointer;
  }
  .collapse:hover {
    background: var(--se-control-hover);
  }
  .collapse:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .title {
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
  }
  .count {
    color: var(--se-text-secondary);
    font-family: var(--se-font-mono);
    font-size: 0.92em;
    font-variant-numeric: tabular-nums;
  }
  .count.truncated {
    color: var(--se-warning-fg);
  }
  .spacer {
    flex: 1;
  }
  .hint {
    color: var(--se-text-muted);
    font-size: 0.9em;
  }
  .drawer-body {
    flex: 1;
    min-height: 0;
  }
  .drawer-body[hidden] {
    display: none;
  }
</style>
