// Mapbox GL / MapLibre style JSON (style spec v8): the renderer-native format,
// usable directly in MapLibre, Mapbox Studio, Maputnik, or QGIS's "Import
// Mapbox style". The export is a complete, loadable style document whose
// GeoJSON source points at the data file name (the consumer re-points it);
// our own LayerStyle is also embedded under `metadata` so a round trip
// through Spatial Explorer is lossless even after a tool rewrites paints.
import { legacyView } from './legacy.js'
import { paintWithZoom } from './zoom.js'
import { extrusionFromMapbox, extrusionHeightExpression } from './extrusion.js'
import {
  DEFAULT_CLUSTERS,
  DEFAULT_LAYER_STYLE,
  metersPerPixel,
  parseColor,
  rgbToHex,
  round,
  sanitizeStyle,
  type ClusterRenderer,
  type LayerStyle,
  type ResolvedStyle,
  type StyleGeometry,
  type StyleImportResult,
} from './model.js'
import { rendererOf } from './legacy.js'
import type { StyleExport } from './qml.js'
import { CLUSTER_FILTER, clusterPaint, heatmapPaint, symbolExpressions, visibilityFilter } from './expressions.js'
import { COMPLEX_RULES_NOTE, EXPRESSION_NOTE, HEATMAP_RAMP_NOTE, MAPBOX_SHAPE_NOTE, categorizedFrom, graduatedFrom, portableRules, thematicForExport, type ImportedCategory, type ImportedRange } from './interchange.js'
import { hasLike, parseSimpleWhere, type SimpleWhere } from './simpleWhere.js'
import { dashFromPattern, dashPattern } from './symbol.js'
import { CHANNEL_NAMES, CHANNEL_ORDER, OUTPUT_KIND, type ChannelId, type Channels, type ClassDef, type Encoding } from './channels.js'
import { labelLayers, labelTextField } from './labelLayer.js'
import { labelColumnOf, sanitizeLabels, type LabelAnchor, type LabelSettings } from './labels.js'

const METADATA_KEY = 'spatial-explorer:layer-style'

/** Spec 011 US6: label glyphs for other tools (Spatial Explorer draws labels with the system's sans-serif). */
const MAPBOX_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
const MAPBOX_FONT = ['Noto Sans Regular']
export const MAPBOX_FONT_NOTE = "Labels use OpenFreeMap's Noto Sans glyphs in other tools (Spatial Explorer draws them with the system's sans-serif)."

/** Spec 011: shapes by attribute need icons, which a style file can't carry. */
export const MAPBOX_SHAPES_NOTE = "Mapbox GL styles draw marker shapes only from a sprite, which a style file can't carry: other tools draw circles (Spatial Explorer keeps the shapes by attribute)."


const POLYGON_FILTER = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const LINE_FILTER = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]
const POINT_FILTER = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]

/**
 * Spec 010: a simple rule condition as a MapLibre expression, with SQL's
 * rules for missing values (a comparison with NULL matches nothing): numbers
 * and ordered text compare only when the value has the literal's type.
 */
function whereExpression(w: SimpleWhere): unknown {
  if (w.kind !== 'cmp') return [w.kind === 'and' ? 'all' : 'any', ...w.items.map(whereExpression)]
  const get = ['get', w.column]
  const op = w.op === '=' ? '==' : w.op
  if (typeof w.value === 'number' || (w.op !== '=' && w.op !== '!=')) {
    return ['all', ['==', ['typeof', get], typeof w.value === 'number' ? 'number' : 'string'], [op, get, w.value]]
  }
  return w.op === '=' ? ['==', get, w.value] : ['all', ['!=', get, null], ['!=', get, w.value]]
}

export function styleToMapbox(input: LayerStyle, geometry: StyleGeometry, layerName: string, dataFileName: string, resolved?: ResolvedStyle): StyleExport {
  const style = legacyView(sanitizeStyle(input))
  const source = 'data'
  const layers: unknown[] = []
  const wants = (g: Exclude<StyleGeometry, 'Mixed'>): boolean => geometry === 'Mixed' || geometry === g
  // Thematic: the same class-index expression the viewer draws with (null and
  // "" guarded, upper-inclusive ranges), so any MapLibre/Mapbox renderer
  // shows the same classes; hidden classes become a layer filter.
  const { notes } = thematicForExport(style, resolved, 'mapbox')
  // Spec 010: rules and expressions are drawn from columns the engine computes, which a style file can't
  // rely on: rules become a `case` on the data's own columns (when simple), an expression the single color.
  const r = rendererOf(style)
  const computed = r.kind === 'rules' || (r.kind === 'graduated' && !!r.expression)
  const portable = r.kind === 'rules' && resolved?.status === 'ok' ? portableRules(style, resolved, 'mapbox') : null
  if (resolved?.status === 'ok' && r.kind === 'graduated' && r.expression) notes.push(EXPRESSION_NOTE('mapbox'))
  if (resolved?.status === 'ok' && r.kind === 'rules' && !portable) notes.push(COMPLEX_RULES_NOTE)
  const drawn: LayerStyle = computed ? { ...style, renderer: { kind: 'single' } } : style
  // Per-class colors and sizes (size classes) as the viewer draws them.
  // Spec 009: the size channel applies with any color channel, so the expressions come whenever the style is resolved.
  const sym = resolved ? symbolExpressions(drawn, resolved) : null
  let ruleColor: unknown = null
  let ruleHidden: unknown = null
  if (r.kind === 'rules' && portable) {
    const arms = portable.flatMap((p) => [whereExpression(p.where), p.rule.color])
    ruleColor = arms.length ? ['case', ...arms, r.elseColor] : r.elseColor
    const index = portable.length ? ['case', ...portable.flatMap((p) => [whereExpression(p.where), p.index]), -1] : -1
    const hiddenIdx = [...portable.filter((p) => !p.rule.visible).map((p) => p.index), ...(r.elseVisible ? [] : [-1])]
    if (hiddenIdx.length) ruleHidden = ['!', ['in', index, ['literal', hiddenIdx]]]
  }
  const roundSize = (v: unknown): unknown => (typeof v === 'number' ? round(v) : v)
  // Spec 011: outline color and width, pattern and opacity per feature, as the map draws them (symbolExpressions).
  const strokeColor = sym?.strokeColor ?? style.strokeColor
  const strokeWidth = roundSize(sym?.strokeWidth ?? style.strokeWidth)
  const opacity = sym?.opacity ?? style.opacity ?? 1
  const times = (a: number): unknown => (opacity === 1 ? round(a) : typeof opacity === 'number' ? round(a * opacity) : ['*', round(a), opacity])
  const pattern = sym ? sym.dash : dashPattern(style.lineDash)
  const dash = pattern ? { 'line-dasharray': pattern } : {}
  if ((style.markerShape ?? 'circle') !== 'circle' && wants('Point') && !sym?.shape) notes.push(MAPBOX_SHAPE_NOTE(style.markerShape ?? 'circle'))
  if (sym?.shape && wants('Point')) notes.push(MAPBOX_SHAPES_NOTE)
  const colorHidden = resolved ? visibilityFilter(drawn, resolved) : null
  const hidden = colorHidden && ruleHidden ? ['all', colorHidden, ruleHidden] : (colorHidden ?? ruleHidden)
  const fillColor = ruleColor ?? sym?.fillColor ?? style.fillColor
  const lineColor = ruleColor ?? sym?.lineColor ?? style.strokeColor
  const filter = (f: unknown): unknown => (hidden ? ['all', f, hidden] : f)
  if (wants('Polygon')) {
    layers.push({
      id: `${layerName}-fill`,
      type: 'fill',
      source,
      filter: filter(POLYGON_FILTER),
      paint: { 'fill-color': fillColor, 'fill-opacity': times(style.fillOpacity) },
    })
    if (style.strokeWidth > 0 || typeof strokeWidth !== 'number') {
      layers.push({
        id: `${layerName}-outline`,
        type: 'line',
        source,
        filter: filter(POLYGON_FILTER),
        layout: { 'line-join': 'round' },
        paint: { 'line-color': strokeColor, 'line-width': strokeWidth, 'line-opacity': times(style.strokeOpacity), ...dash },
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
        'fill-extrusion-color': fillColor,
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
        'line-color': lineColor,
        'line-width': roundSize(sym?.lineWidth ?? style.lineWidth ?? style.strokeWidth),
        'line-opacity': times(style.strokeOpacity),
        ...dash,
      },
    })
  }
  // A heatmap draws the points (the same paint as the viewer's).
  const heat = r.kind === 'heatmap' && resolved?.status === 'ok' && resolved.heat ? heatmapPaint(style, resolved) : null
  if (wants('Point') && heat) layers.push({ id: `${layerName}-heatmap`, type: 'heatmap', source, filter: POINT_FILTER, paint: heat })
  // Clusters: the source groups points; bubbles and counts as the viewer draws them (mapgl's layers).
  const bubbles = r.kind === 'clusters' && wants('Point') ? clusterPaint(style) : null
  if (bubbles) {
    layers.push({ id: `${layerName}-clusters`, type: 'circle', source, filter: CLUSTER_FILTER, paint: bubbles.bubble })
    layers.push({ id: `${layerName}-cluster-count`, type: 'symbol', source, filter: CLUSTER_FILTER, layout: { ...bubbles.count.layout, 'text-font': MAPBOX_FONT }, paint: bubbles.count.paint })
    notes.push(MAPBOX_FONT_NOTE)
  }
  if (wants('Point') && !heat) {
    layers.push({
      id: `${layerName}-point`,
      type: 'circle',
      source,
      filter: bubbles ? ['all', filter(POINT_FILTER), ['!', CLUSTER_FILTER]] : filter(POINT_FILTER),
      paint: {
        'circle-color': fillColor,
        'circle-opacity': times(style.fillOpacity),
        'circle-radius': roundSize(sym?.radius ?? style.pointRadius),
        'circle-stroke-color': strokeColor,
        'circle-stroke-width': strokeWidth,
        'circle-stroke-opacity': times(style.strokeOpacity),
      },
    })
  }
  // Spec 011 US6: labels, as the map's own label layers, reading a column (a style file can't run SQL).
  const labels = resolved && style.labels?.enabled ? labelLayers(drawn, resolved) : null
  const labelColumn = style.labels ? labelColumnOf(style.labels) : null
  if (labels && style.labels && labelColumn) {
    if (style.labels.source.kind === 'expression') notes.push(`Mapbox GL labels read one column: the labels show "${labelColumn}", not the expression.`)
    notes.push(MAPBOX_FONT_NOTE)
    const text = ['coalesce', ['to-string', ['get', labelColumn]], '']
    const swap = (e: unknown): unknown => JSON.parse(JSON.stringify(e).split(JSON.stringify(labelTextField(style.labels as LabelSettings))).join(JSON.stringify(text)))
    for (const [id, suffix] of [['label', 'labels'], ['label-line', 'line-labels']] as const) {
      const spec = labels[id]
      if (id === 'label' && !wants('Point') && !wants('Polygon')) continue
      if (id === 'label-line' && !wants('LineString')) continue
      layers.push({ id: `${layerName}-${suffix}`, type: 'symbol', source, filter: swap(spec.filter), layout: { ...(swap(spec.layout) as object), 'text-font': MAPBOX_FONT }, paint: spec.paint })
    }
  }
  // Spec 011 US4: properties by conditions read the rule index the engine computes, which a style file
  // can't: simple conditions become a case over the data's own columns, others everything else's output.
  for (const id of CHANNEL_ORDER) {
    const enc = style.channels?.[id]
    const rc = resolved?.channels?.[id]
    if (id === 'color' || enc?.scale.kind !== 'conditions' || rc?.status !== 'ok') continue
    const rules = enc.scale.rules
    const errors = new Set(rc.classes.flatMap((c) => (c.kind === 'rule' && c.error && c.ruleId ? [c.ruleId] : [])))
    const parsed = rules.map((r) => (errors.has(r.id) || !r.where.trim() ? null : parseSimpleWhere(r.where)))
    const portable = rules.every((r, i) => errors.has(r.id) || !r.where.trim() || (parsed[i] && !hasLike(parsed[i])))
    const arms = portable ? parsed.flatMap((w, i) => (w ? [whereExpression(w), i] : [])) : []
    const index = arms.length ? ['case', ...arms, -1] : -1
    if (!portable) notes.push(`${CHANNEL_NAMES[id]}: conditions other than simple comparisons can't be written to Mapbox GL; everything takes "${enc.scale.else.label}".`)
    const from = JSON.stringify(['get', rc.dataColumn])
    for (const l of layers as Array<Record<string, unknown>>) {
      for (const part of ['paint', 'layout', 'filter'] as const) {
        if (l[part] !== undefined) l[part] = JSON.parse(JSON.stringify(l[part]).split(from).join(JSON.stringify(index)))
      }
    }
  }
  // Spec 025: the zoom range is Mapbox GL's own layer minzoom and maxzoom; sizes that follow the zoom are zoom expressions.
  if (style.zoom) {
    for (const l of layers as Array<Record<string, unknown>>) {
      if (style.zoom.min !== undefined) l.minzoom = style.zoom.min
      if (style.zoom.max !== undefined) l.maxzoom = style.zoom.max
      if (l.paint && typeof l.paint === 'object') l.paint = paintWithZoom(l.paint as Record<string, unknown>, style.zoom)
    }
  }
  const doc = {
    version: 8,
    name: `${layerName} style`,
    metadata: { [METADATA_KEY]: style },
    ...((labels && labelColumn) || bubbles ? { glyphs: MAPBOX_GLYPHS } : {}),
    sources: { [source]: { type: 'geojson', data: dataFileName, ...(bubbles && r.kind === 'clusters' ? { cluster: true, clusterRadius: r.radius, clusterMaxZoom: r.maxZoom } : {}) } },
    layers,
  }
  return { text: JSON.stringify(doc, null, 2) + '\n', notes }
}

// --- clusters (a clustered GeoJSON source and its bubble layer) --------------

/** A step expression over `point_count`: its base value and its [count, value] steps, or null. */
function countSteps(e: unknown): { base: unknown; steps: Array<[number, unknown]> } | null {
  if (!Array.isArray(e) || e[0] !== 'step' || JSON.stringify(e[1]) !== '["get","point_count"]') return null
  const steps: Array<[number, unknown]> = []
  for (let i = 3; i + 1 < e.length; i += 2) {
    if (typeof e[i] !== 'number') return null
    steps.push([e[i] as number, e[i + 1]])
  }
  return { base: e[2], steps }
}

/** Our clusters from a clustered style (mapgl's cluster_options writes this shape). */
function clustersFromMapbox(root: { sources?: unknown }, bubble: StyleLayerJson, layers: StyleLayerJson[], notes: string[]): ClusterRenderer | null {
  const sourceId = (bubble as { source?: unknown }).source
  const src = typeof sourceId === 'string' ? ((root.sources as Record<string, Record<string, unknown>> | undefined)?.[sourceId] ?? null) : null
  const p = bubble.paint ?? {}
  const color = countSteps(p['circle-color']) ?? (typeof p['circle-color'] === 'string' ? { base: p['circle-color'], steps: [] } : null)
  const radius = countSteps(p['circle-radius']) ?? (typeof p['circle-radius'] === 'number' ? { base: p['circle-radius'], steps: [] } : null)
  if (!color || typeof color.base !== 'string') {
    notes.push("The cluster bubbles' colors aren't steps by count: the default steps were used.")
  }
  // One step per count either expression starts at; each takes the color and radius in force there.
  const counts = [...new Set([...(color?.steps ?? []), ...(radius?.steps ?? [])].map(([n]) => n))].filter((n) => n > 1).sort((a, b) => a - b)
  const at = (sv: { base: unknown; steps: Array<[number, unknown]> } | null, n: number): unknown => {
    if (!sv) return undefined
    let v = sv.base
    for (const [from, value] of sv.steps) if (n >= from) v = value
    return v
  }
  const steps = [2, ...counts].map((from) => ({
    from,
    color: typeof at(color, from) === 'string' ? (at(color, from) as string) : DEFAULT_CLUSTERS.steps[0].color,
    radius: typeof at(radius, from) === 'number' ? (at(radius, from) as number) : DEFAULT_CLUSTERS.steps[0].radius,
  }))
  const count = layers.find((l) => l.type === 'symbol' && JSON.stringify((l as { filter?: unknown }).filter ?? null) === JSON.stringify(CLUSTER_FILTER))
  const text = (count as { layout?: Record<string, unknown> } | undefined)?.layout?.['text-field']
  const textColor = (count?.paint ?? {})['text-color']
  const countFormat = JSON.stringify(text ?? '').includes('number-format') ? 'grouped' : Array.isArray(text) && text[0] === 'to-string' ? 'raw' : 'abbreviated'
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  if (src && src.cluster !== true) notes.push("The bubbles' source isn't clustered in this style; here the points are grouped.")
  return {
    kind: 'clusters',
    ...DEFAULT_CLUSTERS,
    steps: color || radius ? steps : DEFAULT_CLUSTERS.steps.map((st) => ({ ...st })),
    countFormat,
    ...(num(src?.clusterRadius) !== undefined ? { radius: num(src?.clusterRadius) as number } : {}),
    ...(num(src?.clusterMaxZoom) !== undefined ? { maxZoom: num(src?.clusterMaxZoom) as number } : {}),
    ...(typeof textColor === 'string' ? { textColor } : {}),
    ...(num(p['circle-opacity']) !== undefined ? { opacity: num(p['circle-opacity']) as number } : {}),
    ...(typeof p['circle-stroke-color'] === 'string' ? { strokeColor: p['circle-stroke-color'] } : {}),
    ...(num(p['circle-stroke-width']) !== undefined ? { strokeWidth: num(p['circle-stroke-width']) as number } : {}),
  }
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

/**
 * Spec 011: a property by a column from a data-driven paint value: `match`
 * over one `get` (categories) or `step` over one `get` (classes); null for
 * anything else. Colors are read as hex, numbers as they are.
 */
function encodingFromMapbox(id: ChannelId, e: unknown): Encoding | null {
  if (!Array.isArray(e)) return null
  const output = (v: unknown): ClassDef | null => {
    if (OUTPUT_KIND[id] === 'color') {
      const hex = hexOf(v)
      return hex ? { output: hex } : null
    }
    return typeof v === 'number' && Number.isFinite(v) ? { output: id === 'opacity' ? Math.min(1, Math.max(0, v)) : v } : null
  }
  if (e[0] === 'match') {
    const column = columnOf(e[1])
    const other = output(e[e.length - 1])
    if (!column || !other) return null
    const categories: Array<ClassDef & { value: string }> = []
    for (let i = 2; i + 1 < e.length; i += 2) {
      const o = output(e[i + 1])
      if (!o) return null
      for (const l of Array.isArray(e[i]) ? (e[i] as unknown[]) : [e[i]]) categories.push({ value: String(l), ...o })
    }
    return { source: { kind: 'column', column }, scale: { kind: 'categories', manual: true, categories, other, noValue: other, cap: Math.max(categories.length, 1) } }
  }
  // Spec 011 US4: two stops of a linear interpolate over one get: continuous numbers.
  if (e[0] === 'interpolate' && Array.isArray(e[1]) && e[1][0] === 'linear' && e.length === 7 && OUTPUT_KIND[id] !== 'color') {
    const column = columnOf(e[2])
    const [d0, o0, d1, o1] = e.slice(3) as unknown[]
    const lo = output(o0)
    const hi = output(o1)
    if (!column || typeof d0 !== 'number' || typeof d1 !== 'number' || d0 === d1 || !lo || !hi) return null
    return { source: { kind: 'column', column }, scale: { kind: 'continuous', domain: { min: Math.min(d0, d1), max: Math.max(d0, d1) }, range: { min: Number(lo.output), max: Number(hi.output) }, noValue: {} } }
  }
  if (e[0] === 'step') {
    const column = columnOf(e[1])
    if (!column) return null
    const outs = [output(e[2])]
    const breaks: number[] = []
    for (let i = 3; i + 1 < e.length; i += 2) {
      breaks.push(Number(e[i]))
      outs.push(output(e[i + 1]))
    }
    if (!breaks.length || breaks.some((b) => !Number.isFinite(b)) || outs.some((o) => !o) || outs.length > 10) return null
    // As the color classes: the open ends are closed one span away.
    const span = breaks.length > 1 ? breaks[breaks.length - 1] - breaks[0] : Math.abs(breaks[0]) || 1
    const bounds = [breaks[0] - span, ...breaks, breaks[breaks.length - 1] + span]
    const classes = outs.map((o, index) => ({ index, lower: bounds[index], upper: bounds[index + 1], ...(o as ClassDef) }))
    return { source: { kind: 'column', column }, scale: { kind: 'classes', method: 'manual', classCount: classes.length, classes, noValue: {} } }
  }
  return null
}

/** `['interpolate', ['linear'], ['get', col], v0, s0, v1, s1]` (two stops) as a proportional size channel, or null. */
function proportionalFrom(e: unknown, scale: 'linear' | 'area'): LayerStyle['size'] | null {
  if (!Array.isArray(e) || e[0] !== 'interpolate' || !Array.isArray(e[1]) || e[1][0] !== 'linear' || e.length !== 7) return null
  const column = columnOf(e[2])
  const [, , , v0, s0, v1, s1] = e as unknown[]
  if (!column || ![v0, s0, v1, s1].every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return { column, mode: 'proportional', method: 'quantile', classCount: 5, classes: [], noValue: {}, sizeMin: s0 as number, sizeMax: s1 as number, scale }
}

/** MapLibre's text anchor (the side touching the point) for each of our anchors. */
const TEXT_ANCHOR: Record<LabelAnchor, string> = { above: 'bottom', below: 'top', left: 'right', right: 'left', center: 'center' }

/** Labels from a symbol layer: text from one property (an expression over `get`, or a `{field}` token), size, colors, anchor and offset. */
function labelsFromMapbox(layout: Record<string, unknown>, paint: Record<string, unknown>, notes: string[]): LabelSettings | undefined {
  const field = layout['text-field']
  const token = typeof field === 'string' ? /^\{([^}]+)\}$/.exec(field.trim())?.[1] : undefined
  const getIn = (e: unknown): string | null => {
    if (!Array.isArray(e)) return null
    if (e[0] === 'get' && typeof e[1] === 'string') return e[1]
    for (const x of e.slice(1)) {
      const c = getIn(x)
      if (c) return c
    }
    return null
  }
  const column = token ?? getIn(field)
  if (!column) {
    notes.push("The label text isn't read from one property; labels were not imported.")
    return undefined
  }
  const size = typeof layout['text-size'] === 'number' ? (layout['text-size'] as number) : 16
  // Ours choose by geometry (`case`: polygons centered); the last branch is the points'.
  const pointBranch = (v: unknown): unknown => (Array.isArray(v) && v[0] === 'case' ? v[v.length - 1] : v)
  const anchorRaw = pointBranch(layout['text-anchor'])
  const anchor = (Object.keys(TEXT_ANCHOR) as LabelAnchor[]).find((a) => TEXT_ANCHOR[a] === anchorRaw) ?? 'center'
  const off = pointBranch(layout['text-offset'])
  const pair = Array.isArray(off) && off[0] === 'literal' ? off[1] : off
  const em = Array.isArray(pair) && pair.length === 2 && pair.every((n) => typeof n === 'number') ? Math.max(Math.abs(pair[0] as number), Math.abs(pair[1] as number)) : 0
  const hex = (v: unknown) => (typeof v === 'string' ? hexOf(v) : undefined)
  const haloWidth = typeof paint['text-halo-width'] === 'number' ? (paint['text-halo-width'] as number) : 0
  return sanitizeLabels({
    enabled: (layout.visibility ?? 'visible') !== 'none',
    source: { kind: 'column', column },
    size,
    color: hex(paint['text-color']),
    halo: { enabled: haloWidth > 0, color: hex(paint['text-halo-color']), width: haloWidth > 0 ? haloWidth : undefined },
    placement: { kind: 'point', anchor, offset: round(em * size, 1) },
  })
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
  const root = json as { metadata?: Record<string, unknown>; layers?: unknown; sources?: unknown }

  const embedded = root?.metadata?.[METADATA_KEY]
  if (embedded && typeof embedded === 'object') {
    return { style: sanitizeStyle(embedded as Partial<LayerStyle>), format: 'mapbox', notes }
  }

  const layers: StyleLayerJson[] = Array.isArray(json) ? (json as StyleLayerJson[]) : Array.isArray(root?.layers) ? (root.layers as StyleLayerJson[]) : []
  if (layers.length === 0) throw new Error('This JSON has no style "layers" array.')

  const style: Partial<LayerStyle> = {}
  let skipped = 0
  // Spec 011: data-driven values read as properties by a column (not counted as skipped).
  const consumed = new Set<unknown>()
  const color = (v: unknown): { hex: string; a: number } | undefined => {
    if (consumed.has(v)) return undefined
    if (typeof v !== 'string') {
      if (v !== undefined) skipped++
      return undefined
    }
    const c = parseColor(v)
    return c ? { hex: rgbToHex(c), a: c.a } : undefined
  }
  const num = (v: unknown): number | undefined => {
    if (consumed.has(v)) return undefined
    if (typeof v === 'number') return v
    if (v !== undefined) skipped++
    return undefined
  }

  const first = (type: string): StyleLayerJson | undefined => layers.find((l) => l.type === type)
  // A heatmap layer: radius and intensity when literal, the weight's column when it reads one.
  const heatLayer = first('heatmap')
  if (heatLayer) {
    const p = heatLayer.paint ?? {}
    const columnIn = (e: unknown): string | null => {
      if (!Array.isArray(e)) return null
      if (e[0] === 'get' && typeof e[1] === 'string') return e[1]
      for (const x of e.slice(1)) {
        const c = columnIn(x)
        if (c) return c
      }
      return null
    }
    const weight = columnIn(p['heatmap-weight']) ?? ''
    if (p['heatmap-weight'] !== undefined && typeof p['heatmap-weight'] !== 'number' && !weight) notes.push('The heatmap weight reads no column: each point counts once.')
    if (p['heatmap-color'] !== undefined) notes.push(HEATMAP_RAMP_NOTE)
    // A radius that doubles with each zoom level is a ground distance (ours: meters).
    const zr = p['heatmap-radius']
    let meters: number | null = null
    if (Array.isArray(zr) && zr[0] === 'interpolate' && JSON.stringify(zr[1]) === '["exponential",2]' && JSON.stringify(zr[2]) === '["zoom"]' && zr.length === 7) {
      const [z0, r0, z1, r1] = zr.slice(3) as number[]
      if ([z0, r0, z1, r1].every(Number.isFinite) && r0 > 0 && Math.abs(r1 / r0 / 2 ** (z1 - z0) - 1) < 1e-6) meters = Number((r0 * metersPerPixel(0, z0)).toPrecision(6))
    }
    if (meters !== null) notes.push('The heatmap radius is fixed on the map; it was read as meters at the equator.')
    else if ([zr, p['heatmap-intensity']].some((v) => v !== undefined && typeof v !== 'number')) notes.push('The heatmap radius or intensity changes with zoom; the defaults were used.')
    style.renderer = {
      kind: 'heatmap',
      weight,
      ...(typeof p['heatmap-radius'] === 'number' ? { radius: p['heatmap-radius'] } : {}),
      ...(meters !== null ? { radiusUnit: 'm', radiusMeters: meters } : {}),
      ...(typeof p['heatmap-intensity'] === 'number' ? { intensity: p['heatmap-intensity'] } : {}),
    } as LayerStyle['renderer']
    if (typeof p['heatmap-opacity'] === 'number' && p['heatmap-opacity'] < 1) style.layerOpacity = p['heatmap-opacity']
  }
  // Clusters: a circle layer over groups (`has point_count`), its color and radius stepping by count.
  const isGroups = (l: StyleLayerJson): boolean => JSON.stringify((l as { filter?: unknown }).filter ?? null) === JSON.stringify(CLUSTER_FILTER)
  const bubbleLayer = layers.find((l) => l.type === 'circle' && isGroups(l))
  if (bubbleLayer) {
    const clusters = clustersFromMapbox(root, bubbleLayer, layers, notes)
    if (clusters) style.renderer = clusters
  }
  const fillLayer = first('fill')
  const lineLayer = first('line')
  const circleLayer = layers.find((l) => l.type === 'circle' && !isGroups(l))
  if (!fillLayer && !lineLayer && !circleLayer && !heatLayer && !first('fill-extrusion')) throw new Error('This style has no fill, line, circle or heatmap layers.')

  // Data-driven colors (a foreign style, or ours with the metadata stripped).
  const dataColor = fillLayer?.paint?.['fill-color'] ?? circleLayer?.paint?.['circle-color'] ?? (!fillLayer && !circleLayer ? lineLayer?.paint?.['line-color'] : undefined)
  const thematicNotes: string[] = []
  const renderer = !heatLayer && Array.isArray(dataColor) ? rendererFromColor(dataColor, thematicNotes) : null
  if (renderer) {
    style.renderer = renderer
    notes.push(...thematicNotes)
  }

  // Spec 011: other properties by a column (match / step over one get).
  const channels: Channels = {}
  const outlineLayer = layers.find((l, i) => l.type === 'line' && fillLayer && i > layers.indexOf(fillLayer)) ?? (fillLayer ? lineLayer : undefined)
  const dataDriven: Array<[ChannelId, unknown]> = [
    ['strokeColor', circleLayer?.paint?.['circle-stroke-color'] ?? (fillLayer ? outlineLayer?.paint?.['line-color'] : undefined)],
    ['strokeWidth', circleLayer?.paint?.['circle-stroke-width'] ?? (fillLayer ? outlineLayer?.paint?.['line-width'] : undefined)],
    ['opacity', (fillLayer ?? circleLayer ?? lineLayer)?.paint?.[fillLayer ? 'fill-opacity' : circleLayer ? 'circle-opacity' : 'line-opacity']],
  ]
  if (!fillLayer && !circleLayer && lineLayer && !proportionalFrom(lineLayer.paint?.['line-width'], 'linear')) dataDriven.push(['width', lineLayer.paint?.['line-width']])
  for (const [id, value] of dataDriven) {
    const enc = Array.isArray(value) ? encodingFromMapbox(id, value) : null
    if (enc) {
      channels[id] = enc
      consumed.add(value)
    }
  }
  if (Object.keys(channels).length) style.channels = channels

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
  // Spec 011 US6: the first symbol layer with text, as labels.
  const labelLayer = layers.find((l) => l.type === 'symbol' && (l as { layout?: Record<string, unknown> }).layout?.['text-field'] !== undefined) as (StyleLayerJson & { layout?: Record<string, unknown> }) | undefined
  if (labelLayer) {
    const labels = labelsFromMapbox(labelLayer.layout ?? {}, labelLayer.paint ?? {}, notes)
    if (labels) style.labels = labels
  }
  if (skipped > 0) notes.push('Some paint values are expressions or zoom functions; only literal values were imported.')
  if (layers.filter((l) => ['fill', 'line', 'circle'].includes(l.type ?? '')).length > 3) {
    notes.push('This style has several layers; the first fill, line and circle layers were used.')
  }
  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...style }), format: 'mapbox', notes }
}
