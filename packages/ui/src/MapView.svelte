<script lang="ts">
  import { Map as MapLibreMap, GeoJSONSource, type LayerSpecification, type MapMouseEvent, type MapLayerMouseEvent } from 'maplibre-gl'
  import 'maplibre-gl/dist/maplibre-gl.css'
  import { onMount, onDestroy } from 'svelte'
  import type { Layer } from '@spatial-explorer/core'

  interface Props {
    layer: Layer | null
    selectedFeatureId: string | number | null
    onSelectFeature: (id: string | number | null) => void
    onCursorMove: (coords: { lon: number; lat: number } | null) => void
  }
  let { layer, selectedFeatureId, onSelectFeature, onCursorMove }: Props = $props()

  let container: HTMLDivElement
  let map: MapLibreMap | null = null

  const SOURCE_ID = 'layer-source'

  // Renders all geometry types present in a layer, including mixed-geometry
  // layers (FR-013) — one MapLibre layer per base geometry shape, filtered
  // via the `geometry-type` style expression.
  const GEOMETRY_LAYER_DEFS: Array<{ id: string; type: 'fill' | 'line' | 'circle'; filter: unknown; paint: Record<string, unknown> }> = [
    {
      id: 'fill',
      type: 'fill',
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: { 'fill-color': '#3388ff', 'fill-opacity': 0.35 },
    },
    {
      id: 'fill-outline',
      type: 'line',
      filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
      paint: { 'line-color': '#3388ff', 'line-width': 1 },
    },
    {
      id: 'line',
      type: 'line',
      filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
      paint: { 'line-color': '#3388ff', 'line-width': 2 },
    },
    {
      id: 'circle',
      type: 'circle',
      filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
      paint: { 'circle-color': '#3388ff', 'circle-radius': 5, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
    },
  ]

  function toFeatureCollection(l: Layer): GeoJSON.FeatureCollection {
    // Svelte 5's $state wraps Layer (and its nested features/geometry) in
    // reactive Proxy objects (structuredClone refuses to clone them
    // directly: "could not be cloned", confirmed via Playwright). Passing a
    // geometry Proxy straight into maplibre-gl's worker-update serializer
    // (the $effect below reads the reactive `layer` to call this) hits a
    // real MapLibre bug: its generic serialize() walk re-visits the proxied
    // object's underlying target through proxy traps and double-counts its
    // transferables, throwing "DataCloneError: ArrayBuffer at index N is a
    // duplicate of an earlier ArrayBuffer". A JSON round-trip (proxies
    // support JSON.stringify's traps fine, unlike structuredClone) yields
    // plain, non-proxied objects before they ever reach MapLibre.
    return JSON.parse(
      JSON.stringify({
        type: 'FeatureCollection',
        features: l.features
          .filter((f) => f.geometry !== null)
          .map((f) => ({
            type: 'Feature',
            properties: { ...f.attributes, __id: String(f.id) },
            geometry: f.geometry as GeoJSON.Geometry,
          })),
      })
    ) as GeoJSON.FeatureCollection
  }

  function addLayers(): void {
    if (!map) return
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    for (const def of GEOMETRY_LAYER_DEFS) {
      map.addLayer({ id: def.id, type: def.type, source: SOURCE_ID, filter: def.filter, paint: def.paint } as unknown as LayerSpecification)
    }
    map.addLayer({
      id: 'highlight',
      type: 'line',
      source: SOURCE_ID,
      filter: ['==', ['get', '__id'], ''],
      paint: { 'line-color': '#ff6600', 'line-width': 3 },
    } as unknown as LayerSpecification)

    for (const def of GEOMETRY_LAYER_DEFS) {
      map.on('click', def.id, (e: MapLayerMouseEvent) => {
        const feature = e.features?.[0]
        const rawId = feature?.properties?.__id
        onSelectFeature(rawId !== undefined ? rawId : null)
      })
    }

    map.on('mousemove', (e: MapMouseEvent) => onCursorMove({ lon: e.lngLat.lng, lat: e.lngLat.lat }))
    map.on('mouseout', () => onCursorMove(null))
  }

  function updateData(): void {
    if (!map) return
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined
    source?.setData(layer ? toFeatureCollection(layer) : { type: 'FeatureCollection', features: [] })
  }

  function fitExtent(): void {
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
      { padding: 20, animate: false }
    )
  }

  // A single $effect (depending on both mapReady and layer) is the only
  // place that calls source.setData() — addSource() itself can't be given
  // the real data up front, since the layer may not have loaded yet when
  // the map first mounts, so this effect is what delivers it once both the
  // map and the layer are ready.
  let mapReady = $state(false)

  onMount(() => {
    map = new MapLibreMap({
      container,
      // Blank background — a basemap is spec 004/User Story 4, not this spec.
      style: { version: 8, sources: {}, layers: [] },
      center: [0, 0],
      zoom: 1,
      attributionControl: false,
    })
    map.on('load', () => {
      addLayers()
      mapReady = true
    })
  })

  onDestroy(() => {
    map?.remove()
    map = null
  })

  $effect(() => {
    layer
    if (mapReady) {
      updateData()
      fitExtent()
    }
  })

  $effect(() => {
    if (map?.getLayer('highlight')) {
      map.setFilter('highlight', ['==', ['get', '__id'], selectedFeatureId !== null && selectedFeatureId !== undefined ? String(selectedFeatureId) : ''])
    }
  })
</script>

<div class="map-view" bind:this={container}></div>

<style>
  .map-view {
    width: 100%;
    height: 100%;
  }
</style>
