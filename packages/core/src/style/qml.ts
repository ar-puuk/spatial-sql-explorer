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
import { extrusionFromQgis, extrusionToQgis } from './extrusion.js'
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
import { QGIS_METHODS, QGIS_METHOD_IDS, categorizedFrom, classLayerStyle, graduatedFrom, thematicForExport, type ImportedCategory, type ImportedRange, type Thematic } from './interchange.js'
import { dashFromPattern, type LineDash, type MarkerShape } from './symbol.js'

const PX_PER_MM = 96 / 25.4
const PX_PER_PT = 96 / 72

function qgisColor(hex: string, opacity: number): string {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 }
  return `${c.r},${c.g},${c.b},${Math.round(opacity * 255)}`
}

/** QGIS `line_style` / `outline_style` names (Qt pen styles). */
const QGIS_DASH: Record<LineDash, string> = { solid: 'solid', dash: 'dash', dot: 'dot', 'dash-dot': 'dash dot', 'dash-dot-dot': 'dash dot dot' }

/**
 * QGIS simple-marker names. QGIS's `cross` and `x` (`cross2`) are drawn with
 * the outline only, so ours (filled, to carry class colors) are written as
 * `cross_fill`, upright or turned 45 degrees (checked in QGIS 4.2.3).
 */
function qgisMarker(shape: MarkerShape): { name: string; angle: number } {
  if (shape === 'cross') return { name: 'cross_fill', angle: 0 }
  if (shape === 'x') return { name: 'cross_fill', angle: 45 }
  return { name: shape, angle: 0 }
}

/** Our shape for a QGIS marker name and angle; unknown shapes are circles, with a note. */
function shapeFromQgis(name: string | undefined, angle: number, notes: string[]): MarkerShape {
  const n = (name ?? 'circle').trim().toLowerCase()
  const turned = Math.abs(((angle % 90) + 90) % 90) === 45
  if (n === 'cross_fill' || n === 'cross' || n === 'cross2' || n === 'x') {
    if (n !== 'cross_fill') notes.push(`QGIS draws the "${n}" marker as lines; it was imported as a filled ${n === 'cross' ? 'cross' : 'x'}.`)
    const upright = n === 'cross_fill' || n === 'cross'
    return upright !== turned ? 'cross' : 'x'
  }
  if (n === 'circle' || n === 'square' || n === 'triangle' || n === 'diamond' || n === 'star') {
    if (angle % 360 !== 0) notes.push(`The marker's ${angle}° rotation was not imported.`)
    return n
  }
  notes.push(`The "${n}" marker shape was imported as a circle.`)
  return 'circle'
}

/** A QGIS line pattern: a named pen style, or a custom dash matched to the closest one. */
function dashFromQgis(p: Map<string, string>, key: 'line_style' | 'outline_style', notes: string[]): LineDash | undefined {
  if (p.get('use_custom_dash') === '1') {
    const dash = dashFromPattern((p.get('customdash') ?? '').split(';').map(Number))
    if (dash) {
      notes.push('A custom dash pattern was imported as the closest line style.')
      return dash
    }
  }
  const name = p.get(key)
  const found = (Object.keys(QGIS_DASH) as LineDash[]).find((d) => QGIS_DASH[d] === name)
  if (!found && name && name !== 'no') notes.push(`The "${name}" line style was imported as solid.`)
  return found
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
      outline_style: style.strokeWidth > 0 ? QGIS_DASH[style.lineDash ?? 'solid'] : 'no',
      outline_width: String(round(style.strokeWidth)),
      outline_width_unit: 'Pixel',
      joinstyle: 'round',
    }
  } else if (kind === 'line') {
    layerClass = 'SimpleLine'
    props = {
      line_color: qgisColor(style.strokeColor, style.strokeOpacity),
      line_style: QGIS_DASH[style.lineDash ?? 'solid'],
      line_width: String(round(style.strokeWidth)),
      line_width_unit: 'Pixel',
      capstyle: (style.lineDash ?? 'solid') === 'solid' ? 'round' : 'flat',
      joinstyle: 'round',
    }
  } else {
    layerClass = 'SimpleMarker'
    const marker = qgisMarker(style.markerShape ?? 'circle')
    props = {
      name: marker.name,
      angle: String(marker.angle),
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

/** Spatial Explorer's own settings QGIS has no field for, as QGIS custom properties. */
function customProperties(entries: Record<string, string>): string {
  const rows = Object.entries(entries).map(([k, v]) => `      <Option name="${escapeXml(k)}" type="QString" value="${escapeXml(v)}"/>`)
  return rows.length ? `  <customproperties>\n    <Option type="Map">\n${rows.join('\n')}\n    </Option>\n  </customproperties>\n` : ''
}

function thematicRenderer(style: LayerStyle, kind: 'fill' | 'line' | 'marker', th: Thematic, columnType: string | undefined): { renderer: string; props: Record<string, string> } {
  const r = th.renderer
  // One symbol per class: the shared symbol with the class color (FR-006) or size.
  const symbols = th.classes.map((c, i) => symbolXml(kind, classLayerStyle(style, kind, c), String(i))).join('\n')
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

function renderer3dXml(style: LayerStyle): string {
  const e = style.extrusion
  if (!e) return ''
  const { constant, expression } = extrusionToQgis(e)
  const c = parseColor(style.fillColor) ?? { r: 128, g: 128, b: 128 }
  const ddp = expression
    ? `          <Option name="properties" type="Map">
            <Option name="extrusionHeight" type="Map">
              <Option name="active" type="bool" value="true"/>
              <Option name="expression" type="QString" value="${escapeXml(expression)}"/>
              <Option name="type" type="int" value="3"/>
            </Option>
          </Option>`
    : `          <Option name="properties"/>`
  return `  <renderer-3d layer="" type="vector">
    <vector-layer-3d-tiling max-chunk-features="1000" show-bounding-boxes="0" zoom-levels-count="3"/>
    <symbol material_type="phong" type="polygon">
      <data add-back-faces="0" alt-binding="centroid" alt-clamping="absolute" culling-mode="no-culling" extrusion-height="${round(constant)}" invert-normals="0" offset="0" rendered-facade="Walls|Roof"/>
      <material ambient="${c.r},${c.g},${c.b},255" diffuse="${c.r},${c.g},${c.b},255" shininess="0" specular="255,255,255,255" opacity="${round(style.layerOpacity ?? 1)}" type="phong"/>
      <data-defined-properties>
        <Option type="Map">
          <Option name="name" type="QString" value=""/>
${ddp}
          <Option name="type" type="QString" value="collection"/>
        </Option>
      </data-defined-properties>
      <edges color="0,0,0,255" enabled="0" width="1"/>
    </symbol>
  </renderer-3d>
`
}

/** Reads `<renderer-3d>`'s polygon extrusion; a height expression we don't write imports as off. */
function readRenderer3d(doc: Document, notes: string[]): LayerStyle['extrusion'] | undefined {
  const r3d = doc.getElementsByTagName('renderer-3d')[0]
  if (!r3d) return undefined
  const symbol = Array.from(r3d.getElementsByTagName('symbol')).find((s) => s.getAttribute('type') === 'polygon')
  if (!symbol) return undefined
  const data = Array.from(symbol.children).find((c) => c.tagName === 'data')
  const constant = Number(data?.getAttribute('extrusion-height') ?? '0')
  let expression: string | null = null
  for (const o of Array.from(symbol.getElementsByTagName('Option'))) {
    if (o.getAttribute('name') !== 'extrusionHeight') continue
    const opts = Array.from(o.getElementsByTagName('Option'))
    const active = opts.find((x) => x.getAttribute('name') === 'active')?.getAttribute('value') === 'true'
    const expr = opts.find((x) => x.getAttribute('name') === 'expression')?.getAttribute('value') ?? null
    if (active && expr) expression = expr
  }
  const parsed = extrusionFromQgis(expression, Number.isFinite(constant) ? constant : 0)
  if (!parsed) {
    if (expression) notes.push(`The 3D height expression ${expression} is not supported (a column, optionally times a number, or a constant): extrusion is off.`)
    return undefined
  }
  return { enabled: true, ...parsed }
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
  // Spec 008 US6: polygon extrusion, as QGIS's 3D renderer (research §5).
  const renderer3d = style.extrusion?.enabled && geom === 'Polygon' ? renderer3dXml(style) : ''
  // Spec 008: QGIS loads only the categories listed: layer opacity is in
  // Rendering, and polygon extrusion in Symbology3D (checked with QGIS 4.2.3).
  const text = `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34.0" styleCategories="Symbology|Symbology3D|Rendering|CustomProperties">
${renderer}
${renderer3d}${customProperties(props)}  <layerOpacity>${round(style.layerOpacity ?? 1)}</layerOpacity>
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

/** A class symbol's size, px: marker radius (half of QGIS's size) or line width. Null for fills. */
function symbolSize(symbol: Element): number | null {
  const layer = Array.from(symbol.getElementsByTagName('layer')).find((l) => l.getAttribute('enabled') !== '0')
  if (!layer) return null
  const p = readProps(layer)
  const cls = layer.getAttribute('class')
  const quiet: string[] = []
  if (cls === 'SimpleMarker') {
    const d = toPx(p.get('size'), p.get('size_unit'), quiet, 'marker size')
    return d === null ? null : round(d / 2, 2)
  }
  if (cls === 'SimpleLine') {
    const w = toPx(p.get('line_width'), p.get('line_width_unit'), quiet, 'line width')
    return w === null ? null : round(w, 2)
  }
  return null
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
    const dash = dashFromQgis(p, 'outline_style', notes)
    if (dash) style.lineDash = dash
  } else if (cls === 'SimpleLine') {
    const line = colorAndAlpha(p.get('line_color') ?? p.get('color'))
    if (line) {
      style.strokeColor = line.hex
      style.strokeOpacity = line.alpha * alphaMul
    }
    const w = toPx(p.get('line_width'), p.get('line_width_unit'), notes, 'line width')
    if (w !== null) style.strokeWidth = w
    const dash = dashFromQgis(p, 'line_style', notes)
    if (dash) style.lineDash = dash
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
    const angle = Number(p.get('angle') ?? '0')
    style.markerShape = shapeFromQgis(p.get('name'), Number.isFinite(angle) ? angle : 0, notes)
  } else {
    notes.push(`The "${cls}" symbol layer type is not supported; default colors were kept.`)
  }

  if (thematicType) {
    const attr = renderer.getAttribute('attr') ?? ''
    if (/[()"+\s]/.test(attr)) notes.push(`The classes use an expression ("${attr}"), not a column; they may not match any column here.`)
    const custom = readCustomProperties(doc)
    const symbols = new Map<string, string>()
    const sizes = new Map<string, number>()
    for (const s of Array.from(renderer.getElementsByTagName('symbols')[0]?.children ?? [])) {
      const name = s.getAttribute('name')
      const color = symbolColor(s)
      if (name !== null && color) symbols.set(name, color)
      const size = name !== null ? symbolSize(s) : null
      if (name !== null && size !== null) sizes.set(name, size)
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
      const rangeEls = Array.from(renderer.getElementsByTagName('range'))
      // QGIS GraduatedSize: each range's symbol has its size; ours run evenly from the first to the last.
      let size: { min: number; max: number } | undefined
      if (renderer.getAttribute('graduatedMethod') === 'GraduatedSize') {
        const s = rangeEls.map((r) => sizes.get(r.getAttribute('symbol') ?? '')).filter((v): v is number => v !== undefined)
        if (s.length) size = { min: Math.min(s[0], s[s.length - 1]), max: Math.max(s[0], s[s.length - 1]) }
        else notes.push('The class sizes could not be read; the classes vary the color.')
      }
      const ranges: ImportedRange[] = rangeEls.map((r) => ({
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
      style.renderer = graduatedFrom(attr, ranges.filter((r) => Number.isFinite(r.lower) && Number.isFinite(r.upper)), { method, ramp, noValue, size })
    }
  }

  // Spec 008: QGIS's layer opacity.
  const extrusion = readRenderer3d(doc, notes)
  if (extrusion) style.extrusion = extrusion
  const layerOpacity = Number(doc.getElementsByTagName('layerOpacity')[0]?.textContent ?? '1')
  if (Number.isFinite(layerOpacity) && layerOpacity < 1) style.layerOpacity = layerOpacity
  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...style }), format: 'qml', notes }
}
