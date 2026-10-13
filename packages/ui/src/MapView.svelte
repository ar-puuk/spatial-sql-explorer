<script lang="ts">
  import {
    AttributionControl,
    Map as MapLibreMap,
    ScaleControl,
    type GeoJSONSource,
    type MapGeoJSONFeature,
    type MapMouseEvent,
    type StyleSpecification,
  } from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { onMount, onDestroy, tick, untrack } from 'svelte'
  import {
    BasemapHealth,
    basemapFailureMessage,
    loadBasemapStyle,
    paintFor,
    layoutFor,
    isMarkerIconId,
    markerIconIds,
    usesMarkerIcons,
    visibilityFilter,
    type BasemapCatalogEntry,
    type BasemapStyle,
    type Feature,
    type Layer,
    type LayerStyle,
    type MapData,
    type ResolvedStyle,
    EXTRUSION_PITCH,
  } from '@spatial-explorer/core'
  import Icon from './Icon.svelte'
  import ProgressBar from './ProgressBar.svelte'
  import { drawSky, FLAT_SKY, GLOBE_SKY, globeCircle } from './globeSky.js'
  import { canvasToPng, composeMapImage, plainAttribution, type MapCapture } from './mapImage.js'
  import type { TilesArchive } from './pmtilesSource.js'
  import { drawMarkerIcon } from './markerIcon.js'
  import { ensureEngineTilesProtocol } from './engineTiles.js'

  interface Props {
    layer: Layer | null
    /** Spec 010 GeoJSON mode: every feature of the result, drawn from memory. */
    mapData: MapData | null
    /** Spec 010 tiles mode: the engine's vector tiles (`se-tiles://…/{z}/{x}/{y}`). */
    tileUrl: string | null
    /** Tiles mode: the selected feature, fetched by id, drawn as the selection overlay (FR-008). */
    extraFeature?: Feature | null
    /** The GeoJSON load takes longer than 300 ms: a thin bar on the map's top edge. */
    drawLoading?: boolean
    /** Moves the camera once per new request (test hooks). */
    cameraRequest?: { center: [number, number]; zoom: number; pitch?: number; bearing?: number; seq: number } | null
    /** The map drew the latest data (idle after setData or a new tile source). */
    onPainted?: () => void
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
    /** `additive`: Ctrl/Cmd was held (spec 008 FR-012: add to the selection). */
    onSelectFeature: (id: string | number | null, additive?: boolean) => void
    /** Spec 008 FR-012: the ticked rows, highlighted like the selected feature ('all': every drawn feature). */
    tickedIds?: ReadonlySet<number> | 'all'
    /** Spec 008 FR-013: fits the map to a WGS84 box once per new request. */
    fitRequest?: { bbox: [number, number, number, number]; seq: number } | null
    /** Spec 008 FR-023: flat (Web Mercator) or globe. */
    projection?: 'mercator' | 'globe'
    onToggleProjection?: () => void
    /** Spec 008: the camera after each move (center, zoom, pitch, bearing), and (spec 010) the WGS84 bounds. */
    onCameraChange?: (camera: { center: [number, number]; zoom: number; pitch: number; bearing: number }, bounds: [number, number, number, number]) => void
    onCursorMove: (coords: { lon: number; lat: number } | null) => void
    /** Spec 007 US5: a PMTiles archive drawn from its tiles instead of view features. */
    tiles?: TilesArchive | null
    /** A clicked PMTiles feature, for the inspector (tiles carry no table to look it up in). */
    onInspectTileFeature?: (feature: Feature | null) => void
    /** Spec 008 US6: polygons are raised (the style's extrusion applies to this layer). */
    extruded?: boolean
    /** Spec 008 US7: hands the store the map's PNG capture once the map is ready. */
    onCaptureReady?: (capture: MapCapture) => void
    /** Spec 008 US7: opens the map image dialog. */
    onExportImage?: () => void
  }
  let {
    layer,
    mapData,
    tileUrl,
    extraFeature = null,
    drawLoading = false,
    cameraRequest = null,
    onPainted,
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
    onSelectFeature,
    tickedIds = new Set<number>(),
    fitRequest = null,
    projection = 'mercator',
    onToggleProjection = () => {},
    onCameraChange = () => {},
    onCursorMove,
    tiles = null,
    onInspectTileFeature,
    extruded = false,
    onCaptureReady,
    onExportImage,
  }: Props = $props()

  let container: HTMLDivElement
  let map: MapLibreMap | null = null
  let mapReady = $state(false)

  // Spec 010: our sources and layers are `se-`; everything else in the style is the basemap.
  const SOURCE_ID = 'se-data'
  /** Tiles mode: the selected feature's geometry, fetched by id (a tile may clip it, or not hold it). */
  const SELECTION_SOURCE = 'se-selection'
  const SELECTION_HALO = 'se-selection-halo'
  const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
  // Feature ids are promoted from this property so selection/hover use
  // feature-state (no per-selection filter rebuild — GeoLibre-style perf, see
  // design-plan.md §8.2) and keep their original type: the table compares
  // `feature.id === selectedFeatureId`, so a map click must hand back the
  // same number/string the table holds, not a stringified copy.
  const ID_PROP = '__id'
  const POLYGON = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
  const LINE = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
  const POINT = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
  // Spec 010 option C: points standing in for lines and polygons too small to see.
  const DOT = ['boolean', ['get', '__se_dot'], false]
  /** A dot shows below its zoom (__se_dotz, GeoJSON mode); a tile's dots carry none and always show. */
  const DOT_SHOWN = ['any', ['!', DOT], ['<', ['zoom'], ['coalesce', ['get', '__se_dotz'], 99]]]
  const MARKER_POINT = ['all', POINT, ['!', DOT]]
  const INTERACTIVE_DEFS = ['fill', 'line', 'circle', 'marker']

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

  const LAYER_DEFS: Array<{ id: string; type: 'fill' | 'line' | 'circle' | 'fill-extrusion' | 'symbol'; filter: unknown; layout?: Record<string, unknown> }> = [
    { id: 'fill', type: 'fill', filter: POLYGON },
    // Selection halo (spec 003 FR-019): under the outline, polygons and lines.
    { id: 'halo', type: 'line', filter: ['any', POLYGON, LINE], layout: { 'line-join': 'round', 'line-cap': 'round' } },
    { id: 'fill-outline', type: 'line', filter: POLYGON, layout: { 'line-join': 'round' } },
    { id: 'line', type: 'line', filter: LINE, layout: { 'line-join': 'round', 'line-cap': 'round' } },
    { id: 'circle', type: 'circle', filter: ['all', POINT, DOT_SHOWN] },
    // Points of a shape other than the circle: icons, over a disc that shows hover and selection.
    { id: 'marker-select', type: 'circle', filter: MARKER_POINT },
    {
      id: 'marker',
      type: 'symbol',
      filter: MARKER_POINT,
      layout: { 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'viewport', 'icon-pitch-alignment': 'viewport' },
    },
    // Spec 008 US6: raised polygons, shown instead of the fill while extruded.
    { id: 'extrusion', type: 'fill-extrusion', filter: POLYGON },
  ]

  /**
   * Spec 008 US6 (research §4): while extruded, the fill-extrusion layer
   * draws the polygons; the fill stays beneath at opacity 0 so clicks and
   * `data-rendered-features` still find them (fill-extrusion can't be
   * queried without a point on the globe); outlines and halo would float
   * at ground level, so they hide.
   */
  function layerPaint(id: string, p: ReturnType<typeof paintFor>): Record<string, unknown> {
    const paint = p[id as keyof typeof p] ?? {}
    if (extruded && id === 'fill') return { ...paint, 'fill-opacity': 0 }
    return paint
  }
  function layerVisibility(id: string): 'visible' | 'none' {
    if (id === 'extrusion') return extruded && !styledTiles ? 'visible' : 'none'
    if (id === 'marker' || id === 'marker-select') return usesMarkerIcons(style) ? 'visible' : 'none'
    if (extruded && (id === 'fill-outline' || id === 'halo')) return 'none'
    return 'visible'
  }

  /**
   * The map layers drawn now: LAYER_DEFS once over the data source (GeoJSON, or the
   * engine's tiles, spec 010: source layer `data`), or (PMTiles, US5) once per archive
   * layer, as `se-<def>::<source layer>`.
   */
  let styledTiles: TilesArchive | null = null
  /** The engine tile URL the data source was built for (null: GeoJSON or PMTiles). */
  let styledTileUrl: string | null = null
  function layerInstances(): Array<{ id: string; def: (typeof LAYER_DEFS)[number]; sourceLayer?: string }> {
    if (styledTiles) return styledTiles.layers.flatMap((sourceLayer) => LAYER_DEFS.map((def) => ({ id: `se-${def.id}::${sourceLayer}`, def, sourceLayer })))
    if (styledTileUrl) return LAYER_DEFS.map((def) => ({ id: `se-${def.id}`, def, sourceLayer: 'data' }))
    return LAYER_DEFS.map((def) => ({ id: `se-${def.id}`, def }))
  }
  function interactiveLayers(): string[] {
    return layerInstances()
      .filter((l) => INTERACTIVE_DEFS.includes(l.def.id))
      .map((l) => l.id)
      .filter((id) => map?.getLayer(id))
  }

  /** Each layer's geometry filter, plus the hidden-class filter (FR-009). Shaped markers leave the circle layer only the dots. */
  function layerFilter(def: (typeof LAYER_DEFS)[number]): unknown {
    const hidden = visibilityFilter(style, resolved)
    // Shaped markers draw every point; the circle layer then draws only the dots.
    const geometry = def.id === 'circle' && usesMarkerIcons(style) ? ['all', POINT, DOT, DOT_SHOWN] : def.filter
    return hidden ? ['all', geometry, hidden] : geometry
  }

  /** A layer's layout: its fixed part, plus what follows the style (dash caps, marker icons). */
  function layerLayout(def: (typeof LAYER_DEFS)[number], layouts: ReturnType<typeof layoutFor>): Record<string, unknown> {
    // Spec 009: `icon-size` follows the size channel; without one it is back to 1 (layoutFor leaves it out).
    const defaults = def.id === 'marker' ? { 'icon-size': 1 } : {}
    return { ...(def.layout ?? {}), ...defaults, ...(layouts[def.id as keyof typeof layouts] ?? {}), visibility: layerVisibility(def.id) }
  }

  /**
   * Marker icons are made when the map first asks for one
   * (`styleimagemissing`); icons the style no longer draws are dropped.
   */
  function addMarkerIcon(m: MapLibreMap, id: string): void {
    if (m.hasImage(id)) return
    const icon = drawMarkerIcon(id)
    if (icon) m.addImage(id, icon.image, { pixelRatio: icon.pixelRatio })
  }
  function pruneMarkerIcons(m: MapLibreMap): void {
    const keep = new Set(usesMarkerIcons(style) ? markerIconIds(style, resolved) : [])
    for (const id of m.listImages()) if (isMarkerIconId(id) && !keep.has(id)) m.removeImage(id)
    for (const id of keep) addMarkerIcon(m, id)
  }

  /**
   * Spec 008: a Blank basemap paints the globe too. On the flat map the
   * container's color shows through; the globe needs a background layer,
   * or its sphere is MapLibre's default gray in every theme.
   */
  const BLANK_BG = 'basemap-blank'
  function blankBackground(): string {
    return blankColor ?? (getComputedStyle(container).getPropertyValue('--se-map-bg').trim() || '#e5e5e5')
  }

  function applyPaint(): void {
    if (!map || !mapReady) return
    if (map.getLayer(BLANK_BG)) map.setPaintProperty(BLANK_BG, 'background-color', blankBackground())
    const p = paintFor(style, resolved, selectionColor())
    const layouts = layoutFor(style, resolved)
    pruneMarkerIcons(map)
    for (const l of layerInstances()) {
      if (!map.getLayer(l.id)) continue // mid data-source switch; replaceDataSource carries the current paints
      map.setFilter(l.id, layerFilter(l.def) as Parameters<MapLibreMap['setFilter']>[1])
      // An undefined value (a solid line's dash array) goes back to the default.
      for (const [prop, value] of Object.entries(layerPaint(l.def.id, p))) {
        map.setPaintProperty(l.id, prop as Parameters<MapLibreMap['setPaintProperty']>[1], (value ?? null) as Parameters<MapLibreMap['setPaintProperty']>[2])
      }
      for (const [key, value] of Object.entries(layerLayout(l.def, layouts))) {
        const prop = key as Parameters<MapLibreMap['setLayoutProperty']>[1]
        if (map.getLayoutProperty(l.id, prop) !== value) map.setLayoutProperty(l.id, prop, value as Parameters<MapLibreMap['setLayoutProperty']>[2])
      }
    }
  }

  /** A PMTiles feature for the inspector: its properties and the archive layer it came from. */
  function tileFeature(hit: MapGeoJSONFeature): Feature {
    const attributes: Feature['attributes'] = {}
    for (const [k, v] of Object.entries(hit.properties ?? {})) attributes[k] = v as Feature['attributes'][string]
    return { id: hit.id ?? `${hit.sourceLayer}:${JSON.stringify(hit.properties)}`, geometry: null, attributes, sourceLayer: hit.sourceLayer }
  }

  /** A feature-state target on our data source (engine tiles need their source layer). */
  function stateTarget(id: string | number): { source: string; id: string | number; sourceLayer?: string } {
    return styledTileUrl ? { source: SOURCE_ID, sourceLayer: 'data', id } : { source: SOURCE_ID, id }
  }

  let hoveredId: string | number | null = null
  function setHover(id: string | number | null): void {
    if (!map || id === hoveredId || styledTiles) return
    if (hoveredId !== null) map.setFeatureState(stateTarget(hoveredId), { hover: false })
    hoveredId = id
    if (id !== null) map.setFeatureState(stateTarget(id), { hover: true })
    map.getCanvas().style.cursor = id !== null ? 'pointer' : ''
  }

  function featureId(f: MapGeoJSONFeature | undefined): string | number | null {
    const raw = f?.properties?.[ID_PROP]
    return raw === undefined || raw === null ? null : (raw as string | number)
  }

  // The data the source currently holds, so a rebuilt data source
  // (replaceDataSource) starts with it.
  let currentData: GeoJSON.FeatureCollection = EMPTY

  /** What the GeoJSON source holds: the features, then their dots (option C), which draw above them. */
  function sourceData(d: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
    const dots = (d as Partial<MapData>).dots
    return dots?.length ? { type: 'FeatureCollection', features: d.features.concat(dots) } : d
  }

  /** Our data source for the current mode: PMTiles, the engine's tiles (spec 010), or GeoJSON. */
  function dataSource(): Record<string, unknown> {
    if (styledTiles) return { type: 'vector', url: styledTiles.url }
    if (styledTileUrl) return { type: 'vector', tiles: [styledTileUrl], minzoom: 0, maxzoom: 14, promoteId: { data: ID_PROP } }
    // geojson-vt drops features under its tolerance at low zoom; their dots (option C) keep them visible.
    return { type: 'geojson', data: sourceData(currentData), promoteId: ID_PROP }
  }

  /** Our map layers (data, then the tiles-mode selection overlay), with the current paint, layout and filters. */
  function dataLayers(): Array<Record<string, unknown>> {
    const p = paintFor(style, resolved, selectionColor())
    const layouts = layoutFor(style, resolved)
    const layers: Array<Record<string, unknown>> = layerInstances().map((l) => ({
      id: l.id,
      type: l.def.type,
      source: SOURCE_ID,
      ...(l.sourceLayer !== undefined ? { 'source-layer': l.sourceLayer } : {}),
      filter: layerFilter(l.def),
      layout: layerLayout(l.def, layouts),
      paint: Object.fromEntries(Object.entries(layerPaint(l.def.id, p)).filter(([, v]) => v !== undefined)),
    }))
    layers.push({ id: SELECTION_HALO, type: 'line', source: SELECTION_SOURCE, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': selectionColor(), 'line-width': 4, 'line-opacity': 0.9 } })
    return layers
  }

  /** The selected feature's shape in tiles mode (FR-008); nothing otherwise. */
  function selectionData(): GeoJSON.FeatureCollection {
    if (!styledTileUrl || !extraFeature?.geometry) return EMPTY
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: extraFeature.geometry }] }
  }

  /**
   * Spec 010: GeoJSON, engine tiles and PMTiles need different sources: ours are
   * removed and added again (never setStyle), so the basemap stays as it is.
   */
  function replaceDataSource(): void {
    if (!map) return
    const m = map
    for (const l of m.getStyle().layers ?? []) if (l.id.startsWith('se-')) m.removeLayer(l.id)
    for (const id of [SOURCE_ID, SELECTION_SOURCE]) if (m.getSource(id)) m.removeSource(id)
    m.addSource(SOURCE_ID, dataSource() as never)
    m.addSource(SELECTION_SOURCE, { type: 'geojson', data: selectionData() })
    for (const l of dataLayers()) m.addLayer(l as never)
    hoveredId = null
    previousSelected = null
    tickedApplied = new Set()
  }

  /** A basemap's own sources and layers (blank: one background layer), plus its glyphs and sprite. */
  interface BasemapDoc {
    sources: Record<string, Record<string, unknown>>
    layers: Array<Record<string, unknown> & { id: string }>
    glyphs?: string
    sprite?: unknown
  }
  function basemapDoc(base: BasemapStyle | null, entry: BasemapCatalogEntry): BasemapDoc {
    if (!base) return { sources: {}, layers: [{ id: BLANK_BG, type: 'background', paint: { 'background-color': blankBackground() } }] }
    // The style's own camera, projection, sky, light and terrain are ignored: the view belongs
    // to the data (fit-to-extent), and the projection to the viewer (spec 008).
    const copy = JSON.parse(JSON.stringify(base)) as BasemapStyle
    const sources = copy.sources as BasemapDoc['sources']
    // Always show the catalog's attribution (CLAUDE.md "Basemaps").
    if (entry.attribution) {
      const first = Object.values(sources).find((src) => src.type === 'vector') ?? Object.values(sources)[0]
      if (first && !first.attribution) first.attribution = entry.attribution
    }
    return {
      sources,
      layers: copy.layers as BasemapDoc['layers'],
      glyphs: typeof copy.glyphs === 'string' ? copy.glyphs : undefined,
      sprite: copy.sprite,
    }
  }

  /** What the current basemap added to the style: everything that isn't ours (`se-`). */
  let basemapLayerIds: string[] = []
  let basemapSourceIds: string[] = []

  /** The map's first style: the blank basemap, then our data source and layers on top. */
  function firstStyle(entry: BasemapCatalogEntry): StyleSpecification {
    const base = basemapDoc(null, entry)
    basemapLayerIds = base.layers.map((l) => l.id)
    basemapSourceIds = []
    return {
      version: 8,
      // Spec 008: the projection belongs to the viewer; the globe's atmosphere glow (space is drawn behind the map, globeSky.ts).
      projection: { type: untrack(() => projection) },
      ...(untrack(() => projection) === 'globe' ? { sky: GLOBE_SKY } : {}),
      sources: { [SOURCE_ID]: dataSource(), [SELECTION_SOURCE]: { type: 'geojson', data: selectionData() } },
      layers: [...base.layers, ...dataLayers()],
    } as unknown as StyleSpecification
  }

  /**
   * Spec 010 (research.md S3, approach a): one swap path for every basemap change.
   * The old basemap's layers and sources are removed and the new ones added under our
   * first layer; there is no setStyle, so the data source, its tiles and feature-state
   * stay as they are, and exactly one basemap is in the style.
   */
  function swapBasemap(m: MapLibreMap, doc: BasemapDoc): void {
    for (const id of basemapLayerIds) if (m.getLayer(id)) m.removeLayer(id)
    for (const id of basemapSourceIds) if (m.getSource(id)) m.removeSource(id)
    const before = (m.getStyle().layers ?? []).find((l) => l.id.startsWith('se-'))?.id
    for (const [id, src] of Object.entries(doc.sources)) m.addSource(id, src as never)
    for (const l of doc.layers) m.addLayer(l as never, before)
    if (doc.glyphs) m.setGlyphs(doc.glyphs)
    // A raster or blank basemap keeps the previous sprite: nothing of it is drawn.
    if (doc.sprite) m.setSprite(doc.sprite as never)
    basemapLayerIds = doc.layers.map((l) => l.id)
    basemapSourceIds = Object.keys(doc.sources)
    container.dataset.basemapLayers = basemapLayerIds.join(',')
  }

  /**
   * Spec 008 (user report): on the globe, a point in space is not on the map,
   * but a query there can still return a feature near the far limb. A point
   * on the sphere survives screen -> lng/lat -> screen; one in space is
   * clamped to the horizon and comes back elsewhere (public API only).
   */
  function onSurface(p: { x: number; y: number }): boolean {
    if (untrack(() => projection) !== 'globe' || !map) return true
    const back = map.project(map.unproject([p.x, p.y]))
    return Math.hypot(back.x - p.x, back.y - p.y) < 2
  }

  function registerHandlers(): void {
    if (!map) return
    const m = map
    m.on('click', (e: MapMouseEvent) => {
      if (!onSurface(e.point)) {
        if (styledTiles) onInspectTileFeature?.(null)
        else onSelectFeature(null)
        return
      }
      if (styledTiles) {
        // PMTiles: the tile feature itself is what the inspector shows. Tile
        // features are often a pixel or two wide, so a click allows 4 px.
        const { x, y } = e.point
        const near = m.queryRenderedFeatures(
          [
            [x - 4, y - 4],
            [x + 4, y + 4],
          ],
          { layers: interactiveLayers() }
        )[0]
        onInspectTileFeature?.(near ? tileFeature(near) : null)
        return
      }
      const hit = m.queryRenderedFeatures(e.point, { layers: interactiveLayers() })[0]
      onSelectFeature(featureId(hit), e.originalEvent.ctrlKey || e.originalEvent.metaKey)
    })
    m.on('mousemove', (e: MapMouseEvent) => {
      onCursorMove({ lon: e.lngLat.lng, lat: e.lngLat.lat })
      const layers = interactiveLayers()
      const hit = layers.length && onSurface(e.point) ? m.queryRenderedFeatures(e.point, { layers })[0] : undefined
      if (styledTiles) m.getCanvas().style.cursor = hit ? 'pointer' : ''
      else setHover(featureId(hit))
    })
    m.on('moveend', () => {
      const c = m.getCenter()
      const b = m.getBounds()
      onCameraChange({ center: [c.lng, c.lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() }, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    })
    m.on('move', scheduleSky)
    // Spec 008 FR-026: "Reset view" shows while the map is tilted or rotated.
    m.on('move', () => {
      const t = Math.abs(m.getPitch()) > 0.5 || Math.abs(m.getBearing()) > 0.5
      if (t !== tilted) tilted = t
    })
    m.on('mouseout', () => onCursorMove(null))
    m.on('movestart', (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) programmaticMoveAt = performance.now()
    })

    // Tile/sprite/glyph failures after the style document itself loaded
    // (e.g. tiles blocked by CSP): degrade to blank + message (FR-016).
    // Errors from the data source are never counted.
    m.on('error', (e: { sourceId?: string; error?: { message?: string } }) => {
      if (!activeBasemap || activeBasemap.type === 'blank') return
      const fromBasemap = (e.sourceId !== undefined && !e.sourceId.startsWith('se-')) || (basemapHost !== '' && String(e.error?.message ?? '').includes(basemapHost))
      if (fromBasemap && health.recordFailure()) {
        onBasemapFailure(basemapFailureMessage(activeBasemap, 'tiles could not be loaded'))
      }
    })
    // Observable proof the data was actually drawn, not just that a canvas
    // exists: without MapLibre's worker the source never tiles and the map
    // is blank while every other check passes (a real bug in the VS Code
    // webview). Refreshed on every idle, since a basemap switch rebuilds
    // the style. Read by the VS Code test hook and the browser tests.
    m.on('idle', () => {
      // Spec 010 (scale tests): a monotonic count of settled frames, so "tiles in view are drawn" is observable.
      container.dataset.idles = String(Number(container.dataset.idles ?? 0) + 1)
      if (activeBasemap && activeBasemap.type !== 'blank' && health.settledWithoutTiles()) {
        onBasemapFailure(basemapFailureMessage(activeBasemap, 'tiles could not be loaded'))
      }
      // Only meaningful once this layer's data is set: an idle before it
      // arrives must not publish a premature "0".
      if (!layer || !dataLoaded) return
      // Test hooks only (`data-se-test-hooks` on <html>): with every small parcel drawn (option C),
      // counting 77k rendered features on each idle was the longest task while panning (1.8 s at 6x CPU).
      if (document.documentElement.dataset.seTestHooks !== undefined) {
        container.dataset.renderedFeatures = String(m.queryRenderedFeatures({ layers: interactiveLayers() }).length)
      }
      if (paintPending) {
        paintPending = false
        // Monotonic "data was drawn" counter: unlike data-rendered-features
        // (cleared when new data arrives), it never disappears (spec 007, SC-009 timing).
        container.dataset.paints = String(Number(container.dataset.paints ?? 0) + 1)
        onPainted?.()
      }
    })
    m.on('sourcedata', (e: { sourceId?: string; tile?: unknown; sourceDataType?: string }) => {
      if (e.sourceId && !e.sourceId.startsWith('se-') && e.tile) health.recordSuccess()
      // Spec 010 (tests): each (re)load of our data source, by setData or a rebuilt style; a basemap swap makes none.
      if (e.sourceId === SOURCE_ID && e.sourceDataType === 'metadata') container.dataset.sourceLoads = String(Number(container.dataset.sourceLoads ?? 0) + 1)
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
    // Raster templates hold `{s}` in the host (spec 008): match on the part after it.
    basemapHost = entry.url ? (/^https?:\/\/([^/]+)/.exec(entry.url)?.[1] ?? '').replace(/^\{s\}\./, '') : ''
    health = new BasemapHealth()
    swapBasemap(map, basemapDoc(result.style, entry))
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
    const geometry = mapData?.features.find((f) => f.id === id)?.geometry ?? (extraFeature?.id === id ? extraFeature.geometry : null)
    if (!map || !geometry) return
    const b = geometryBounds(geometry)
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
  /** When the app last moved the camera itself (no user input behind the move). */
  let programmaticMoveAt = -Infinity
  function scheduleResize(): void {
    if (!map || resizing || resizeFrame) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0
      if (!map) return
      // Spec 010: a panel opening or closing beside the map keeps what is under
      // its top-left corner in place (resize alone keeps the center, so the
      // features would slide under the cursor).
      // A view the app just set (fit, zoom to a feature, a restored link) keeps its center.
      const canvas = map.getCanvas()
      const [w0, h0] = [canvas.clientWidth, canvas.clientHeight]
      map.resize()
      const [dw, dh] = [canvas.clientWidth - w0, canvas.clientHeight - h0]
      const setByApp = map.isMoving() || performance.now() - programmaticMoveAt < 1000
      if (w0 > 0 && h0 > 0 && (dw || dh) && !setByApp) map.panBy([dw / 2, dh / 2], { animate: false })
      scheduleSky()
    })
  }

  // Spec 008 (user request): the night sky behind the globe, redrawn as the view moves.
  let skyCanvas = $state<HTMLCanvasElement>()
  let skyFrame = 0
  function scheduleSky(): void {
    if (skyFrame || !map || untrack(() => projection) !== 'globe') return
    skyFrame = requestAnimationFrame(() => {
      skyFrame = 0
      if (!map || !skyCanvas || untrack(() => projection) !== 'globe') return
      const m = map
      const c = m.getCenter()
      drawSky(skyCanvas, c, m.getBearing(), globeCircle(c, (p) => m.project(p)))
    })
  }

  // --- Spec 008 US7 (research §6): the view as a PNG ------------------------
  /** The frame, read inside a render (no preserveDrawingBuffer needed). */
  function grabFrame(m: MapLibreMap): Promise<HTMLCanvasElement> {
    return new Promise((resolve) => {
      m.once('render', () => {
        const src = m.getCanvas()
        const c = document.createElement('canvas')
        c.width = src.width
        c.height = src.height
        c.getContext('2d')?.drawImage(src, 0, 0)
        resolve(c)
      })
      m.triggerRepaint()
    })
  }
  function idle(m: MapLibreMap, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs)
      m.once('idle', () => {
        clearTimeout(t)
        resolve()
      })
      m.triggerRepaint()
    })
  }
  const captureMap: MapCapture = async ({ scale, legend }) => {
    const m = map
    if (!m) throw new Error('The map is not ready.')
    const notes: string[] = []
    const cssW = container.clientWidth
    const cssH = container.clientHeight
    const gl = (m.getCanvas().getContext('webgl2') ?? m.getCanvas().getContext('webgl')) as WebGLRenderingContext | null
    const max = gl ? Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) : 4096
    let ratio: number = scale
    if (Math.max(cssW, cssH) * ratio > max) {
      ratio = 1
      notes.push(`2× would be larger than this device can draw (${max} px): saved at 1×.`)
    }
    const previous = m.getPixelRatio()
    const background = blankBackground()
    const attribution = activeBasemap?.attribution ? plainAttribution(activeBasemap.attribution) : ''
    const sky = untrack(() => projection) === 'globe' ? (skyCanvas ?? null) : null
    try {
      if (ratio !== previous) {
        m.setPixelRatio(ratio)
        await idle(m)
      }
      const compose = (frame: HTMLCanvasElement, withAttribution: boolean) =>
        composeMapImage({ map: frame, under: sky, background, ratio, legend, attribution: withAttribution ? attribution : '' })
      try {
        const out = compose(await grabFrame(m), true)
        return { bytes: await canvasToPng(out), width: out.width, height: out.height, notes }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'SecurityError')) throw err
        // A basemap whose server doesn't allow reading its tiles taints the
        // canvas: export without it, and say so (FR-030).
        const ours = new Set([...layerInstances().map((l) => l.id), BLANK_BG])
        const hidden = (m.getStyle().layers ?? []).filter((l) => !ours.has(l.id) && m.getLayoutProperty(l.id, 'visibility') !== 'none').map((l) => l.id)
        for (const id of hidden) m.setLayoutProperty(id, 'visibility', 'none')
        try {
          const out = compose(await grabFrame(m), false)
          notes.push(`The ${activeBasemap?.name ?? ''} basemap could not be captured (its server doesn't allow it) and was left out.`.replace('The  basemap', 'The basemap'))
          return { bytes: await canvasToPng(out), width: out.width, height: out.height, notes }
        } finally {
          for (const id of hidden) m.setLayoutProperty(id, 'visibility', 'visible')
        }
      }
    } finally {
      if (m.getPixelRatio() !== previous) m.setPixelRatio(previous)
    }
  }

  let resizeObserver: ResizeObserver | null = null

  onMount(() => {
    ensureEngineTilesProtocol()
    map = new MapLibreMap({
      container,
      // Data only at first (on a blank background); the basemap effect swaps
      // in the chosen basemap under it as soon as the map is ready.
      style: firstStyle(basemap),
      center: [0, 0],
      zoom: 1,
      attributionControl: false,
      // One copy of the world: a data viewer showing a layer twice side by
      // side at low zoom reads as duplicated data.
      renderWorldCopies: false,
      trackResize: false,
      // Rotation and tilt are on while polygons are extruded (spec 008 US6).
      dragRotate: false,
      pitchWithRotate: true,
      touchPitch: false,
    })
    // Test hooks only: the tests read the style itself (spec 010: exactly one basemap in it).
    if (document.documentElement.dataset.seTestHooks !== undefined) (container as unknown as { seMap: MapLibreMap }).seMap = map
    map.touchZoomRotate.disableRotation()
    map.addControl(new ScaleControl({ unit: 'metric', maxWidth: 96 }), 'bottom-left')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    // Shaped marker icons, on demand (also after a basemap switch replaces the style's images).
    map.on('styleimagemissing', (e: { id: string }) => {
      if (map && isMarkerIconId(e.id)) addMarkerIcon(map, e.id)
    })
    map.on('load', () => {
      registerHandlers()
      mapReady = true
      onCaptureReady?.(captureMap)
    })
    resizeObserver = new ResizeObserver(scheduleResize)
    resizeObserver.observe(container)
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    if (resizeFrame) cancelAnimationFrame(resizeFrame)
    if (skyFrame) cancelAnimationFrame(skyFrame)
    map?.remove()
    map = null
  })

  // Spec 010: a new layer (file or result) fits its extent; the data arrives through mapData or tileUrl.
  let dataLoaded = false
  /** New data was set and hasn't been reported painted yet. */
  let paintPending = false
  let shownLayer: Layer | null = null
  $effect(() => {
    const current = layer
    if (!mapReady || !map) return
    if (current === shownLayer) return
    shownLayer = current
    if (!current) {
      dataLoaded = false
      currentData = EMPTY
      ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(sourceData(currentData))
      return
    }
    untrack(() => fitExtent(false))
  })

  // Which source our data needs: PMTiles, engine tiles or GeoJSON. A change rebuilds our source and layers.
  $effect(() => {
    const archive = tiles
    const url = archive ? null : tileUrl
    if (!mapReady || !map) return
    if (archive === styledTiles && url === styledTileUrl) return
    styledTiles = archive
    styledTileUrl = url
    if (url === null && !archive) currentData = untrack(() => mapData) ?? EMPTY
    replaceDataSource()
    if (archive || url) {
      // Tiles draw themselves; their first idle reports what was drawn.
      dataLoaded = true
      paintPending = true
      delete container.dataset.renderedFeatures
    }
  })

  // GeoJSON mode: the one setData per new result (spec 010: never per pan).
  $effect(() => {
    const data = mapData
    if (!mapReady || !map || data === null || tiles || tileUrl) return
    if (data === currentData) return
    currentData = data
    ;(map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(sourceData(currentData))
    hoveredId = null
    dataLoaded = true
    paintPending = true
    // Marks the rendered-feature count stale until the next idle (above).
    delete container.dataset.renderedFeatures
  })

  // Tiles mode: the selected feature's shape, fetched by id (FR-008).
  $effect(() => {
    void extraFeature
    void tileUrl
    if (!mapReady || !map) return
    ;(map.getSource(SELECTION_SOURCE) as GeoJSONSource | undefined)?.setData(untrack(() => selectionData()))
  })

  $effect(() => {
    void style.fillColor
    void style.fillOpacity
    void style.strokeColor
    void style.strokeOpacity
    void style.strokeWidth
    void style.pointRadius
    void style.layerOpacity
    void style.extrusion
    void style.markerShape
    void style.lineDash
    void style.size
    void resolved
    void themeRevision
    void blankColor
    applyPaint()
  })

  let previousSelected: string | number | null = null
  $effect(() => {
    const id = selectedFeatureId
    void layer
    if (!map || !mapReady || styledTiles) return
    if (previousSelected !== null) map.setFeatureState(stateTarget(previousSelected), { selected: false })
    if (id !== null && id !== undefined) map.setFeatureState(stateTarget(id), { selected: true })
    previousSelected = id ?? null
  })

  // Spec 008 FR-012: ticked rows share the selection highlight (feature-state
  // `ticked`). GeoJSON mode: on the features in memory. Tiles mode: only on
  // listed ids; a whole-result selection ('all') isn't highlighted there (the
  // ids aren't known without reading every row).
  let tickedApplied = new Set<string | number>()
  function applyTicked(): void {
    if (!map || !mapReady || styledTiles) return
    const ids = tickedIds
    let next: Set<string | number>
    if (styledTileUrl) next = ids === 'all' ? new Set() : new Set(ids)
    else {
      const drawn = (mapData?.features ?? []).map((f) => f.id as string | number)
      next = new Set(ids === 'all' ? drawn : drawn.filter((id) => typeof id === 'number' && ids.has(id)))
    }
    for (const id of tickedApplied) if (!next.has(id)) map.setFeatureState(stateTarget(id), { ticked: false })
    for (const id of next) if (!tickedApplied.has(id)) map.setFeatureState(stateTarget(id), { ticked: true })
    tickedApplied = next
  }
  $effect(() => {
    void tickedIds
    void mapData
    void tileUrl
    untrack(() => applyTicked())
  })

  // Spec 008 US6 (FR-026): extrusion on tilts a flat map so heights show,
  // and lets the mouse tilt and rotate (right-drag; Shift+arrows by keyboard).
  let tilted = $state(false)
  let wasExtruded = false
  $effect(() => {
    const on = extruded
    if (!map || !mapReady) return
    untrack(() => applyPaint())
    if (on) {
      map.dragRotate.enable()
      map.touchZoomRotate.enableRotation()
      if (!wasExtruded && map.getPitch() < 1) map.easeTo({ pitch: EXTRUSION_PITCH, duration: 600 })
    } else {
      map.dragRotate.disable()
      map.touchZoomRotate.disableRotation()
    }
    wasExtruded = on
  })
  function resetView(): void {
    map?.easeTo({ pitch: 0, bearing: 0, duration: 500 })
  }

  // Spec 008 FR-023: switching keeps the camera (center and zoom).
  $effect(() => {
    const type = projection
    if (!map || !mapReady) return
    if (map.getProjection()?.type !== type) map.setProjection({ type })
    map.setSky(type === 'globe' ? GLOBE_SKY : FLAT_SKY)
    if (type === 'globe') void tick().then(scheduleSky)
  })

  let appliedFit = 0
  $effect(() => {
    const req = fitRequest
    if (!req || !mapReady || !map || req.seq === appliedFit) return
    appliedFit = req.seq
    const [x0, y0, x1, y1] = req.bbox
    if (x0 === x1 && y0 === y1) map.easeTo({ center: [x0, y0], zoom: Math.max(map.getZoom(), 14), duration: 500 })
    else
      map.fitBounds(
        [
          [x0, y0],
          [x1, y1],
        ],
        { padding: 48, maxZoom: 17, duration: 500 }
      )
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

  let appliedCamera = 0
  $effect(() => {
    const req = cameraRequest
    if (!req || !mapReady || !map || req.seq === appliedCamera) return
    appliedCamera = req.seq
    map.jumpTo({ center: req.center, zoom: req.zoom, ...(req.pitch !== undefined ? { pitch: req.pitch } : {}), ...(req.bearing !== undefined ? { bearing: req.bearing } : {}) })
  })

  $effect(() => {
    // Splitter drag ended: catch up with one resize.
    if (!resizing) scheduleResize()
  })
</script>

<div class="map-view" class:space={projection === 'globe'} style:background={projection === 'globe' ? undefined : (blankColor ?? undefined)}>
  {#if projection === 'globe'}
    <canvas class="sky" bind:this={skyCanvas} aria-hidden="true"></canvas>
  {/if}
  <div class="canvas-host" class:dimmed bind:this={container}></div>
  {#if drawLoading}
    <ProgressBar label="Loading the features" />
  {/if}
  <div class="controls" role="toolbar" aria-label="Map controls">
    <div class="group">
      <button type="button" title="Zoom in" aria-label="Zoom in" onclick={() => map?.zoomIn()}><Icon name="plus" /></button>
      <button type="button" title="Zoom out" aria-label="Zoom out" onclick={() => map?.zoomOut()}><Icon name="minus" /></button>
      <button type="button" title="Zoom to layer" aria-label="Zoom to layer" disabled={!layer?.extent} onclick={() => fitExtent(true)}><Icon name="fit" /></button>
      <button
        type="button"
        title={projection === 'globe' ? 'Flat map' : 'Globe view'}
        aria-label="Globe view"
        aria-pressed={projection === 'globe'}
        class:active={projection === 'globe'}
        onclick={onToggleProjection}
      >
        <Icon name="globe" />
      </button>
      <button type="button" title="Export map image…" aria-label="Export map image…" disabled={!layer || !onExportImage} onclick={() => onExportImage?.()}><Icon name="image" /></button>
      {#if tilted}
        <!-- Spec 008 FR-026: back to flat and north-up. -->
        <button type="button" title="Reset view (flat, north up)" aria-label="Reset view" onclick={resetView}><Icon name="reset" /></button>
      {/if}
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
  /* Spec 008: deep space around the globe (fixed colors, like data colors). */
  .map-view.space {
    background: #020610;
  }
  .sky {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
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
    /* MapLibre's standard size (user request: 10 px read as unnatural). */
    font: 12px/18px var(--se-font-ui);
    backdrop-filter: var(--se-overlay-blur);
  }
  .map-view :global(.maplibregl-ctrl-attrib a) {
    color: inherit;
  }
  .map-view :global(.maplibregl-ctrl-attrib.maplibregl-compact) {
    border: 1px solid var(--se-control-border);
  }
  /* Spec 008 FR-035: MapLibre draws the compact attribution's "i" as a black
     background image, invisible on dark themes. The same glyph is painted
     here as a mask filled with the text token, so it follows light, dark and
     high contrast. */
  .map-view :global(.maplibregl-ctrl-attrib-button) {
    background-image: none;
    background-color: transparent;
  }
  .map-view :global(.maplibregl-ctrl-attrib-button)::before {
    content: '';
    position: absolute;
    inset: 0;
    background-color: var(--se-text-secondary);
    -webkit-mask: var(--se-attrib-icon) center / 24px 24px no-repeat;
    mask: var(--se-attrib-icon) center / 24px 24px no-repeat;
  }
  .map-view :global(.maplibregl-ctrl-attrib-button:hover)::before {
    background-color: var(--se-text);
  }
  .map-view :global(.maplibregl-ctrl-attrib-button:focus-visible) {
    box-shadow: none;
    outline: 1px solid var(--se-focus);
    outline-offset: 1px;
  }
  .map-view {
    --se-attrib-icon: url("data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20fill-rule%3D%22evenodd%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20d%3D%22M4%2010a6%206%200%201%200%2012%200%206%206%200%201%200-12%200m5-3a1%201%200%201%200%202%200%201%201%200%201%200-2%200m0%203a1%201%200%201%201%202%200v3a1%201%200%201%201-2%200%22%2F%3E%3C%2Fsvg%3E");
  }
  .map-view :global(.maplibregl-ctrl-scale) {
    background: var(--se-control-bg);
    border: 1px solid var(--se-text-secondary);
    border-top: 0;
    color: var(--se-text-secondary);
    font: 11px/1.6 var(--se-font-mono);
    font-variant-numeric: tabular-nums;
    padding: 0 4px;
    backdrop-filter: var(--se-overlay-blur);
  }
</style>
