// QGIS QML (`<file>.qml`) — the sidecar format. QGIS itself auto-loads a
// same-basename .qml when it opens a layer, so saving one next to the data
// file makes our styling show up in QGIS with no extra steps, and vice versa
// (user decision, design-plan.md §8.5).
//
// Written in the QGIS ≥ 3.26 `<Option type="Map">` property form; the
// importer also reads the legacy `<prop k v>` form older QGIS versions wrote.
// Sizes are written in `Pixel` units so they mean exactly what MapLibre
// renders; on import, QGIS's default millimetre and point units are
// converted at 96 DPI.
import {
  DEFAULT_LAYER_STYLE,
  escapeXml,
  parseColor,
  rgbToHex,
  round,
  sanitizeStyle,
  type LayerStyle,
  type StyleGeometry,
  type StyleImportResult,
} from './model.js'

const PX_PER_MM = 96 / 25.4
const PX_PER_PT = 96 / 72

function qgisColor(hex: string, opacity: number): string {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 }
  return `${c.r},${c.g},${c.b},${Math.round(opacity * 255)}`
}

function options(entries: Record<string, string>): string {
  const rows = Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `            <Option name="${escapeXml(k)}" type="QString" value="${escapeXml(v)}"/>`)
  return `          <Option type="Map">\n${rows.join('\n')}\n          </Option>`
}

function symbolXml(kind: 'fill' | 'line' | 'marker', style: LayerStyle): string {
  let layerClass: string
  let props: Record<string, string>
  if (kind === 'fill') {
    layerClass = 'SimpleFill'
    props = {
      color: qgisColor(style.fillColor, style.fillOpacity),
      style: 'solid',
      outline_color: qgisColor(style.strokeColor, style.strokeOpacity),
      outline_style: style.strokeWidth > 0 ? 'solid' : 'no',
      outline_width: String(round(style.strokeWidth)),
      outline_width_unit: 'Pixel',
      joinstyle: 'round',
    }
  } else if (kind === 'line') {
    layerClass = 'SimpleLine'
    props = {
      line_color: qgisColor(style.strokeColor, style.strokeOpacity),
      line_style: 'solid',
      line_width: String(round(style.strokeWidth)),
      line_width_unit: 'Pixel',
      capstyle: 'round',
      joinstyle: 'round',
    }
  } else {
    layerClass = 'SimpleMarker'
    props = {
      name: 'circle',
      color: qgisColor(style.fillColor, style.fillOpacity),
      outline_color: qgisColor(style.strokeColor, style.strokeOpacity),
      outline_style: style.strokeWidth > 0 ? 'solid' : 'no',
      outline_width: String(round(style.strokeWidth)),
      outline_width_unit: 'Pixel',
      size: String(round(style.pointRadius * 2)),
      size_unit: 'Pixel',
    }
  }
  return `      <symbol type="${kind}" name="0" alpha="1" clip_to_extent="1" force_rhr="0">
        <layer class="${layerClass}" enabled="1" locked="0" pass="0">
${options(props)}
        </layer>
      </symbol>`
}

/** QGIS's `layerGeometryType` enum: 0 point, 1 line, 2 polygon. */
const GEOMETRY_CODE: Record<Exclude<StyleGeometry, 'Mixed'>, number> = { Point: 0, LineString: 1, Polygon: 2 }

export interface StyleExport {
  text: string
  /** Caveats about what the target format could not express. */
  notes: string[]
}

export function styleToQml(input: LayerStyle, geometry: StyleGeometry): StyleExport {
  const style = sanitizeStyle(input)
  const notes: string[] = []
  // A QGIS vector layer has exactly one geometry type, so a single-symbol
  // renderer holds one symbol. Mixed layers get the polygon (fill) symbol,
  // which is also what QGIS shows for a mixed GeoPackage/GeoJSON it splits.
  let geom: Exclude<StyleGeometry, 'Mixed'> = geometry === 'Mixed' ? 'Polygon' : geometry
  if (geometry === 'Mixed') {
    notes.push('QGIS layers have a single geometry type; the mixed layer was exported with its polygon symbol.')
    geom = 'Polygon'
  }
  const kind = geom === 'Point' ? 'marker' : geom === 'LineString' ? 'line' : 'fill'
  const text = `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology">
  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <symbols>
${symbolXml(kind, style)}
    </symbols>
    <rotation/>
    <sizescale/>
  </renderer-v2>
  <layerGeometryType>${GEOMETRY_CODE[geom]}</layerGeometryType>
</qgis>
`
  return { text, notes }
}

// --- import ---------------------------------------------------------------

function readProps(layerEl: Element): Map<string, string> {
  const props = new Map<string, string>()
  // Legacy form: <prop k="color" v="..."/>
  for (const p of Array.from(layerEl.getElementsByTagName('prop'))) {
    const k = p.getAttribute('k')
    const v = p.getAttribute('v')
    if (k && v !== null) props.set(k, v)
  }
  // QGIS ≥ 3.26: <Option type="Map"><Option name="color" value="..."/></Option>.
  // Only the symbol layer's own top-level map — nested maps belong to
  // data-defined properties, not static values.
  const map = Array.from(layerEl.children).find((c) => c.tagName === 'Option' && c.getAttribute('type') === 'Map')
  if (map) {
    for (const o of Array.from(map.children)) {
      const name = o.getAttribute('name')
      const value = o.getAttribute('value')
      if (o.tagName === 'Option' && name && value !== null) props.set(name, value)
    }
  }
  return props
}

function toPx(raw: string | undefined, unit: string | undefined, notes: string[], what: string): number | null {
  if (raw === undefined) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  switch ((unit ?? 'MM').toLowerCase()) {
    case 'pixel':
      return n
    case 'point':
      return n * PX_PER_PT
    case 'inch':
      return n * 96
    case 'mm':
    case '':
      return n * PX_PER_MM
    default:
      notes.push(`The ${what} uses map units ("${unit}"), which a screen-space style cannot reproduce; the default was used.`)
      return null
  }
}

function colorAndAlpha(raw: string | undefined): { hex: string; alpha: number } | null {
  const c = parseColor(raw)
  return c ? { hex: rgbToHex(c), alpha: c.a } : null
}

export function qmlToStyle(text: string): StyleImportResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('This QML file is not valid XML.')
  const renderer = doc.getElementsByTagName('renderer-v2')[0]
  if (!renderer) throw new Error('This QML file has no symbology (no <renderer-v2> element).')

  const notes: string[] = []
  const rendererType = renderer.getAttribute('type') ?? 'singleSymbol'
  if (rendererType !== 'singleSymbol') {
    notes.push(`This QML uses a "${rendererType}" renderer; only its first symbol was imported (categorized and graduated styles are not supported yet).`)
  }
  const symbol = renderer.getElementsByTagName('symbol')[0]
  if (!symbol) throw new Error('This QML renderer contains no symbols.')
  const symbolAlpha = Number(symbol.getAttribute('alpha') ?? '1')
  const alphaMul = Number.isFinite(symbolAlpha) ? symbolAlpha : 1

  const layers = Array.from(symbol.getElementsByTagName('layer')).filter((l) => l.getAttribute('enabled') !== '0')
  if (layers.length === 0) throw new Error('This QML symbol has no enabled symbol layers.')
  if (layers.length > 1) notes.push('This symbol has several stacked symbol layers; only the bottom one was imported.')
  const layerEl = layers[0]
  const cls = layerEl.getAttribute('class') ?? ''
  const p = readProps(layerEl)

  const style: Partial<LayerStyle> = {}
  if (cls === 'SimpleFill') {
    const fill = colorAndAlpha(p.get('color'))
    if (fill) {
      style.fillColor = fill.hex
      style.fillOpacity = p.get('style') === 'no' ? 0 : fill.alpha * alphaMul
    }
    const outline = colorAndAlpha(p.get('outline_color'))
    if (outline) {
      style.strokeColor = outline.hex
      style.strokeOpacity = outline.alpha * alphaMul
    }
    const w = toPx(p.get('outline_width'), p.get('outline_width_unit'), notes, 'outline width')
    if (w !== null) style.strokeWidth = p.get('outline_style') === 'no' ? 0 : w
  } else if (cls === 'SimpleLine') {
    const line = colorAndAlpha(p.get('line_color') ?? p.get('color'))
    if (line) {
      style.strokeColor = line.hex
      style.strokeOpacity = line.alpha * alphaMul
    }
    const w = toPx(p.get('line_width'), p.get('line_width_unit'), notes, 'line width')
    if (w !== null) style.strokeWidth = w
  } else if (cls === 'SimpleMarker') {
    const fill = colorAndAlpha(p.get('color'))
    if (fill) {
      style.fillColor = fill.hex
      style.fillOpacity = fill.alpha * alphaMul
    }
    const outline = colorAndAlpha(p.get('outline_color'))
    if (outline) {
      style.strokeColor = outline.hex
      style.strokeOpacity = outline.alpha * alphaMul
    }
    const w = toPx(p.get('outline_width'), p.get('outline_width_unit'), notes, 'marker outline width')
    if (w !== null) style.strokeWidth = p.get('outline_style') === 'no' ? 0 : w
    const size = toPx(p.get('size'), p.get('size_unit'), notes, 'marker size')
    if (size !== null) style.pointRadius = size / 2
    const shape = p.get('name')
    if (shape && shape !== 'circle') notes.push(`The "${shape}" marker shape was imported as a circle.`)
  } else {
    notes.push(`The "${cls}" symbol layer type is not supported; default colors were kept.`)
  }

  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...style }), format: 'qml', notes }
}
