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
  type ResolvedStyle,
  type StyleGeometry,
  type StyleImportResult,
} from './model.js'
import { QGIS_METHODS, QGIS_METHOD_IDS, categorizedFrom, graduatedFrom, thematicForExport, type ImportedCategory, type ImportedRange, type Thematic } from './interchange.js'

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

function symbolXml(kind: 'fill' | 'line' | 'marker', style: LayerStyle, name = '0'): string {
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
  return `      <symbol type="${kind}" name="${name}" alpha="1" clip_to_extent="1" force_rhr="0">
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

/** QGIS's QVariant type name for a category value of a DuckDB column type (spike: QGIS 4.2.3). */
function categoryType(columnType: string | undefined): string {
  const t = (columnType ?? '').toUpperCase()
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|U\w*INT|INT\d?)$/.test(t)) return 'long'
  if (/^(FLOAT|DOUBLE|REAL|DECIMAL|NUMERIC)/.test(t)) return 'double'
  if (t === 'BOOLEAN') return 'bool'
  return 'string'
}

/** One symbol per class: the shared symbol with only the class color changed (FR-006). */
function classStyle(style: LayerStyle, kind: 'fill' | 'line' | 'marker', color: string): LayerStyle {
  return kind === 'line' ? { ...style, strokeColor: color } : { ...style, fillColor: color }
}

/** Spatial Explorer's own settings QGIS has no field for, as QGIS custom properties. */
function customProperties(entries: Record<string, string>): string {
  const rows = Object.entries(entries).map(([k, v]) => `      <Option name="${escapeXml(k)}" type="QString" value="${escapeXml(v)}"/>`)
  return rows.length ? `  <customproperties>\n    <Option type="Map">\n${rows.join('\n')}\n    </Option>\n  </customproperties>\n` : ''
}

function thematicRenderer(style: LayerStyle, kind: 'fill' | 'line' | 'marker', th: Thematic, columnType: string | undefined): { renderer: string; props: Record<string, string> } {
  const r = th.renderer
  const symbols = th.classes.map((c, i) => symbolXml(kind, classStyle(style, kind, c.color), String(i))).join('\n')
  const props: Record<string, string> = { 'spatialExplorer/ramp': r.ramp.id, 'spatialExplorer/rampReversed': String(r.ramp.reversed) }
  if (r.kind === 'categorized') {
    props['spatialExplorer/categories'] = r.manual ? 'manual' : 'auto'
    props['spatialExplorer/cap'] = String(r.cap)
    const type = categoryType(columnType)
    const rows = th.classes.map((c, i) => {
      // QGIS: an empty value is "all other values"; a NULL-typed one matches nulls.
      const [value, vtype] = c.kind === 'noValue' ? ['NULL', 'NULL'] : c.kind === 'other' ? ['', 'string'] : [c.value ?? '', type]
      return `      <category value="${escapeXml(value)}" type="${vtype}" label="${escapeXml(c.label)}" render="${c.visible}" symbol="${i}"/>`
    })
    return {
      props,
      renderer: `  <renderer-v2 type="categorizedSymbol" attr="${escapeXml(r.column)}" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <categories>
${rows.join('\n')}
    </categories>
    <symbols>
${symbols}
    </symbols>
    <rotation/>
    <sizescale/>
  </renderer-v2>`,
    }
  }
  if (r.method === 'manual') props['spatialExplorer/method'] = 'manual'
  const ranges = th.classes.flatMap((c, i) =>
    c.kind === 'range' ? [`      <range lower="${c.lower}" upper="${c.upper}" label="${escapeXml(c.label)}" render="${c.visible}" symbol="${i}"/>`] : []
  )
  const method = r.method === 'manual' ? '' : `    <classificationMethod id="${QGIS_METHOD_IDS[r.method]}"/>\n`
  const noValue = th.classes.findIndex((c) => c.kind === 'noValue')
  if (noValue !== -1) {
    // QGIS draws nulls in no class; the "No value" color is kept for us.
    const c = th.classes[noValue]
    props['spatialExplorer/noValue'] = JSON.stringify({ color: c.color, label: c.label, visible: c.visible })
  }
  return {
    props,
    renderer: `  <renderer-v2 type="graduatedSymbol" attr="${escapeXml(r.column)}" graduatedMethod="GraduatedColor" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <ranges>
${ranges.join('\n')}
    </ranges>
    <symbols>
${symbols}
    </symbols>
${method}    <rotation/>
    <sizescale/>
  </renderer-v2>`,
  }
}

export function styleToQml(input: LayerStyle, geometry: StyleGeometry, resolved?: ResolvedStyle, columnType?: string): StyleExport {
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
  const { thematic, notes: thematicNotes } = thematicForExport(style, resolved)
  notes.push(...thematicNotes)
  let renderer = `  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <symbols>
${symbolXml(kind, style)}
    </symbols>
    <rotation/>
    <sizescale/>
  </renderer-v2>`
  let props: Record<string, string> = {}
  if (thematic) ({ renderer, props } = thematicRenderer(style, kind, thematic, columnType))
  // Spec 008: QGIS loads only the categories listed: layer opacity is in
  // Rendering, and polygon extrusion in Symbology3D (checked with QGIS 4.2.3).
  const text = `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology|Symbology3D|Rendering|CustomProperties">
${renderer}
${customProperties(props)}  <layerOpacity>${round(style.layerOpacity ?? 1)}</layerOpacity>
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

/** The color a class symbol carries: fill for fill and marker symbols, line color for line symbols. */
function symbolColor(symbol: Element): string | null {
  const layer = Array.from(symbol.getElementsByTagName('layer')).find((l) => l.getAttribute('enabled') !== '0')
  if (!layer) return null
  const p = readProps(layer)
  const c = parseColor(layer.getAttribute('class') === 'SimpleLine' ? (p.get('line_color') ?? p.get('color')) : p.get('color'))
  return c ? rgbToHex(c) : null
}

function readCustomProperties(doc: Document): Map<string, string> {
  const out = new Map<string, string>()
  const root = doc.getElementsByTagName('customproperties')[0]
  if (!root) return out
  for (const o of Array.from(root.getElementsByTagName('Option'))) {
    const name = o.getAttribute('name')
    const value = o.getAttribute('value')
    if (name && value !== null) out.set(name, value)
  }
  return out
}

export function qmlToStyle(text: string): StyleImportResult {
  // QGIS writes CDATA sections (e.g. <editforminitcode>); not every XML parser
  // in reach supports them (happy-dom doesn't). As escaped text they mean the same.
  const plain = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, body: string) => escapeXml(body))
  const doc = new DOMParser().parseFromString(plain, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('This QML file is not valid XML.')
  const renderer = doc.getElementsByTagName('renderer-v2')[0]
  if (!renderer) throw new Error('This QML file has no symbology (no <renderer-v2> element).')

  const notes: string[] = []
  const rendererType = renderer.getAttribute('type') ?? 'singleSymbol'
  const thematicType = rendererType === 'categorizedSymbol' || rendererType === 'graduatedSymbol'
  if (rendererType !== 'singleSymbol' && !thematicType) {
    notes.push(`This QML uses a "${rendererType}" renderer, which isn't supported; its first symbol was imported as a single symbol.`)
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

  if (thematicType) {
    const attr = renderer.getAttribute('attr') ?? ''
    if (/[()"+\s]/.test(attr)) notes.push(`The classes use an expression ("${attr}"), not a column; they may not match any column here.`)
    const custom = readCustomProperties(doc)
    const symbols = new Map<string, string>()
    for (const s of Array.from(renderer.getElementsByTagName('symbols')[0]?.children ?? [])) {
      const name = s.getAttribute('name')
      const color = symbolColor(s)
      if (name !== null && color) symbols.set(name, color)
    }
    const ramp = custom.has('spatialExplorer/ramp') ? { id: custom.get('spatialExplorer/ramp') as string, reversed: custom.get('spatialExplorer/rampReversed') === 'true' } : undefined
    if (rendererType === 'categorizedSymbol') {
      const items: ImportedCategory[] = Array.from(renderer.getElementsByTagName('category')).map((c) => {
        const type = c.getAttribute('type')
        const raw = c.getAttribute('value') ?? ''
        return {
          value: type === 'NULL' ? null : raw === '' ? undefined : raw,
          color: symbols.get(c.getAttribute('symbol') ?? ''),
          label: c.getAttribute('label') ?? undefined,
          visible: c.getAttribute('render') !== 'false',
        }
      })
      const cap = Number(custom.get('spatialExplorer/cap'))
      style.renderer = categorizedFrom(attr, items, { ramp, auto: custom.get('spatialExplorer/categories') === 'auto', cap: Number.isFinite(cap) ? cap : undefined })
    } else {
      if (renderer.getAttribute('graduatedMethod') === 'GraduatedSize') notes.push("Size by value isn't supported; the class colors were imported and the sizes ignored.")
      const ranges: ImportedRange[] = Array.from(renderer.getElementsByTagName('range')).map((r) => ({
        lower: Number(r.getAttribute('lower')),
        upper: Number(r.getAttribute('upper')),
        color: symbols.get(r.getAttribute('symbol') ?? ''),
        label: r.getAttribute('label') ?? undefined,
        visible: r.getAttribute('render') !== 'false',
      }))
      const methodId = renderer.getElementsByTagName('classificationMethod')[0]?.getAttribute('id') ?? ''
      const method = custom.get('spatialExplorer/method') === 'manual' ? 'manual' : (QGIS_METHODS[methodId] ?? 'manual')
      if (method === 'manual' && !custom.has('spatialExplorer/method') && methodId) notes.push(`The "${methodId}" classification isn't available; the classes were imported as fixed (Manual).`)
      let noValue: ImportedCategory | undefined
      try {
        const nv = custom.get('spatialExplorer/noValue')
        if (nv) noValue = { value: null, ...(JSON.parse(nv) as Omit<ImportedCategory, 'value'>) }
      } catch {
        // ignore a malformed property
      }
      style.renderer = graduatedFrom(attr, ranges.filter((r) => Number.isFinite(r.lower) && Number.isFinite(r.upper)), { method, ramp, noValue })
    }
  }

  // Spec 008: QGIS's layer opacity.
  const layerOpacity = Number(doc.getElementsByTagName('layerOpacity')[0]?.textContent ?? '1')
  if (Number.isFinite(layerOpacity) && layerOpacity < 1) style.layerOpacity = layerOpacity
  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...style }), format: 'qml', notes }
}
