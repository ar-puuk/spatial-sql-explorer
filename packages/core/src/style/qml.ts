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
import { legacyView } from './legacy.js'
import { extrusionFromQgis, extrusionToQgis } from './extrusion.js'
import {
  DEFAULT_LAYER_STYLE,
  escapeXml,
  parseColor,
  rgbToHex,
  round,
  ruleLabel,
  sanitizeStyle,
  DEFAULT_ELSE_LABEL,
  OTHER_COLOR,
  type HeatmapRenderer,
  type LayerStyle,
  type ResolvedStyle,
  type RuleDef,
  type RulesRenderer,
  type StyleGeometry,
  type StyleImportResult,
} from './model.js'
import { rendererOf } from './legacy.js'
import { HEATMAP_QML_NOTE, HEATMAP_RAMP_NOTE, QGIS_METHODS, QGIS_METHOD_IDS, categorizedFrom, classLayerStyle, graduatedFrom, thematicForExport, type ImportedCategory, type ImportedRange, type Thematic } from './interchange.js'
import { dashFromPattern, type LineDash, type MarkerShape } from './symbol.js'
import { CHANNEL_NAMES, CHANNEL_ORDER, OUTPUT_KIND, fixedValue, type ChannelId, type Output } from './channels.js'
import type { ResolvedClass } from './model.js'
import { isGenericChannel } from './resolve.js'
import { checkExpression } from './sqlExpression.js'
import { rampColors } from './ramps.js'
import { HEATMAP_STOPS } from './resolve.js'

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

function symbolXml(kind: 'fill' | 'line' | 'marker', style: LayerStyle, name = '0', dataDefined: QgisDataDefined = NO_DD): string {
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
      // Spec 011: a line's fixed Width, when set apart from the outline width.
      line_width: String(round(style.lineWidth ?? style.strokeWidth)),
      line_width_unit: 'Pixel',
      capstyle: (style.lineDash ?? 'solid') === 'solid' ? 'round' : 'flat',
      joinstyle: 'round',
    }
  } else {
    layerClass = 'SimpleMarker'
    const marker = qgisMarker(style.markerShape ?? 'circle')
    props = {
      name: marker.name,
      // Spec 011: the fixed rotation, on top of the shape's own turn (our "x").
      angle: String(round(marker.angle + (style.rotation ?? 0), 4)),
      color: qgisColor(style.fillColor, style.fillOpacity),
      outline_color: qgisColor(style.strokeColor, style.strokeOpacity),
      outline_style: style.strokeWidth > 0 ? 'solid' : 'no',
      outline_width: String(round(style.strokeWidth)),
      outline_width_unit: 'Pixel',
      size: String(round(style.pointRadius * 2)),
      size_unit: 'Pixel',
    }
  }
  return `      <symbol type="${kind}" name="${name}" alpha="${round(style.opacity ?? 1, 4)}" clip_to_extent="1" force_rhr="0">${dataDefinedBlock(dataDefined.symbol, 8)}
        <layer class="${layerClass}" enabled="1" locked="0" pass="0">
${options(props)}${dataDefinedBlock(dataDefined.layer, 10)}
        </layer>
      </symbol>`
}

// --- Spec 011: other properties by a column, as QGIS data-defined properties (research §4) ---

/** Data-defined properties: the symbol layer's, and the symbol's own (opacity). */
export interface QgisDataDefined {
  layer: Array<[string, string[]]>
  symbol: Array<[string, string[]]>
}

const NO_DD: QgisDataDefined = { layer: [], symbol: [] }

/** A data-defined expression property's entries. */
const expressionEntries = (expression: string): string[] => [
  '<Option name="active" type="bool" value="true"/>',
  `<Option name="expression" type="QString" value="${escapeXml(expression)}"/>`,
  '<Option name="type" type="int" value="3"/>',
]

/** Several data-defined properties as QGIS's `<data_defined_properties>` block, at an indent. */
function dataDefinedBlock(props: Array<[string, string[]]>, indent: number): string {
  if (!props.length) return ''
  const pad = (n: number) => ' '.repeat(indent + n)
  const body = props.map(([key, entries]) => `${pad(6)}<Option name="${key}" type="Map">\n${entries.map((e) => pad(8) + e).join('\n')}\n${pad(6)}</Option>`).join('\n')
  return `
${pad(0)}<data_defined_properties>
${pad(2)}<Option type="Map">
${pad(4)}<Option name="name" type="QString" value=""/>
${pad(4)}<Option name="properties" type="Map">
${body}
${pad(4)}</Option>
${pad(4)}<Option name="type" type="QString" value="collection"/>
${pad(2)}</Option>
${pad(0)}</data_defined_properties>`
}

/** A QGIS string literal. */
const qgisString = (s: string): string => `'${s.replace(/'/g, "''")}'`

/** Which QGIS data-defined key a property sets on each kind of symbol layer (null: none). */
function qgisKey(id: ChannelId, kind: 'fill' | 'line' | 'marker'): string | null {
  switch (id) {
    case 'strokeColor':
      return kind === 'line' ? null : 'outlineColor'
    case 'strokeWidth':
      return kind === 'line' ? null : 'outlineWidth'
    case 'size':
      return kind === 'marker' ? 'size' : null
    case 'width':
      return kind === 'line' ? 'outlineWidth' : null
    case 'shape':
      return kind === 'marker' ? 'name' : null
    case 'dash':
      return kind === 'marker' ? null : 'outlineStyle'
    case 'rotation':
      return kind === 'marker' ? 'angle' : null
    default:
      return null
  }
}

/** A property's output as a QGIS literal, in QGIS's terms (marker diameters, percent opacity, QGIS names). */
function qgisOutput(id: ChannelId, output: Output): string {
  switch (OUTPUT_KIND[id]) {
    case 'color':
      return qgisString(String(output))
    case 'shape':
      return qgisString(qgisMarker(output as MarkerShape).name)
    case 'dash':
      return qgisString(QGIS_DASH[output as LineDash])
    case 'opacity':
      return String(round(Number(output) * 100, 4))
    default:
      return String(round(id === 'size' ? Number(output) * 2 : Number(output), 4))
  }
}

/** The QGIS test of one class of a property on `field` (our class rules, as the map's). */
function qgisClassTest(field: string, scale: 'categories' | 'classes', c: ResolvedClass, ranges: ResolvedClass[]): string | null {
  if (c.kind === 'noValue') return scale === 'classes' ? `${field} IS NULL` : `(${field} IS NULL OR to_string(${field}) = '')`
  if (c.kind === 'value' && c.value !== undefined) return `to_string(${field}) = ${qgisString(c.value)}`
  if (c.kind === 'range' && c.lower !== undefined && c.upper !== undefined) {
    const first = ranges[0] === c
    return `${field} ${first ? '>=' : '>'} ${c.lower} AND ${field} <= ${c.upper}`
  }
  return null
}

/**
 * A property's value per feature as a QGIS `CASE`: No value first, then the
 * classes in order (upper-inclusive ranges, the first one including its lower
 * bound; categories by their string form), then Other (else: the fixed value).
 */
function qgisChannelCase(id: ChannelId, field: string, scale: 'categories' | 'classes', classes: ResolvedClass[], fixed: Output, mapOutput: (id: ChannelId, o: Output) => string): string {
  const ranges = classes.filter((c) => c.kind === 'range')
  const out = (c: ResolvedClass | undefined) => mapOutput(id, c?.output ?? fixed)
  const arms: string[] = []
  const noValue = classes.find((c) => c.kind === 'noValue')
  arms.push(`WHEN ${qgisClassTest(field, scale, noValue ?? ({ kind: 'noValue' } as ResolvedClass), ranges)} THEN ${out(noValue)}`)
  for (const c of classes) {
    if (c.kind !== 'value' && c.kind !== 'range') continue
    const test = qgisClassTest(field, scale, c, ranges)
    if (test) arms.push(`WHEN ${test} THEN ${out(c)}`)
  }
  return `CASE ${arms.join(' ')} ELSE ${out(classes.find((c) => c.kind === 'other'))} END`
}

/**
 * Spec 011: every property that varies by data (other than color and spec
 * 009's size) as QGIS data-defined properties on a symbol: outline color and
 * width, size or width by categories, shape, pattern and rotation on the
 * symbol layer; opacity, and the classes hidden in any of them, as the
 * symbol's opacity (alpha, in percent; hidden: 0). Fixed rotation and opacity
 * are written as the symbol's own values (symbolXml). Properties read from a
 * SQL expression have no column in the file: left out, with a note.
 */
export function channelDataDefined(style: LayerStyle, resolved: ResolvedStyle | undefined, kind: 'fill' | 'line' | 'marker', notes: string[] = []): QgisDataDefined {
  if (!resolved?.channels || !style.channels) return NO_DD
  const layer: Array<[string, string[]]> = []
  const hidden: string[] = []
  let opacity: string | null = null
  let rotation: string | null = null
  let shapeOurs: string | null = null
  for (const id of CHANNEL_ORDER) {
    const enc = style.channels[id]
    const rc = resolved.channels[id]
    if (!enc || !rc || rc.status !== 'ok' || !isGenericChannel(id, enc)) continue
    if (enc.source.kind !== 'column' || (enc.scale.kind !== 'categories' && enc.scale.kind !== 'classes')) {
      notes.push(`${CHANNEL_NAMES[id]} by an expression isn't written to QGIS: it uses the fixed ${CHANNEL_NAMES[id].toLowerCase()} there.`)
      continue
    }
    const field = qgisField(enc.source.column)
    const scale = enc.scale.kind
    const fixed = fixedValue(style, id, kind === 'line' ? 'line' : 'marker')
    const ranges = rc.classes.filter((c) => c.kind === 'range')
    for (const c of rc.classes) {
      if (c.visible) continue
      const test = c.kind === 'other' ? null : qgisClassTest(field, scale, c, ranges)
      if (test) hidden.push(`(${test})`)
    }
    if (id === 'opacity') {
      opacity = qgisChannelCase(id, field, scale, rc.classes, fixed, qgisOutput)
      continue
    }
    if (id === 'rotation') {
      if (kind === 'marker') rotation = qgisChannelCase(id, field, scale, rc.classes, fixed, qgisOutput)
      continue
    }
    if (id === 'shape' && kind === 'marker') shapeOurs = qgisChannelCase(id, field, scale, rc.classes, fixed, (_i, o) => qgisString(String(o)))
    const key = qgisKey(id, kind)
    if (key) layer.push([key, expressionEntries(qgisChannelCase(id, field, scale, rc.classes, fixed, qgisOutput))])
  }
  // Our "x" is QGIS's filled cross turned 45°: a shape by data turns those features too.
  if (kind === 'marker' && (rotation || shapeOurs)) {
    const base = rotation ?? String(style.rotation ?? 0)
    const turn = shapeOurs ? ` + CASE WHEN (${shapeOurs}) = 'x' THEN 45 ELSE 0 END` : ''
    layer.push(['angle', expressionEntries(`(${base})${turn}`)])
  }
  const symbol: Array<[string, string[]]> = []
  if (opacity || hidden.length) {
    const shown = opacity ?? String(round((style.opacity ?? 1) * 100, 4))
    symbol.push(['alpha', expressionEntries(hidden.length ? `CASE WHEN ${hidden.join(' OR ')} THEN 0 ELSE ${shown} END` : shown)])
  }
  return { layer, symbol }
}


// --- Spec 009: the size channel as a QGIS data-defined size (research §5) ---------

/** A QGIS expression's quoted field name. */
const qgisField = (column: string): string => `"${column.replace(/"/g, '""')}"`

/**
 * The size channel as a data-defined size on every symbol layer: a `CASE`
 * expression over the size classes (classed; hidden classes are size 0), or
 * QGIS's size assistant form, a field with a size scale transformer
 * (proportional: Linear for lines, Area 0.5 for markers). QGIS sizes are
 * marker diameters, in the symbol's Pixel unit. '' when no channel applies.
 */
function sizeDataDefined(style: LayerStyle, resolved: ResolvedStyle | undefined, kind: 'fill' | 'line' | 'marker'): Array<[string, string[]]> {
  const s = style.size
  const r = resolved?.size
  if (kind === 'fill' || !s || !r || r.status !== 'ok') return []
  const key = kind === 'marker' ? 'size' : 'outlineWidth'
  const f = kind === 'marker' ? 2 : 1
  const single = (kind === 'marker' ? style.pointRadius : style.strokeWidth) * f
  const noValue = r.classes.find((c) => c.kind === 'noValue')
  const nullSize = noValue && !noValue.visible ? 0 : single
  if (s.mode === 'proportional' && r.domain) {
    const area = (s.scale ?? 'linear') === 'area'
    const d = { exponent: area ? 0.5 : 1, maxSize: s.sizeMax * f, maxValue: r.domain.max, minSize: s.sizeMin * f, minValue: r.domain.min, nullSize, scaleType: area ? 1 : 0 }
    return [[key, [
      '<Option name="active" type="bool" value="true"/>',
      `<Option name="field" type="QString" value="${escapeXml(s.column)}"/>`,
      '<Option name="transformer" type="Map">',
      '  <Option name="d" type="Map">',
      ...Object.entries(d).map(([k, v]) => `    <Option name="${k}" type="${k === 'scaleType' ? 'int' : 'double'}" value="${round(v, 6)}"/>`),
      '  </Option>',
      '  <Option name="t" type="int" value="1"/>',
      '</Option>',
      '<Option name="type" type="int" value="2"/>',
    ]]]
  }
  // Classed: our class rules (upper-inclusive, the first class including its lower bound).
  const v = qgisField(s.column)
  const ranges = r.classes.filter((c) => c.kind === 'range')
  const arms = [`WHEN ${v} IS NULL THEN ${nullSize}`]
  if (ranges.length) arms.push(`WHEN ${v} < ${ranges[0].lower} THEN ${single}`)
  for (const c of ranges) arms.push(`WHEN ${v} <= ${c.upper} THEN ${c.visible ? round((c.size as number) * f, 6) : 0}`)
  return [[key, expressionEntries(`CASE ${arms.join(' ')} ELSE ${single} END`)]]
}

/**
 * Spec 009 US4/US5 (research §6): a bivariate style as QGIS's rule-based
 * renderer: one rule per cell (our class rules: the first class of an axis
 * includes its lower bound; hidden cells unchecked) and one for "No value".
 * The renderer itself rides along in `spatialExplorer/bivariate`.
 */
function bivariateRendererXml(style: LayerStyle, resolved: ResolvedStyle, kind: 'fill' | 'line' | 'marker', dd: QgisDataDefined = NO_DD): string {
  const g = resolved.grid
  if (!g) return ''
  const x = qgisField(g.x.column)
  const y = qgisField(g.y.column)
  const between = (f: string, r: { lower: number; upper: number }, first: boolean) => `${f} ${first ? '>=' : '>'} ${r.lower} AND ${f} <= ${r.upper}`
  const rules: string[] = []
  const symbols: string[] = []
  resolved.classes.forEach((c, k) => {
    const filter =
      c.kind === 'cell' && c.x && c.y
        ? `${between(x, c.x, c.col === 0)} AND ${between(y, c.y, c.row === 0)}`
        : `${x} IS NULL OR ${y} IS NULL`
    const unchecked = c.visible ? '' : ' checkstate="0"'
    rules.push(`      <rule filter="${escapeXml(filter)}" key="{se-${escapeXml(c.key)}}" label="${escapeXml(c.label)}" symbol="${k}"${unchecked}/>`)
    symbols.push(symbolXml(kind, kind === 'line' ? { ...style, strokeColor: c.color } : { ...style, fillColor: c.color }, String(k), dd))
  })
  return `  <renderer-v2 type="RuleRenderer" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <rules key="{se-rules}">
${rules.join('\n')}
    </rules>
    <symbols>
${symbols.join('\n')}
    </symbols>
  </renderer-v2>`
}

/** A rule's QGIS filter after earlier ones: QGIS draws every matching rule, ours only the first, so earlier conditions are excluded. */
const ruleGuard = (where: string): string => ` AND NOT coalesce((${where}), FALSE)`
function guardedFilter(where: string, before: readonly string[]): string {
  return before.length ? `(${where})${before.map(ruleGuard).join('')}` : where
}

/**
 * Spec 010: rules as QGIS's rule-based renderer: one rule per usable rule (its
 * condition as the filter, QGIS expressions sharing SQL's simple comparison
 * syntax; hidden rules unchecked), then the ELSE rule. QGIS draws every rule
 * that matches, so each filter also excludes the rules before it. The renderer
 * itself rides along in `spatialExplorer/rules`.
 */
function rulesRendererXml(style: LayerStyle, r: RulesRenderer, resolved: ResolvedStyle | undefined, kind: 'fill' | 'line' | 'marker', dd: QgisDataDefined = NO_DD): string {
  const errors = new Set((resolved?.classes ?? []).flatMap((c) => (c.kind === 'rule' && c.ruleId && c.error ? [c.ruleId] : [])))
  const usable = r.rules.filter((rule) => !checkExpression(rule.where, 'condition') && !errors.has(rule.id))
  const rules: string[] = []
  const symbols: string[] = []
  const look = (color: string): LayerStyle => (kind === 'line' ? { ...style, strokeColor: color } : { ...style, fillColor: color })
  usable.forEach((rule, k) => {
    const filter = guardedFilter(rule.where.trim(), usable.slice(0, k).map((x) => x.where.trim()))
    const unchecked = rule.visible ? '' : ' checkstate="0"'
    rules.push(`      <rule filter="${escapeXml(filter)}" key="{se-rule-${escapeXml(rule.id)}}" label="${escapeXml(ruleLabel(rule))}" symbol="${k}"${unchecked}/>`)
    symbols.push(symbolXml(kind, look(rule.color), String(k), dd))
  })
  const n = usable.length
  rules.push(`      <rule filter="ELSE" key="{se-else}" label="${escapeXml(r.elseLabel)}" symbol="${n}"${r.elseVisible ? '' : ' checkstate="0"'}/>`)
  symbols.push(symbolXml(kind, look(r.elseColor), String(n), dd))
  return `  <renderer-v2 type="RuleRenderer" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <rules key="{se-rules}">
${rules.join('\n')}
    </rules>
    <symbols>
${symbols.join('\n')}
    </symbols>
  </renderer-v2>`
}

/** Spec 010: a QGIS rule-based renderer this product didn't write, as rules (top-level rules; ELSE is everything else). */
function rulesFromQgis(renderer: Element, notes: string[]): RulesRenderer {
  const symbols = new Map<string, string>()
  for (const s of Array.from(renderer.getElementsByTagName('symbols')[0]?.children ?? [])) {
    const name = s.getAttribute('name')
    const color = symbolColor(s)
    if (name !== null && color) symbols.set(name, color)
  }
  const top = Array.from(renderer.getElementsByTagName('rules')[0]?.children ?? []).filter((el) => el.localName === 'rule')
  const out: RulesRenderer = { kind: 'rules', rules: [], elseColor: OTHER_COLOR, elseVisible: true, elseLabel: DEFAULT_ELSE_LABEL }
  let nested = false
  let scaled = false
  for (const el of top) {
    if (Array.from(el.children).some((c) => c.localName === 'rule')) nested = true
    if (el.hasAttribute('scalemindenom') || el.hasAttribute('scalemaxdenom')) scaled = true
    const filter = (el.getAttribute('filter') ?? '').trim()
    const color = symbols.get(el.getAttribute('symbol') ?? '')
    const visible = el.getAttribute('checkstate') !== '0'
    const label = el.getAttribute('label') ?? ''
    if (filter.toUpperCase() === 'ELSE') {
      out.elseVisible = visible
      if (label.trim()) out.elseLabel = label
      if (color) out.elseColor = color
      continue
    }
    if (!color && !filter) continue
    // Our own guard (see guardedFilter) comes off again.
    const before = out.rules.map((x) => x.where)
    const suffix = before.map(ruleGuard).join('')
    const where = before.length && filter.startsWith('(') && filter.endsWith(`)${suffix}`) ? filter.slice(1, filter.length - suffix.length - 1) : filter || 'TRUE'
    const rule: RuleDef = { id: `r${out.rules.length + 1}`, label: '', where, color: color ?? DEFAULT_LAYER_STYLE.fillColor, visible }
    if (label && label !== ruleLabel({ label: '', where })) rule.label = label
    out.rules.push(rule)
  }
  if (nested) notes.push('Nested rules were not imported; only the top-level rules were.')
  if (scaled) notes.push("Rules' scale ranges were not imported: every rule applies at every zoom.")
  notes.push('QGIS expressions were imported as SQL conditions; QGIS-only functions show an error on their rule.')
  return out
}

/** A size channel from a QGIS data-defined size this product didn't write (a size assistant transformer), or null. */
function sizeFromQgis(layerEl: Element, kind: string, notes: string[]): LayerStyle['size'] | null {
  const dd = Array.from(layerEl.children).find((c) => c.tagName === 'data_defined_properties')
  const key = kind === 'SimpleMarker' ? 'size' : kind === 'SimpleLine' ? 'outlineWidth' : null
  if (!dd || !key) return null
  const prop = Array.from(dd.getElementsByTagName('Option')).find((o) => o.getAttribute('name') === key && o.getAttribute('type') === 'Map')
  if (!prop) return null
  const opt = (parent: Element, name: string) => Array.from(parent.children).find((c) => c.getAttribute('name') === name)
  if (opt(prop, 'active')?.getAttribute('value') !== 'true') return null
  const type = opt(prop, 'type')?.getAttribute('value')
  const field = opt(prop, 'field')?.getAttribute('value')
  const d = opt(opt(prop, 'transformer') ?? prop, 'd')
  if (type !== '2' || !field || !d) {
    notes.push('A data-defined size expression was not imported; every feature has the single size.')
    return null
  }
  const num = (name: string) => Number(opt(d, name)?.getAttribute('value'))
  const scaleType = num('scaleType')
  if (scaleType !== 0 && scaleType !== 1) notes.push('Only linear and area size scales are supported; the sizes were imported as linear.')
  const unitKey = kind === 'SimpleMarker' ? 'size_unit' : 'line_width_unit'
  const unit = readProps(layerEl).get(unitKey)
  const f = kind === 'SimpleMarker' ? 2 : 1
  const px = (n: number) => (toPx(String(n), unit, notes, 'data-defined size') ?? n) / f
  return {
    column: field,
    mode: 'proportional',
    method: 'quantile',
    classCount: 5,
    classes: [],
    noValue: {},
    sizeMin: round(px(num('minSize')), 3),
    sizeMax: round(px(num('maxSize')), 3),
    scale: scaleType === 1 ? 'area' : 'linear',
  }
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

function thematicRenderer(style: LayerStyle, kind: 'fill' | 'line' | 'marker', th: Thematic, columnType: string | undefined, dataDefined: QgisDataDefined = NO_DD): { renderer: string; props: Record<string, string> } {
  const r = th.renderer
  // One symbol per class: the shared symbol with the class color (FR-006); spec 009: each sized by the size channel.
  const symbols = th.classes.map((c, i) => symbolXml(kind, classLayerStyle(style, kind, c), String(i), dataDefined)).join('\n')
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
  // Spec 010: an expression is the renderer's attribute (QGIS accepts expressions there); its label rides along.
  if (r.expression) props['spatialExplorer/expression'] = JSON.stringify({ expression: r.expression, column: r.column })
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
    renderer: `  <renderer-v2 type="graduatedSymbol" attr="${escapeXml(r.expression ?? r.column)}" graduatedMethod="GraduatedColor" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
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
  const style = legacyView(sanitizeStyle(input))
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
  // Spec 009: the size channel, a data-defined size on every symbol (research §5);
  // spec 011: every other property by a column too, and opacity on the symbol.
  const channelDd = channelDataDefined(style, resolved, kind, notes)
  const sizeDd: QgisDataDefined = { layer: [...sizeDataDefined(style, resolved, kind), ...channelDd.layer], symbol: channelDd.symbol }
  if (style.size && kind === 'fill') notes.push('QGIS polygons have no size: the size channel was left out.')
  let renderer = `  <renderer-v2 type="singleSymbol" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
    <symbols>
${symbolXml(kind, style, '0', sizeDd)}
    </symbols>
    <rotation/>
    <sizescale/>
  </renderer-v2>`
  let props: Record<string, string> = {}
  if (thematic) ({ renderer, props } = thematicRenderer(style, kind, thematic, columnType, sizeDd))
  // Spec 009: bivariate, as a rule-based renderer.
  const r = rendererOf(style)
  if (r.kind === 'bivariate' && resolved?.status === 'ok' && resolved.grid) {
    renderer = bivariateRendererXml(style, resolved, kind, channelDd)
    props = { 'spatialExplorer/bivariate': JSON.stringify(r) }
  }
  // A heatmap, as QGIS's heatmap renderer (point layers only), with the symbol kept for a return to single.
  if (r.kind === 'heatmap') {
    if (kind === 'marker') {
      renderer = heatmapRendererXml(r, resolved)
      const { renderer: _r, extrusion: _e, size: _s, ...symbol } = style
      void _r
      void _e
      void _s
      props = { 'spatialExplorer/heatmap': JSON.stringify(r), 'spatialExplorer/symbol': JSON.stringify(symbol) }
      if (!r.autoIntensity && r.intensity !== 1) notes.push(HEATMAP_QML_NOTE)
    } else notes.push('QGIS heatmaps are for point layers: this layer was exported with its single symbol.')
  }
  // Spec 010: rules, as a rule-based renderer.
  if (r.kind === 'rules') {
    renderer = rulesRendererXml(style, r, resolved, kind, sizeDd)
    props = { 'spatialExplorer/rules': JSON.stringify(r) }
  }
  // Our own size channel, kept whole for a lossless reload here.
  if (style.size) props['spatialExplorer/size'] = JSON.stringify(style.size)
  // Spec 011: the whole channel model (preferred on import; the entries above stay for 0.3.0).
  const own = ownStyle(style)
  if (own) props['spatialExplorer/style'] = own
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

// --- heatmap ----------------------------------------------------------------

/** QGIS render unit codes (Qgis::RenderUnit) a heatmap radius may use. */
const QGIS_RENDER_UNITS: Record<string, string> = { '0': 'MM', '2': 'Pixel', '4': 'Point', '5': 'Inch' }

/** QGIS's heatmap renderer: the radius in pixels, the weight as a field, the ramp transparent at zero density. */
function heatmapRendererXml(r: HeatmapRenderer, resolved: ResolvedStyle | undefined): string {
  const colors = resolved?.heat?.colors ?? rampColors(r.ramp, HEATMAP_STOPS)
  const n = colors.length
  const stops = colors.slice(0, -1).map((c, i) => `${round((i + 1) / n, 6)};${qgisColor(c, 1)}`).join(':')
  const weight = r.weight ? `"${r.weight.replace(/"/g, '""')}"` : ''
  // Meters on the ground: QGIS's "meters at scale" unit (Qgis::RenderUnit 7).
  const [radius, unit] = r.radiusUnit === 'm' ? [r.radiusMeters ?? 0, 7] : [r.radius, 2]
  return `  <renderer-v2 type="heatmapRenderer" radius="${round(radius)}" radius_unit="${unit}" radius_map_unit_scale="3x:0,0,0,0,0,0" max_value="0" quality="3" weight_expression="${escapeXml(weight)}" forceraster="0" enableorderby="0">
    <colorramp type="gradient" name="[source]">
${options({ color1: '0,0,0,0', color2: qgisColor(colors[n - 1] ?? '#000000', 1), discrete: '0', rampType: 'gradient', stops })}
    </colorramp>
  </renderer-v2>`
}

/** QGIS's `weight_expression` as a column: a quoted or bare field name, or null (an expression). */
function weightColumn(expression: string): string | null {
  const e = expression.trim()
  const quoted = /^"((?:[^"]|"")+)"$/.exec(e)
  if (quoted) return quoted[1].replace(/""/g, '"')
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(e) ? e : null
}

/** A heatmap renderer read back: ours from its custom property, QGIS's own from its attributes. */
function heatmapFromQgis(renderer: Element, custom: Map<string, string>, notes: string[]): Partial<LayerStyle> {
  const style: Partial<LayerStyle> = {}
  try {
    const symbol = custom.get('spatialExplorer/symbol')
    if (symbol) Object.assign(style, JSON.parse(symbol) as Partial<LayerStyle>)
    const own = custom.get('spatialExplorer/heatmap')
    if (own) {
      style.renderer = JSON.parse(own) as HeatmapRenderer
      return style
    }
  } catch {
    // a malformed property: read QGIS's own attributes
  }
  const code = renderer.getAttribute('radius_unit') ?? '0'
  const unit = QGIS_RENDER_UNITS[code]
  const raw = renderer.getAttribute('radius') ?? ''
  const meters = code === '7' && Number(raw) > 0 ? Number(raw) : null
  const radius = unit && raw ? toPx(raw, unit, notes, 'heatmap radius') : null
  if (!unit && meters === null) notes.push('The heatmap radius is in map units, which have no fixed size on screen: the default radius was used.')
  const expression = renderer.getAttribute('weight_expression') ?? ''
  const weight = expression.trim() ? weightColumn(expression) : ''
  if (weight === null) notes.push(`The heatmap weight is the QGIS expression "${expression}"; each point counts once instead.`)
  if (renderer.getElementsByTagName('colorramp').length) notes.push(HEATMAP_RAMP_NOTE)
  if (Number(renderer.getAttribute('max_value') ?? '0') > 0) notes.push('The heatmap has a fixed maximum in QGIS; here the colors follow the densest area in view.')
  style.renderer = { kind: 'heatmap', weight: weight ?? '', ...(radius !== null ? { radius } : {}), ...(meters !== null ? { radiusUnit: 'm', radiusMeters: meters } : {}) } as HeatmapRenderer
  return style
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
  // Spec 009: our own bivariate rules (a RuleRenderer with the renderer in a custom property).
  const ownBivariate = rendererType === 'RuleRenderer' ? readCustomProperties(doc).get('spatialExplorer/bivariate') : undefined
  // Spec 010: our own rules (the renderer in a custom property), or any other rule-based renderer.
  const ownRules = rendererType === 'RuleRenderer' && !ownBivariate ? readCustomProperties(doc).get('spatialExplorer/rules') : undefined
  const foreignRules = rendererType === 'RuleRenderer' && !ownBivariate && !ownRules
  // A heatmap has no symbols of its own.
  if (rendererType === 'heatmapRenderer') {
    const style = heatmapFromQgis(renderer, readCustomProperties(doc), notes)
    const layerOpacity = Number(doc.getElementsByTagName('layerOpacity')[0]?.textContent ?? '1')
    if (Number.isFinite(layerOpacity) && layerOpacity < 1) style.layerOpacity = layerOpacity
    return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...withOwnStyle(style, readCustomProperties(doc), notes) }), format: 'qml', notes }
  }
  if (rendererType !== 'singleSymbol' && !thematicType && rendererType !== 'RuleRenderer') {
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
    const custom = readCustomProperties(doc)
    // Spec 010: graduated by expression (ours from the property; QGIS's own attribute expressions too).
    let expression: { expression: string; column: string } | null = null
    try {
      const own = custom.get('spatialExplorer/expression')
      if (own) expression = JSON.parse(own) as { expression: string; column: string }
    } catch {
      // ignore a malformed property
    }
    const looksLikeExpression = /[()"+*/\s]/.test(attr)
    if (!expression && looksLikeExpression && rendererType === 'graduatedSymbol') {
      expression = { expression: attr, column: '' }
      notes.push(`The classes use the QGIS expression "${attr}"; it was imported as a SQL expression (QGIS-only functions won't work).`)
    } else if (!expression && looksLikeExpression) notes.push(`The classes use an expression ("${attr}"), not a column; they may not match any column here.`)
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
      if (expression && style.renderer.kind === 'graduated') style.renderer = { ...style.renderer, column: expression.column, expression: expression.expression }
    }
  }

  if (ownRules || foreignRules) {
    let rules: LayerStyle['renderer']
    try {
      rules = ownRules ? (JSON.parse(ownRules) as LayerStyle['renderer']) : rulesFromQgis(renderer, notes)
    } catch {
      rules = rulesFromQgis(renderer, notes)
    }
    if (rules?.kind === 'rules' && rules.rules.length === 0 && foreignRules) {
      // Nothing readable: a rules style of "Everything else" only would hide the data's look.
      notes.length = 0
      notes.push('This QML RuleRenderer has no rules that could be imported; its first symbol was imported as a single symbol.')
    } else {
      style.renderer = rules
      // The first rule's symbol carries a rule color, not the single symbol's.
      delete style.fillColor
      if (cls === 'SimpleLine') delete style.strokeColor
    }
  }

  if (ownBivariate) {
    try {
      style.renderer = JSON.parse(ownBivariate) as LayerStyle['renderer']
      // The first rule's symbol carries a cell color, not the single symbol's.
      delete style.fillColor
      if (cls === 'SimpleLine') delete style.strokeColor
    } catch {
      notes.push('The saved bivariate style could not be read; its first symbol was imported as a single symbol.')
    }
  }

  // Spec 009: the size channel. Ours from the custom property; otherwise QGIS's size assistant form.
  const custom = readCustomProperties(doc)
  const ownSize = custom.get('spatialExplorer/size')
  if (ownSize) {
    try {
      style.size = JSON.parse(ownSize) as LayerStyle['size']
    } catch {
      notes.push('The saved size channel could not be read.')
    }
  } else {
    const fromQgis = sizeFromQgis(layerEl, cls, notes)
    if (fromQgis) style.size = fromQgis
  }

  // Spec 008: QGIS's layer opacity.
  const extrusion = readRenderer3d(doc, notes)
  if (extrusion) style.extrusion = extrusion
  const layerOpacity = Number(doc.getElementsByTagName('layerOpacity')[0]?.textContent ?? '1')
  if (Number.isFinite(layerOpacity) && layerOpacity < 1) style.layerOpacity = layerOpacity
  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...withOwnStyle(style, custom, notes) }), format: 'qml', notes }
}

/** Spec 011: the channel model fields, as JSON for `spatialExplorer/style` (null: a single style, nothing to add). */
function ownStyle(style: LayerStyle): string | null {
  const keys = ['draw', 'channels', 'heatmap', 'height', 'labels', 'lineWidth', 'rotation', 'opacity'] as const
  const out: Partial<LayerStyle> = {}
  for (const k of keys) if (style[k] !== undefined) (out as Record<string, unknown>)[k] = style[k]
  return Object.keys(out).length ? JSON.stringify(out) : null
}

/** Spec 011: a style read from the file, with our saved channel model (when present) in place of the legacy fields. */
function withOwnStyle(style: Partial<LayerStyle>, custom: Map<string, string>, notes: string[]): Partial<LayerStyle> {
  const own = custom.get('spatialExplorer/style')
  if (!own) return style
  try {
    const saved = JSON.parse(own) as Partial<LayerStyle>
    const { renderer: _r, size: _s, extrusion: _e, ...rest } = style
    void _r
    void _s
    void _e
    return { ...rest, ...saved }
  } catch {
    notes.push('The saved Spatial Explorer style could not be read; the QGIS symbology was imported instead.')
    return style
  }
}
