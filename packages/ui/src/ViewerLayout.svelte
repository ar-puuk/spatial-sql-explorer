<script lang="ts">
  // Spec 010 layout Option A (implementation-plan.md phase 8): the map with
  // its floating widgets (search, the feature card, the legend), a bottom
  // panel with Table and SQL tabs, a side panel (Style, Labels, Basemap)
  // opened from an activity rail on the right, as VS Code arranges its views. The arrangement is the store's
  // `layout`, remembered by the host. No header here: that's per-shell chrome
  // (design-plan.md §4.3); the web shell passes its status bar.
  import type { Snippet } from 'svelte'
  import { DEFAULT_LAYER_STYLE, groupsInCorner, shownControls, legendGroups, classSymbols, clusterLegendRows, rendererOf, rendererTitle, setLabels, sidecarStyleFileName, sizeSymbols, type ChannelId, type LegendGroup } from '@spatial-explorer/core'
  import MapView from './MapView.svelte'
  import AttributeTable from './AttributeTable.svelte'
  import ErrorBanner from './ErrorBanner.svelte'
  import LayerWarningBanner from './LayerWarningBanner.svelte'
  import LayerStylePanel from './LayerStylePanel.svelte'
  import MapLegend from './MapLegend.svelte'
  import BasemapPicker from './BasemapPicker.svelte'
  import BasemapGallery from './BasemapGallery.svelte'
  import FeatureInspector from './FeatureInspector.svelte'
  import OpenProgress from './OpenProgress.svelte'
  import QueryPanel from './QueryPanel.svelte'
  import ExportDialog from './ExportDialog.svelte'
  import MapImageDialog from './MapImageDialog.svelte'
  import type { LegendSpec } from './mapImage.js'
  import ReadWholeDialog from './ReadWholeDialog.svelte'
  import UnavailableNotice from './UnavailableNotice.svelte'
  import ColumnChooser from './ColumnChooser.svelte'
  import SelectionBar from './SelectionBar.svelte'
  import ActivityRail from './ActivityRail.svelte'
  import LabelsPanel from './LabelsPanel.svelte'
  import MapControlsPanel from './MapControlsPanel.svelte'
  import SidePanel from './SidePanel.svelte'
  import BottomPanel from './BottomPanel.svelte'
  import SearchBox from './SearchBox.svelte'
  import LayerPicker from './LayerPicker.svelte'
  import WorkspaceFiles from './WorkspaceFiles.svelte'
  import { tick, untrack } from 'svelte'
  import Icon from './Icon.svelte'
  import type { SideTab, ViewerStore } from './viewerStore.svelte.js'

  interface Props {
    store: ViewerStore
    /** Rendered inside the map pane, above the canvas. */
    mapOverlay?: Snippet
    /** Rendered as a full-width row under the panels (the web shell's status bar). */
    statusBar?: Snippet
    /** Display name of the open file, for style file naming. */
    fileName?: string | null
  }
  let { store, mapOverlay, statusBar, fileName = null }: Props = $props()

  const session = $derived(store.session)
  const layer = $derived(session.layer)
  const layout = $derived(store.layout)
  // Legend (spec 003 FR-010): for thematic styles, and for a customized
  // single symbol (one row); not for the untouched default.
  const legendRenderer = $derived(rendererOf(store.style))
  // Spec 011: one group per property that varies, merged where properties read the same classes.
  const legend = $derived(legendGroups(store.style, store.resolvedStyle))
  // Spec 009 US2: proportional sizes are reference sizes, not classes: their own group.
  const legendProportional = $derived.by(() => {
    const size = store.resolvedStyle.size
    if (size?.status !== 'ok' || size.mode !== 'proportional' || legendRenderer.kind === 'bivariate' || legendRenderer.kind === 'heatmap' || legendRenderer.kind === 'clusters') return null
    return { channel: size, symbols: sizeSymbols(store.style, store.resolvedStyle) }
  })
  const showLegend = $derived(
    legendRenderer.kind !== 'single' ||
      legend.length > 0 ||
      !!legendProportional ||
      (['fillColor', 'strokeColor', 'fillOpacity', 'strokeOpacity', 'strokeWidth', 'pointRadius', 'layerOpacity', 'markerShape', 'lineDash'] as const).some((k) => store.style[k] !== DEFAULT_LAYER_STYLE[k])
  )
  // The single symbol, as the map draws it, for the row shown when nothing varies.
  const legendSymbols = $derived(classSymbols(store.style, store.resolvedStyle))
  // Clusters: a row per step, bubbles drawn to scale.
  const clusterRows = $derived(clusterLegendRows(store.style, store.resolvedStyle))
  const legendTitle = $derived(rendererTitle(legendRenderer))
  /** Hides or shows a legend entry: its class in every merged property. */
  function toggleEntry(toggles: Array<{ channel: ChannelId; key: string }>, visible: boolean): void {
    for (const t of toggles) {
      if (t.channel === 'color' || t.key.startsWith('size:')) store.setClassVisible(t.key, visible)
      else store.setChannelClassVisible(t.channel, t.key, visible)
    }
  }
  // Spec 008 US7: the legend as the map shows it, for the map image.
  const legendSpec = $derived.by((): LegendSpec | null => {
    if (!layer || !showLegend) return null
    const r = store.resolvedStyle
    const base = layer.geometryType === 'LineString' ? 'line' : layer.geometryType === 'Point' ? 'point' : 'area'
    const sizing = legend.some((g) => g.channels.includes('size') || g.channels.includes('width')) || !!legendProportional
    const shapeOf = (g: LegendGroup): 'line' | 'point' | 'area' =>
      g.channels.some((c) => c === 'shape' || c === 'rotation')
        ? 'point'
        : g.channels.some((c) => c === 'width' || c === 'dash')
          ? 'line'
          : g.channels.includes('size')
            ? layer.geometryType === 'Point'
              ? 'point'
              : 'line'
            : base
    const rowsOf = (g: LegendGroup) => {
      const readable = sizing && !(g.channels.includes('size') || g.channels.includes('width'))
      // Samples of a continuous property (no toggles) have no count.
      return g.entries.flatMap((e) => (e.visible ? [{ color: e.symbol.fillColor, label: e.label, ...(e.toggles.length ? { count: e.count } : {}), symbol: readable ? { ...e.symbol, lineWidth: Math.max(e.symbol.lineWidth, 3), radius: Math.max(e.symbol.radius, 5) } : e.symbol }] : []))
    }
    // A continuous or as-is color is a group of its own (its bar or note), not the layer's classes.
    const colorGroup = legend[0]?.channels[0] === 'color' && !legend[0].gradient && !legend[0].note ? legend[0] : null
    const others = colorGroup ? legend.slice(1) : legend
    return {
      title: r.status === 'fallback' ? `${legendTitle} · not available` : r.caption || (fileName ?? 'Layer'),
      shape: colorGroup ? shapeOf(colorGroup) : base,
      alpha: store.style.fillOpacity * (store.style.layerOpacity ?? 1),
      rows: r.clusters && r.status === 'ok'
        ? [...clusterRows, { color: r.classes[0].color, label: r.classes[0].label, symbol: legendSymbols[0] }]
        : r.heat || r.grid ? [] : colorGroup ? rowsOf(colorGroup) : others.length || legendProportional ? [] : r.classes.map((c, i) => ({ color: c.color, label: c.label, symbol: legendSymbols[i] })),
      // A heatmap: its ramp.
      gradient: r.heat && r.status === 'ok' ? r.heat.colors : undefined,
      // Spec 009 US6: the bivariate square.
      bivariate: r.grid && r.status === 'ok'
        ? {
            x: r.grid.x.column,
            y: r.grid.y.column,
            nx: r.grid.x.ranges.length,
            ny: r.grid.y.ranges.length,
            cells: r.classes.filter((c) => c.kind === 'cell').map((c) => ({ color: c.color, visible: c.visible })),
            noValue: r.classes.filter((c) => c.kind === 'noValue').map((c) => ({ color: c.color, label: c.label, count: c.count, visible: c.visible }))[0],
          }
        : undefined,
      // Spec 011: the other groups (merged where they share classes), then proportional sizes.
      groups: [
        ...others.map((g) => ({
          title: g.title,
          shape: shapeOf(g),
          alpha: store.style.fillOpacity * (store.style.layerOpacity ?? 1),
          rows: rowsOf(g),
          ...(g.gradient ? { ramp: { colors: g.gradient.stops, min: g.gradient.min, max: g.gradient.max } } : {}),
          ...(g.note ? { note: g.note } : {}),
        })),
        ...(legendProportional
          ? [
              {
                title: legendProportional.channel.caption,
                shape: layer.geometryType === 'Point' ? ('point' as const) : ('line' as const),
                alpha: store.style.fillOpacity * (store.style.layerOpacity ?? 1),
                rows: [
                  ...(legendProportional.channel.samples ?? []).map((x, i) => ({ color: store.style.fillColor, label: x.label, symbol: legendProportional.symbols[i] })),
                  ...legendProportional.channel.classes.flatMap((c, i) =>
                    c.visible ? [{ color: c.color, label: c.label, count: c.count, symbol: legendProportional.symbols[(legendProportional.channel.samples?.length ?? 0) + i] }] : []
                  ),
                ],
              },
            ]
          : []),
      ],
    }
  })
  const loading = $derived(session.loadState === 'loading')

  // --- Bottom panel ------------------------------------------------------------
  const MIN_FRACTION = 0.15
  const MAX_FRACTION = 0.85
  const TAB_BAR_H = 35
  const COLLAPSE_BELOW_PX = TAB_BAR_H + 36
  const NARROW_PX = 720

  let dragging = $state(false)
  let mainHeight = $state(0)
  let layoutWidth = $state(0)
  let main = $state<HTMLDivElement>()
  /** Not remembered: a maximized panel is a moment's need. */
  let maximized = $state(false)
  let queryPanel = $state<QueryPanel>()
  let exportButton = $state<HTMLButtonElement>()
  let columnsOpen = $state(false)
  let galleryOpen = $state(false)
  /** Spec 012: the gallery opens searching for what the Basemap panel's search holds. */
  let galleryQuery = $state('')
  /** The feature card was closed (× or Escape); the next selection opens it again. */
  let inspectorClosed = $state(false)
  /** The search box's width (it fits its placeholder); the feature card under it matches. */
  let searchWidth = $state(0)

  const narrow = $derived(layoutWidth > 0 && layoutWidth < NARROW_PX)
  const bottomHeight = $derived(
    layout.bottomCollapsed ? TAB_BAR_H : maximized ? Math.max(TAB_BAR_H, mainHeight - 1) : Math.max(TAB_BAR_H, Math.round(layout.bottomFraction * mainHeight))
  )

  async function openSql(): Promise<void> {
    store.setLayout({ bottomCollapsed: false, bottomTab: 'sql', ...(layout.bottomFraction < 0.3 ? { bottomFraction: 0.38 } : {}) })
    await tick()
    queryPanel?.focusEditor()
  }

  function startDrag(e: PointerEvent): void {
    if (e.button !== 0 || !main) return
    e.preventDefault()
    const sash = e.currentTarget as HTMLElement
    const host = main
    sash.setPointerCapture(e.pointerId)
    dragging = true
    maximized = false
    const move = (ev: PointerEvent): void => {
      const rect = host.getBoundingClientRect()
      const px = rect.bottom - ev.clientY
      if (px < COLLAPSE_BELOW_PX) {
        if (!layout.bottomCollapsed) store.setLayout({ bottomCollapsed: true })
        return
      }
      store.setLayout({ bottomCollapsed: false, bottomFraction: Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, px / rect.height)) })
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
    maximized = false
    if (e.key === 'ArrowUp') store.setLayout({ bottomCollapsed: false, bottomFraction: Math.min(MAX_FRACTION, layout.bottomFraction + step) })
    else if (e.key === 'ArrowDown') {
      if (layout.bottomFraction - step < MIN_FRACTION) store.setLayout({ bottomCollapsed: true })
      else store.setLayout({ bottomFraction: layout.bottomFraction - step })
    } else if (e.key === 'Enter' || e.key === ' ') store.setLayout({ bottomCollapsed: !layout.bottomCollapsed })
    else return
    e.preventDefault()
  }

  // Spec 010: a query that returns a result shows it in the Table tab.
  let seenResult = untrack(() => store.resultSeq)
  $effect(() => {
    const seq = store.resultSeq
    if (seq === seenResult) return
    seenResult = seq
    untrack(() => store.setLayout({ bottomTab: 'table' }))
  })

  // --- Side panel ----------------------------------------------------------------
  const SIDE_TITLES: Record<SideTab, string> = { style: 'Style', labels: 'Labels', basemap: 'Basemap', controls: 'Map controls' }
  /** Spec 011 US6: what labels show, for the rail button's tooltip (null: off). */
  const labelsOn = $derived.by(() => {
    const l = store.style.labels
    if (!l?.enabled) return null
    return l.source.kind === 'column' ? l.source.column : 'expression'
  })
  /** Spec 014: map buttons in the top-left corner push the feature card over by their width (28 px + a gap). */
  const ctlLeft = $derived(groupsInCorner(store.mapControls, 'top-left').some((g) => shownControls(store.mapControls, g).length > 0) ? 36 : 0)
  const sideActive = $derived<SideTab | null>(layout.sideOpen ? layout.sideTab : null)

  function selectSide(panel: SideTab | null): void {
    if (panel === null) store.setLayout({ sideOpen: false })
    else store.setLayout({ sideOpen: true, sideTab: panel })
  }

  /** Closes the side panel and returns focus to its rail button (Escape or the close button). */
  function closeSide(): void {
    const tab = layout.sideTab
    store.setLayout({ sideOpen: false })
    void tick().then(() => document.querySelector<HTMLElement>(`.rail [data-rail="${tab}"]`)?.focus())
  }

  /**
   * A selection shows its attributes in the card on the map, whatever the side
   * panel shows (user decision 2026-10-14: it replaced spec 010's Details panel).
   */
  function revealDetails(): void {
    inspectorClosed = false
  }

  // The inspector shows the selected feature from wherever it is: its full
  // record (fetched in tiles mode), the features in memory (spec 010), or one
  // fetched by id (FR-008).
  const inspected = $derived.by(() => {
    const id = session.selectedFeatureId
    if (!layer || id === null) return null
    if (store.detailFeature?.id === id) return store.detailFeature
    return store.drawnFeature(id) ?? (store.outsideFeature?.id === id ? store.outsideFeature : null)
  })

  function handleMapSelect(id: string | number | null, additive = false): void {
    store.selectFeature(id)
    // Spec 008 FR-012: a click selects that row; Ctrl/Cmd-click adds it to (or removes it from) the selection.
    if (typeof id === 'number' || id === null) store.selectOnMap(id, additive)
    if (id !== null) revealDetails()
  }

  function handleWindowKeydown(e: KeyboardEvent): void {
    // Ctrl/Cmd+Shift+Q opens the SQL tab and focuses the editor (spec 002).
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Q' || e.key === 'q')) {
      e.preventDefault()
      void openSql()
    }
  }

  const nf = new Intl.NumberFormat()
  let countLabel = $derived.by(() => {
    if (loading) return 'Loading…'
    if (!layer) return ''
    // PMTiles (spec 007 US5): the archive's feature count, from its metadata.
    if (layer.facts?.readMode === 'tiles') return `${nf.format(layer.featureCount)} features in tiles`
    if (layer.truncated) return `Showing ${nf.format(layer.rowCount)} of ${nf.format(layer.totalRows)} rows`
    // Rows with invalid geometry are listed but not drawn (spec 002 amendment).
    if (layer.rowCount !== layer.featureCount) return `${nf.format(layer.rowCount)} rows · ${nf.format(layer.featureCount)} mapped`
    return `${nf.format(layer.featureCount)} ${layer.featureCount === 1 ? 'feature' : 'features'}`
  })
  // Spec 010 phase 9: the workspace's data files (the open one first); before the host answers, the open file.
  const queryFiles = $derived(store.workspaceFiles.length ? store.workspaceFiles : [{ path: fileName ?? 'layer', size: 0, open: true }])
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="viewer-layout" class:dragging bind:clientWidth={layoutWidth}>
  {#if loading}
    <OpenProgress phase={store.openPhase} startedAt={store.openStartedAt} facts={store.openFacts} onCancel={() => void store.cancelOpen()} />
  {/if}
  {#if store.wholeReadPrompt}
    <ReadWholeDialog sizeBytes={store.wholeReadPrompt.sizeBytes} format={store.wholeReadPrompt.format} onAnswer={(open) => store.answerWholeRead(open)} />
  {/if}
  <ErrorBanner message={session.loadState === 'error' ? (session.loadError?.message ?? 'Unknown error') : null} />
  {#if store.sourceChanged}
    <div class="changed-banner" role="status">
      <Icon name="info" />
      <span>This file changed on disk. The view shows the version that was opened.</span>
      <button type="button" onclick={() => store.reloadSource()}>Reload</button>
    </div>
  {/if}
  {#if layer}
    <LayerWarningBanner invalidGeometryCount={layer.invalidGeometryCount} />
  {/if}

  <div class="workbench">
    <div class="main" bind:this={main} bind:clientHeight={mainHeight}>
      <div class="map-pane" class:hidden={maximized && !layout.bottomCollapsed} style:--se-ctl-left="{ctlLeft}px">
        <MapView
          layer={store.mapLayer ?? layer}
          mapData={store.mapData}
          labelPoints={store.labelPoints}
          tileUrl={store.tileUrl}
          extraFeature={store.outsideFeature}
          drawLoading={store.drawLoading}
          cameraRequest={store.cameraRequest}
          onPainted={() => store.notifyPainted()}
          dimmed={store.mapDimmed}
          selectedFeatureId={session.selectedFeatureId}
          style={store.style}
          resolved={store.resolvedStyle}
          themeRevision={store.themeRevision}
          zoomRequest={store.zoomRequest}
          resizing={dragging}
          basemap={store.basemap}
          blankColor={store.blankColor}
          onBasemapFailure={(message) => store.reportBasemapFailure(message)}
          onSelectFeature={handleMapSelect}
          tickedIds={store.selection.kind === 'all-matching' ? 'all' : store.selection.ids}
          fitRequest={store.fitRequest}
          projection={store.projection}
          controls={store.mapControls}
          onToggleProjection={() => store.setProjection(store.projection === 'globe' ? 'mercator' : 'globe')}
          onCameraChange={(c, bounds) => store.setMapCamera(c, bounds)}
          onCursorMove={(c) => store.setCursor(c)}
          tiles={store.tiles}
          onInspectTileFeature={(f) => {
            store.inspectTileFeature(f)
            if (f) revealDetails()
          }}
          extruded={store.extruded}
          onCaptureReady={(capture) => store.setMapCapture(capture)}
          onExportImage={() => store.openMapImage()}
        />
        <div class="map-ov tl">
          <!-- Spec 010 phase 10: layer values and coordinates always; places when allowed. -->
          <div class="search-slot" bind:offsetWidth={searchWidth}>
            <SearchBox
              {store}
              layerName={fileName ?? 'layer'}
              onChooseFeature={(id) => {
                handleMapSelect(id)
                store.zoomToFeature(id)
              }}
            />
          </div>
          {#if store.fileLayers.length > 1}
            <!-- Spec 008 US3: the file's layers. -->
            <LayerPicker layers={store.fileLayers} active={store.activeLayer} busy={session.loadState === 'loading' || store.queryPhase === 'running'} onSwitch={(name) => void store.switchLayer(name)} />
          {/if}
        </div>
        {#if inspected && !inspectorClosed}
          <!-- The selected feature's attributes, under the search box, beside whatever panel is open. -->
          <div class="map-ov inspector-slot" style:--se-card-width={searchWidth ? `${searchWidth}px` : null}>
            <FeatureInspector feature={inspected} onZoom={() => store.zoomToFeature(inspected.id)} onClose={() => (inspectorClosed = true)} />
          </div>
        {/if}
        {#if store.mapDimmed}
          <div class="map-notice no-geometry" role="status">
            <Icon name="info" size={14} />
            <span>This result has no geometry to map. The previous layer is shown dimmed.</span>
          </div>
        {:else if store.viewNotice}
          <div class="map-notice" class:info={store.viewNotice.kind === 'info'} role="status">
            <Icon name={store.viewNotice.kind === 'info' ? 'info' : 'warning'} size={14} />
            <span>{store.viewNotice.text}</span>
            {#if store.viewNotice.dismissible}
              <button type="button" aria-label="Dismiss" onclick={() => store.dismissViewNotice()}><Icon name="close" size={14} /></button>
            {/if}
          </div>
        {:else if store.basemapNotice && sideActive !== 'basemap'}
          <div class="map-notice" role="status">
            <Icon name="warning" size={14} />
            <span>{store.basemapNotice}</span>
            <button type="button" aria-label="Dismiss" onclick={() => store.dismissBasemapNotice()}><Icon name="close" size={14} /></button>
          </div>
        {/if}
        {#if layer && showLegend}
          <MapLegend
            resolved={store.resolvedStyle}
            title={legendTitle}
            geometryType={layer.geometryType}
            collapsed={store.legendCollapsed}
            onToggleCollapsed={() => store.setLegendCollapsed(!store.legendCollapsed)}
            onToggleClass={(key, visible) => store.setClassVisible(key, visible)}
            symbols={legendSymbols}
            groups={legend}
            onToggleEntry={toggleEntry}
            proportional={legendProportional}
            {clusterRows}
          />
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
        aria-label="Resize panel"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={layout.bottomCollapsed ? 0 : Math.round(layout.bottomFraction * 100)}
        tabindex="0"
        onpointerdown={startDrag}
        onkeydown={sashKeydown}
        ondblclick={() => store.setLayout({ bottomCollapsed: !layout.bottomCollapsed })}
      >
        <span class="grip" aria-hidden="true"></span>
      </div>

      <div class="bottom" style:height="{bottomHeight}px">
        <BottomPanel
          tab={layout.bottomTab}
          onTab={(tab) => {
            store.setLayout({ bottomTab: tab, bottomCollapsed: false })
            if (tab === 'sql') void tick().then(() => queryPanel?.focusEditor())
          }}
          collapsed={layout.bottomCollapsed}
          onToggleCollapsed={() => {
            maximized = false
            store.setLayout({ bottomCollapsed: !layout.bottomCollapsed })
          }}
          {maximized}
          onToggleMaximized={() => {
            maximized = !maximized
            if (maximized) store.setLayout({ bottomCollapsed: false })
          }}
        >
          {#snippet actions()}
            {#if layer}
              <button
                type="button"
                class="export-button"
                bind:this={exportButton}
                aria-label="Export data…"
                title={store.exportDisabled ?? 'Export data… (save this result as GeoJSON, GeoParquet or CSV)'}
                disabled={!!store.exportDisabled && !store.exportOpen}
                onclick={() => store.openExport()}
              >
                <Icon name="export" size={14} /><span>Export</span>
              </button>
            {/if}
          {/snippet}
          {#snippet table()}
            <div class="drawer-header table-toolbar">
              <span class="title">Attributes</span>
              <span class="count" class:truncated={layer?.truncated}>{store.filterCounts ? `${nf.format(store.filterCounts.matching)} of ${nf.format(store.filterCounts.total)} rows` : store.filtering ? 'Filtering…' : countLabel}</span>
              {#if layer && !store.tilesOnlyReason && layer.columns.length > 0}
                <div class="columns-anchor">
                  <button
                    type="button"
                    class="tool"
                    data-column-chooser-toggle
                    aria-haspopup="dialog"
                    aria-expanded={columnsOpen}
                    onclick={() => (columnsOpen = !columnsOpen)}
                    title="Choose which columns the table shows"
                  >
                    <Icon name="columns" size={14} /><span>{store.hiddenColumns.size ? `Columns (${store.hiddenColumns.size} hidden)` : 'Columns'}</span>
                  </button>
                  {#if columnsOpen}
                    <ColumnChooser columns={layer.columns} hidden={store.hiddenColumns} onChange={(hidden) => store.setHiddenColumns(hidden)} onClose={() => (columnsOpen = false)} />
                  {/if}
                </div>
                {#if store.filters.length}
                  <button type="button" class="tool" onclick={() => store.clearFilters()}><Icon name="close" size={14} /><span>Clear filters</span></button>
                {/if}
                {#if store.selectedCount > 0}
                  <SelectionBar
                    count={store.selectedCount}
                    showSelectedOnly={store.showSelectedOnly}
                    onZoom={() => void store.zoomToSelection()}
                    onShowSelectedOnly={(on) => store.setShowSelectedOnly(on)}
                    onClear={() => store.clearSelection()}
                  />
                {/if}
              {/if}
              <span class="spacer"></span>
              <!-- A selection brings its own zoom tool, and the toolbar has no room for both. -->
              {#if layer && layer.rowCount > 0 && !store.tilesOnlyReason && store.selectedCount === 0}
                <span class="hint">Double-click a row to zoom</span>
              {/if}
            </div>
            <div class="table-body" id="attribute-drawer">
              {#if store.tilesOnlyReason}
                <UnavailableNotice text={store.tilesOnlyReason} />
              {:else}
                <AttributeTable
                  {layer}
                  {loading}
                  total={store.tableTotal}
                  revision={store.tableRevision}
                  sort={store.tableSort}
                  loadPage={(offset) => store.loadPage(offset)}
                  onSort={(s) => store.setTableSort(s)}
                  selectedFeatureId={session.selectedFeatureId}
                  onSelectFeature={(id) => {
                    store.selectFeature(id)
                    if (id !== null) revealDetails()
                  }}
                  onZoomToFeature={(id) => store.zoomToFeature(id)}
                  hiddenColumns={store.hiddenColumns}
                  filters={store.filters}
                  onFilter={(column, f) => store.setFilter(column, f)}
                  selection={store.selection}
                  onToggleSelect={(id, on) => store.toggleSelected(id, on)}
                  onSelectAll={(on) => (on ? store.selectAllMatching() : store.clearSelection())}
                />
              {/if}
            </div>
          {/snippet}
          {#snippet sql()}
            <div class="sql-body" class:narrow>
              <div class="query-col">
                <QueryPanel bind:this={queryPanel} {store} embedded collapsed={false} onToggle={() => {}} />
              </div>
              <div class="files-col">
                <WorkspaceFiles
                  files={queryFiles}
                  onInsert={(text) => queryPanel?.insertText(text)}
                  onAdd={store.canAddWorkspaceFiles ? (files) => void store.addWorkspaceFiles(files) : undefined}
                />
              </div>
            </div>
          {/snippet}
        </BottomPanel>
      </div>
    </div>

    {#if layout.sideOpen}
      <SidePanel
        title={SIDE_TITLES[layout.sideTab]}
        width={layout.sideWidth}
        overlay={narrow}
        onResize={(w) => store.setLayout({ sideWidth: w })}
        onDragging={(d) => (dragging = d)}
        onClose={closeSide}
      >
        {#if layout.sideTab === 'style'}
          {#if !layer}
            <p class="empty">Open a file to style it.</p>
          {:else if store.tilesOnlyReason}
            <UnavailableNotice text={store.tilesOnlyReason} />
          {:else}
            <LayerStylePanel
              embedded
              camera={store.mapCamera}
              style={store.style}
              resolved={store.resolvedStyle}
              layer={store.styleInput}
              geometryType={layer.geometryType}
              sidecarName={sidecarStyleFileName(fileName ?? 'layer')}
              styleSource={store.styleSource}
              styleDirty={store.styleDirty}
              canSaveSidecar={store.canSaveSidecar}
              notice={store.styleNotice}
              onChange={(patch) => store.setStyle(patch)}
              onPreview={(next) => store.previewStyle(next)}
              histogram={store.styleHistogram}
              onSave={() => void store.saveStyle()}
              onExport={(format) => void store.saveStyleAs(format)}
              onImport={() => void store.importStyle()}
              onReset={() => store.resetStyle()}
              onDismissNotice={() => store.dismissStyleNotice()}
              onClose={closeSide}
              classifyingRows={store.classifying ? (store.styleInput?.rowCount ?? null) : null}
              extrusionFlat={store.extrusionFlat}
              onSuggestScale={(column) => store.suggestExtrusionScale(column)}
              onSuggestRules={() => store.ruleSuggestions()}
            />
          {/if}
        {:else if layout.sideTab === 'labels'}
          {#if !layer}
            <p class="empty">Open a file to label it.</p>
          {:else if store.tilesOnlyReason}
            <UnavailableNotice text={store.tilesOnlyReason} />
          {:else}
            <LabelsPanel
              labels={store.style.labels}
              columns={store.styleInput?.columns ?? []}
              geometryType={layer.geometryType}
              error={store.resolvedStyle.labelError}
              onChange={(patch) => store.setStyle({ labels: setLabels(store.style, patch, store.styleInput?.columns ?? []).labels })}
            />
          {/if}
        {:else if layout.sideTab === 'controls'}
          <MapControlsPanel prefs={store.mapControls} onChange={(prefs) => store.setMapControls(prefs)} />
        {:else}
          <BasemapPicker
            activeId={store.basemap.id}
            followingTheme={store.basemapChoice === 'auto'}
            appearance={session.basemapAppearance}
            blankColor={store.blankColor}
            notice={store.basemapNotice}
            keys={store.basemapKeys}
            onChoose={(choice) => store.setBasemap(choice)}
            onChooseGallery={(id) => store.chooseGalleryBasemap(id)}
            previewUrls={(id) => store.galleryPreviewUrls(id)}
            onMore={(query) => {
              galleryQuery = query ?? ''
              galleryOpen = true
            }}
            onBlankColor={(color) => store.setBlankColor(color)}
            onClose={closeSide}
          />
        {/if}
      </SidePanel>
    {/if}
    <ActivityRail
      active={sideActive}
      disabled={{ style: store.tilesOnlyReason, labels: store.tilesOnlyReason }}
      {labelsOn}
      basemapName={store.basemap.name}
      onSelect={selectSide}
    />
  </div>
  {@render statusBar?.()}

  {#if store.mapImageOpen}
    <MapImageDialog
      {store}
      legend={legendSpec}
      onClose={() => {
        store.closeMapImage()
        void tick().then(() => document.querySelector<HTMLElement>('[aria-label="Export map image…"]')?.focus())
      }}
    />
  {/if}
  {#if galleryOpen}
    <BasemapGallery
      {store}
      initialQuery={galleryQuery}
      anchor={main}
      onClose={() => {
        galleryOpen = false
        store.cancelKeyRequest()
        void tick().then(() => document.querySelector<HTMLElement>('.more-button')?.focus())
      }}
    />
  {/if}
  {#if store.exportOpen}
    <ExportDialog
      {store}
      onClose={() => {
        store.closeExport()
        void tick().then(() => exportButton?.focus())
      }}
    />
  {/if}
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
    user-select: none;
  }
  .workbench {
    position: relative;
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .main {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .map-pane {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  /* Maximized panel: the map keeps its size state but takes no room. */
  .map-pane.hidden {
    flex: 0 0 0;
    overflow: hidden;
  }
  /* Below the search box (10 px + 30 px + 8 px), down to the bottom controls. */
  .map-ov.inspector-slot {
    position: absolute;
    top: 48px;
    left: calc(10px + var(--se-ctl-left, 0px));
    /* 8 px above the scale bar (10 px margin + 11px * 1.6 line + 1 px border), the gap under the search box. */
    bottom: calc(var(--se-map-bottom-inset, 0px) + 10px + 11px * 1.6 + 1px + 8px);
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: calc(100% - 64px);
    pointer-events: none;
  }
  .map-ov.inspector-slot > :global(*) {
    pointer-events: auto;
  }
  .search-slot {
    min-width: 0;
  }
  .map-ov.tl {
    position: absolute;
    top: 10px;
    left: 10px;
    /* Above the feature card: search results drop down over it. */
    z-index: 7;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    max-width: calc(100% - 64px);
    pointer-events: none;
  }
  .map-notice {
    position: absolute;
    left: 50%;
    top: 52px;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(560px, calc(100% - 32px));
    padding: 6px 6px 6px 10px;
    transform: translateX(-50%);
    background: var(--se-bg-elevated);
    border: 1px solid var(--se-control-border);
    border-left: 3px solid var(--se-warning);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font-size: 0.95em;
  }
  .map-notice > :global(.icon) {
    color: var(--se-warning);
  }
  .map-notice.info {
    border-left-color: var(--se-info);
  }
  .map-notice.info > :global(.icon) {
    color: var(--se-info);
  }
  .map-notice button,
  .changed-banner button {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-text-secondary);
    cursor: pointer;
  }
  .map-notice button {
    width: 22px;
    height: 22px;
    border-radius: var(--se-radius-sm);
  }
  .map-notice button:hover {
    background: var(--se-control-hover);
  }
  .changed-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 12px;
    background: color-mix(in srgb, var(--se-info) 12%, var(--se-bg-base));
    border-left: 3px solid var(--se-info);
    border-bottom: 1px solid var(--se-border);
  }
  .changed-banner > :global(.icon) {
    color: var(--se-info);
  }
  .changed-banner span {
    flex: 1;
  }
  .changed-banner button {
    height: 22px;
    padding: 0 10px;
    border-radius: var(--se-radius-sm);
    background: var(--se-button-bg);
    color: var(--se-button-fg);
    font: inherit;
  }
  .changed-banner button:hover {
    background: var(--se-button-hover);
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
  .bottom {
    flex: none;
    min-height: 0;
  }
  .drawer-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: 28px;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--se-border);
    white-space: nowrap;
    /* The column chooser opens below the toolbar: let it overflow. */
    overflow: visible;
    position: relative;
    z-index: 3;
  }
  .table-body {
    flex: 1;
    min-height: 0;
  }
  .sql-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .query-col {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .files-col {
    flex: 0 0 250px;
    min-height: 0;
    border-left: 1px solid var(--se-border);
  }
  .sql-body.narrow .files-col {
    display: none;
  }
  .columns-anchor {
    position: relative;
  }
  .tool {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .tool:hover,
  .tool[aria-expanded='true'] {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .tool:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .title {
    font: var(--se-section-title-font);
    text-transform: var(--se-section-title-transform);
    letter-spacing: var(--se-section-title-tracking);
    color: var(--se-section-title-fg);
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
    min-width: 8px;
  }
  /* The first thing to give way when the toolbar is narrow (a selection adds its own tools). */
  .hint {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--se-text-muted);
    font-size: 0.9em;
  }
  .export-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 6px;
    margin-right: 4px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: var(--se-text-secondary);
    font: inherit;
    cursor: pointer;
  }
  .export-button:hover:not(:disabled) {
    background: var(--se-control-hover);
    color: var(--se-text-primary);
  }
  .export-button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .export-button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }
  .empty {
    margin: 0;
    padding: 8px 12px;
    color: var(--se-text-secondary);
    line-height: 1.5;
  }
</style>
