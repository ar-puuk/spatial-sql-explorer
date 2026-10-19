<script lang="ts" module>
  import type { MapControlId } from '@spatial-explorer/core'
  /** What a corner's `extra` snippet may be asked to draw: a control, or one of the two things that are not controls and show whenever they are needed (the file's layer picker, the selected feature's card). */
  export type MapExtraId = MapControlId | 'layers' | 'info'
</script>

<script lang="ts">
  import {
    AttributionControl,
    Map as MapLibreMap,
    Marker,
    LogoControl,
    ScaleControl,
    getWorkerCount,
    setWorkerCount,
    type GeoJSONSource,
    type MapGeoJSONFeature,
    type MapMouseEvent,
    type StyleSpecification,
  } from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { onMount, onDestroy, tick, untrack } from'svelte'
  import {
    BasemapHealth,
    basemapFailureMessage,
    loadBasemapStyle,
    paintFor,
    drawsHeatmap,
    drawsClusters,
    clusterPaint,
    clusterSourceOptions,
    CLUSTER_FILTER,
    layoutFor,
    isMarkerIconId,
    ARROW_ICON_ID,
    drawsArrows,
    markerIconIds,
    drawsMarkerIcons,
    layerFilters,
    labelFeatures,
    labelLayers,
    layerZoomRange,
    paintWithZoom,
    TILE_LABEL_LAYER,
    TILE_LAYER,
    visibilityFilter,
    type BasemapCatalogEntry,
    type BasemapStyle,
    type Feature,
    type Layer,
    type LayerStyle,
    type LabelPoint,
    type MapData,
    type ResolvedStyle,
    EXTRUSION_PITCH,
    DEFAULT_MAP_CONTROLS,
    shapeLabel,
    type DrawnShape,
    type ShapePurpose,
    type UnitSystem,
    formatElevation,
    TERRAIN_HILLSHADE_ID,
    hillshadePaint,
    reliefKindFor,
    TERRAIN_SOURCE_ID,
    terrainSource,
    controlsAt,
    CONTROL_GROUPS,
    MAP_CONTROLS,
    isControlOn,
    type ControlPosition,
    type ControlGroupId,
    type MapControlsPrefs,
    describeCode,
    type ColumnDomains,
    type DomainDisplay,
  } from '@spatial-explorer/core'
  import type { Snippet } from'svelte'
  import Icon, { type IconName } from './Icon.svelte'
  import type { DrawController, DrawTool } from './draw/controller.js'
  import ProgressBar from './ProgressBar.svelte'
  import Tip from './kit/Tip.svelte'
  import { Comets, drawSky, FLAT_SKY, GLOBE_SKY, globeCircle, loadSky } from './globeSky.js'
  import { plainAttribution, type MapCapture, type MapShot } from './mapImage.js'
  import type { PrintCamera } from './print/camera.js'
  import { paintAtlasMask } from './print/mask.js'
  import { clearPrintExtent, drawPrintExtent, setPrintExtentVisible, showPrintExtent } from './print/extent.js'
  import type { TilesArchive } from './pmtilesSource.js'
  import { drawArrowIcon, drawMarkerIcon } from './markerIcon.js'
  import { ensureEngineTilesProtocol } from './engineTiles.js'

  interface Props {
    layer: Layer | null
    /** Spec 010 GeoJSON mode: every feature of the result, drawn from memory. */
    mapData: MapData | null
    /** GeoJSON mode, labels on: polygons' label points for mapData (one label each), once the engine has read them. */
    labelPoints?: readonly LabelPoint[] | null
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
    /** Spec 014: which buttons show, and in which corner each group sits. */
    controls?: MapControlsPrefs
    /** The controls that live outside the map (search, legend), drawn where the user put them. */
    extra?: Snippet<[MapExtraId, ControlPosition]>
    /** Spec 014: the columns the hover tooltip shows, and (engine tiles, which carry only the style's columns) a by-id lookup of the rest. */
    tooltipColumns?: string[]
    /** Spec 013: a geodatabase layer's coded domains, and whether the tooltip shows descriptions or codes. */
    columnDomains?: ColumnDomains
    domainMode?: DomainDisplay
    /** Spec 014: 3D terrain (a DEM the map is lifted onto), and what to do when its tiles fail. */
    terrain?: { on: boolean; exaggeration: number }
    onToggleTerrain?: () => void
    onTerrainFailure?: () => void
    /** Spec 014: the open drawing tool, the finished shapes (the store owns them), and what changes them. */
    drawTool?: { purpose: ShapePurpose; tool: DrawTool } | null
    shapes?: readonly DrawnShape[]
    shapesRequest?: { seq: number; clear?: boolean; remove?: string[] } | null
    drawUnits?: UnitSystem
    onToggleDrawPurpose?: (purpose: ShapePurpose) => void
    onSetDrawTool?: (tool: DrawTool | null) => void
    onSetDrawUnits?: (units: UnitSystem) => void
    onShapes?: (shapes: DrawnShape[]) => void
    onShapeDrawn?: (shape: DrawnShape, additive: boolean) => void
    tooltipRecord?: (id: number) => Promise<Record<string, unknown> | null>
    /** Spec 008: the camera after each move (center, zoom, pitch, bearing), and (spec 010) the WGS84 bounds. */
    onCameraChange?: (camera: { center: [number, number]; zoom: number; pitch: number; bearing: number }, bounds: [number, number, number, number]) => void
    /** The zoom while the map moves, at most once a frame (the zoom marker on the style panel follows it live). */
    onZoom?: (zoom: number) => void
    onCursorMove: (coords: { lon: number; lat: number; elevation?: number | null } | null) => void
    /** Spec 007 US5: a PMTiles archive drawn from its tiles instead of view features. */
    tiles?: TilesArchive | null
    /** A clicked PMTiles feature, for the inspector (tiles carry no table to look it up in). */
    onInspectTileFeature?: (feature: Feature | null) => void
    /** Spec 008 US6: polygons are raised (the style's extrusion applies to this layer). */
    extruded?: boolean
    /** Spec 008 US7: hands the store the map's PNG capture once the map is ready. */
    onCaptureReady?: (capture: MapCapture) => void
    /** Spec 016: hands the store the print composer's view of the map. */
    onCameraReady?: (camera: PrintCamera) => void
    /** Spec 008 US7: opens the map image dialog. */
    onExportImage?: () => void
    /** Spec 017: opens the Bin into cells dialog. */
    onBinCells?: () => void
    /** Spec 022: opens the Dot density dialog; why it can't open (or null). */
    onDotDensity?: () => void
    dotUnavailable?: string | null
    /** Spec 020: opens (or closes) the time slider; whether it is open; why it can't open (or null). */
    onTimeSlider?: () => void
    timeSliderOpen?: boolean
    timeSliderUnavailable?: string | null
    /** Why Bin into cells is not available, or null. */
    binUnavailable?: string | null
  }
  let {
    layer,
    mapData,
    labelPoints = null,
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
    controls = DEFAULT_MAP_CONTROLS,
    extra,
    tooltipColumns = [],
    columnDomains = {},
    domainMode = 'descriptions',
    terrain = { on: false, exaggeration: 1 },
    onToggleTerrain = () => {},
    onTerrainFailure = () => {},
    drawTool = null,
    shapes = [],
    shapesRequest = null,
    drawUnits = 'metric',
    onToggleDrawPurpose = () => {},
    onSetDrawTool = () => {},
    onSetDrawUnits = () => {},
    onShapes = () => {},
    onShapeDrawn = () => {},
    tooltipRecord,
    onCameraChange = () => {},
    onZoom,
    onCursorMove,
    tiles = null,
    onInspectTileFeature,
    extruded = false,
    onCaptureReady,
    onCameraReady,
    onExportImage,
    onBinCells,
    onDotDensity,
    dotUnavailable = null,
    onTimeSlider,
    timeSliderOpen = false,
    timeSliderUnavailable = null,
    binUnavailable = null,
  }: Props = $props()

  let container: HTMLDivElement
  let map: MapLibreMap | null = null
  let mapReady = $state(false)

  // Spec 010: our sources and layers are `se-`; everything else in the style is the basemap.
  const SOURCE_ID ='se-data'
  /**
   * GeoJSON mode: the dots (option C) in a source of their own. MapLibre gives
   * each source its own worker, so the dots are tiled alongside the features
   * instead of after them in one source (77k parcels: 2.3 s to 1.3 s).
   */
  const DOT_SOURCE ='se-dots'
  const DOT_LAYER ='se-circle-dots'
  /** MapLibre's workers (its default is one outside Safari). */
  const MAP_WORKERS = 2
  /** Tiles mode: the selected feature's geometry, fetched by id (a tile may clip it, or not hold it). */
  /** GeoJSON mode: polygons' label points (one label each), filled only while labels are on. */
  const LABEL_SOURCE ='se-labels'
  const SELECTION_SOURCE ='se-selection'
  const SELECTION_HALO ='se-selection-halo'
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

  const LAYER_DEFS: Array<{ id: string; type: 'fill' | 'line' | 'circle' | 'fill-extrusion' |'symbol' | 'heatmap'; filter: unknown; layout?: Record<string, unknown> }> = [
    { id: 'fill', type: 'fill', filter: POLYGON },
    // Selection halo (spec 003 FR-019): under the outline, polygons and lines.
    { id: 'halo', type: 'line', filter: ['any', POLYGON, LINE], layout: { 'line-join': 'round', 'line-cap': 'round' } },
    { id: 'fill-outline', type: 'line', filter: POLYGON, layout: { 'line-join': 'round' } },
    { id: 'line', type: 'line', filter: LINE, layout: { 'line-join': 'round', 'line-cap': 'round' } },
    // Spec 019: direction arrows along the lines (not interactive: the line under them takes the hover and the click).
    { id: 'line-arrow', type:'symbol', filter: LINE },
    // A heatmap style: the points' density, under their (then hidden) circles, which keep hover and selection.
    { id: 'heatmap', type: 'heatmap', filter: MARKER_POINT },
    { id: 'circle', type: 'circle', filter: ['all', POINT, DOT_SHOWN] },
    // Points of a shape other than the circle: icons, over a disc that shows hover and selection.
    { id: 'marker-select', type: 'circle', filter: MARKER_POINT },
    {
      id: 'marker',
      type:'symbol',
      filter: MARKER_POINT,
      layout: { 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-rotation-alignment': 'viewport', 'icon-pitch-alignment': 'viewport' },
    },
    // Clusters: groups of points as bubbles, and their counts (points not in a group draw as usual).
    { id: 'cluster', type: 'circle', filter: CLUSTER_FILTER },
    { id: 'cluster-count', type:'symbol', filter: CLUSTER_FILTER },
    // Spec 008 US6: raised polygons, shown instead of the fill while extruded.
    { id: 'extrusion', type: 'fill-extrusion', filter: POLYGON },
    // Spec 011 US6: labels, above everything (on the ground in 3D: research §3); not interactive.
    { id: 'label', type:'symbol', filter: ['any', POINT, POLYGON] },
    { id: 'label-line', type:'symbol', filter: LINE },
    // Polygons' labels, over their label points (the engine's: one per feature); PMTiles have none, `label` takes them there.
    { id: 'label-area', type:'symbol', filter: true },
  ]
  const LABEL_DEFS = new Set(['label', 'label-line', 'label-area'])
  /** A label point shows while its polygon isn't a dot (__se_dotz, GeoJSON mode; tiles send none for dots). */
  const AREA_LABEL_SHOWN = ['>=', ['zoom'], ['coalesce', ['get', '__se_dotz'], 0]]

  /** Spec 011 US6: a label layer's filter, layout and paint now (null: labels off). */
  function labelSpec(id: string) {
    return labelLayers(style, resolved, !styledTiles)?.[id as 'label' | 'label-line' | 'label-area'] ?? null
  }

  /**
   * Spec 008 US6 (research §4): while extruded, the fill-extrusion layer
   * draws the polygons; the fill stays beneath at opacity 0 so clicks and
   * `data-rendered-features` still find them (fill-extrusion can't be
   * queried without a point on the globe); outlines and halo would float
   * at ground level, so they hide.
   */
  function layerPaint(id: string, p: ReturnType<typeof paintFor>): Record<string, unknown> {
    if (LABEL_DEFS.has(id)) return labelSpec(id)?.paint ?? {}
    if (id === 'cluster') return clusterPaint(style)?.bubble ?? {}
    if (id === 'cluster-count') return clusterPaint(style)?.count.paint ?? {}
    const paint = p[id as keyof typeof p] ?? {}
    // Spec 025: sizes that follow the zoom.
    if (extruded && id === 'fill') return { ...paintWithZoom(paint, style.zoom), 'fill-opacity': 0 }
    return paintWithZoom(paint, style.zoom)
  }
  function layerVisibility(id: string): 'visible' | 'none' {
    if (LABEL_DEFS.has(id)) return labelSpec(id) ? 'visible' : 'none'
    if (id === 'extrusion') return extruded && !styledTiles ? 'visible' : 'none'
    const heat = drawsHeatmap(style, resolved)
    if (id === 'heatmap') return heat ? 'visible' : 'none'
    if (id === 'line-arrow') return drawsArrows(style) ? 'visible' : 'none'
    if (id === 'cluster' || id === 'cluster-count') return drawsClusters(style, resolved) ? 'visible' : 'none'
    if (id === 'marker' || id === 'marker-select') return drawsMarkerIcons(style, resolved) && !heat ? 'visible' : 'none'
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
  function layerInstances(): Array<{ id: string; def: (typeof LAYER_DEFS)[number]; sourceLayer?: string; source?: string }> {
    if (styledTiles) return styledTiles.layers.flatMap((sourceLayer) => LAYER_DEFS.filter((def) => def.id !== 'label-area').map((def) => ({ id: `se-${def.id}::${sourceLayer}`, def, sourceLayer })))
    if (styledTileUrl) return LAYER_DEFS.map((def) => ({ id: `se-${def.id}`, def, sourceLayer: def.id === 'label-area' ? TILE_LABEL_LAYER : TILE_LAYER }))
    // GeoJSON mode: the circle layer once more, over the dots' own source; polygons' labels over theirs.
    return LAYER_DEFS.flatMap((def) =>
      def.id === 'circle'
        ? [{ id:'se-circle', def }, { id: DOT_LAYER, def, source: DOT_SOURCE }]
        : def.id === 'label-area'
          ? [{ id:'se-label-area', def, source: LABEL_SOURCE }]
          : [{ id: `se-${def.id}`, def }]
    )
  }
  function interactiveLayers(): string[] {
    return layerInstances()
      .filter((l) => INTERACTIVE_DEFS.includes(l.def.id))
      .map((l) => l.id)
      .filter((id) => map?.getLayer(id))
  }

  /**
   * Each layer's geometry filter, plus the hidden-class filter (FR-009).
   * Shaped markers leave the circle layer only the dots; with a shape by data
   * (spec 011) the circle layer also keeps the points whose shape is a circle.
   */
  function layerFilter(def: (typeof LAYER_DEFS)[number]): unknown {
    const own = baseFilter(def)
    // Clusters: groups are the bubbles' alone (a group is a point, so it would match the point layers).
    return CLUSTER_DEFS.has(def.id) || !drawsClusters(style, resolved) ? own : ['all', own, ['!', CLUSTER_FILTER]]
  }
  const CLUSTER_DEFS = new Set(['cluster', 'cluster-count'])
  function baseFilter(def: (typeof LAYER_DEFS)[number]): unknown {
    // Dots standing in for features too small to see (option C) get no label.
    if (def.id === 'label-area') return ['all', labelSpec(def.id)?.filter ?? def.filter, AREA_LABEL_SHOWN]
    if (LABEL_DEFS.has(def.id)) return ['all', labelSpec(def.id)?.filter ?? def.filter, ['!', DOT]]
    const hidden = visibilityFilter(style, resolved)
    const extra = layerFilters(style, resolved)
    const heat = drawsHeatmap(style, resolved)
    let geometry = def.filter
    if (def.id === 'circle' && !heat) {
      if (extra.circle) geometry = ['all', POINT, DOT_SHOWN, ['any', DOT, extra.circle]]
      else if (drawsMarkerIcons(style, resolved)) geometry = ['all', POINT, DOT, DOT_SHOWN]
    } else if (extra[def.id as keyof typeof extra]) geometry = ['all', def.filter, extra[def.id as keyof typeof extra]]
    return hidden ? ['all', geometry, hidden] : geometry
  }

  /** A layer's layout: its fixed part, plus what follows the style (dash caps, marker icons). */
  function layerLayout(def: (typeof LAYER_DEFS)[number], layouts: ReturnType<typeof layoutFor>): Record<string, unknown> {
    // Spec 009: `icon-size` follows the size channel; without one it is back to 1 (layoutFor leaves it out).
    const defaults = def.id === 'marker' ? { 'icon-size': 1 } : {}
    if (LABEL_DEFS.has(def.id)) return { ...(labelSpec(def.id)?.layout ?? {}), visibility: layerVisibility(def.id) }
    if (def.id === 'cluster-count') return { ...(clusterPaint(style)?.count.layout ?? {}), visibility: layerVisibility(def.id) }
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
    const ids = drawsMarkerIcons(style, resolved) ? markerIconIds(style, resolved) : []
    // Spec 011: icons built per feature (shape or outline by data) can't be listed; they stay until the style lists its icons again.
    if (drawsMarkerIcons(style, resolved) && ids.length === 0) return
    const keep = new Set(ids)
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

  /** The layer's center latitude: a heatmap radius in meters converts there unless it has its own. */
  function layerLatitude(): number {
    const e = layer?.extent
    return e ? (e[1] + e[3]) / 2 : 0
  }

  /** The paint and layout properties last set on each layer (so ones a style drops can be reset). Bookkeeping, not state. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const setProps = new Map<string, { paint: string[]; layout: string[] }>()

  /** The cluster options the GeoJSON source has (JSON), so a style change sets them only when they change. */
  let appliedClusters = ''
  function applyClusters(m: MapLibreMap): void {
    if (styledTiles || styledTileUrl) return
    const options = clusterSourceOptions(style, resolved)
    const key = JSON.stringify(options)
    const source = m.getSource(SOURCE_ID) as GeoJSONSource | undefined
    if (!source || key === appliedClusters) return
    appliedClusters = key
    void source.setClusterOptions(options)
  }

  function applyPaint(): void {
    if (!map || !mapReady) return
    applyClusters(map)
    applyLabelData(map)
    if (map.getLayer(BLANK_BG)) map.setPaintProperty(BLANK_BG, 'background-color', blankBackground())
    const p = paintFor(style, resolved, selectionColor(), layerLatitude())
    const layouts = layoutFor(style, resolved)
    pruneMarkerIcons(map)
    for (const l of layerInstances()) {
      if (!map.getLayer(l.id)) continue // mid data-source switch; replaceDataSource carries the current paints
      map.setFilter(l.id, layerFilter(l.def) as Parameters<MapLibreMap['setFilter']>[1])
      // Spec 025: the zoom range the layer shows in.
      const range = layerZoomRange(style.zoom)
      map.setLayerZoomRange(l.id, range.minzoom, range.maxzoom)
      // An undefined value (a solid line's dash array) goes back to the default.
      const paint = layerPaint(l.def.id, p)
      for (const [prop, value] of Object.entries(paint)) {
        map.setPaintProperty(l.id, prop as Parameters<MapLibreMap['setPaintProperty']>[1], (value ?? null) as Parameters<MapLibreMap['setPaintProperty']>[2])
      }
      const layout = layerLayout(l.def, layouts)
      for (const [key, value] of Object.entries(layout)) {
        const prop = key as Parameters<MapLibreMap['setLayoutProperty']>[1]
        if (map.getLayoutProperty(l.id, prop) !== value) map.setLayoutProperty(l.id, prop, value as Parameters<MapLibreMap['setLayoutProperty']>[2])
      }
      // Spec 011: properties a style no longer sets (opacity or rotation back to fixed) go back to the default.
      const before = setProps.get(l.id)
      if (before) {
        for (const prop of before.paint) if (!(prop in paint)) map.setPaintProperty(l.id, prop as Parameters<MapLibreMap['setPaintProperty']>[1], null as unknown as Parameters<MapLibreMap['setPaintProperty']>[2])
        for (const prop of before.layout) if (!(prop in layout)) map.setLayoutProperty(l.id, prop as Parameters<MapLibreMap['setLayoutProperty']>[1], undefined)
      }
      setProps.set(l.id, { paint: Object.keys(paint), layout: Object.keys(layout) })
    }
  }

  /** A PMTiles feature for the inspector: its properties and the archive layer it came from. */
  function tileFeature(hit: MapGeoJSONFeature): Feature {
    const attributes: Feature['attributes'] = {}
    for (const [k, v] of Object.entries(hit.properties ?? {})) attributes[k] = v as Feature['attributes'][string]
    return { id: hit.id ?? `${hit.sourceLayer}:${JSON.stringify(hit.properties)}`, geometry: null, attributes, sourceLayer: hit.sourceLayer }
  }

  /** A feature-state target on our data source (engine tiles need their source layer). */
  /** Hover, selection and ticks as feature-state: on the feature, and in GeoJSON mode on its dot too (same id). */
  function setState(id: string | number, state: Record<string, boolean>): void {
    if (!map) return
    if (styledTileUrl) {
      map.setFeatureState({ source: SOURCE_ID, sourceLayer: 'data', id }, state)
      return
    }
    map.setFeatureState({ source: SOURCE_ID, id }, state)
    if (map.getSource(DOT_SOURCE)) map.setFeatureState({ source: DOT_SOURCE, id }, state)
  }

  let hoveredId: string | number | null = null
  function setHover(id: string | number | null): void {
    if (!map || id === hoveredId || styledTiles) return
    if (hoveredId !== null) setState(hoveredId, { hover: false })
    hoveredId = id
    if (id !== null) setState(id, { hover: true })
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
  function dotData(d: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
    return { type: 'FeatureCollection', features: (d as Partial<MapData>).dots ?? [] }
  }

  /** GeoJSON mode: polygons' label points while labels are on (sent only then: labels off cost nothing). */
  let labelsSent: readonly LabelPoint[] | null = null
  function labelData(d: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
    labelsSent = labelSpec('label-area') && d === mapData ? labelPoints : null
    return { type: 'FeatureCollection', features: labelsSent ? labelFeatures(d.features, labelsSent) : [] }
  }

  /** GeoJSON mode: new data for the features, their dots and label points. */
  function setSourceData(m: MapLibreMap, d: GeoJSON.FeatureCollection): void {
    ;(m.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(d)
    ;(m.getSource(DOT_SOURCE) as GeoJSONSource | undefined)?.setData(dotData(d))
    ;(m.getSource(LABEL_SOURCE) as GeoJSONSource | undefined)?.setData(labelData(d))
  }

  /** Labels turned on or off: the label points follow (the layer itself is never reloaded). */
  function applyLabelData(m: MapLibreMap): void {
    const source = m.getSource(LABEL_SOURCE) as GeoJSONSource | undefined
    const want = labelSpec('label-area') && currentData === mapData ? labelPoints : null
    if (source && want !== labelsSent) source.setData(labelData(currentData))
  }

  /** Our sources: the data (and in GeoJSON mode its dots), and the tiles-mode selection overlay. */
  function dataSources(): Record<string, unknown> {
    return {
      [SOURCE_ID]: dataSource(),
      ...(styledTiles || styledTileUrl
        ? {}
        : { [DOT_SOURCE]: { type: 'geojson', data: dotData(currentData), promoteId: ID_PROP }, [LABEL_SOURCE]: { type: 'geojson', data: labelData(currentData), promoteId: ID_PROP } }),
      [SELECTION_SOURCE]: { type: 'geojson', data: selectionData() },
    }
  }

  /** Our data source for the current mode: PMTiles, the engine's tiles (spec 010), or GeoJSON. */
  function dataSource(): Record<string, unknown> {
    if (styledTiles) return { type: 'vector', url: styledTiles.url }
    if (styledTileUrl) return { type: 'vector', tiles: [styledTileUrl], minzoom: 0, maxzoom: 14, promoteId: { [TILE_LAYER]: ID_PROP, [TILE_LABEL_LAYER]: ID_PROP } }
    // geojson-vt drops features under its tolerance at low zoom; their dots (option C) keep them visible.
    appliedClusters = JSON.stringify(clusterSourceOptions(style, resolved))
    return { type: 'geojson', data: currentData, promoteId: ID_PROP, ...clusterSourceOptions(style, resolved) }
  }

  /** Our map layers (data, then the tiles-mode selection overlay), with the current paint, layout and filters. */
  function dataLayers(): Array<Record<string, unknown>> {
    const p = paintFor(style, resolved, selectionColor(), layerLatitude())
    const layouts = layoutFor(style, resolved)
    const layers: Array<Record<string, unknown>> = layerInstances().map((l) => ({
      id: l.id,
      type: l.def.type,
      source: l.source ?? SOURCE_ID,
      ...(l.sourceLayer !== undefined ? {'source-layer': l.sourceLayer } : {}),
      filter: layerFilter(l.def),
      ...(style.zoom?.min !== undefined || style.zoom?.max !== undefined ? layerZoomRange(style.zoom) : {}),
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
    for (const id of [SOURCE_ID, DOT_SOURCE, LABEL_SOURCE, SELECTION_SOURCE]) if (m.getSource(id)) m.removeSource(id)
    for (const [id, source] of Object.entries(dataSources())) m.addSource(id, source as never)
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
      glyphs: typeof copy.glyphs ==='string' ? copy.glyphs : undefined,
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
      sources: dataSources(),
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
    // The terrain's shading (when on) sits above the basemap and below our data.
    const before = m.getLayer(TERRAIN_HILLSHADE_ID) ? TERRAIN_HILLSHADE_ID : (m.getStyle().layers ?? []).find((l) => l.id.startsWith('se-'))?.id
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

  /** The bubble under a point, if the map draws clusters. */
  function clusterAt(point: { x: number; y: number }): MapGeoJSONFeature | null {
    if (!map || !drawsClusters(style, resolved)) return null
    const layers = layerInstances()
      .filter((l) => l.def.id === 'cluster')
      .map((l) => l.id)
      .filter((id) => map?.getLayer(id))
    return layers.length ? (map.queryRenderedFeatures([point.x, point.y], { layers })[0] ?? null) : null
  }
  /** Zooms in on a bubble: to where it breaks apart (GeoJSON), or one level (engine tiles group again at every zoom). */
  async function expandCluster(bubble: MapGeoJSONFeature): Promise<void> {
    const m = map
    if (!m || bubble.geometry.type !== 'Point') return
    const center = bubble.geometry.coordinates as [number, number]
    const source = m.getSource(SOURCE_ID) as GeoJSONSource | undefined
    let zoom = Math.min(m.getZoom() + 1, 20)
    const id = bubble.properties?.cluster_id
    if (source && typeof source.getClusterExpansionZoom === 'function' && typeof id === 'number') {
      zoom = await source.getClusterExpansionZoom(id).catch(() => zoom)
    }
    m.easeTo({ center, zoom })
  }

  function registerHandlers(): void {
    if (!map) return
    const m = map
    m.on('click', (e: MapMouseEvent) => {
      // A drawing tool is open: the click belongs to it.
      if (drawingOn) return
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
      const bubble = clusterAt(e.point)
      if (bubble) {
        void expandCluster(bubble)
        return
      }
      const hit = m.queryRenderedFeatures(e.point, { layers: interactiveLayers() })[0]
      onSelectFeature(featureId(hit), e.originalEvent.ctrlKey || e.originalEvent.metaKey)
    })
    m.on('mousemove', (e: MapMouseEvent) => {
      const elevation = terrainActive ? elevationAt(e.lngLat) : undefined
      onCursorMove({ lon: e.lngLat.lng, lat: e.lngLat.lat, elevation })
      trackCursor(e.lngLat.lng, e.lngLat.lat, elevation)
      const layers = interactiveLayers()
      const hit = layers.length && onSurface(e.point) ? m.queryRenderedFeatures(e.point, { layers })[0] : undefined
      if (styledTiles) m.getCanvas().style.cursor = hit ? 'pointer' : ''
      else setHover(featureId(hit))
      if (!hit && onSurface(e.point) && clusterAt(e.point)) m.getCanvas().style.cursor = 'pointer'
      if (drawingOn) hideTip()
      else updateTooltip(e, hit)
      lastPoint = e.point
      if (progressText) placeLive()
    })
    // A position worth copying is the one you point at: right-click opens a small menu there (it does not move with the
    // cursor, as the live readout does). Not while a drawing tool is open.
    m.on('contextmenu', (e: MapMouseEvent) => {
      if (drawingOn) return
      e.originalEvent.preventDefault()
      hideTip()
      pointCopied = null
      pointMenu = { x: e.point.x, y: e.point.y, width: m.getContainer().clientWidth, height: m.getContainer().clientHeight, lon: e.lngLat.lng, lat: e.lngLat.lat, elevation: terrainActive ? elevationAt(e.lngLat) : null }
    })
    m.on('mousedown', () => (pointMenu = null))
    m.on('movestart', () => (pointMenu = null))
    m.on('moveend', () => {
      const c = m.getCenter()
      const b = m.getBounds()
      onCameraChange({ center: [c.lng, c.lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() }, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    })
    m.on('move', scheduleSky)
    // The zoom as the map moves, once a frame and only when it changed: a number that only the zoom marker reads.
    let zoomFrame = 0
    let sentZoom = Number.NaN
    m.on('move', () => {
      if (!onZoom || zoomFrame) return
      zoomFrame = requestAnimationFrame(() => {
        zoomFrame = 0
        const z = m.getZoom()
        if (Math.abs(z - sentZoom) < 0.001) return
        sentZoom = z
        onZoom?.(z)
      })
    })
    // Spec 008 FR-026: "Reset view" shows while the map is tilted or rotated.
    m.on('move', () => {
      const t = Math.abs(m.getPitch()) > 0.5 || Math.abs(m.getBearing()) > 0.5
      if (t !== tilted) tilted = t
      const bearing = m.getBearing()
      if (Math.abs(bearing - mapBearing) > 0.4) mapBearing = bearing
    })
    m.on('mouseout', () => {
      onCursorMove(null)
      hideTip()
    })
    m.on('movestart', hideTip)
    m.on('movestart', (e: { originalEvent?: unknown }) => {
      if (!e.originalEvent) programmaticMoveAt = performance.now()
    })

    // Tile/sprite/glyph failures after the style document itself loaded
    // (e.g. tiles blocked by CSP): degrade to blank + message (FR-016).
    // Errors from the data source are never counted.
    m.on('error', (e: { sourceId?: string; error?: { message?: string } }) => {
      // The terrain's own tiles are not the basemap's: their failure turns terrain off.
      if (e.sourceId === TERRAIN_SOURCE_ID) {
        if (terrainHealth.recordFailure()) onTerrainFailure()
        return
      }
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
        // Spec 010 (style tests): the drawn features' ids and properties, on demand (e.g. the engine's rule index).
        ;(container as HTMLElement & { seRendered?: () => Array<{ id: unknown; properties: unknown }> }).seRendered = () =>
          m.queryRenderedFeatures({ layers: interactiveLayers() }).map((f) => ({ id: f.id, properties: f.properties }))
        // Spec 011 US6: the labels placed (after collisions), and their features' ids, layer and screen points.
        const labelIds = layerInstances()
          .filter((l) => LABEL_DEFS.has(l.def.id) && m.getLayer(l.id) && m.getLayoutProperty(l.id, 'visibility') !== 'none')
          .map((l) => l.id)
        container.dataset.renderedLabels = String(labelIds.length ? m.queryRenderedFeatures({ layers: labelIds }).length : 0)
        ;(container as HTMLElement & { seLabels?: () => Array<{ id: unknown; layer: string }> }).seLabels = () =>
          labelIds.length ? m.queryRenderedFeatures({ layers: labelIds }).map((f) => ({ id: f.id, layer: f.layer.id })) : []
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
      if (e.sourceId === TERRAIN_SOURCE_ID) {
        if (e.tile) terrainHealth.recordSuccess()
        return
      }
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

  // Occasional comets behind the globe (GeoLibre's effects), on their own canvas: never in the map image.
  let cometCanvas = $state<HTMLCanvasElement>()
  $effect(() => {
    const canvas = cometCanvas
    if (!canvas) return
    const comets = new Comets(canvas)
    comets.start()
    return () => comets.stop()
  })

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
  /** Ground meters per CSS pixel at the center, from two points 100 px apart (right on a globe too). */
  function metersPerPixelAt(m: MapLibreMap, at: { x: number; y: number }): number {
    const { x, y } = at
    const a = m.unproject([x - 50, y])
    const b = m.unproject([x + 50, y])
    const rad = Math.PI / 180
    const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2
    return (2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)))) / 100
  }
  const captureMap: MapCapture = async ({ ratio: wanted, clip, mask }) => {
    const m = map
    if (!m) throw new Error('The map is not ready.')
    const notes: string[] = []
    const cssW = container.clientWidth
    const cssH = container.clientHeight
    const gl = (m.getCanvas().getContext('webgl2') ?? m.getCanvas().getContext('webgl')) as WebGLRenderingContext | null
    const max = gl ? Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) : 4096
    let ratio = wanted
    if (Math.max(cssW, cssH) * ratio > max) {
      ratio = 1
      notes.push(`${wanted}× would be larger than this device can draw (${max} px): the map is at 1×.`)
    }
    const previous = m.getPixelRatio()
    // The print extent's box is not part of the picture.
    setPrintExtentVisible(m, false)
    const background = blankBackground()
    const attribution = activeBasemap?.attribution ? plainAttribution(activeBasemap.attribution) : ''
    const sky = untrack(() => projection) === 'globe' ? (skyCanvas ?? null) : null
    try {
      if (ratio !== previous) {
        m.setPixelRatio(ratio)
        await idle(m)
      }
      // The frame as drawn, with the atlas's mask over everything outside the page's feature.
      const grab = async (): Promise<HTMLCanvasElement> => {
        const frame = await grabFrame(m)
        const ctx = frame.getContext('2d')
        if (mask && ctx) paintAtlasMask(ctx, mask, (p) => m.project(p), ratio)
        return frame
      }
      // The frame over its background (and the globe's sky), so a transparent part is not black in the file.
      const flatten = (grabbed: HTMLCanvasElement): HTMLCanvasElement => {
        const out = document.createElement('canvas')
        out.width = grabbed.width
        out.height = grabbed.height
        const ctx = out.getContext('2d')
        if (!ctx) throw new Error('No 2D canvas is available for the map image.')
        ctx.fillStyle = background
        ctx.fillRect(0, 0, out.width, out.height)
        if (sky && sky.width) ctx.drawImage(sky, 0, 0, out.width, out.height)
        ctx.drawImage(grabbed, 0, 0)
        return out
      }
      // With a print extent, the frame is cut to its box, and the scale is measured in the part that shows.
      const shot = (frame: HTMLCanvasElement, credit: string): MapShot => {
        let out = frame
        let center: { x: number; y: number } = m.project(m.getCenter())
        let width = cssW
        let height = cssH
        const view = m.getBounds()
        let extent: [number, number, number, number] = [view.getWest(), view.getSouth(), view.getEast(), view.getNorth()]
        if (clip) {
          extent = clip
          const [w, s, e, n] = clip
          const corners = [m.project([w, n]), m.project([e, n]), m.project([e, s]), m.project([w, s])]
          const minX = Math.min(...corners.map((c) => c.x))
          const maxX = Math.max(...corners.map((c) => c.x))
          const minY = Math.min(...corners.map((c) => c.y))
          const maxY = Math.max(...corners.map((c) => c.y))
          const x0 = Math.max(0, Math.floor(minX * ratio))
          const y0 = Math.max(0, Math.floor(minY * ratio))
          const x1 = Math.min(frame.width, Math.ceil(maxX * ratio))
          const y1 = Math.min(frame.height, Math.ceil(maxY * ratio))
          if (x1 - x0 < 1 || y1 - y0 < 1) throw new Error('The print extent is outside the map: pan to it, or draw it again.')
          out = document.createElement('canvas')
          out.width = x1 - x0
          out.height = y1 - y0
          out.getContext('2d')?.drawImage(frame, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
          center = { x: (x0 + x1) / 2 / ratio, y: (y0 + y1) / 2 / ratio }
          width = out.width / ratio
          height = out.height / ratio
        }
        return { frame: out, ratio, width, height, attribution: credit, bearing: m.getBearing(), extent: [Math.max(-180, extent[0]), Math.max(-90, extent[1]), Math.min(180, extent[2]), Math.min(90, extent[3])], metersPerPixel: metersPerPixelAt(m, center), notes }
      }
      try {
        return shot(flatten(await grab()), attribution)
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'SecurityError')) throw err
        // A basemap whose server doesn't allow reading its tiles taints the
        // canvas: export without it, and say so (FR-030).
        const ours = new Set([...layerInstances().map((l) => l.id), BLANK_BG])
        const hidden = (m.getStyle().layers ?? []).filter((l) => !ours.has(l.id) && m.getLayoutProperty(l.id, 'visibility') !== 'none').map((l) => l.id)
        for (const id of hidden) m.setLayoutProperty(id, 'visibility', 'none')
        try {
          const out = shot(flatten(await grab()), '')
          notes.push(`The ${activeBasemap?.name ?? ''} basemap could not be captured (its server doesn't allow it) and was left out.`.replace('The  basemap', 'The basemap'))
          return out
        } finally {
          for (const id of hidden) m.setLayoutProperty(id, 'visibility', 'visible')
        }
      }
    } finally {
      if (m.getPixelRatio() !== previous) m.setPixelRatio(previous)
      setPrintExtentVisible(m, true)
    }
  }

  // Spec 016: the composer's hold on the map.
  const printCamera: PrintCamera = {
    zoom: () => map?.getZoom() ?? 0,
    zoomLimits: () => ({ min: map?.getMinZoom() ?? 0, max: map?.getMaxZoom() ?? 22 }),
    setZoom: (zoom) => map?.setZoom(zoom),
    settled: async (timeoutMs = 1500) => {
      if (map) await idle(map, timeoutMs)
    },
    drawExtent: (opts) => (map ? drawPrintExtent(map, opts) : Promise.resolve(null)),
    showExtent: (extent) => {
      if (!map) return
      if (extent) showPrintExtent(map, extent)
      else clearPrintExtent(map)
    },
    viewport: () => ({ width: container.clientWidth, height: container.clientHeight }),
    fit: (bounds, padding) => {
      const [w, s, e, n] = bounds
      map?.fitBounds(
        [
          [w, s],
          [e, n],
        ],
        { animate: false, padding, bearing: 0, pitch: 0 }
      )
    },
    unproject: (x, y) => {
      if (!map) return null
      // A pixel off the sphere (the globe) has no position.
      try {
        const p = map.unproject([x, y])
        return Number.isFinite(p.lng) && Number.isFinite(p.lat) ? [p.lng, p.lat] : null
      } catch {
        return null
      }
    },
    view: () => ({ center: map ? [map.getCenter().lng, map.getCenter().lat] : [0, 0], zoom: map?.getZoom() ?? 0, bearing: map?.getBearing() ?? 0, pitch: map?.getPitch() ?? 0 }),
    restoreView: (v) => map?.jumpTo({ center: v.center, zoom: v.zoom, bearing: v.bearing, pitch: v.pitch }),
  }

  let resizeObserver: ResizeObserver | null = null

  onMount(() => {
    ensureEngineTilesProtocol()
    // MapLibre 6 runs one worker outside Safari, so our features, their dots
    // and the basemap's tiles all queued on it. Two let the features and the
    // dots tile side by side. Takes effect only before the first map.
    if (getWorkerCount() < MAP_WORKERS) setWorkerCount(MAP_WORKERS)
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
      // Tilt and rotate (right-drag or Ctrl+drag; Shift+arrows by keyboard) are always on
      // (user decision 2026-10-13: basemap 3D buildings, such as Liberty's, show when tilted).
      // Reset view brings the map back to flat and north-up.
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
    })
    // Test hooks only: the tests read the style itself (spec 010: exactly one basemap in it).
    if (document.documentElement.dataset.seTestHooks !== undefined) (container as unknown as { seMap: MapLibreMap }).seMap = map
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    // Ctrl or Cmd held as a shape is finished adds its rows to the selection.
    container.addEventListener('pointerup', (e) => (additiveFinish = e.ctrlKey || e.metaKey), true)
    // Shaped marker icons, on demand (also after a basemap switch replaces the style's images).
    map.on('styleimagemissing', (e: { id: string }) => {
      if (map && isMarkerIconId(e.id)) addMarkerIcon(map, e.id)
      else if (map && e.id === ARROW_ICON_ID && !map.hasImage(e.id)) {
        const icon = drawArrowIcon()
        if (icon) map.addImage(e.id, icon.image, { pixelRatio: icon.pixelRatio, sdf: true })
      }
    })
    map.on('load', () => {
      registerHandlers()
      mapReady = true
      onCaptureReady?.(captureMap)
      onCameraReady?.(printCamera)
    })
    resizeObserver = new ResizeObserver(scheduleResize)
    resizeObserver.observe(container)
    // Overlays are laid out against each other, not only against the map: whenever the map, a stack or the open
    // tools change size, the tools are fitted again.
    overlayObserver = new ResizeObserver(scheduleFit)
    overlayObserver.observe(rootEl)
  })

  let rootEl: HTMLDivElement
  let overlayObserver: ResizeObserver | null = null
  let fitFrame = 0
  function scheduleFit(): void {
    if (fitFrame) return
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0
      // The stacks come and go with the controls: watch each, so a legend growing or collapsing refits the tools.
      for (const c of rootEl.querySelectorAll('.corner')) overlayObserver?.observe(c)
      fitPalette()
    })
  }
  /**
   * The open drawing tools are a column that can be taller than the room under them. They take as many columns as it
   * takes to end above the map's bottom edge and above any stack at the bottom they would reach (the legend), so
   * nothing is covered, whatever the size of the map or the legend.
   */
  function fitPalette(): void {
    const el = rootEl?.querySelector<HTMLElement>('.group.palette')
    if (!el) return
    const root = rootEl.getBoundingClientRect()
    const bottoms = Array.from(rootEl.querySelectorAll<HTMLElement>('.corner.bottom-left, .corner.bottom-right, .corner.bottom-center')).filter((c) => c.offsetHeight > 0)
    const fits = (): boolean => {
      const r = el.getBoundingClientRect()
      // The bottom band holds the attribution and the scale: the tools end above it.
      let limit = root.bottom - 44
      for (const c of bottoms) {
        const o = c.getBoundingClientRect()
        const overlapsX = o.left < r.right && o.right > r.left
        if (overlapsX && o.top > r.top) limit = Math.min(limit, o.top - 8)
      }
      return r.bottom <= limit
    }
    const buttons = el.children.length
    for (let cols = 1; cols <= Math.min(buttons, 6); cols++) {
      el.style.setProperty('--cols', String(cols))
      if (fits()) return
    }
  }
  $effect(() => {
    // The tools open or close, or the stacks around them change.
    void drawTool?.purpose
    void drawTool?.tool
    void controls
    void layer
    void tick().then(scheduleFit)
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    overlayObserver?.disconnect()
    if (fitFrame) cancelAnimationFrame(fitFrame)
    if (resizeFrame) cancelAnimationFrame(resizeFrame)
    if (skyFrame) cancelAnimationFrame(skyFrame)
    if (cursorFrame) cancelAnimationFrame(cursorFrame)
    if (copiedTimer) clearTimeout(copiedTimer)
    drawController?.destroy()
    for (const marker of labelMarkers.values()) marker.remove()
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
      setSourceData(map, currentData)
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
    delete container.dataset.renderedLabels
    }
  })

  // GeoJSON mode: the label points arrive (labels on) after their drawing.
  $effect(() => {
    void labelPoints
    const m = map
    if (mapReady && m) untrack(() => applyLabelData(m))
  })

  // GeoJSON mode: the one setData per new result (spec 010: never per pan).
  $effect(() => {
    const data = mapData
    if (!mapReady || !map || data === null || tiles || tileUrl) return
    if (data === currentData) return
    currentData = data
    setSourceData(map, currentData)
    hoveredId = null
    dataLoaded = true
    paintPending = true
    // Marks the rendered-feature count stale until the next idle (above).
    delete container.dataset.renderedFeatures
    delete container.dataset.renderedLabels
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
    void style.draw
    void style.height
    void style.heatmap
    void style.clusters
    void style.markerShape
    void style.lineDash
    void style.channels
    void style.lineWidth
    void style.rotation
    void style.opacity
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
    if (previousSelected !== null) setState(previousSelected, { selected: false })
    if (id !== null && id !== undefined) setState(id, { selected: true })
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
    for (const id of tickedApplied) if (!next.has(id)) setState(id, { ticked: false })
    for (const id of next) if (!tickedApplied.has(id)) setState(id, { ticked: true })
    tickedApplied = next
  }
  $effect(() => {
    void tickedIds
    void mapData
    void tileUrl
    untrack(() => applyTicked())
  })

  // Spec 008 US6 (FR-026): extrusion on tilts a flat map so heights show.
  let tilted = $state(false)
  /** The map's bearing in degrees, for the north arrow on Reset view. */
  let mapBearing = $state(0)
  let wasExtruded = false
  $effect(() => {
    const on = extruded
    if (!map || !mapReady) return
    untrack(() => applyPaint())
    if (on && !wasExtruded && map.getPitch() < 1) map.easeTo({ pitch: EXTRUSION_PITCH, duration: 600 })
    wasExtruded = on
  })
  function resetView(): void {
    map?.easeTo({ pitch: 0, bearing: 0, duration: 500 })
  }

  // Spec 014: terrain. A DEM source and a hillshade layer are added while it is on, and `setTerrain` lifts the one
  // basemap and our data onto it. Neither carries the `se-` prefix (replaceDataSource drops those) and both come
  // back after any rebuild through this effect. A basemap swap keeps them (swapBasemap puts the new layers under the shading).
  let terrainHealth = new BasemapHealth()
  /** Terrain is lifted (a tile source exists); the cursor then reports an elevation. */
  let terrainActive = false
  let terrainElevationScale = 1
  function applyTerrain(m: MapLibreMap, on: boolean, exaggeration: number): void {
    if (on) {
      if (!m.getSource(TERRAIN_SOURCE_ID)) {
        terrainHealth = new BasemapHealth()
        m.addSource(TERRAIN_SOURCE_ID, terrainSource() as never)
      }
      if (!m.getLayer(TERRAIN_HILLSHADE_ID)) {
        const before = (m.getStyle().layers ?? []).find((l) => l.id.startsWith('se-'))?.id
        // Relief shading, so the surface reads on flat-colored basemaps too. Colors are the relief's own (not theme chrome).
        m.addLayer({ id: TERRAIN_HILLSHADE_ID, type: 'hillshade', source: TERRAIN_SOURCE_ID, paint: hillshadePaint(reliefKindFor(basemap)) } as never, before)
      }
      m.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration })
      terrainElevationScale = exaggeration
      terrainActive = true
    } else {
      terrainActive = false
      if (m.getTerrain()) m.setTerrain(null)
      if (m.getLayer(TERRAIN_HILLSHADE_ID)) m.removeLayer(TERRAIN_HILLSHADE_ID)
      if (m.getSource(TERRAIN_SOURCE_ID)) m.removeSource(TERRAIN_SOURCE_ID)
    }
    container.dataset.terrain = on ? String(exaggeration) : ''
  }
  /** Meters at a point, without the exaggeration; undefined where the DEM has no tile yet. */
  function elevationAt(lngLat: { lng: number; lat: number }): number | null {
    const v = map?.queryTerrainElevation(lngLat)
    return typeof v === 'number' && Number.isFinite(v) ? v / terrainElevationScale : null
  }
  /** The shading follows the basemap: shadows only over imagery, a faint highlight over a dark map. */
  function updateHillshadePaint(entry: BasemapCatalogEntry): void {
    if (!map || !map.getLayer(TERRAIN_HILLSHADE_ID)) return
    for (const [name, value] of Object.entries(hillshadePaint(reliefKindFor(entry)))) map.setPaintProperty(TERRAIN_HILLSHADE_ID, name as never, value as never)
  }
  $effect(() => {
    const entry = basemap
    if (!mapReady) return
    untrack(() => updateHillshadePaint(entry))
  })
  let wasTerrain = false
  $effect(() => {
    const { on, exaggeration } = terrain
    if (!map || !mapReady) return
    untrack(() => {
      if (!map) return
      applyTerrain(map, on, exaggeration)
      // Relief shows when the map is tilted: tilt it, as turning extrusion on does.
      if (on && !wasTerrain && map.getPitch() < 1) map.easeTo({ pitch: EXTRUSION_PITCH, duration: 600 })
      wasTerrain = on
    })
  })

  // Spec 014: MapLibre's own scale bar and logo, mounted where the user put them: their elements go into our corner stacks.
  let scaleHost = $state<HTMLDivElement>()
  let logoHost = $state<HTMLDivElement>()
  $effect(() => {
    const host = scaleHost
    if (!map || !mapReady || !host) return
    const control = new ScaleControl({ unit: 'metric', maxWidth: 96 })
    const element = control.onAdd(map)
    host.appendChild(element)
    return () => {
      control.onRemove()
      element.remove()
    }
  })
  $effect(() => {
    const host = logoHost
    if (!map || !mapReady || !host) return
    const control = new LogoControl()
    const element = control.onAdd(map)
    host.appendChild(element)
    return () => {
      control.onRemove()
      element.remove()
    }
  })

  // Spec 014: the hover tooltip. The text changes only when the feature under the cursor does; the box follows the
  // pointer by moving the element directly (no re-render per mouse move).
  let tip = $state<{ id: string | number; lines: Array<[string, string]> } | null>(null)
  let tipEl = $state<HTMLDivElement>()
  let tipId: string | number | null = null
  const TIP_MAX_LINES = 5
  const TIP_MAX_CHARS = 60

  function tipLines(props: Record<string, unknown> | null | undefined, columns: string[]): Array<[string, string]> {
    if (!props) return []
    const lines: Array<[string, string]> = []
    for (const name of columns) {
      if (lines.length >= TIP_MAX_LINES) break
      const v = props[name]
      if (v === undefined) continue
      const words = untrack(() => domainMode) === 'descriptions' ? describeCode(untrack(() => columnDomains), name, v) : null
      const text = words ?? (v === null ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v))
      lines.push([name, text.length > TIP_MAX_CHARS ? `${text.slice(0, TIP_MAX_CHARS - 1)}…` : text])
    }
    return lines
  }

  function placeTip(x: number, y: number): void {
    if (!tipEl || !container) return
    const w = tipEl.offsetWidth
    const h = tipEl.offsetHeight
    const room = container.getBoundingClientRect()
    // Below and right of the pointer; flipped when it would leave the map.
    const left = x + 14 + w > room.width ? Math.max(0, x - 14 - w) : x + 14
    const top = y + 16 + h > room.height ? Math.max(0, y - 12 - h) : y + 16
    tipEl.style.transform = `translate(${left}px, ${top}px)`
  }

  function hideTip(): void {
    tipId = null
    if (tip) tip = null
  }

  function updateTooltip(e: MapMouseEvent, hit: MapGeoJSONFeature | undefined): void {
    if (!untrack(() => isControlOn(controls, 'tooltip'))) {
      if (tip) hideTip()
      return
    }
    // Dragging the map, or nothing under the pointer: no tooltip.
    if (!hit || e.originalEvent.buttons !== 0) {
      hideTip()
      return
    }
    const id = featureId(hit) ?? `${hit.sourceLayer ?? ''}:${hit.id ?? ''}`
    if (id === tipId) {
      placeTip(e.point.x, e.point.y)
      return
    }
    tipId = id
    // A PMTiles archive has no column list: its first few properties.
    const columns = styledTiles ? Object.keys(hit.properties ?? {}).filter((k) => k !== ID_PROP).slice(0, 3) : untrack(() => tooltipColumns)
    const lines = tipLines(hit.properties, columns)
    const byId = !!untrack(() => tileUrl) && typeof id === 'number' && !!tooltipRecord
    if (lines.length === 0 && !byId) {
      hideTip()
      return
    }
    tip = { id, lines }
    const { x, y } = e.point
    void tick().then(() => placeTip(x, y))
    // Engine tiles carry only the style's columns: the rest come by id.
    if (byId && tooltipRecord) {
      void tooltipRecord(id as number).then((record) => {
        if (tipId !== id || !record) return
        const full = tipLines(record, untrack(() => tooltipColumns))
        if (full.length === 0) hideTip()
        else {
          tip = { id, lines: full }
          void tick().then(() => placeTip(x, y))
        }
      })
    }
  }

  // Spec 014: the drawing tools (Terra Draw, loaded the first time one is opened). Shapes are scratch geometry for
  // queries and filters, never edits to the data. The store owns the finished shapes; this file draws them,
  // labels them with their measurements, and reports changes.
  let drawController: DrawController | null = null
  let drawStarting: Promise<DrawController | null> | null = null
  /** A tool is open: the map's own click, hover and tooltip stand aside. */
  let drawingOn = false
  /** Ctrl or Cmd was held when the last shape was finished (adds to the selection instead of replacing it). */
  let additiveFinish = false
  let selectedShape = $state<string | null>(null)
  /** Measurement of the shape being drawn right now. */
  let progressText = $state<string | null>(null)
  let liveEl = $state<HTMLDivElement>()
  let lastPoint = { x: 0, y: 0 }

  function setProgress(geometry: DrawnShape['geometry'] | null): void {
    progressText = geometry ? shapeLabel({ geometry }, untrack(() => drawUnits)) : null
    if (progressText) void tick().then(placeLive)
  }
  function placeLive(): void {
    if (liveEl) liveEl.style.transform = `translate(${lastPoint.x + 16}px, ${lastPoint.y + 18}px)`
  }

  async function ensureDraw(): Promise<DrawController | null> {
    if (drawController) return drawController
    if (drawStarting) return drawStarting
    const m = map
    if (!m) return null
    drawStarting = (async () => {
      try {
        const { createDrawController, readDrawColors } = await import('./draw/controller.js')
        const made = await createDrawController(m, readDrawColors(container), {
          onShapes: (shapes) => onShapes(shapes),
          onFinish: (shape) => onShapeDrawn(shape, additiveFinish),
          onProgress: setProgress,
          onSelect: (id) => (selectedShape = id),
        })
        if (map !== m) {
          made.destroy()
          return null
        }
        drawController = made
        return made
      } catch (err) {
        console.warn('Spatial Explorer: the drawing tools could not start', err)
        return null
      } finally {
        drawStarting = null
      }
    })()
    return drawStarting
  }

  async function applyDrawTool(): Promise<void> {
    if (!drawTool && !drawController) return
    const c = await ensureDraw()
    if (!c) return
    // The newest choice, whatever it was when this started.
    const now = untrack(() => drawTool)
    c.setTool(now ? now.tool : null, now ? now.purpose : 'draw')
    if (!now) selectedShape = null
  }
  $effect(() => {
    drawingOn = !!drawTool
    void drawTool
    if (!mapReady) return
    untrack(() => void applyDrawTool())
  })

  let appliedShapesRequest = 0
  $effect(() => {
    const req = shapesRequest
    if (!req || req.seq === appliedShapesRequest) return
    appliedShapesRequest = req.seq
    untrack(() => {
      const c = drawController
      if (!c) return
      if (req.clear) c.clear()
      if (req.remove?.length) c.remove(req.remove)
    })
  })

  // A new theme: the shapes' colors are canvas colors, read again; the shapes carry over.
  async function rebuildDraw(): Promise<void> {
    const old = drawController
    if (!old || !map) return
    const keep = old.shapes()
    old.destroy()
    drawController = null
    const made = await ensureDraw()
    if (!made) return
    made.load(keep)
    const now = untrack(() => drawTool)
    made.setTool(now ? now.tool : null, now ? now.purpose : 'draw')
  }
  $effect(() => {
    void themeRevision
    untrack(() => void rebuildDraw())
  })

  // Each shape's measurement, on the map at the shape's label point.
  // A plain registry of DOM markers, not reactive state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const labelMarkers = new Map<string, Marker>()
  function labelPoint(g: DrawnShape['geometry']): [number, number] | null {
    if (g.type === 'Point') return null
    if (g.type === 'LineString') {
      const c = g.coordinates
      const i = Math.floor((c.length - 1) / 2)
      const a = c[i]
      const b = c[Math.min(i + 1, c.length - 1)]
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    }
    const ring = g.coordinates[0] ?? []
    if (ring.length === 0) return null
    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
  }
  function syncLabels(list: readonly DrawnShape[], units: UnitSystem): void {
    const m = map
    if (!m) return
    // A local lookup, not reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const keep = new Set<string>()
    for (const s of list) {
      const text = shapeLabel(s, units)
      const at = labelPoint(s.geometry)
      if (!text || !at) continue
      keep.add(s.id)
      let marker = labelMarkers.get(s.id)
      if (!marker) {
        const el = document.createElement('div')
        el.className ='shape-label'
        marker = new Marker({ element: el, anchor: 'center' }).setLngLat(at).addTo(m)
        labelMarkers.set(s.id, marker)
      }
      marker.setLngLat(at)
      marker.getElement().textContent = text
    }
    for (const [id, marker] of labelMarkers) {
      if (keep.has(id)) continue
      marker.remove()
      labelMarkers.delete(id)
    }
  }
  $effect(() => {
    const list = shapes
    const units = drawUnits
    if (!map || !mapReady) return
    untrack(() => syncLabels(list, units))
  })

  const PALETTE: Record<ShapePurpose, DrawTool[]> = {
    draw: ['point', 'line', 'polygon', 'rectangle', 'circle', 'freehand', 'edit'],
    measure: ['line', 'polygon', 'rectangle', 'circle'],
    select: ['rectangle', 'polygon', 'circle', 'freehand'],
  }
  const TOOL_ICON: Record<DrawTool, IconName> = { point:'shape-point', line:'shape-line', polygon:'shape-polygon', rectangle:'shape-rect', circle:'shape-circle', freehand:'shape-freehand', edit: 'pointer' }
  const TOOL_LABEL: Record<DrawTool, string> = { point: 'Point', line: 'Line', polygon: 'Polygon', rectangle: 'Rectangle', circle: 'Circle', freehand: 'Freehand', edit: 'Edit shapes' }
  const TOOL_HINT: Record<DrawTool, string> = {
    point: 'Click to place a point',
    line: 'Click to add points; double-click or Enter to finish; Esc to cancel',
    polygon: 'Click to add corners; double-click or Enter to finish; Esc to cancel',
    rectangle: 'Click and drag, or click two corners',
    circle: 'Click the center, then click or drag out the radius',
    freehand: 'Press and drag to draw a free shape',
    edit: 'Click a shape to select it: drag it or its corners; Delete removes it',
  }
  const PURPOSE_LABEL: Record<ShapePurpose, string> = { draw: 'Draw', measure: 'Measure', select: 'Select by shape' }

  // Spec 014: the cursor readout. It keeps the last position when the pointer moves onto it, so a click copies
  // what was under the cursor. Updated at most once a frame, and only while the control is on.
  let lastCursor = $state<{ lon: number; lat: number; elevation?: number | null } | null>(null)
  let cursorFrame = 0
  let copiedTimer: ReturnType<typeof setTimeout> | null = null
  function trackCursor(lon: number, lat: number, elevation?: number | null): void {
    if (!untrack(() => isControlOn(controls, 'coordinates'))) return
    const next = { lon, lat, elevation }
    if (cursorFrame) {
      pendingCursor = next
      return
    }
    lastCursor = next
    cursorFrame = requestAnimationFrame(() => {
      cursorFrame = 0
      if (pendingCursor) lastCursor = pendingCursor
      pendingCursor = null
    })
  }
  let pendingCursor: { lon: number; lat: number; elevation?: number | null } | null = null
  /** The same "lat, lon" the status bar shows, to 5 decimals. */
  const cursorText = $derived(lastCursor ? `${lastCursor.lat.toFixed(5)}, ${lastCursor.lon.toFixed(5)}` : null)

  // The right-click position menu.
  type PointMenu = { x: number; y: number; width: number; height: number; lon: number; lat: number; elevation: number | null }
  let pointMenu = $state<PointMenu | null>(null)
  let pointCopied = $state<string | null>(null)
  let pointMenuEl = $state<HTMLDivElement>()
  const pointItems = $derived(
    pointMenu
      ? [
          { id: 'latlon', label: 'Copy lat, lon', text: `${pointMenu.lat.toFixed(5)}, ${pointMenu.lon.toFixed(5)}` },
          { id: 'lonlat', label: 'Copy lon, lat', text: `${pointMenu.lon.toFixed(5)}, ${pointMenu.lat.toFixed(5)}` },
          { id: 'wkt', label: 'Copy as WKT', text: `POINT(${pointMenu.lon.toFixed(6)} ${pointMenu.lat.toFixed(6)})` },
        ]
      : []
  )
  /** Kept inside the map. */
  const pointMenuLeft = $derived(pointMenu ? Math.max(4, Math.min(pointMenu.x, pointMenu.width - 196)) : 0)
  const pointMenuTop = $derived(pointMenu ? Math.max(4, Math.min(pointMenu.y, pointMenu.height - 150)) : 0)
  async function copyPoint(id: string, text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    pointCopied = id
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => ((pointMenu = null), (pointCopied = null)), 700)
  }
  function closePointMenu(refocus = true): void {
    pointMenu = null
    pointCopied = null
    if (refocus) map?.getCanvas().focus()
  }
  function pointMenuKeydown(e: KeyboardEvent): void {
    const items = Array.from(pointMenuEl?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closePointMenu()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    } else if (e.key === 'Tab') closePointMenu(false)
  }
  $effect(() => {
    if (!pointMenu) return
    void tick().then(() => pointMenuEl?.querySelector<HTMLButtonElement>('button')?.focus())
    const outside = (ev: PointerEvent): void => {
      if (pointMenuEl && !pointMenuEl.contains(ev.target as Node)) closePointMenu(false)
    }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  })

  /** The controls drawn as buttons in a box; the rest (search, legend, readout, scale, logo) are their own elements. */
  const BUTTONS = new Set<MapControlId>(['zoom', 'zoomToLayer', 'resetView', 'globe', 'terrain', 'draw', 'measure','select', 'binCells', 'dotDensity', 'timeSlider', 'exportImage'])
  const GROUP_LABEL = Object.fromEntries(CONTROL_GROUPS.map((g) => [g.id, g.label])) as Record<ControlGroupId, string>
  const PURPOSE_CONTROL: Record<ShapePurpose, MapControlId> = { draw: 'draw', measure: 'measure', select:'select' }
  type Segment = { kind: 'buttons'; key: string; group: ControlGroupId; ids: MapControlId[] } | { kind: 'item'; key: string; id: MapExtraId }
  /** What a corner holds, top to bottom: buttons of one group side by side share a box, anything else stands alone. */
  function cornerSegments(corner: ControlPosition): Segment[] {
    const out: Segment[] = []
    for (const id of controlsAt(controls, corner, (c) => c !== 'resetView' || tilted)) {
      if (!BUTTONS.has(id)) {
        out.push({ kind: 'item', key: `i:${id}`, id })
        continue
      }
      const group = MAP_CONTROLS.find((c) => c.id === id)?.group ?? 'navigation'
      const last = out[out.length - 1]
      if (last && last.kind === 'buttons' && last.group === group) last.ids.push(id)
      else out.push({ kind: 'buttons', key: `b:${id}`, group, ids: [id] })
    }
    // Not controls: the file's layers and the selected feature's card show whenever they are needed, at the top left.
    if (corner === 'top-left') {
      out.push({ kind: 'item', key: 'i:layers', id: 'layers' }, { kind: 'item', key: 'i:info', id: 'info' })
    }
    return out
  }

  // Spec 008 FR-023: switching keeps the camera (center and zoom).
  $effect(() => {
    const type = projection
    if (!map || !mapReady) return
    if (map.getProjection()?.type !== type) map.setProjection({ type })
    map.setSky(type === 'globe' ? GLOBE_SKY : FLAT_SKY)
    if (type === 'globe') {
      loadSky(scheduleSky)
      void tick().then(scheduleSky)
    }
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

{#snippet cornerStack(corner: ControlPosition)}
    {@const segments = cornerSegments(corner)}
    {#if segments.length > 0}
      <div class="corner {corner}">
        {#each segments as seg (seg.key)}
          {#if seg.kind === 'buttons'}
                    <!-- The tools of an open purpose (draw, measure, select) form a second column beside the buttons, on the side away from the map's edge. -->
            <div class="pair">
      <div class="group" role="toolbar" aria-label="{GROUP_LABEL[seg.group]} controls" class:rows={seg.ids.length > 6} style:--cols={Math.ceil(seg.ids.length / 2)}>
                {#each seg.ids as id (id)}
                  {#if id === 'zoom'}
                    {@render mapButton('Zoom in', 'Zoom in', 'plus', corner, { onclick: () => map?.zoomIn() })}
                    {@render mapButton('Zoom out', 'Zoom out', 'minus', corner, { onclick: () => map?.zoomOut() })}
                  {:else if id === 'zoomToLayer'}
                    {@render mapButton('Zoom to layer', 'Zoom to layer', 'fit', corner, { disabled: !layer?.extent, onclick: () => fitExtent(true) })}
                  {:else if id === 'globe'}
                    {@render mapButton('Globe view', projection === 'globe' ? 'Flat map' : 'Globe view', 'globe', corner, { pressed: projection === 'globe', onclick: () => onToggleProjection?.() })}
                  {:else if id === 'terrain'}
                    {@render mapButton('Terrain', terrain.on ? 'Terrain off' : 'Terrain on', 'mountain', corner, { pressed: terrain.on, onclick: () => onToggleTerrain?.() })}
                  {:else if id === 'draw' || id === 'measure' || id ==='select'}
                    {@const purpose: ShapePurpose = id}
                    {@render mapButton(PURPOSE_LABEL[purpose], PURPOSE_LABEL[purpose], id === 'draw' ? 'draw' : id === 'measure' ? 'ruler' :'select-shape', corner, {
                      pressed: drawTool?.purpose === purpose,
                      onclick: () => onToggleDrawPurpose(purpose),
                    })}
                  {:else if id === 'timeSlider'}
                    {@render mapButton('Time slider', timeSliderUnavailable ?? 'Time slider: show the rows within a window of a date column', 'timeSlider', corner, { pressed: timeSliderOpen, disabled: !layer || !onTimeSlider || !!timeSliderUnavailable, onclick: () => onTimeSlider?.() })}
                  {:else if id === 'binCells'}
                    {@render mapButton('Bin into cells…', binUnavailable ?? 'Bin into cells (H3 or A5 grid)', 'grid', corner, { disabled: !layer || !onBinCells || !!binUnavailable, onclick: () => onBinCells?.() })}
                  {:else if id === 'dotDensity'}
                    {@render mapButton('Dot density…', dotUnavailable ?? 'Dot density: draw a count as dots inside its polygons', 'dots', corner, { disabled: !layer || !onDotDensity || !!dotUnavailable, onclick: () => onDotDensity?.() })}
                  {:else if id === 'exportImage'}
                    {@render mapButton('Print map…', 'Print map…', 'printer', corner, { disabled: !layer || !onExportImage, onclick: () => onExportImage?.() })}
                  {:else if id === 'resetView'}
                    <!-- Spec 008 FR-026: back to flat and north-up. -->
                    {@render mapButton('Reset view', 'Reset view (flat, north up)', 'north', corner, { rotate: -mapBearing, onclick: resetView })}
                  {/if}
                {/each}
              </div>
              {#if drawTool && seg.ids.includes(PURPOSE_CONTROL[drawTool.purpose])}
                <!-- The open tool's palette, under the box holding its button. -->
                  <div class="group palette" role="group" aria-label="{PURPOSE_LABEL[drawTool.purpose]} tools">
                    {#each PALETTE[drawTool.purpose] as t (t)}
                      {@render mapButton(TOOL_LABEL[t], `${TOOL_LABEL[t]}: ${TOOL_HINT[t]}`, TOOL_ICON[t], corner, { pressed: drawTool.tool === t, onclick: () => onSetDrawTool(t) })}
                    {/each}
                    {#if drawTool.purpose === 'draw'}
                      {@render mapButton('Delete selected shape', 'Delete the selected shape (edit mode)', 'trash', corner, { disabled: drawTool.tool !== 'edit' || !selectedShape, onclick: () => drawController?.deleteSelected() })}
                      {@render mapButton('Undo', 'Undo', 'undo', corner, { onclick: () => drawController?.undo() })}
                    {@render mapButton('Redo', 'Redo', 'redo', corner, { onclick: () => drawController?.redo() })}
                    {/if}
                    {#if drawTool.purpose === 'measure'}
                      {@render mapButton(`Units: ${drawUnits}`, `Units: ${drawUnits === 'metric' ? 'metric (km, m)' : 'imperial (mi, ft)'}. Click to switch.`, null, corner, {
                        text: drawUnits === 'metric' ? 'km' : 'mi',
                        onclick: () => onSetDrawUnits(drawUnits === 'metric' ? 'imperial' : 'metric'),
                      })}
                    {/if}
                    {@render mapButton('Close drawing tools', 'Close the tools (the shapes stay)', 'check', corner, { onclick: () => onSetDrawTool(null) })}
                  </div>
              {/if}
            </div>
          {:else if seg.id === 'coordinates'}
            <output class="coords" title="Right-click the map to copy a position">
              <span class="pos">{cursorText ?? 'lat, lon'}</span>
              {#if typeof lastCursor?.elevation === 'number'}<span class="elev">{formatElevation(lastCursor.elevation)}</span>{/if}
            </output>
          {:else if seg.id ==='scale'}
            <div class="native" bind:this={scaleHost}></div>
          {:else if seg.id === 'logo'}
            <div class="native" bind:this={logoHost}></div>
          {:else}
            {@render extra?.(seg.id, corner)}
          {/if}
        {/each}
      </div>
    {/if}
{/snippet}

{#snippet mapButton(label: string, hint: string, icon: IconName | null, corner: ControlPosition, o: { pressed?: boolean; disabled?: boolean; text?: string; rotate?: number; onclick: () => void })}
  <Tip text={hint} side={corner.endsWith('left') ? 'right' : corner.endsWith('right') ? 'left' : corner.startsWith('top') ? 'bottom' : 'top'}>
    {#snippet trigger(props)}
      <button type="button" {...props} aria-label={label} aria-pressed={o.pressed} class:active={o.pressed} class:text={!!o.text} disabled={o.disabled} onclick={o.onclick}>
        {#if icon}<Icon name={icon} rotate={o.rotate} />{:else}{o.text}{/if}
      </button>
    {/snippet}
  </Tip>
{/snippet}

<div class="map-view" bind:this={rootEl} class:space={projection === 'globe'} style:background={projection === 'globe' ? undefined : (blankColor ?? undefined)}>
  {#if projection === 'globe'}
    <canvas class="sky" bind:this={skyCanvas} aria-hidden="true"></canvas>
    <canvas class="comets" bind:this={cometCanvas} aria-hidden="true"></canvas>
  {/if}
  <div class="canvas-host" class:dimmed bind:this={container}></div>
  {#if drawLoading}
    <ProgressBar label="Loading the features" />
  {/if}
  <!-- The left side is one column: what is at the top left (search, layers, the feature's card) shares the height with what is
       at the bottom left (legend, scale, logo), so the card is never taller than the room between them. -->
  <div class="side left">
    {@render cornerStack('top-left')}
    {@render cornerStack('bottom-left')}
  </div>
  {@render cornerStack('top-center')}
  {@render cornerStack('bottom-center')}
  <div class="side right">
    {@render cornerStack('top-right')}
    {@render cornerStack('bottom-right')}
  </div>
  {#if pointMenu}
    <div class="point-menu" role="menu" aria-label="Position" bind:this={pointMenuEl} style:left="{pointMenuLeft}px" style:top="{pointMenuTop}px" onkeydown={pointMenuKeydown} tabindex="-1">
      <div class="point-head">
        <span class="point-coords">{pointItems[0]?.text}</span>
        {#if typeof pointMenu.elevation === 'number'}<span class="point-elev">{formatElevation(pointMenu.elevation)}</span>{/if}
      </div>
      {#each pointItems as it (it.id)}
        <button type="button" role="menuitem" onclick={() => void copyPoint(it.id, it.text)}>
          <span>{pointCopied === it.id ? 'Copied' : it.label}</span>
          {#if pointCopied === it.id}<Icon name="check" size={14} />{/if}
        </button>
      {/each}
    </div>
  {/if}
  {#if progressText}
    <div class="live-label" bind:this={liveEl}>{progressText}</div>
  {/if}
  {#if tip}
    <div class="tip" bind:this={tipEl} role="tooltip">
      {#each tip.lines as [name, value] (name)}
        <div class="tip-row"><span class="tip-name">{name}</span><span class="tip-value">{value}</span></div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .map-view {
    position: relative;
    width: 100%;
    height: 100%;
    /* Search, layer picker and feature card, one width. */
    --se-stack-width: 300px;
    /* Cards in the corners are sized against the map's own height (cqh). */
    container-type: size;
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
  .sky,
  .comets {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .canvas-host.dimmed {
    opacity: 0.35;
  }
  /* Spec 014: a corner's stack of controls, top to bottom; the corner itself lets the map through. */
  .corner {
    position: absolute;
    z-index: 6;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: calc(50% - 15px);
    max-height: calc(100% - 20px);
    pointer-events: none;
  }
  .corner > :global(*) {
    pointer-events: auto;
  }
  /* The left column: top and bottom stacks in one flex column; the top one gives way when the bottom one is tall. */
  .side.left {
    position: absolute;
    top: 10px;
    left: 10px;
    bottom: calc(var(--se-map-bottom-inset, 0px) + 10px);
    z-index: 7;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    max-width: calc(50% - 15px);
    pointer-events: none;
  }
  .side.left > .corner {
    position: static;
    max-width: 100%;
    max-height: none;
  }
  .side.left > .corner.top-left {
    /* The card and search give way first (their lists scroll): the bottom stack never shrinks below what it needs. */
    flex: 0 100 auto;
    min-height: 0;
    align-items: flex-start;
  }
  /* When the two do not fit, the legend gives up more of its height than the card (its list scrolls). */
  .side.left > .corner.bottom-left {
    flex: 0 1 auto;
    /* Never below its content's own minimum (legend, logo, scale bar): it would spill out of the map over the table. */
    min-height: min-content;
    margin-top: auto;
    align-items: flex-start;
  }
  .side.left > .corner > .native {
    flex: none;
  }
  /* The right column: the buttons on top, the legend (or anything else put at the bottom) under them, above the attribution. */
  .side.right {
    position: absolute;
    top: 10px;
    right: 10px;
    bottom: calc(var(--se-map-bottom-inset, 0px) + 38px);
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    max-width: calc(50% - 15px);
    pointer-events: none;
  }
  .side.right > .corner {
    position: static;
    max-width: 100%;
    max-height: none;
    align-items: flex-end;
  }
  .side.right > .corner.top-right {
    flex: none;
  }
  .side.right > .corner.bottom-right {
    flex: 0 1 auto;
    min-height: min-content;
    margin-top: auto;
  }
  .side.right > .corner > .native {
    flex: none;
  }
  /* Along an edge, centered (a wide, short readout); clear of the corners' stacks on both sides. */
  .corner.top-center,
  .corner.bottom-center {
    left: 50%;
    transform: translateX(-50%);
    align-items: center;
    max-width: calc(100% - 360px);
  }
  .corner.top-center {
    top: 10px;
  }
  .corner.bottom-center {
    bottom: calc(var(--se-map-bottom-inset, 0px) + 10px);
  }
  .native {
    display: flex;
  }
  .native :global(.maplibregl-ctrl) {
    margin: 0;
    float: none;
  }
  .group button.text {
    width: 30px;
    font: 500 11px/1 var(--se-font-mono);
  }
  /* The tools: a grid whose columns are chosen to fit (fitPalette). */
  .map-view .group.palette {
    display: grid;
    grid-template-columns: repeat(var(--cols, 1), 30px);
    gap: 0;
    max-width: none;
    background: var(--se-control-bg);
    border-color: var(--se-focus);
  }
  .map-view .group.palette :global(button) {
    background: var(--se-control-bg);
    border-top: 0;
    box-shadow: inset -1px -1px 0 var(--se-border);
  }
  .map-view .group.palette :global(button.active) {
    background: var(--se-control-active-bg);
  }
  .live-label {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 7;
    padding: 1px 6px;
    background: var(--se-bg-elevated);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    color: var(--se-text-primary);
    font: 11px/1.6 var(--se-font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
  .map-view :global(.shape-label) {
    padding: 0 5px;
    background: var(--se-bg-elevated);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    color: var(--se-text-primary);
    font: 11px/1.6 var(--se-font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
  .tip {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 6;
    max-width: 280px;
    padding: 4px 8px;
    background: var(--se-bg-elevated);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    box-shadow: var(--se-shadow-card);
    color: var(--se-text-primary);
    font: var(--se-font-size) var(--se-font-ui);
    pointer-events: none;
  }
  .tip-row {
    display: flex;
    gap: 8px;
    min-width: 0;
  }
  .tip-name {
    flex: none;
    color: var(--se-text-secondary);
  }
  .tip-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .coords {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    background: var(--se-control-bg);
    border: 1px solid var(--se-control-border);
    border-radius: var(--se-radius-sm);
    color: var(--se-text-secondary);
    font: 11px/1.6 var(--se-font-mono);
    font-variant-numeric: tabular-nums;
    backdrop-filter: var(--se-overlay-blur);
  }
  .coords .pos {
    color: var(--se-text-primary);
  }
  .coords .elev {
    padding-left: 8px;
    border-left: 1px solid var(--se-border);
  }
  /* Right-click: where you pointed, and what to copy. */
  .point-menu {
    position: absolute;
    z-index: 8;
    width: 192px;
    padding: 4px;
    background: var(--se-menu-bg);
    color: var(--se-menu-fg);
    border: 1px solid var(--se-menu-border);
    border-radius: var(--se-radius);
    box-shadow: var(--se-shadow-elevated);
    font: var(--se-font-size) var(--se-font-ui);
    outline: none;
  }
  .point-head {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px 8px 6px;
    margin-bottom: 4px;
    border-bottom: 1px solid var(--se-border);
  }
  .point-coords {
    font: 12px var(--se-font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--se-text-primary);
  }
  .point-elev {
    font-size: 12px;
    color: var(--se-text-secondary);
  }
  .point-menu button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 5px 8px;
    border: 0;
    border-radius: var(--se-radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .point-menu button:hover,
  .point-menu button:focus-visible {
    background: var(--se-menu-hover-bg);
    color: var(--se-menu-hover-fg);
    outline: none;
  }
  /* A short map (a big table panel under it): the buttons lie in rows instead of one tall column, so the stack fits
     the strip. The tools of an open purpose open under the buttons, not beside them. */
  @container (max-height: 420px) {
    .map-view .group {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 1px;
      /* A box of up to six buttons stays one row (the navigation group, with Reset view, is six). */
      max-width: 190px;
      /* More than six buttons lie in two even rows (seven are four and three, the last row's buttons wider), never six and one. */
      background: var(--se-border);
    }
    .map-view .group.rows {
      width: calc(var(--cols) * 31px - 1px);
    }
    .map-view .group.rows :global(button) {
      flex: 1 1 0;
      width: auto;
      min-width: 30px;
    }
    .map-view .group :global(button) {
      background: var(--se-control-bg);
      border-top: 0;
    }
    .map-view .group :global(button + button) {
      border-top: 0;
    }
    .map-view .group :global(button.active) {
      background: var(--se-control-active-bg);
    }
  }
  /* The open tools sit beside the buttons, out of the flow: however tall they are, they never push the stack (and so
     the legend under it) around, and fitPalette decides how many columns they need. */
  .pair {
    position: relative;
  }
  .map-view .group.palette {
    position: absolute;
    top: 0;
    left: calc(100% + 6px);
  }
  .map-view .corner.top-right .group.palette,
  .map-view .corner.bottom-right .group.palette {
    left: auto;
    right: calc(100% + 6px);
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
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--se-control-fg);
    cursor: pointer;
  }
  .group :global(button + button) {
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
    outline: 2px solid var(--se-focus);
    outline-offset: -2px;
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
