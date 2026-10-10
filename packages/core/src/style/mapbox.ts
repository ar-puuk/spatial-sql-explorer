// Mapbox GL / MapLibre style JSON (style spec v8): the renderer-native format,
// usable directly in MapLibre, Mapbox Studio, Maputnik, or QGIS's "Import
// Mapbox style". The export is a complete, loadable style document whose
// GeoJSON source points at the data file name (the consumer re-points it);
// our own LayerStyle is also embedded under `metadata` so a round trip
// through Spatial Explorer is lossless even after a tool rewrites paints.
import {
  DEFAULT_LAYER_STYLE,
  parseColor,
  rgbToHex,
  round,
  sanitizeStyle,
  type LayerStyle,
  type StyleGeometry,
  type StyleImportResult,
} from './model.js'
import type { StyleExport } from './qml.js'

const METADATA_KEY = 'spatial-explorer:layer-style'

const POLYGON_FILTER = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const LINE_FILTER = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const POINT_FILTER = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]

export function styleToMapbox(input: LayerStyle, geometry: StyleGeometry, layerName: string, dataFileName: string): StyleExport {
  const style = sanitizeStyle(input)
  const source = 'data'
  const layers: unknown[] = []
  const wants = (g: Exclude<StyleGeometry, 'Mixed'>): boolean => geometry === 'Mixed' || geometry === g
  if (wants('Polygon')) {
    layers.push({
      id: `${layerName}-fill`,
      type: 'fill',
      source,
      filter: POLYGON_FILTER,
      paint: { 'fill-color': style.fillColor, 'fill-opacity': round(style.fillOpacity) },
    })
    if (style.strokeWidth > 0) {
      layers.push({
        id: `${layerName}-outline`,
        type: 'line',
        source,
        filter: POLYGON_FILTER,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': style.strokeColor, 'line-width': round(style.strokeWidth), 'line-opacity': round(style.strokeOpacity) },
      })
    }
  }
  if (wants('LineString')) {
    layers.push({
      id: `${layerName}-line`,
      type: 'line',
      source,
      filter: LINE_FILTER,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': style.strokeColor, 'line-width': round(style.strokeWidth), 'line-opacity': round(style.strokeOpacity) },
    })
  }
  if (wants('Point')) {
    layers.push({
      id: `${layerName}-point`,
      type: 'circle',
      source,
      filter: POINT_FILTER,
      paint: {
        'circle-color': style.fillColor,
        'circle-opacity': round(style.fillOpacity),
        'circle-radius': round(style.pointRadius),
        'circle-stroke-color': style.strokeColor,
        'circle-stroke-width': round(style.strokeWidth),
        'circle-stroke-opacity': round(style.strokeOpacity),
      },
    })
  }
  const doc = {
    version: 8,
    name: `${layerName} style`,
    metadata: { [METADATA_KEY]: style },
    sources: { [source]: { type: 'geojson', data: dataFileName } },
    layers,
  }
  return { text: JSON.stringify(doc, null, 2) + '\n', notes: [] }
}

// --- import ---------------------------------------------------------------

interface StyleLayerJson {
  type?: string
  paint?: Record<string, unknown>
}

export function mapboxToStyle(text: string): StyleImportResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  const notes: string[] = []
  const root = json as { metadata?: Record<string, unknown>; layers?: unknown }

  const embedded = root?.metadata?.[METADATA_KEY]
  if (embedded && typeof embedded === 'object') {
    return { style: sanitizeStyle(embedded as Partial<LayerStyle>), format: 'mapbox', notes }
  }

  const layers: StyleLayerJson[] = Array.isArray(json) ? (json as StyleLayerJson[]) : Array.isArray(root?.layers) ? (root.layers as StyleLayerJson[]) : []
  if (layers.length === 0) throw new Error('This JSON has no style "layers" array.')

  const style: Partial<LayerStyle> = {}
  let skipped = 0
  const color = (v: unknown): { hex: string; a: number } | undefined => {
    if (typeof v !== 'string') {
      if (v !== undefined) skipped++
      return undefined
    }
    const c = parseColor(v)
    return c ? { hex: rgbToHex(c), a: c.a } : undefined
  }
  const num = (v: unknown): number | undefined => {
    if (typeof v === 'number') return v
    if (v !== undefined) skipped++
    return undefined
  }

  const first = (type: string): StyleLayerJson | undefined => layers.find((l) => l.type === type)
  const fillLayer = first('fill')
  const lineLayer = first('line')
  const circleLayer = first('circle')
  if (!fillLayer && !lineLayer && !circleLayer) throw new Error('This style has no fill, line or circle layers.')

  if (fillLayer?.paint) {
    const c = color(fillLayer.paint['fill-color'])
    if (c) style.fillColor = c.hex
    const o = num(fillLayer.paint['fill-opacity'])
    style.fillOpacity = (o ?? 1) * (c?.a ?? 1)
    const outline = color(fillLayer.paint['fill-outline-color'])
    if (outline) style.strokeColor = outline.hex
  } else if (circleLayer?.paint) {
    const c = color(circleLayer.paint['circle-color'])
    if (c) style.fillColor = c.hex
    const o = num(circleLayer.paint['circle-opacity'])
    style.fillOpacity = (o ?? 1) * (c?.a ?? 1)
  }
  if (lineLayer?.paint) {
    const c = color(lineLayer.paint['line-color'])
    if (c) style.strokeColor = c.hex
    const w = num(lineLayer.paint['line-width'])
    if (w !== undefined) style.strokeWidth = w
    const o = num(lineLayer.paint['line-opacity'])
    style.strokeOpacity = (o ?? 1) * (c?.a ?? 1)
  } else if (circleLayer?.paint) {
    const c = color(circleLayer.paint['circle-stroke-color'])
    if (c) style.strokeColor = c.hex
    const w = num(circleLayer.paint['circle-stroke-width'])
    if (w !== undefined) style.strokeWidth = w
  }
  if (circleLayer?.paint) {
    const r = num(circleLayer.paint['circle-radius'])
    if (r !== undefined) style.pointRadius = r
  }
  if (skipped > 0) notes.push('Some paint values are expressions or zoom functions; only literal values were imported.')
  if (layers.filter((l) => ['fill', 'line', 'circle'].includes(l.type ?? '')).length > 3) {
    notes.push('This style has several layers; the first fill, line and circle layers were used.')
  }
  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...style }), format: 'mapbox', notes }
}
