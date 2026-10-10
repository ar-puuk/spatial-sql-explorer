<script lang="ts">
  import {
    Map as MapLibreMap,
    ScaleControl,
    type GeoJSONSource,
    type LayerSpecification,
    type MapGeoJSONFeature,
    type MapLayerMouseEvent,
    type MapMouseEvent,
  } from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { onMount, onDestroy } from 'svelte'
  import type { Layer, LayerStyle } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'

  interface Props {
    layer: Layer | null
    selectedFeatureId: string | number | null
    style: LayerStyle
    /** Bumps on host theme change; canvas colors are re-read from CSS tokens. */
    themeRevision: number
    zoomRequest: { id: string | number; seq: number } | null
    /** True while a splitter is being dragged: resizes are deferred to the end of the drag. */
    resizing: boolean
    styleOpen: boolean
    onToggleStyle: () => void
    onSelectFeature: (id: string | number | null) => void
    onCursorMove: (coords: { lon: number; lat: number } | null) => void
  }
  let {
    layer,
    selectedFeatureId,
    style,
    themeRevision,
    zoomRequest,
    resizing,
    styleOpen,
    onToggleStyle,
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

  const selected = ['boolean', ['feature-state', 'selected'], false]
  const hovered = ['boolean', ['feature-state', 'hover'], false]

  /**
   * Canvas colors cannot use CSS variables (CLAUDE.md), so the selection
   * color is read from the `--se-map-selection` token at paint time and
   * re-applied whenever the host theme changes. Data colors (the layer
   * style) are deliberately theme-independent.
   */
  function selectionColor(): string {
    return getComputedStyle(container).getPropertyValue('--se-map-selection').trim() || '#f59e0b'
  }

  function paints(s: LayerStyle, sel: string): Record<string, Record<string, unknown>> {
    const outlineWidth = Math.max(s.strokeWidth, 1) + 1.5
    return {
      fill: {
        'fill-color': ['case', selected, sel, s.fillColor],
        'fill-opacity': ['case', selected, Math.max(s.fillOpacity, 0.6), hovered, Math.min(1, s.fillOpacity + 0.15), s.fillOpacity],
      },
      'fill-outline': {
        'line-color': ['case', selected, sel, s.strokeColor],
        'line-width': ['case', selected, outlineWidth, s.strokeWidth],
        'line-opacity': ['case', selected, 1, s.strokeOpacity],
      },
      line: {
        'line-color': ['case', selected, sel, s.strokeColor],
        'line-width': ['case', selected, outlineWidth + 1, hovered, s.strokeWidth + 1, s.strokeWidth],
        'line-opacity': ['case', selected, 1, s.strokeOpacity],
      },
      circle: {
        'circle-color': ['case', selected, sel, s.fillColor],
        'circle-opacity': ['case', selected, 1, Math.max(s.fillOpacity, 0.05)],
        'circle-radius': ['case', selected, s.pointRadius + 2, hovered, s.pointRadius + 1, s.pointRadius],
        'circle-stroke-color': ['case', selected, '#ffffff', s.strokeColor],
        'circle-stroke-width': ['case', selected, 2, s.strokeWidth],
        'circle-stroke-opacity': ['case', selected, 1, s.strokeOpacity],
      },
    }
  }

  const LAYER_DEFS: Array<{ id: string; type: 'fill' | 'line' | 'circle'; filter: unknown; layout?: Record<string, unknown> }> = [
    { id: 'fill', type: 'fill', filter: POLYGON },
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

  function applyPaint(): void {
    if (!map || !mapReady) return
    const p = paints(style, selectionColor())
    for (const [layerId, props] of Object.entries(p)) {
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

  function addLayers(): void {
    if (!map) return
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: ID_PROP })
    const p = paints(style, selectionColor())
    for (const def of LAYER_DEFS) {
      map.addLayer({ id: def.id, type: def.type, source: SOURCE_ID, filter: def.filter, layout: def.layout ?? {}, paint: p[def.id] } as unknown as LayerSpecification)
    }

    map.on('click', (e: MapMouseEvent) => {
      const hit = map!.queryRenderedFeatures(e.point, { layers: INTERACTIVE_LAYERS })[0]
      onSelectFeature(featureId(hit))
    })
    for (const id of INTERACTIVE_LAYERS) {
      map.on('mousemove', id, (e: MapLayerMouseEvent) => setHover(featureId(e.features?.[0])))
      map.on('mouseleave', id, () => setHover(null))
    }
    map.on('mousemove', (e: MapMouseEvent) => onCursorMove({ lon: e.lngLat.lng, lat: e.lngLat.lat }))
    map.on('mouseout', () => onCursorMove(null))
  }

  function fitExtent(animate: boolean): void {
    // Renders a correct, empty map (no error, no crash) when
    // Layer.featureCount === 0 (FR-012) — extent is null, so we just keep
    // the default view instead of calling fitBounds.
    if (!map || !layer?.extent) return
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
      // Blank background — a basemap is User Story 4 / Phase 6.
      style: { version: 8, sources: {}, layers: [] },
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
    map.on('load', () => {
      addLayers()
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
    ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(
      current ? toFeatureCollection(current) : { type: 'FeatureCollection', features: [] }
    )
    hoveredId = null
    fitExtent(false)
    // Observable proof the data was actually drawn, not just that a canvas
    // exists: without MapLibre's worker the source never tiles and the map
    // is blank while every other check passes (a real bug in the VS Code
    // webview). Read by the VS Code test hook (apps/vscode-ext main.ts).
    const m = map
    delete container.dataset.renderedFeatures
    m.once('idle', () => {
      container.dataset.renderedFeatures = String(m.queryRenderedFeatures({ layers: INTERACTIVE_LAYERS }).length)
    })
  })

  $effect(() => {
    void style.fillColor
    void style.fillOpacity
    void style.strokeColor
    void style.strokeOpacity
    void style.strokeWidth
    void style.pointRadius
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

  $effect(() => {
    const req = zoomRequest
    if (req && mapReady) zoomToFeature(req.id)
  })

  $effect(() => {
    // Splitter drag ended: catch up with one resize.
    if (!resizing) scheduleResize()
  })
</script>

<div class="map-view">
  <div class="canvas-host" bind:this={container}></div>
  <div class="controls" role="toolbar" aria-label="Map controls">
    <div class="group">
      <button type="button" title="Zoom in" aria-label="Zoom in" onclick={() => map?.zoomIn()}><Icon name="plus" /></button>
      <button type="button" title="Zoom out" aria-label="Zoom out" onclick={() => map?.zoomOut()}><Icon name="minus" /></button>
      <button type="button" title="Zoom to layer" aria-label="Zoom to layer" disabled={!layer?.extent} onclick={() => fitExtent(true)}><Icon name="fit" /></button>
    </div>
    <div class="group">
      <button type="button" title="Layer style" aria-label="Layer style" aria-pressed={styleOpen} class:active={styleOpen} disabled={!layer} onclick={onToggleStyle}>
        <Icon name="paint" />
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
  .map-view :global(.maplibregl-ctrl-bottom-left) {
    bottom: var(--se-map-bottom-inset, 0px);
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
