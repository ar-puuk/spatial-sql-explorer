<script lang="ts">
  // Map-first viewer: the map fills the pane, the attribute table is a
  // resizable, collapsible bottom drawer (GeoLibre's drawer pattern, the
  // legacy app's drag handle — design-plan.md §5.1). No header or status bar
  // here: that's per-shell chrome (§4.3). The web shell injects its status bar
  // over the map through `mapOverlay`; VS Code uses its native status bar.
  import type { Snippet } from 'svelte'
  import { DEFAULT_LAYER_STYLE, classSymbols, rendererOf, rendererTitle, sidecarStyleFileName, sizeSymbols } from '@spatial-explorer/core'
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
  import PlaceSearch from './PlaceSearch.svelte'
  import type { LegendSpec } from './mapImage.js'
  import ReadWholeDialog from './ReadWholeDialog.svelte'
  import UnavailableNotice from './UnavailableNotice.svelte'
  import ColumnChooser from './ColumnChooser.svelte'
  import SelectionBar from './SelectionBar.svelte'
  import LayerList from './LayerList.svelte'
  import { tick } from 'svelte'
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
  // Legend (spec 003 FR-010): for thematic styles, and for a customized
  // single symbol (one row); not for the untouched default.
  const legendRenderer = $derived(rendererOf(store.style))
  const showLegend = $derived(
    legendRenderer.kind !== 'single' ||
      store.resolvedStyle.size?.status === 'ok' ||
      (['fillColor', 'strokeColor', 'fillOpacity', 'strokeOpacity', 'strokeWidth', 'pointRadius', 'layerOpacity', 'markerShape', 'lineDash'] as const).some((k) => store.style[k] !== DEFAULT_LAYER_STYLE[k])
  )
  // Each legend class's symbol, as the map draws it (shape, size, pattern, opacity).
  // Spec 009: with a size channel, color swatches are drawn at one readable width (sizes have their own group).
  const legendSymbols = $derived.by(() => {
    const symbols = classSymbols(store.style, store.resolvedStyle)
    return store.resolvedStyle.size?.status === 'ok' ? symbols.map((s) => ({ ...s, lineWidth: Math.max(s.lineWidth, 3), radius: Math.max(s.radius, 5) })) : symbols
  })
  // Spec 009: the size channel's legend group, when it draws.
  const legendSize = $derived(store.resolvedStyle.size?.status === 'ok' ? { channel: store.resolvedStyle.size, symbols: sizeSymbols(store.style, store.resolvedStyle) } : null)
  const legendTitle = $derived(rendererTitle(legendRenderer))
  // Spec 008 US7: the legend as the map shows it, for the map image.
  const legendSpec = $derived.by((): LegendSpec | null => {
    if (!layer || !showLegend) return null
    const r = store.resolvedStyle
    return {
      title: r.status === 'fallback' ? `${legendTitle} · not available` : r.caption || (fileName ?? 'Layer'),
      shape: layer.geometryType === 'LineString' ? 'line' : layer.geometryType === 'Point' ? 'point' : 'area',
      alpha: store.style.fillOpacity * (store.style.layerOpacity ?? 1),
      rows: r.classes.flatMap((c, i) => (c.visible ? [{ color: c.color, label: c.label, count: r.classes.length > 1 ? c.count : undefined, symbol: legendSymbols[i] }] : [])),
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
      // Spec 009: the size channel's group (reference sizes, then visible classes).
      groups: legendSize
        ? [
            {
              title: legendSize.channel.caption,
              shape: layer.geometryType === 'Point' ? ('point' as const) : ('line' as const),
              alpha: store.style.fillOpacity * (store.style.layerOpacity ?? 1),
              rows: [
                ...(legendSize.channel.samples ?? []).map((x, i) => ({ color: store.style.fillColor, label: x.label, symbol: legendSize.symbols[i] })),
                ...legendSize.channel.classes.flatMap((c, i) =>
                  c.visible ? [{ color: c.color, label: c.label, count: c.count, symbol: legendSize.symbols[(legendSize.channel.samples?.length ?? 0) + i] }] : []
                ),
              ],
            },
          ]
        : undefined,
    }
  })
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
  /** One map popover at a time. */
  let openPanel = $state<'style' | 'basemap' | 'search' | null>(null)
  /** Spec 010: the "More basemaps…" modal. */
  let galleryOpen = $state(false)
  let exportButton = $state<HTMLButtonElement>()
  /** Opened by a map click (FR-010); then follows the selection until closed. */
  let inspectorOpen = $state(false)

  // Spec 002: the query panel shares the drawer with the attribute table.
  // Collapsed by default (a header strip above the attributes), so spec 001's
  // view is unchanged until the user opens it (contracts/ui-query-panel.md).
  let queryOpen = $state(false)
  let queryFraction = $state(0.42)
  let drawerWidth = $state(0)
  let queryPanel = $state<QueryPanel>()
  const NARROW_PX = 720
  const narrow = $derived(drawerWidth > 0 && drawerWidth < NARROW_PX)
  const queryStripH = $derived(queryOpen ? 0 : HEADER_H)

  let drawerHeight = $derived(collapsed ? HEADER_H + queryStripH : Math.round(fraction * panesHeight))

  async function toggleQuery(open = !queryOpen): Promise<void> {
    queryOpen = open
    if (open) {
      collapsed = false
      if (fraction < 0.3) fraction = 0.38
      await tick()
      queryPanel?.focusEditor()
    }
  }

  function startColDrag(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    const sash = e.currentTarget as HTMLElement
    const drawer = sash.parentElement as HTMLElement
    sash.setPointerCapture(e.pointerId)
    dragging = true
    const move = (ev: PointerEvent): void => {
      const rect = drawer.getBoundingClientRect()
      const f = narrow ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width
      queryFraction = Math.min(0.8, Math.max(0.2, f))
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

  function colSashKeydown(e: KeyboardEvent): void {
    const step = e.shiftKey ? 0.1 : 0.03
    const less = narrow ? 'ArrowUp' : 'ArrowLeft'
    const more = narrow ? 'ArrowDown' : 'ArrowRight'
    if (e.key === less) queryFraction = Math.max(0.2, queryFraction - step)
    else if (e.key === more) queryFraction = Math.min(0.8, queryFraction + step)
    else return
    e.preventDefault()
  }
  // The inspector shows the selected feature from wherever it is: its full
  // record (fetched in tiles mode), the features in memory (spec 010), or one
  // fetched by id (FR-008).
  let inspected = $derived.by(() => {
    const id = session.selectedFeatureId
    if (!inspectorOpen || !layer || id === null) return null
    if (store.detailFeature?.id === id) return store.detailFeature
    return store.drawnFeature(id) ?? (store.outsideFeature?.id === id ? store.outsideFeature : null)
  })

  // Popovers that need a layer close when it goes away (new file, error).
  $effect(() => {
    if (!layer) {
      if (openPanel === 'style') openPanel = null
      inspectorOpen = false
    }
  })

  /**
   * Closes a map popover from the keyboard or its close button and puts focus
   * back on the map control that opened it (Constitution VII: keyboard users
   * keep their place). A map click closes popovers without moving focus.
   */
  function closePanel(): void {
    const which = openPanel
    // Only take focus back if it was in the popover (or nowhere): Esc pressed
    // while typing in the SQL editor closes the popover but must leave the
    // caret where it is.
    const active = document.activeElement
    const inPopover = !active || active === document.body || !!active.closest('.style-popover')
    openPanel = null
    if (!which || !inPopover) return
    const label = which === 'style' ? 'Layer style' : which === 'search' ? 'Search places' : 'Basemap'
    void tick().then(() => panes?.querySelector<HTMLButtonElement>(`.map-pane button[aria-label="${label}"]`)?.focus())
  }

  function handleMapSelect(id: string | number | null, additive = false): void {
    store.selectFeature(id)
    // Spec 008 FR-012: a click selects that row; Ctrl/Cmd-click adds it to (or removes it from) the selection.
    if (typeof id === 'number' || id === null) store.selectOnMap(id, additive)
    inspectorOpen = id !== null
    openPanel = null // a click on the map dismisses popovers, as in any map app
  }

  let columnsOpen = $state(false)

  function handleWindowKeydown(e: KeyboardEvent): void {
    // Ctrl/Cmd+Shift+Q opens the query panel and focuses the editor (spec 002).
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'Q' || e.key === 'q')) {
      e.preventDefault()
      void toggleQuery()
      return
    }
    // Escape closes the open popover from anywhere, not only from inside it.
    if (e.key === 'Escape' && openPanel !== null) {
      closePanel()
      e.preventDefault()
    }
  }

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
    // PMTiles (spec 007 US5): the archive's feature count, from its metadata.
    if (layer.facts?.readMode === 'tiles') return `${nf.format(layer.featureCount)} features in tiles`
    if (layer.truncated) return `Showing ${nf.format(layer.rowCount)} of ${nf.format(layer.totalRows)} rows`
    // Rows with invalid geometry are listed but not drawn (spec 002 amendment).
    if (layer.rowCount !== layer.featureCount) return `${nf.format(layer.rowCount)} rows · ${nf.format(layer.featureCount)} mapped`
    return `${nf.format(layer.featureCount)} ${layer.featureCount === 1 ? 'feature' : 'features'}`
  })
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div class="viewer-layout" class:dragging>
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

  <div class="panes" bind:this={panes} bind:clientHeight={panesHeight}>
    <div class="map-pane">
      <MapView
        layer={store.mapLayer ?? layer}
        mapData={store.mapData}
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
        {openPanel}
        onTogglePanel={(panel) => (openPanel = openPanel === panel ? null : panel)}
        onSelectFeature={handleMapSelect}
        tickedIds={store.selection.kind === 'all-matching' ? 'all' : store.selection.ids}
        fitRequest={store.fitRequest}
        projection={store.projection}
        onToggleProjection={() => store.setProjection(store.projection === 'globe' ? 'mercator' : 'globe')}
        onCameraChange={(c, bounds) => store.setMapCamera(c, bounds)}
        onCursorMove={(c) => store.setCursor(c)}
        tiles={store.tiles}
        onInspectTileFeature={(f) => {
          store.inspectTileFeature(f)
          inspectorOpen = f !== null
          openPanel = null
        }}
        styleUnavailable={store.tilesOnlyReason}
        extruded={store.extruded}
        placeSearch={store.placeSearchEnabled}
        onCaptureReady={(capture) => store.setMapCapture(capture)}
        onExportImage={() => store.openMapImage()}
      />
      {#if inspected || store.fileLayers.length > 1}
        <div class="inspector-slot">
          {#if store.fileLayers.length > 1}
            <!-- Spec 008 US3: the file's layers, with the inspector under them. -->
            <LayerList layers={store.fileLayers} active={store.activeLayer} busy={session.loadState === 'loading' || store.queryPhase === 'running'} onSwitch={(name) => void store.switchLayer(name)} />
          {/if}
          {#if inspected}
            <FeatureInspector feature={inspected} onZoom={() => store.zoomToFeature(inspected.id)} onClose={() => (inspectorOpen = false)} />
          {/if}
        </div>
      {/if}
      {#if openPanel === 'search' && store.placeSearchEnabled}
        <div class="style-popover">
          <PlaceSearch {store} onClose={closePanel} />
        </div>
      {/if}
      {#if openPanel === 'basemap'}
        <div class="style-popover">
          <BasemapPicker
            activeId={store.basemap.id}
            followingTheme={store.basemapChoice === 'auto'}
            appearance={session.basemapAppearance}
            blankColor={store.blankColor}
            notice={store.basemapNotice}
            galleryEntry={store.basemap.id.startsWith('g-') ? { id: store.basemap.id, name: store.basemap.name } : null}
            onChoose={(choice) => store.setBasemap(choice)}
            onMore={() => (galleryOpen = true)}
            onBlankColor={(color) => store.setBlankColor(color)}
            onClose={closePanel}
          />
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
      {:else if store.basemapNotice && openPanel !== 'basemap'}
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
          size={legendSize}
        />
      {/if}
      {#if openPanel === 'style' && layer}
        <div class="style-popover">
          <LayerStylePanel
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
            onClose={closePanel}
            classifyingRows={store.classifying ? (store.styleInput?.rowCount ?? null) : null}
            extrusionFlat={store.extrusionFlat}
            onSuggestScale={(column) => store.suggestExtrusionScale(column)}
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

    <div class="drawer" class:query-open={queryOpen} class:narrow style:height="{drawerHeight}px" bind:clientWidth={drawerWidth}>
      <div class="query-col" style:flex-basis={queryOpen ? `${queryFraction * 100}%` : undefined}>
        <QueryPanel bind:this={queryPanel} {store} collapsed={!queryOpen} onToggle={() => void toggleQuery()} />
      </div>
      {#if queryOpen}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          class="col-sash"
          role="separator"
          aria-orientation={narrow ? 'horizontal' : 'vertical'}
          aria-label="Resize query panel"
          aria-valuemin={20}
          aria-valuemax={80}
          aria-valuenow={Math.round(queryFraction * 100)}
          tabindex="0"
          onpointerdown={startColDrag}
          onkeydown={colSashKeydown}
        ></div>
      {/if}
      <div class="attributes-col">
        <div class="drawer-header">
          <button type="button" class="collapse" aria-expanded={!collapsed} aria-controls="attribute-drawer" onclick={() => (collapsed = !collapsed)}>
            <Icon name={collapsed ? 'chevron-up' : 'chevron-down'} size={14} />
            <span class="title">Attributes</span>
          </button>
          <span class="count" class:truncated={layer?.truncated}>{store.filterCounts ? `${nf.format(store.filterCounts.matching)} of ${nf.format(store.filterCounts.total)} rows` : store.filtering ? 'Filtering…' : countLabel}</span>
          {#if layer && !collapsed && !store.tilesOnlyReason && layer.columns.length > 0}
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
                <ColumnChooser
                  columns={layer.columns}
                  hidden={store.hiddenColumns}
                  onChange={(hidden) => store.setHiddenColumns(hidden)}
                  onClose={() => (columnsOpen = false)}
                />
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
          {#if layer && layer.rowCount > 0 && !collapsed && !store.tilesOnlyReason}
            <span class="hint">Double-click a row to zoom</span>
          {/if}
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
        </div>
        <div class="drawer-body" id="attribute-drawer" hidden={collapsed}>
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
            onSelectFeature={(id) => store.selectFeature(id)}
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
      </div>
    </div>
  </div>
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
    display: flex;
    max-height: calc(100% - 20px - var(--se-map-bottom-inset, 0px));
  }
  .inspector-slot {
    position: absolute;
    top: 10px;
    left: 10px;
    bottom: calc(var(--se-map-bottom-inset, 0px) + 34px);
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    pointer-events: none;
  }
  .inspector-slot > :global(*) {
    pointer-events: auto;
  }
  .map-notice {
    position: absolute;
    left: 50%;
    bottom: calc(var(--se-map-bottom-inset, 0px) + 12px);
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

  .drawer {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--se-bg-base);
  }
  .query-col {
    flex: none;
    height: 28px;
    min-width: 0;
  }
  .attributes-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  /* Open: query beside the attributes (stacked when narrow). */
  .drawer.query-open:not(.narrow) {
    flex-direction: row;
  }
  .drawer.query-open .query-col {
    flex: 0 0 auto;
    height: auto;
    min-height: 0;
  }
  .drawer.query-open.narrow .query-col {
    min-height: 120px;
  }
  .drawer.query-open:not(.narrow) .query-col {
    min-width: 260px;
  }
  .col-sash {
    position: relative;
    flex: none;
    z-index: 3;
    background: var(--se-border);
    outline: none;
    touch-action: none;
  }
  .drawer:not(.narrow) .col-sash {
    width: 1px;
    cursor: col-resize;
  }
  .drawer.narrow .col-sash {
    height: 1px;
    cursor: row-resize;
  }
  .col-sash::before {
    content: '';
    position: absolute;
    inset: 0 -3px;
  }
  .drawer.narrow .col-sash::before {
    inset: -3px 0;
  }
  .col-sash:hover,
  .col-sash:focus-visible {
    background: var(--se-sash-hover);
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
    /* The column chooser opens below the header: let it overflow the header. */
    overflow: visible;
    position: relative;
    z-index: 3;
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
  .export-button {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 6px;
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
  .drawer-body {
    flex: 1;
    min-height: 0;
  }
  .drawer-body[hidden] {
    display: none;
  }
</style>
