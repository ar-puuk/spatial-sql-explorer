// Mapbox GL / MapLibre style JSON (style spec v8): the renderer-native format,
// usable directly in MapLibre, Mapbox Studio, Maputnik, or QGIS's "Import
// Mapbox style". The export is a complete, loadable style document whose
// GeoJSON source points at the data file name (the consumer re-points it);
// our own LayerStyle is also embedded under `metadata` so a round trip
// through Spatial Explorer is lossless even after a tool rewrites paints.
import { extrusionFromMapbox, extrusionHeightExpression } from './extrusion.js'
import {
  DEFAULT_LAYER_STYLE,
  parseColor,
  rgbToHex,
  round,
  sanitizeStyle,
  type LayerStyle,
  type ResolvedStyle,
  type StyleGeometry,
  type StyleImportResult,
} from './model.js'
import type { StyleExport } from './qml.js'
import { symbolExpressions, visibilityFilter } from './expressions.js'
import { MAPBOX_SHAPE_NOTE, categorizedFrom, graduatedFrom, thematicForExport, type ImportedCategory, type ImportedRange } from './interchange.js'
import { dashFromPattern, dashPattern } from './symbol.js'

const METADATA_KEY = 'spatial-explorer:layer-style'

const POLYGON_FILTER = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const LINE_FILTER = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const POINT_FILTER = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]

export function styleToMapbox(input: LayerStyle, geometry: StyleGeometry, layerName: string, dataFileName: string, resolved?: ResolvedStyle): StyleExport {
  const style = sanitizeStyle(input)
  const source = 'data'
  const layers: unknown[] = []
  const wants = (g: Exclude<StyleGeometry, 'Mixed'>): boolean => geometry === 'Mixed' || geometry === g
  // Thematic: the same class-index expression the viewer draws with (null and
  // "" guarded, upper-inclusive ranges), so any MapLibre/Mapbox renderer
  // shows the same classes; hidden classes become a layer filter.
  const { notes } = thematicForExport(style, resolved)
  // Per-class colors and sizes (size classes) as the viewer draws them.
  // Spec 009: the size channel applies with any color channel, so the expressions come whenever the style is resolved.
  const sym = resolved ? symbolExpressions(style, resolved) : null
  const roundSize = (v: unknown): unknown => (typeof v === 'number' ? round(v) : v)
  const pattern = dashPattern(style.lineDash)
  const dash = pattern ? { 'line-dasharray': pattern } : {}
  if ((style.markerShape ?? 'circle') !== 'circle' && wants('Point')) notes.push(MAPBOX_SHAPE_NOTE(style.markerShape ?? 'circle'))
  const hidden = resolved ? visibilityFilter(style, resolved) : null
  const filter = (f: unknown): unknown => (hidden ? ['all', f, hidden] : f)
  if (wants('Polygon')) {
    layers.push({
      id: `${layerName}-fill`,
      type: 'fill',
      source,
      filter: filter(POLYGON_FILTER),
      paint: { 'fill-color': sym?.fillColor ?? style.fillColor, 'fill-opacity': round(style.fillOpacity) },
    })
    if (style.strokeWidth > 0) {
      layers.push({
        id: `${layerName}-outline`,
        type: 'line',
        source,
        filter: filter(POLYGON_FILTER),
        layout: { 'line-join': 'round' },
        paint: { 'line-color': style.strokeColor, 'line-width': round(style.strokeWidth), 'line-opacity': round(style.strokeOpacity), ...dash },
      })
    }
  }
  // Spec 008 US6: polygon extrusion.
  if (wants('Polygon') && style.extrusion?.enabled) {
    layers.push({
      id: `${layerName}-extrusion`,
      type: 'fill-extrusion',
      source,
      filter: filter(POLYGON_FILTER),
      paint: {
        'fill-extrusion-color': sym?.fillColor ?? style.fillColor,
        'fill-extrusion-height': extrusionHeightExpression(style.extrusion),
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': round(style.layerOpacity ?? 1),
      },
    })
  }
  if (wants('LineString')) {
    layers.push({
      id: `${layerName}-line`,
      type: 'line',
      source,
      filter: filter(LINE_FILTER),
      layout: { 'line-join': 'round', 'line-cap': pattern ? 'butt' : 'round' },
      paint: {
        'line-color': sym?.lineColor ?? style.strokeColor,
        'line-width': roundSize(sym?.lineWidth ?? style.strokeWidth),
        'line-opacity': round(style.strokeOpacity),
        ...dash,
      },
    })
  }
  if (wants('Point')) {
    layers.push({
      id: `${layerName}-point`,
      type: 'circle',
      source,
      filter: filter(POINT_FILTER),
      paint: {
        'circle-color': sym?.fillColor ?? style.fillColor,
        'circle-opacity': round(style.fillOpacity),
        'circle-radius': roundSize(sym?.radius ?? style.pointRadius),
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
  return { text: JSON.stringify(doc, null, 2) + '\n', notes }
}

// --- foreign thematic expressions (no spatial-explorer metadata) -------------

/** The column an expression reads, through to-string / to-number / coalesce wrappers. */
function columnOf(e: unknown): string | null {
  if (!Array.isArray(e)) return null
  if (e[0] === 'get' && typeof e[1] === 'string' && e.length === 2) return e[1]
  if (e[0] === 'to-string' || e[0] === 'to-number' || e[0] === 'number' || e[0] === 'string' || e[0] === 'coalesce') return columnOf(e[1])
  return null
}

const hexOf = (v: unknown): string | undefined => {
  const c = typeof v === 'string' ? parseColor(v) : null
  return c ? rgbToHex(c) : undefined
}

/** Classes from a data-driven color: `match` (categorized), `step` / `interpolate` (graduated). */
function rendererFromColor(e: unknown, notes: string[]): LayerStyle['renderer'] | null {
  if (!Array.isArray(e)) return null
  const op = e[0]
  if (op === 'match') {
    const column = columnOf(e[1])
    if (!column) return null
    const items: ImportedCategory[] = []
    for (let i = 2; i + 1 < e.length; i += 2) {
      const labels = Array.isArray(e[i]) ? (e[i] as unknown[]) : [e[i]]
      for (const l of labels) items.push({ value: String(l), color: hexOf(e[i + 1]) })
    }
    items.push({ value: undefined, color: hexOf(e[e.length - 1]) })
    return categorizedFrom(column, items)
  }
  if (op === 'step' || op === 'interpolate') {
    const isStep = op === 'step'
    const input = isStep ? e[1] : e[2]
    const column = columnOf(input)
    if (!column) return null
    const ranges: ImportedRange[] = []
    if (isStep) {
      // ["step", input, c0, b1, c1, b2, c2, ...]: c0 below b1, ci from bi.
      const breaks: number[] = []
      const colors: Array<string | undefined> = [hexOf(e[2])]
      for (let i = 3; i + 1 < e.length; i += 2) {
        breaks.push(Number(e[i]))
        colors.push(hexOf(e[i + 1]))
      }
      if (!breaks.length || breaks.some((b) => !Number.isFinite(b))) return null
      const span = breaks.length > 1 ? breaks[breaks.length - 1] - breaks[0] : Math.abs(breaks[0]) || 1
      const bounds = [breaks[0] - span, ...breaks, breaks[breaks.length - 1] + span]
      for (let i = 0; i < colors.length; i++) ranges.push({ lower: bounds[i], upper: bounds[i + 1], color: colors[i] })
    } else {
      const stops: Array<[number, string | undefined]> = []
      for (let i = 3; i + 1 < e.length; i += 2) stops.push([Number(e[i]), hexOf(e[i + 1])])
      if (stops.length < 2 || stops.some(([v]) => !Number.isFinite(v))) return null
      for (let i = 0; i + 1 < stops.length; i++) ranges.push({ lower: stops[i][0], upper: stops[i + 1][0], color: stops[i][1] })
      notes.push('A smooth color gradient was imported as classes.')
    }
    notes.push('These classes have no classification method in the file; they were imported as fixed classes (Manual).')
    return graduatedFrom(column, ranges)
  }
  return null
}

// --- import ---------------------------------------------------------------

/** `['interpolate', ['linear'], ['get', col], v0, s0, v1, s1]` (two stops) as a proportional size channel, or null. */
function proportionalFrom(e: unknown, scale: 'linear' | 'area'): LayerStyle['size'] | null {
  if (!Array.isArray(e) || e[0] !== 'interpolate' || !Array.isArray(e[1]) || e[1][0] !== 'linear' || e.length !== 7) return null
  const column = columnOf(e[2])
  const [, , , v0, s0, v1, s1] = e as unknown[]
  if (!column || ![v0, s0, v1, s1].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return { column, mode: 'proportional', method: 'quantile', classCount: 5, classes: [], noValue: {}, sizeMin: s0 as number, sizeMax: s1 as number, scale }
}

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
  if (!fillLayer && !lineLayer && !circleLayer && !first('fill-extrusion')) throw new Error('This style has no fill, line or circle layers.')

  // Data-driven colors (a foreign style, or ours with the metadata stripped).
  const dataColor = fillLayer?.paint?.['fill-color'] ?? circleLayer?.paint?.['circle-color'] ?? (!fillLayer && !circleLayer ? lineLayer?.paint?.['line-color'] : undefined)
  const thematicNotes: string[] = []
  const renderer = Array.isArray(dataColor) ? rendererFromColor(dataColor, thematicNotes) : null
  if (renderer) {
    style.renderer = renderer
    notes.push(...thematicNotes)
  }

  if (fillLayer?.paint) {
    const c = renderer ? undefined : color(fillLayer.paint['fill-color'])
    if (c) style.fillColor = c.hex
    const o = num(fillLayer.paint['fill-opacity'])
    style.fillOpacity = (o ?? 1) * (c?.a ?? 1)
    const outline = color(fillLayer.paint['fill-outline-color'])
    if (outline) style.strokeColor = outline.hex
  } else if (circleLayer?.paint) {
    const c = renderer ? undefined : color(circleLayer.paint['circle-color'])
    if (c) style.fillColor = c.hex
    const o = num(circleLayer.paint['circle-opacity'])
    style.fillOpacity = (o ?? 1) * (c?.a ?? 1)
  }
  if (lineLayer?.paint) {
    const c = renderer && !fillLayer && !circleLayer ? undefined : color(lineLayer.paint['line-color'])
    if (c) style.strokeColor = c.hex
    // Spec 009: a two-stop linear width on a property is a proportional size channel.
    const sizeChannel = proportionalFrom(lineLayer.paint['line-width'], 'linear')
    if (sizeChannel) style.size = sizeChannel
    const w = sizeChannel ? undefined : num(lineLayer.paint['line-width'])
    if (w !== undefined) style.strokeWidth = w
    const o = num(lineLayer.paint['line-opacity'])
    style.strokeOpacity = (o ?? 1) * (c?.a ?? 1)
    const d = lineLayer.paint['line-dasharray']
    if (Array.isArray(d) && d.every((n) => typeof n === 'number')) {
      const dash = dashFromPattern(d as number[])
      if (dash) style.lineDash = dash
    } else if (d !== undefined) skipped++
  } else if (circleLayer?.paint) {
    const c = color(circleLayer.paint['circle-stroke-color'])
    if (c) style.strokeColor = c.hex
    const w = num(circleLayer.paint['circle-stroke-width'])
    if (w !== undefined) style.strokeWidth = w
  }
  if (circleLayer?.paint) {
    const sizeChannel = proportionalFrom(circleLayer.paint['circle-radius'], 'linear')
    if (sizeChannel) style.size = sizeChannel
    const r = sizeChannel ? undefined : num(circleLayer.paint['circle-radius'])
    if (r !== undefined) style.pointRadius = r
  }
  const extrusionLayer = first('fill-extrusion')
  if (extrusionLayer?.paint) {
    const parsed = extrusionFromMapbox(extrusionLayer.paint['fill-extrusion-height'])
    if (parsed) style.extrusion = { enabled: true, ...parsed }
    else notes.push('The fill-extrusion height is not a column, a column times a number, or a constant: extrusion is off.')
  }
  if (skipped > 0) notes.push('Some paint values are expressions or zoom functions; only literal values were imported.')
  if (layers.filter((l) => ['fill', 'line', 'circle'].includes(l.type ?? '')).length > 3) {
    notes.push('This style has several layers; the first fill, line and circle layers were used.')
  }
  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...style }), format: 'mapbox', notes }
}
