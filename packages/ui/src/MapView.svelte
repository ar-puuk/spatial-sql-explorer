<script lang="ts">
  import {
    AttributionControl,
    Map as MapLibreMap,
    ScaleControl,
    type GeoJSONSource,
    type MapGeoJSONFeature,
    type MapLayerMouseEvent,
    type MapMouseEvent,
    type StyleSpecification,
  } from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { onMount, onDestroy, untrack } from 'svelte'
  import {
    BasemapHealth,
    loadBasemapStyle,
    paintFor,
    visibilityFilter,
    type BasemapCatalogEntry,
    type BasemapStyle,
    type Layer,
    type LayerStyle,
    type ResolvedStyle,
  } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  interface Props {
    layer: Layer | null
    selectedFeatureId: string | number | null
    style: LayerStyle
    /** The style resolved against the displayed result (spec 003): drives paint and filters. */
    resolved: ResolvedStyle
    /** Bumps on host theme change; canvas colors are re-read from CSS tokens. */
    themeRevision: number
    zoomRequest: { id: string | number; seq: number } | null
    /** True while a splitter is being dragged: resizes are deferred to the end of the drag. */
    resizing: boolean
    basemap: BasemapCatalogEntry
    /** Blank background color chosen by the user; null = the theme's --se-map-bg. */
    blankColor: string | null
    /** Spec 002 FR-006: a table-only result keeps the last layer visible, dimmed. */
    dimmed?: boolean
    onBasemapFailure: (message: string) => void
    openPanel: 'style' | 'basemap' | null
    onTogglePanel: (panel: 'style' | 'basemap') => void
    onSelectFeature: (id: string | number | null) => void
    onCursorMove: (coords: { lon: number; lat: number } | null) => void
  }
  let {
    layer,
    selectedFeatureId,
    style,
    resolved,
    themeRevision,
    zoomRequest,
    resizing,
    basemap,
    blankColor,
    dimmed = false,
    onBasemapFailure,
    openPanel,
    onTogglePanel,
    onSelectFeature,
    onCursorMove,
  }: Props = $props()

  let container: HTMLDivElement
  let map: MapLibreMap | null = null
  let mapReady = $state(false)

  const SOURCE_ID = 'layer-source'
  // Feature ids are promoted from this property so selection/hover use
  // feature-state (no per-selection filter rebuild — GeoLibre-style perf, see
  // design-plan.md §8.2) and keep their original type: the table compares
  // `feature.id === selectedFeatureId`, so a map click must hand back the
  // same number/string the table holds, not a stringified copy.
  const ID_PROP = '__id'
  const POLYGON = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
  const LINE = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
  const POINT = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
  const INTERACTIVE_LAYERS = ['fill', 'line', 'circle']

  /**
   * Canvas colors cannot use CSS variables (CLAUDE.md), so the selection
   * color is read from the `--se-map-selection` token at paint time and
   * re-applied whenever the host theme changes. Data colors (the layer
   * style) are deliberately theme-independent. Paint itself is built in core
   * (spec 003: `paintFor`), the same for single and thematic styles.
   */
  function selectionColor(): string {
    return getComputedStyle(container).getPropertyValue('--se-map-selection').trim() || '#f59e0b'
  }

  const LAYER_DEFS: Array<{ id: string; type: 'fill' | 'line' | 'circle'; filter: unknown; layout?: Record<string, unknown> }> = [
    { id: 'fill', type: 'fill', filter: POLYGON },
    // Selection halo (spec 003 FR-019): under the outline, polygons and lines.
    { id: 'halo', type: 'line', filter: ['any', POLYGON, LINE], layout: { 'line-join': 'round', 'line-cap': 'round' } },
    { id: 'fill-outline', type: 'line', filter: POLYGON, layout: { 'line-join': 'round' } },
    { id: 'line', type: 'line', filter: LINE, layout: { 'line-join': 'round', 'line-cap': 'round' } },
    { id: 'circle', type: 'circle', filter: POINT },
  ]

  function toFeatureCollection(l: Layer): GeoJSON.FeatureCollection {
    // Svelte 5's $state wraps Layer (and its nested features/geometry) in
    // reactive Proxy objects (structuredClone refuses to clone them
    // directly: "could not be cloned", confirmed via Playwright). Passing a
    // geometry Proxy straight into maplibre-gl's worker-update serializer
    // hits a real MapLibre bug: its generic serialize() walk re-visits the
    // proxied object's underlying target through proxy traps and
    // double-counts its transferables, throwing "DataCloneError: ArrayBuffer
    // at index N is a duplicate of an earlier ArrayBuffer". A JSON round-trip
    // (proxies support JSON.stringify's traps fine, unlike structuredClone)
    // yields plain, non-proxied objects before they ever reach MapLibre.
    return JSON.parse(
      JSON.stringify({
        type: 'FeatureCollection',
        features: l.features
          .filter((f) => f.geometry !== null)
          .map((f) => ({
            type: 'Feature',
            properties: { ...f.attributes, [ID_PROP]: f.id },
            geometry: f.geometry as GeoJSON.Geometry,
          })),
      })
    ) as GeoJSON.FeatureCollection
  }

  /** Each layer's geometry filter, plus the hidden-class filter (FR-009). */
  function layerFilter(def: (typeof LAYER_DEFS)[number]): unknown {
    const hidden = visibilityFilter(style, resolved)
    return hidden ? ['all', def.filter, hidden] : def.filter
  }

  function applyPaint(): void {
    if (!map || !mapReady) return
    const p = paintFor(style, resolved, selectionColor())
    for (const def of LAYER_DEFS) {
      if (map.getLayer(def.id)) map.setFilter(def.id, layerFilter(def) as Parameters<MapLibreMap['setFilter']>[1])
    }
    for (const [layerId, props] of Object.entries(p)) {
      if (!map.getLayer(layerId)) continue // mid basemap switch; buildStyle carries the current paints
      for (const [prop, value] of Object.entries(props)) {
        map.setPaintProperty(layerId, prop as Parameters<MapLibreMap['setPaintProperty']>[1], value as Parameters<MapLibreMap['setPaintProperty']>[2])
      }
    }
  }

  let hoveredId: string | number | null = null
  function setHover(id: string | number | null): void {
    if (!map || id === hoveredId) return
    if (hoveredId !== null) map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false })
    hoveredId = id
    if (id !== null) map.setFeatureState({ source: SOURCE_ID, id }, { hover: true })
    map.getCanvas().style.cursor = id !== null ? 'pointer' : ''
  }

  function featureId(f: MapGeoJSONFeature | undefined): string | number | null {
    const raw = f?.properties?.[ID_PROP]
    return raw === undefined || raw === null ? null : (raw as string | number)
  }

  // The data the source currently holds, so a basemap switch (which
  // replaces the whole style) can carry it over without a reload.
  let currentData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

  /**
   * One MapLibre style = the basemap's own style (nothing, for blank) + our
   * data source and layers on top, so basemap labels sit under the data.
   */
  function buildStyle(base: BasemapStyle | null, entry: BasemapCatalogEntry): StyleSpecification {
    const doc = (base ? JSON.parse(JSON.stringify(base)) : { version: 8, sources: {}, layers: [] }) as StyleSpecification & {
      sources: Record<string, Record<string, unknown>>
    }
    // A basemap style's own camera (OpenFreeMap styles ship `center`/`zoom`)
    // must never move the map: the view belongs to the data (fit-to-extent),
    // and switching basemaps keeps wherever the user is.
    const camera = doc as unknown as Record<string, unknown>
    for (const key of ['center', 'zoom', 'bearing', 'pitch', 'roll']) delete camera[key]
    // Always show the catalog's attribution (CLAUDE.md "Basemaps").
    if (base && entry.attribution) {
      const first = Object.values(doc.sources).find((src) => src.type === 'vector') ?? Object.values(doc.sources)[0]
      if (first && !first.attribution) first.attribution = entry.attribution
    }
    doc.sources[SOURCE_ID] = { type: 'geojson', data: currentData, promoteId: ID_PROP }
    const p = paintFor(style, resolved, selectionColor())
    for (const def of LAYER_DEFS) {
      doc.layers.push({ id: def.id, type: def.type, source: SOURCE_ID, filter: layerFilter(def), layout: def.layout ?? {}, paint: p[def.id as keyof typeof p] } as never)
    }
    return doc
  }

  function registerHandlers(): void {
    if (!map) return
    const m = map
    m.on('click', (e: MapMouseEvent) => {
      const hit = m.queryRenderedFeatures(e.point, { layers: INTERACTIVE_LAYERS })[0]
      onSelectFeature(featureId(hit))
    })
    for (const id of INTERACTIVE_LAYERS) {
      m.on('mousemove', id, (e: MapLayerMouseEvent) => setHover(featureId(e.features?.[0])))
      m.on('mouseleave', id, () => setHover(null))
    }
    m.on('mousemove', (e: MapMouseEvent) => onCursorMove({ lon: e.lngLat.lng, lat: e.lngLat.lat }))
    m.on('mouseout', () => onCursorMove(null))

    // Tile/sprite/glyph failures after the style document itself loaded
    // (e.g. tiles blocked by CSP): degrade to blank + message (FR-016).
    // Errors from the data source are never counted.
    m.on('error', (e: { sourceId?: string; error?: { message?: string } }) => {
      if (!activeBasemap || activeBasemap.type === 'blank') return
      const fromBasemap = (e.sourceId !== undefined && e.sourceId !== SOURCE_ID) || (basemapHost !== '' && String(e.error?.message ?? '').includes(basemapHost))
      if (fromBasemap && health.recordFailure()) {
        onBasemapFailure(`${activeBasemap.name} basemap unavailable (tiles could not be loaded). Showing a blank background.`)
      }
    })
    // Observable proof the data was actually drawn, not just that a canvas
    // exists: without MapLibre's worker the source never tiles and the map
    // is blank while every other check passes (a real bug in the VS Code
    // webview). Refreshed on every idle, since a basemap switch rebuilds
    // the style. Read by the VS Code test hook and the browser tests.
    m.on('idle', () => {
      // Only meaningful once a layer is loaded: an idle before the data
      // arrives must not publish a premature "0".
      if (!layer) return
      container.dataset.renderedFeatures = String(m.queryRenderedFeatures({ layers: INTERACTIVE_LAYERS }).length)
    })
    m.on('sourcedata', (e: { sourceId?: string; tile?: unknown }) => {
      if (e.sourceId !== SOURCE_ID && e.tile) health.recordSuccess()
    })
  }

  let activeBasemap: BasemapCatalogEntry | null = null
  let basemapHost = ''
  let health = new BasemapHealth()
  let basemapRequest = 0

  async function applyBasemap(entry: BasemapCatalogEntry): Promise<void> {
    const request = ++basemapRequest
    const result = await loadBasemapStyle(entry)
    if (request !== basemapRequest || !map) return // superseded by a newer choice
    if (!result.ok) {
      onBasemapFailure(result.message) // the store falls back to blank, which comes back through here
      return
    }
    activeBasemap = entry
    basemapHost = entry.url ? new URL(entry.url).host : ''
    health = new BasemapHealth()
    const m = map
    m.setStyle(buildStyle(result.style, entry), { diff: false })
    m.once('style.load', () => {
      // A new style is a new source: restore the state that lived on the old one.
      hoveredId = null
      if (selectedFeatureId !== null && selectedFeatureId !== undefined) m.setFeatureState({ source: SOURCE_ID, id: selectedFeatureId }, { selected: true })
      previousSelected = selectedFeatureId ?? null
    })
  }

  function fitExtent(animate: boolean): void {
    // Renders a correct, empty map (no error, no crash) when
    // Layer.featureCount === 0 (FR-012) — extent is null, so we just keep
    // the default view instead of calling fitBounds.
    if (!map || !layer?.extent) return
    // Measure first: with trackResize off, the canvas can still have the
    // size it had before the layout settled, and fitBounds would fit the
    // extent into that stale (smaller) viewport, leaving the layer small
    // and off-center.
    map.resize()
    const [minX, minY, maxX, maxY] = layer.extent
    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 32, maxZoom: 16, animate, duration: animate ? 500 : 0 }
    )
  }

  function geometryBounds(g: GeoJSON.Geometry): [number, number, number, number] | null {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const visit = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') {
        minX = Math.min(minX, c[0] as number)
        maxX = Math.max(maxX, c[0] as number)
        minY = Math.min(minY, c[1] as number)
        maxY = Math.max(maxY, c[1] as number)
      } else if (Array.isArray(c)) c.forEach(visit)
    }
    if (g.type === 'GeometryCollection') g.geometries.forEach((sub) => visit('coordinates' in sub ? sub.coordinates : []))
    else visit(g.coordinates)
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null
  }

  function zoomToFeature(id: string | number): void {
    const feature = layer?.features.find((f) => f.id === id)
    if (!map || !feature?.geometry) return
    const b = geometryBounds(feature.geometry)
    if (!b) return
    if (b[0] === b[2] && b[1] === b[3]) {
      map.easeTo({ center: [b[0], b[1]], zoom: Math.max(map.getZoom(), 14), duration: 500 })
    } else {
      map.fitBounds(
        [
          [b[0], b[1]],
          [b[2], b[3]],
        ],
        { padding: 48, maxZoom: 17, duration: 500 }
      )
    }
  }

  // Own the resize instead of MapLibre's window-only listener: the map sits
  // in a resizable split, and its container changes size without the window
  // doing so (GeoLibre map-resize.ts; their post-launch fixes #2173/#2201).
  // One resize per animation frame, and none mid-drag.
  let resizeFrame = 0
  function scheduleResize(): void {
    if (!map || resizing || resizeFrame) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      map?.resize()
    })
  }

  let resizeObserver: ResizeObserver | null = null

  onMount(() => {
    map = new MapLibreMap({
      container,
      // Data only at first; the basemap effect swaps in the basemap style
      // (with the data on top) as soon as the map is ready.
      style: buildStyle(null, basemap),
      center: [0, 0],
      zoom: 1,
      attributionControl: false,
      // One copy of the world: a data viewer showing a layer twice side by
      // side at low zoom reads as duplicated data.
      renderWorldCopies: false,
      trackResize: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 96 }), 'bottom-left')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    map.on('load', () => {
      registerHandlers()
      mapReady = true
    })
    resizeObserver = new ResizeObserver(scheduleResize)
    resizeObserver.observe(container)
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    if (resizeFrame) cancelAnimationFrame(resizeFrame)
    map?.remove()
    map = null
  })

  // The only place source.setData() is called: the layer may arrive before
  // or after the map's style has loaded, so this waits for both.
  $effect(() => {
    const current = layer
    if (!mapReady || !map) return
    currentData = current ? toFeatureCollection(current) : { type: 'FeatureCollection', features: [] }
    ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(currentData)
    hoveredId = null
    fitExtent(false)
    // Marks the rendered-feature count stale until the next idle (above).
    delete container.dataset.renderedFeatures
  })

  $effect(() => {
    void style.fillColor
    void style.fillOpacity
    void style.strokeColor
    void style.strokeOpacity
    void style.strokeWidth
    void style.pointRadius
    void resolved
    void themeRevision
    applyPaint()
  })

  let previousSelected: string | number | null = null
  $effect(() => {
    const id = selectedFeatureId
    void layer
    if (!map || !mapReady) return
    if (previousSelected !== null) map.setFeatureState({ source: SOURCE_ID, id: previousSelected }, { selected: false })
    if (id !== null && id !== undefined) map.setFeatureState({ source: SOURCE_ID, id }, { selected: true })
    previousSelected = id ?? null
  })

  // Basemap choice, theme default and failure fallback all arrive here.
  let appliedBasemapId: string | null = null
  $effect(() => {
    const entry = basemap
    if (!mapReady || entry.id === appliedBasemapId) return
    appliedBasemapId = entry.id
    void applyBasemap(entry)
  })

  $effect(() => {
    const req = zoomRequest
    // Only a NEW zoom request zooms. zoomToFeature reads `layer`, and must not
    // subscribe to it: a new query result would otherwise replay the last
    // request against the new rows (found in spec 002 screenshots).
    if (req && mapReady) untrack(() => zoomToFeature(req.id))
  })

  $effect(() => {
    // Splitter drag ended: catch up with one resize.
    if (!resizing) scheduleResize()
  })
</script>

<div class="map-view" style:background={blankColor ?? undefined}>
  <div class="canvas-host" class:dimmed bind:this={container}></div>
  <div class="controls" role="toolbar" aria-label="Map controls">
    <div class="group">
      <button type="button" title="Zoom in" aria-label="Zoom in" onclick={() => map?.zoomIn()}><Icon name="plus" /></button>
      <button type="button" title="Zoom out" aria-label="Zoom out" onclick={() => map?.zoomOut()}><Icon name="minus" /></button>
      <button type="button" title="Zoom to layer" aria-label="Zoom to layer" disabled={!layer?.extent} onclick={() => fitExtent(true)}><Icon name="fit" /></button>
    </div>
    <div class="group">
      <button
        type="button"
        title="Layer style"
        aria-label="Layer style"
        aria-pressed={openPanel === 'style'}
        class:active={openPanel === 'style'}
        disabled={!layer}
        onclick={() => onTogglePanel('style')}
      >
        <Icon name="paint" />
      </button>
      <button
        type="button"
        title="Basemap: {basemap.name}"
        aria-label="Basemap"
        aria-pressed={openPanel === 'basemap'}
        class:active={openPanel === 'basemap'}
        onclick={() => onTogglePanel('basemap')}
      >
        <Icon name="layers" />
      </button>
    </div>
  </div>
</div>

<style>
  .map-view {
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--se-map-bg);
    /* A stray text selection elsewhere must not turn a map drag into a
       selection drag (GeoLibre #2734). */
    user-select: none;
  }
  .canvas-host {
    position: absolute;
    inset: 0;
    transition: opacity 0.15s;
  }
  .canvas-host.dimmed {
    opacity: 0.35;
  }
  .controls {
    position: absolute;
    top: 10px;
    right: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 5;
  }
  .group {
    display: flex;
    flex-direction: column;
    background: var(--se-control-bg);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-card);
    overflow: hidden;
    backdrop-filter: var(--se-overlay-blur);
  }
  .group button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-control-fg);
    cursor: pointer;
  }
  .group button + button {
    border-top: 1px solid var(--se-border);
  }
  .group button:hover:not(:disabled) {
    background: var(--se-control-hover);
  }
  .group button.active {
    background: var(--se-control-active-bg);
    color: var(--se-control-active-fg);
  }
  .group button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .group button:focus-visible {
    outline: 1px solid var(--se-focus);
    outline-offset: -1px;
  }

  /* MapLibre's own controls, re-skinned onto the same tokens. */
  .map-view :global(.maplibregl-ctrl-bottom-left),
  .map-view :global(.maplibregl-ctrl-bottom-right) {
    bottom: var(--se-map-bottom-inset, 0px);
  }
  .map-view :global(.maplibregl-ctrl-attrib) {
    background: var(--se-control-bg);
    color: var(--se-text-secondary);
    font: 10px/1.5 var(--se-font-ui);
    backdrop-filter: var(--se-overlay-blur);
  }
  .map-view :global(.maplibregl-ctrl-attrib a) {
    color: inherit;
  }
  .map-view :global(.maplibregl-ctrl-attrib.maplibregl-compact) {
    border: 1px solid var(--se-control-border);
  }
  .map-view :global(.maplibregl-ctrl-scale) {
    background: var(--se-control-bg);
    border: 1px solid var(--se-text-secondary);
    border-top: 0;
    color: var(--se-text-secondary);
    font: 10px/1.6 var(--se-font-mono);
    font-variant-numeric: tabular-nums;
    padding: 0 4px;
    backdrop-filter: var(--se-overlay-blur);
  }
</style>
