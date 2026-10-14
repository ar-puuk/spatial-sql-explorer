// OGC Styled Layer Descriptor (SLD 1.0.0), the format GeoServer, MapServer
// and QGIS ("Save as SLD") all exchange. 1.0.0 with `CssParameter` is the
// most widely accepted dialect; the importer also reads SLD 1.1 / SE
// (`SvgParameter`, `se:` namespace) by matching local names only.
// SLD sizes are in pixels by default, and marker `Size` is a diameter.
import { legacyView } from './legacy.js'
import {
  DEFAULT_LAYER_STYLE,
  escapeXml,
  parseColor,
  rgbToHex,
  round,
  ruleLabel as ruleDefLabel,
  sanitizeStyle,
  type LayerStyle,
  type RulesRenderer,
  type ResolvedStyle,
  type StyleGeometry,
  type StyleImportResult,
} from './model.js'
import { rendererOf } from './legacy.js'
import type { StyleExport } from './qml.js'
import { categorizedFrom, classLayerStyle, graduatedFrom, portableRules, previewExportNotice, thematicForExport, type ExportClass, type ImportedCategory, type ImportedRange, type PortableRule, type Thematic } from './interchange.js'
import type { SimpleWhere } from './simpleWhere.js'
import { dashFromPattern, dashPattern, proportionalSize, type LineDash, type MarkerShape } from './symbol.js'
import { CHANNEL_NAMES, CHANNEL_ORDER, type ChannelId, type Channels, type ClassDef, type Output } from './channels.js'
import { labelColumnOf, sanitizeLabels, type LabelAnchor, type LabelSettings } from './labels.js'
import { continuousOutput, isGenericChannel } from './resolve.js'

function param(name: string, value: string | number): string {
  return `<CssParameter name="${name}">${escapeXml(String(value))}</CssParameter>`
}

function fill(style: LayerStyle): string {
  return `<Fill>${param('fill', style.fillColor)}${param('fill-opacity', round(style.fillOpacity))}</Fill>`
}

/** Lines and polygon outlines carry the dash pattern, in pixels (pattern x width), as SLD defines it. */
function stroke(style: LayerStyle, dashed = false): string {
  if (style.strokeWidth <= 0) return ''
  const pattern = dashed ? dashPattern(style.lineDash) : null
  const dash = pattern ? param('stroke-dasharray', pattern.map((n) => round(n * style.strokeWidth)).join(' ')) : ''
  return `<Stroke>${param('stroke', style.strokeColor)}${param('stroke-width', round(style.strokeWidth))}${param('stroke-opacity', round(style.strokeOpacity))}${param('stroke-linejoin', 'round')}${dash}</Stroke>`
}

/**
 * SLD well-known marks. No standard mark is a diamond: it is a square turned
 * 45 degrees, of the size that puts its corners where QGIS's diamond has them.
 */
function mark(shape: MarkerShape, radius: number): { name: string; size: number; rotation: number } {
  if (shape === 'diamond') return { name: 'square', size: radius * Math.SQRT2, rotation: 45 }
  return { name: shape, size: radius * 2, rotation: 0 }
}

function symbolizer(geom: Exclude<StyleGeometry, 'Mixed'>, style: LayerStyle): string {
  // Spec 011 US6: the labels ride in every rule, so hidden classes stay unlabeled.
  return shapeSymbolizer(geom, style) + textSymbolizer(style.labels, geom)
}

function shapeSymbolizer(geom: Exclude<StyleGeometry, 'Mixed'>, style: LayerStyle): string {
  // Spec 011: the fixed (or class) opacity multiplies the fill and outline opacities.
  const o = style.opacity ?? 1
  if (o !== 1) style = { ...style, fillOpacity: style.fillOpacity * o, strokeOpacity: style.strokeOpacity * o }
  if (geom === 'LineString' && style.lineWidth !== undefined) style = { ...style, strokeWidth: style.lineWidth }
  if (geom === 'Polygon') return `<PolygonSymbolizer>${fill(style)}${stroke(style, true)}</PolygonSymbolizer>`
  if (geom === 'LineString') return `<LineSymbolizer>${stroke(style, true)}</LineSymbolizer>`
  const m = mark(style.markerShape ?? 'circle', style.pointRadius)
  const turn = round((((m.rotation + (style.rotation ?? 0)) % 360) + 360) % 360, 4)
  const rotation = turn ? `<Rotation>${turn}</Rotation>` : ''
  return `<PointSymbolizer><Graphic><Mark><WellKnownName>${m.name}</WellKnownName>${fill(style)}${stroke(style)}</Mark><Size>${round(m.size)}</Size>${rotation}</Graphic></PointSymbolizer>`
}

// Mixed layers: one rule per geometry family, filtered with the
// `geometryType()` function GeoServer and QGIS's SLD reader both understand.
const MIXED_RULES: Array<{ geom: Exclude<StyleGeometry, 'Mixed'>; types: string[] }> = [
  { geom: 'Polygon', types: ['Polygon', 'MultiPolygon'] },
  { geom: 'LineString', types: ['LineString', 'MultiLineString'] },
  { geom: 'Point', types: ['Point', 'MultiPoint'] },
]

function geometryTypeFilter(types: string[]): string {
  const tests = types.map(
    (t) =>
      `<ogc:PropertyIsEqualTo><ogc:Function name="geometryType"><ogc:PropertyName>geometry</ogc:PropertyName></ogc:Function><ogc:Literal>${t}</ogc:Literal></ogc:PropertyIsEqualTo>`
  )
  return `<ogc:Filter><ogc:Or>${tests.join('')}</ogc:Or></ogc:Filter>`
}

const prop = (column: string): string => `<ogc:PropertyName>${escapeXml(column)}</ogc:PropertyName>`
const literal = (v: string | number): string => `<ogc:Literal>${escapeXml(String(v))}</ogc:Literal>`

/** The OGC filter that selects one class (upper-inclusive ranges, research §2). */
function classFilter(column: string, c: ExportClass, first: boolean): string {
  if (c.kind === 'noValue') return `<ogc:PropertyIsNull>${prop(column)}</ogc:PropertyIsNull>`
  if (c.kind === 'value') return `<ogc:PropertyIsEqualTo>${prop(column)}${literal(c.value ?? '')}</ogc:PropertyIsEqualTo>`
  const lower = first ? 'PropertyIsGreaterThanOrEqualTo' : 'PropertyIsGreaterThan'
  return `<ogc:And><ogc:${lower}>${prop(column)}${literal(c.lower ?? 0)}</ogc:${lower}><ogc:PropertyIsLessThanOrEqualTo>${prop(column)}${literal(c.upper ?? 0)}</ogc:PropertyIsLessThanOrEqualTo></ogc:And>`
}

function classStyle(style: LayerStyle, geom: Exclude<StyleGeometry, 'Mixed'>, c: ExportClass): LayerStyle {
  return classLayerStyle(style, geom === 'LineString' ? 'line' : geom === 'Point' ? 'marker' : 'fill', c)
}

/** Thematic rules: one per visible class ("Other" is the ElseFilter), times geometry family for mixed layers. */
function thematicRules(style: LayerStyle, geometry: StyleGeometry, column: string, classes: ExportClass[]): string {
  const families = geometry === 'Mixed' ? MIXED_RULES : [{ geom: geometry, types: [] as string[] }]
  const firstRange = classes.findIndex((c) => c.kind === 'range')
  const rules: string[] = []
  classes.forEach((c, i) => {
    if (!c.visible) return
    for (const f of families) {
      const own = c.kind === 'other' ? '' : classFilter(column, c, i === firstRange)
      const geomTest = f.types.length ? geometryTypeFilter(f.types).replace(/^<ogc:Filter>|<\/ogc:Filter>$/g, '') : ''
      const filter = c.kind === 'other' ? (geomTest ? `<ogc:Filter>${geomTest}</ogc:Filter>` : '') : `<ogc:Filter>${geomTest ? `<ogc:And>${own}${geomTest}</ogc:And>` : own}</ogc:Filter>`
      const elseFilter = c.kind === 'other' ? '<ElseFilter/>' : ''
      rules.push(`          <Rule>
            <Name>${escapeXml(c.label)}</Name>
            <Title>${escapeXml(c.label)}</Title>
            ${filter}${elseFilter}
            ${symbolizer(f.geom as Exclude<StyleGeometry, 'Mixed'>, classStyle(style, f.geom as Exclude<StyleGeometry, 'Mixed'>, c))}
          </Rule>`)
    }
  })
  return rules.join('\n')
}

/**
 * Spec 009: the size channel's classes for SLD: the size classes (classed), or
 * 5 equal steps over the domain at their midpoint sizes (proportional, with a
 * notice). "Other" (outside manual classes) has no rule.
 */
function sizeExportClasses(style: LayerStyle, resolved: ResolvedStyle | undefined): ExportClass[] | null {
  const s = style.size
  const r = resolved?.size
  if (!s || !r || r.status !== 'ok' || rendererOf(style).kind === 'bivariate') return null
  const noValue = r.classes.filter((c) => c.kind === 'noValue').map((c) => ({ kind: 'noValue' as const, color: c.color, label: c.label, visible: c.visible }))
  if (s.mode === 'proportional') {
    if (!r.domain) return null
    const { min, max } = r.domain
    const step = (max - min) / 5
    const steps: ExportClass[] = Array.from({ length: max > min ? 5 : 1 }, (_, i) => {
      const lower = min + step * i
      const upper = i === 4 || !(max > min) ? max : min + step * (i + 1)
      return { kind: 'range', lower, upper, color: style.fillColor, label: `${round(lower, 3)} – ${round(upper, 3)}`, visible: true, size: proportionalSize((lower + upper) / 2, r.domain as { min: number; max: number }, s.sizeMin, s.sizeMax, s.scale ?? 'linear') }
    })
    return [...steps, ...noValue]
  }
  return [
    ...r.classes.flatMap((c) => (c.kind === 'range' ? [{ kind: 'range' as const, lower: c.lower, upper: c.upper, color: c.color, label: c.label, visible: c.visible, size: c.size }] : [])),
    ...noValue,
  ]
}

/**
 * Spec 009: one rule per (color class x size class), the filter ANDing both
 * tests, on point and line families; polygons keep the color rules.
 */
function channelRules(style: LayerStyle, geometry: StyleGeometry, color: { column: string; classes: ExportClass[] } | null, size: { column: string; classes: ExportClass[] }): string {
  const families = geometry === 'Mixed' ? MIXED_RULES : [{ geom: geometry, types: [] as string[] }]
  const colors: ExportClass[] = color?.classes ?? [{ kind: 'other', color: style.fillColor, label: '', visible: true }]
  const firstColorRange = colors.findIndex((c) => c.kind === 'range')
  const firstSizeRange = size.classes.findIndex((c) => c.kind === 'range')
  const rules: string[] = []
  for (const f of families) {
    const geom = f.geom as Exclude<StyleGeometry, 'Mixed'>
    const geomTest = f.types.length ? geometryTypeFilter(f.types).replace(/^<ogc:Filter>|<\/ogc:Filter>$/g, '') : ''
    const sized = geom !== 'Polygon'
    colors.forEach((c, i) => {
      if (!c.visible) return
      // "Other" colors (all other values) have no filter of their own here: it is what no listed value matches.
      const colorTest = color && c.kind !== 'other' ? classFilter(color.column, c, i === firstColorRange) : color ? otherFilter(color.column, colors) : ''
      for (const [j, k] of (sized ? size.classes : [null]).entries()) {
        if (k && !k.visible) continue
        const sizeTest = k ? classFilter(size.column, k, j === firstSizeRange) : ''
        const tests = [colorTest, sizeTest, geomTest].filter(Boolean)
        const filter = tests.length === 0 ? '' : `<ogc:Filter>${tests.length === 1 ? tests[0] : `<ogc:And>${tests.join('')}</ogc:And>`}</ogc:Filter>`
        const label = [color ? c.label : '', k?.label ?? ''].filter(Boolean).join(' · ')
        let look = color ? classStyle(style, geom, c) : style
        if (k?.size !== undefined) look = geom === 'LineString' ? { ...look, strokeWidth: k.size } : { ...look, pointRadius: k.size }
        rules.push(`          <Rule>
            <Name>${escapeXml(label)}</Name>
            <Title>${escapeXml(label)}</Title>
            ${filter}
            ${symbolizer(geom, look)}
          </Rule>`)
      }
    })
  }
  return rules.join('\n')
}

/** "All other values" of a categorized color channel, as a filter: none of the listed values (combined with a size test, ElseFilter can't be used). */
function otherFilter(column: string, classes: ExportClass[]): string {
  const listed = classes.filter((c) => c.kind === 'value').map((c) => `<ogc:PropertyIsNotEqualTo>${prop(column)}${literal(c.value ?? '')}</ogc:PropertyIsNotEqualTo>`)
  const notNull = `<ogc:Not><ogc:PropertyIsNull>${prop(column)}</ogc:PropertyIsNull></ogc:Not>`
  return `<ogc:And>${listed.join('')}${notNull}</ogc:And>`
}

// --- Spec 011: properties by a column, as one rule per combination of classes ---

type AxisClass = ExportClass & { output?: Output }

/** One property's classes (`output`: what the class draws), and how a class sets it on a symbol. */
interface Axis {
  id: ChannelId | 'size'
  /** Other properties written with this one's rules (same column, same classes). */
  merged?: ChannelId[]
  column: string
  classes: AxisClass[]
  apply: (look: LayerStyle, c: AxisClass, geom: Exclude<StyleGeometry, 'Mixed'>) => LayerStyle
}

/** Spec 011 US4: SLD has no continuous scale: a continuous property is written as this many equal classes. */
export const SLD_CONTINUOUS_CLASSES = 10

/** Spec 011 US4: what SLD changes about continuous and as-is properties. */
function sldScaleNotes(style: LayerStyle, resolved: ResolvedStyle | undefined): string[] {
  const out: string[] = []
  for (const id of CHANNEL_ORDER) {
    const enc = style.channels?.[id]
    const rc = resolved?.channels?.[id]
    if (!enc || !rc || rc.status !== 'ok' || !isGenericChannel(id, enc)) continue
    if (enc.scale.kind === 'continuous') out.push(`SLD has no continuous scale: ${CHANNEL_NAMES[id]} was written as ${SLD_CONTINUOUS_CLASSES} equal classes.`)
    if (enc.scale.kind === 'identity') out.push(`SLD can't read ${CHANNEL_NAMES[id].toLowerCase()} from a column as is: it keeps the fixed ${CHANNEL_NAMES[id].toLowerCase()} there.`)
    if (enc.scale.kind === 'conditions') out.push(`${CHANNEL_NAMES[id]} by conditions isn't written to SLD: it keeps the fixed ${CHANNEL_NAMES[id].toLowerCase()} there (QML and Mapbox GL keep the conditions).`)
  }
  return out
}

/** SLD rules beyond this many fall back to the first property alone (contracts/interchange-mapping.md). */
export const SLD_RULE_CAP = 100

/** How one property's class output sets the symbol. */
function applyOutput(id: ChannelId, look: LayerStyle, output: Output | undefined, geom: Exclude<StyleGeometry, 'Mixed'>): LayerStyle {
  if (output === undefined) return look
  switch (id) {
    // Spec 011 US4: a continuous color (a line's color is its stroke).
    case 'color':
      return geom === 'LineString' ? { ...look, strokeColor: String(output) } : { ...look, fillColor: String(output) }
    case 'strokeColor':
      return geom === 'LineString' ? look : { ...look, strokeColor: String(output) }
    case 'strokeWidth':
      return geom === 'LineString' ? look : { ...look, strokeWidth: Number(output) }
    case 'width':
      return geom === 'LineString' ? { ...look, lineWidth: Number(output) } : look
    case 'size':
      return geom === 'Point' ? { ...look, pointRadius: Number(output) } : look
    case 'shape':
      return { ...look, markerShape: output as MarkerShape }
    case 'dash':
      return { ...look, lineDash: output as LineDash }
    case 'opacity':
      return { ...look, opacity: Number(output) }
    case 'rotation':
      return { ...look, rotation: Number(output) }
    default:
      return look
  }
}

/** The other properties varying by a column (categories and classes), as SLD writes them. */
function genericAxes(style: LayerStyle, resolved: ResolvedStyle | undefined): Axis[] {
  const out: Axis[] = []
  for (const id of CHANNEL_ORDER) {
    const enc = style.channels?.[id]
    const rc = resolved?.channels?.[id]
    if (!enc || !rc || rc.status !== 'ok' || !isGenericChannel(id, enc) || enc.source.kind !== 'column') continue
    // Spec 011 US4: as is and conditions aren't written to SLD (sldScaleNotes says so).
    if (enc.scale.kind === 'identity' || enc.scale.kind === 'conditions') continue
    if (enc.scale.kind === 'continuous') {
      const scale = enc.scale
      const domain = rc.domain
      if (!domain) continue
      const span = domain.max - domain.min
      const fmt = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 4 })
      const steps: AxisClass[] = Array.from({ length: span > 0 ? SLD_CONTINUOUS_CLASSES : 1 }, (_, i) => {
        const lower = domain.min + (span * i) / SLD_CONTINUOUS_CLASSES
        const upper = span > 0 ? domain.min + (span * (i + 1)) / SLD_CONTINUOUS_CLASSES : domain.max
        return { kind: 'range', lower, upper, color: '', label: `${fmt.format(lower)} – ${fmt.format(upper)}`, visible: true, output: continuousOutput(id, scale, domain, (lower + upper) / 2) }
      })
      const noValue: AxisClass[] = rc.classes.filter((c) => c.kind === 'noValue').map((c) => ({ kind: 'noValue', color: '', label: c.label, visible: c.visible, output: c.output }))
      out.push({ id, column: enc.source.column, classes: [...steps, ...noValue], apply: (look, c, geom) => applyOutput(id, look, c.output, geom) })
      continue
    }
    const classes: AxisClass[] = rc.classes.flatMap((c) =>
      c.kind === 'value' || c.kind === 'range' || c.kind === 'other' || c.kind === 'noValue'
        ? [{ kind: c.kind, value: c.value, lower: c.lower, upper: c.upper, color: c.color, label: c.label, visible: c.visible, output: c.output }]
        : []
    )
    out.push({ id, column: enc.source.column, classes, apply: (look, c, geom) => applyOutput(id, look, c.output, geom) })
  }
  return out
}

/** Every property's axis, in order: color, spec 009's size, then the others (null: SLD writes the renderer its own way). */
function exportAxes(style: LayerStyle, resolved: ResolvedStyle | undefined, thematic: Thematic | null, sizeClasses: ExportClass[] | null): { axes: Axis[]; generic: Axis[] } | null {
  const generic = genericAxes(style, resolved)
  const r = rendererOf(style)
  if (!generic.length) return null
  if (r.kind === 'rules' || r.kind === 'bivariate' || r.kind === 'heatmap' || r.kind === 'clusters') return { axes: [], generic }
  const axes: Axis[] = []
  if (thematic) axes.push({ id: 'color', column: thematic.renderer.column, classes: thematic.classes, apply: (look, c, geom) => (geom === 'LineString' ? { ...look, strokeColor: c.color } : { ...look, fillColor: c.color }) })
  if (sizeClasses && style.size)
    axes.push({ id: 'size', column: style.size.column, classes: sizeClasses, apply: (look, c, geom) => (c.size === undefined ? look : geom === 'LineString' ? { ...look, lineWidth: c.size } : geom === 'Point' ? { ...look, pointRadius: c.size } : look) })
  // Properties on the same column with the same classes are one set of rules (as the legend merges them).
  for (const g of generic) {
    const same = axes.find((a) => a.column === g.column && classSignature(a.classes) === classSignature(g.classes))
    if (!same) {
      axes.push(g)
      continue
    }
    const own = new Map(g.classes.map((c) => [classKey(c), c]))
    const index = axes.indexOf(same)
    axes[index] = {
      ...same,
      merged: [...(same.merged ?? []), g.id],
      classes: same.classes.map((c) => ({ ...c, visible: c.visible && own.get(classKey(c))?.visible !== false })),
      apply: (look, c, geom) => {
        const mine = own.get(classKey(c))
        return mine ? g.apply(same.apply(look, c, geom), mine, geom) : same.apply(look, c, geom)
      },
    }
  }
  return { axes, generic }
}

/** A class's identity across properties: its kind and value or bounds. */
const classKey = (c: ExportClass): string => (c.kind === 'value' ? `v:${c.value}` : c.kind === 'range' ? `r:${c.lower}:${c.upper}` : c.kind)
const classSignature = (classes: ExportClass[]): string => classes.map(classKey).join('|')

const ruleCount = (axes: Axis[]): number => axes.reduce((n, a) => n * Math.max(a.classes.filter((c) => c.visible).length, 1), 1)

/** The axes SLD writes: all of them when two or fewer make at most SLD_RULE_CAP rules, else the first alone. */
function writtenAxes(axes: Axis[]): Axis[] {
  return axes.length <= 2 && ruleCount(axes) <= SLD_RULE_CAP ? axes : axes.slice(0, 1)
}

/** The note for properties SLD leaves at their fixed value, or null. */
function sldChannelNote(style: LayerStyle, resolved: ResolvedStyle | undefined): string | null {
  style = legacyView(style)
  const { thematic } = thematicForExport(style, resolved, 'sld')
  const plan = exportAxes(style, resolved, thematic, sizeExportClasses(style, resolved))
  if (!plan) return null
  const written = new Set(writtenAxes(plan.axes).flatMap((a) => [a.id, ...(a.merged ?? [])]))
  const dropped = plan.generic.filter((a) => !written.has(a.id)).map((a) => CHANNEL_NAMES[a.id as ChannelId])
  if (!dropped.length) return null
  const list = dropped.join(', ')
  if (!plan.axes.length) return `SLD can't combine ${rendererOf(style).kind === 'rules' ? 'rules' : rendererOf(style).kind} with properties by attribute: ${list} keep the fixed value there.`
  return `SLD writes one rule per combination of classes, for two properties and up to ${SLD_RULE_CAP} rules (this style needs ${ruleCount(plan.axes)}): ${list} keep the fixed value there. QML and Mapbox GL keep every property.`
}

/** Features in none of a property's listed classes ("Other"). */
function othersFilter(column: string, classes: ExportClass[]): string {
  if (classes.some((c) => c.kind === 'value')) return otherFilter(column, classes)
  const firstRange = classes.findIndex((c) => c.kind === 'range')
  const ranges = classes.flatMap((c, i) => (c.kind === 'range' ? [classFilter(column, c, i === firstRange)] : []))
  const notNull = `<ogc:Not><ogc:PropertyIsNull>${prop(column)}</ogc:PropertyIsNull></ogc:Not>`
  return ranges.length ? `<ogc:And><ogc:Not>${ranges.length === 1 ? ranges[0] : `<ogc:Or>${ranges.join('')}</ogc:Or>`}</ogc:Not>${notNull}</ogc:And>` : notNull
}

/**
 * Spec 011: one rule per combination of the properties' visible classes (the
 * filter ANDs each property's test), per geometry family. Hidden classes have
 * no rule, so their features aren't drawn, as on the map.
 */
function crossRules(style: LayerStyle, geometry: StyleGeometry, axes: Axis[]): string {
  const families = geometry === 'Mixed' ? MIXED_RULES : [{ geom: geometry, types: [] as string[] }]
  let combos: Array<Array<{ axis: Axis; c: AxisClass; test: string }>> = [[]]
  for (const axis of axes) {
    const firstRange = axis.classes.findIndex((c) => c.kind === 'range')
    const tests = axis.classes.flatMap((c, i) => (c.visible ? [{ axis, c, test: c.kind === 'other' ? othersFilter(axis.column, axis.classes) : classFilter(axis.column, c, i === firstRange) }] : []))
    combos = combos.flatMap((combo) => tests.map((t) => [...combo, t]))
  }
  const rules: string[] = []
  for (const f of families) {
    const geom = f.geom as Exclude<StyleGeometry, 'Mixed'>
    const geomTest = f.types.length ? geometryTypeFilter(f.types).replace(/^<ogc:Filter>|<\/ogc:Filter>$/g, '') : ''
    for (const combo of combos) {
      const tests = [...combo.map((t) => t.test), geomTest].filter(Boolean)
      const filter = tests.length === 0 ? '' : `<ogc:Filter>${tests.length === 1 ? tests[0] : `<ogc:And>${tests.join('')}</ogc:And>`}</ogc:Filter>`
      const label = combo.map((t) => t.c.label).filter(Boolean).join(' · ')
      const look = combo.reduce((l, t) => t.axis.apply(l, t.c, geom), style)
      rules.push(`          <Rule>
            <Name>${escapeXml(label)}</Name>
            <Title>${escapeXml(label)}</Title>
            ${filter}
            ${symbolizer(geom, look)}
          </Rule>`)
    }
  }
  return rules.join('\n')
}

/** Spec 009: one rule per visible bivariate cell (both axes' tests ANDed), plus "No value". Hidden cells are left out. */
function bivariateRules(style: LayerStyle, geometry: StyleGeometry, resolved: ResolvedStyle): string {
  const g = resolved.grid as NonNullable<ResolvedStyle['grid']>
  const families = geometry === 'Mixed' ? MIXED_RULES : [{ geom: geometry, types: [] as string[] }]
  const between = (column: string, r: { lower: number; upper: number }, first: boolean) => {
    const lower = first ? 'PropertyIsGreaterThanOrEqualTo' : 'PropertyIsGreaterThan'
    return `<ogc:${lower}>${prop(column)}${literal(r.lower)}</ogc:${lower}><ogc:PropertyIsLessThanOrEqualTo>${prop(column)}${literal(r.upper)}</ogc:PropertyIsLessThanOrEqualTo>`
  }
  const rules: string[] = []
  for (const f of families) {
    const geom = f.geom as Exclude<StyleGeometry, 'Mixed'>
    const geomTest = f.types.length ? geometryTypeFilter(f.types).replace(/^<ogc:Filter>|<\/ogc:Filter>$/g, '') : ''
    for (const c of resolved.classes) {
      if (!c.visible) continue
      const test =
        c.kind === 'cell' && c.x && c.y
          ? `<ogc:And>${between(g.x.column, c.x, c.col === 0)}${between(g.y.column, c.y, c.row === 0)}${geomTest}</ogc:And>`
          : `${geomTest ? '<ogc:And>' : ''}<ogc:Or><ogc:PropertyIsNull>${prop(g.x.column)}</ogc:PropertyIsNull><ogc:PropertyIsNull>${prop(g.y.column)}</ogc:PropertyIsNull></ogc:Or>${geomTest}${geomTest ? '</ogc:And>' : ''}`
      const look = geom === 'LineString' ? { ...style, strokeColor: c.color } : { ...style, fillColor: c.color }
      rules.push(`          <Rule>
            <Name>${escapeXml(c.label)}</Name>
            <Title>${escapeXml(c.label)}</Title>
            <ogc:Filter>${test}</ogc:Filter>
            ${symbolizer(geom, look)}
          </Rule>`)
    }
  }
  return rules.join('\n')
}

/** Spec 010: a simple rule condition as an OGC filter expression. */
function whereFilter(w: SimpleWhere): string {
  if (w.kind !== 'cmp') return `<ogc:${w.kind === 'and' ? 'And' : 'Or'}>${w.items.map(whereFilter).join('')}</ogc:${w.kind === 'and' ? 'And' : 'Or'}>`
  if (w.op === 'like') return `<ogc:PropertyIsLike wildCard="%" singleChar="_" escape="\\">${prop(w.column)}${literal(w.value)}</ogc:PropertyIsLike>`
  const name = { '=': 'PropertyIsEqualTo', '!=': 'PropertyIsNotEqualTo', '<': 'PropertyIsLessThan', '<=': 'PropertyIsLessThanOrEqualTo', '>': 'PropertyIsGreaterThan', '>=': 'PropertyIsGreaterThanOrEqualTo' }[w.op]
  return `<ogc:${name}>${prop(w.column)}${literal(w.value)}</ogc:${name}>`
}

/**
 * Spec 010: rules as SLD rules. SLD draws every rule whose filter matches, so
 * each rule also says "and none of the rules before it" (the first matching
 * rule colors a feature). Hidden rules are left out but still exclude their
 * features from later rules; "Everything else" is the ElseFilter, or (with
 * hidden rules) the explicit "none of the rules".
 */
function rulesRules(style: LayerStyle, geometry: StyleGeometry, r: RulesRenderer, portable: PortableRule[]): string {
  const families = geometry === 'Mixed' ? MIXED_RULES : [{ geom: geometry, types: [] as string[] }]
  const anyHidden = portable.some((p) => !p.rule.visible)
  const out: string[] = []
  const and = (tests: string[]): string => (tests.length === 1 ? tests[0] : `<ogc:And>${tests.join('')}</ogc:And>`)
  for (const f of families) {
    const geom = f.geom as Exclude<StyleGeometry, 'Mixed'>
    const geomTest = f.types.length ? geometryTypeFilter(f.types).replace(/^<ogc:Filter>|<\/ogc:Filter>$/g, '') : ''
    const rule = (label: string, color: string, filter: string): void => {
      const look = geom === 'LineString' ? { ...style, strokeColor: color } : { ...style, fillColor: color }
      out.push(`          <Rule>
            <Name>${escapeXml(label)}</Name>
            <Title>${escapeXml(label)}</Title>
            ${filter}
            ${symbolizer(geom, look)}
          </Rule>`)
    }
    portable.forEach((p, k) => {
      if (!p.rule.visible) return
      const before = portable.slice(0, k).map((q) => `<ogc:Not>${whereFilter(q.where)}</ogc:Not>`)
      rule(ruleDefLabel(p.rule), p.rule.color, `<ogc:Filter>${and([whereFilter(p.where), ...before, ...(geomTest ? [geomTest] : [])])}</ogc:Filter>`)
    })
    if (r.elseVisible) {
      if (anyHidden && portable.length) {
        const none = portable.map((q) => `<ogc:Not>${whereFilter(q.where)}</ogc:Not>`)
        rule(r.elseLabel, r.elseColor, `<ogc:Filter>${and([...none, ...(geomTest ? [geomTest] : [])])}</ogc:Filter>`)
      } else rule(r.elseLabel, r.elseColor, `${geomTest ? `<ogc:Filter>${geomTest}</ogc:Filter>` : ''}<ElseFilter/>`)
    }
  }
  return out.join('\n')
}

// --- Spec 011 US6: labels as a TextSymbolizer in every rule (contracts/interchange-mapping.md) ---

/** SLD's anchor point (0..1 of the label box) and displacement (px, y up) for each of our point anchors. */
const SLD_ANCHOR: Record<LabelAnchor, { ax: number; ay: number; dx: number; dy: number }> = {
  above: { ax: 0.5, ay: 0, dx: 0, dy: 1 },
  below: { ax: 0.5, ay: 1, dx: 0, dy: -1 },
  left: { ax: 1, ay: 0.5, dx: -1, dy: 0 },
  right: { ax: 0, ay: 0.5, dx: 1, dy: 0 },
  center: { ax: 0.5, ay: 0.5, dx: 0, dy: 0 },
}

/** A TextSymbolizer for one geometry family, or '' (labels off, or no column to read). */
function textSymbolizer(labels: LabelSettings | undefined, geom: Exclude<StyleGeometry, 'Mixed'>): string {
  if (!labels?.enabled) return ''
  const column = labelColumnOf(labels)
  if (!column) return ''
  const font = `<Font>${param('font-family', 'sans-serif')}${param('font-size', labels.size)}</Font>`
  const halo = labels.halo.enabled ? `<Halo><Radius>${labels.halo.width}</Radius><Fill>${param('fill', labels.halo.color)}</Fill></Halo>` : ''
  let placement: string
  if (geom === 'LineString') placement = `<LabelPlacement><LinePlacement><PerpendicularOffset>${round(labels.size * 0.2 + labels.size / 2)}</PerpendicularOffset></LinePlacement></LabelPlacement>`
  else {
    const p = geom === 'Polygon' || labels.placement.kind !== 'point' ? { anchor: 'center' as LabelAnchor, offset: 0 } : labels.placement
    const a = SLD_ANCHOR[p.anchor]
    placement = `<LabelPlacement><PointPlacement><AnchorPoint><AnchorPointX>${a.ax}</AnchorPointX><AnchorPointY>${a.ay}</AnchorPointY></AnchorPoint><Displacement><DisplacementX>${a.dx * p.offset}</DisplacementX><DisplacementY>${a.dy * p.offset}</DisplacementY></Displacement></PointPlacement></LabelPlacement>`
  }
  return `<TextSymbolizer><Label>${prop(column)}</Label>${font}${placement}${halo}<Fill>${param('fill', labels.color)}</Fill></TextSymbolizer>`
}

/** Our labels from the first TextSymbolizer, or undefined. */
function labelsFromSld(doc: Document, notes: string[]): LabelSettings | undefined {
  const t = byLocal(doc, 'TextSymbolizer')[0]
  if (!t) return undefined
  const label = directChild(t, 'Label')
  const column = label ? byLocal(label, 'PropertyName')[0]?.textContent?.trim() : undefined
  if (!column) {
    notes.push('The SLD label is not a single property; labels were not imported.')
    return undefined
  }
  const font = readParams(directChild(t, 'Font'))
  const fill = parseColor(readParams(directChild(t, 'Fill')).get('fill'))
  const haloEl = directChild(t, 'Halo')
  const haloFill = parseColor(readParams(haloEl ? directChild(haloEl, 'Fill') : undefined).get('fill'))
  const radius = Number(haloEl ? directChild(haloEl, 'Radius')?.textContent : NaN)
  const pp = byLocal(t, 'PointPlacement')[0]
  const num = (el: Element | undefined, local: string) => Number(el ? byLocal(el, local)[0]?.textContent?.trim() : NaN)
  const ax = num(pp, 'AnchorPointX')
  const ay = num(pp, 'AnchorPointY')
  const dx = num(pp, 'DisplacementX')
  const dy = num(pp, 'DisplacementY')
  const anchor = (Object.keys(SLD_ANCHOR) as LabelAnchor[]).find((k) => SLD_ANCHOR[k].ax === (Number.isFinite(ax) ? ax : 0.5) && SLD_ANCHOR[k].ay === (Number.isFinite(ay) ? ay : 0.5)) ?? 'center'
  const offset = Math.abs(Number.isFinite(dx) && dx !== 0 ? dx : Number.isFinite(dy) ? dy : 0)
  return sanitizeLabels({
    enabled: true,
    source: { kind: 'column', column },
    size: Number(font.get('font-size')) || undefined,
    color: fill ? rgbToHex(fill) : undefined,
    halo: { enabled: !!haloEl, color: haloFill ? rgbToHex(haloFill) : undefined, width: Number.isFinite(radius) ? radius : undefined },
    placement: { kind: 'point', anchor, offset },
  })
}

export function styleToSld(input: LayerStyle, geometry: StyleGeometry, layerName: string, resolved?: ResolvedStyle): StyleExport {
  const style = legacyView(sanitizeStyle(input))
  const { thematic } = thematicForExport(style, resolved, 'sld')
  const notes = previewExportNotice(style, 'sld', resolved).items
  const sizeClasses = geometry === 'Polygon' ? null : sizeExportClasses(style, resolved)
  const isBivariate = rendererOf(style).kind === 'bivariate' && resolved?.status === 'ok' && !!resolved.grid
  // Spec 010: rules, when every condition is simple (else the single symbol, with a notice).
  const rr = rendererOf(style)
  const portable = rr.kind === 'rules' && resolved?.status === 'ok' ? portableRules(style, resolved, 'sld') : null
  // Spec 011: properties by a column, crossed with the color and size classes.
  const plan = exportAxes(style, resolved, thematic, sizeClasses)
  notes.push(...sldScaleNotes(style, resolved))
  const channelNote = sldChannelNote(style, resolved)
  if (channelNote) notes.push(channelNote)
  const l = style.labels
  if (l?.enabled && l.source.kind === 'expression') {
    const column = labelColumnOf(l)
    notes.push(column ? `SLD labels read one column: the labels show "${column}", not the expression.` : 'SLD labels read one column, and the label expression names none: labels were left out.')
  }
  const rules = isBivariate && resolved
    ? bivariateRules(style, geometry, resolved)
    : rr.kind === 'rules' && portable
    ? rulesRules(style, geometry, rr, portable)
    : plan && plan.axes.length
    ? crossRules(style, geometry, writtenAxes(plan.axes))
    : sizeClasses && style.size
    ? channelRules(style, geometry, thematic ? { column: thematic.renderer.column, classes: thematic.classes } : null, { column: style.size.column, classes: sizeClasses })
    : thematic
    ? thematicRules(style, geometry, thematic.renderer.column, thematic.classes)
    : geometry === 'Mixed'
      ? MIXED_RULES.map(
          (r) => `          <Rule>
            <Name>${r.geom}</Name>
            ${geometryTypeFilter(r.types)}
            ${symbolizer(r.geom, style)}
          </Rule>`
        ).join('\n')
      : `          <Rule>
            <Name>Single symbol</Name>
            ${symbolizer(geometry, style)}
          </Rule>`
  const name = escapeXml(layerName)
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>${name}</Name>
    <UserStyle>
      <Title>${name}</Title>
      <FeatureTypeStyle>
${rules}
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
`
  return { text, notes }
}

// --- import ---------------------------------------------------------------

/** Namespace-agnostic descendant lookup (SLD 1.0 vs SE 1.1 prefixes differ). */
function byLocal(root: Element | Document, local: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((el) => el.localName === local)
}

function readParams(el: Element | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!el) return out
  for (const p of [...byLocal(el, 'CssParameter'), ...byLocal(el, 'SvgParameter')]) {
    const name = p.getAttribute('name')
    const value = p.textContent?.trim()
    if (name && value) out.set(name, value)
  }
  return out
}

function directChild(el: Element, local: string): Element | undefined {
  return Array.from(el.children).find((c) => c.localName === local)
}

type RuleClass =
  | { kind: 'value'; column: string; value: string }
  | { kind: 'noValue'; column: string }
  | { kind: 'other' }
  | { kind: 'range'; column: string; lower: number; upper: number; lowerOpen: boolean }
  | { kind: 'guard'; column: string }

/** Reads one comparison: the column and the literal. */
function comparison(el: Element): { column: string; literal: string } | null {
  const column = directChild(el, 'PropertyName')?.textContent?.trim()
  const lit = directChild(el, 'Literal')?.textContent?.trim()
  return column && lit !== undefined ? { column, literal: lit } : null
}

const GEOMETRY_FN = (el: Element): boolean => el.localName === 'PropertyIsEqualTo' && !!directChild(el, 'Function')

/**
 * The class a rule's filter selects, if it is one of the thematic shapes our
 * writer (and QGIS, GeoServer, GeoLibre) produce; null otherwise.
 */
function ruleClass(rule: Element): RuleClass | null {
  if (directChild(rule, 'ElseFilter')) return { kind: 'other' }
  const filter = directChild(rule, 'Filter')
  if (!filter) return null
  let node = filter.firstElementChild
  // Our mixed-geometry rules: And(class test, geometryType test) or Or(geometryType tests) alone.
  if (node?.localName === 'And') {
    const parts = Array.from(node.children).filter((c) => !(GEOMETRY_FN(c) || (c.localName === 'Or' && Array.from(c.children).every(GEOMETRY_FN))))
    if (parts.length === 1) node = parts[0]
    else if (parts.length === 2) {
      const lo = parts.find((p) => p.localName === 'PropertyIsGreaterThan' || p.localName === 'PropertyIsGreaterThanOrEqualTo')
      const hi = parts.find((p) => p.localName === 'PropertyIsLessThanOrEqualTo' || p.localName === 'PropertyIsLessThan')
      const a = lo && comparison(lo)
      const b = hi && comparison(hi)
      if (a && b && a.column === b.column && Number.isFinite(Number(a.literal)) && Number.isFinite(Number(b.literal))) {
        return { kind: 'range', column: a.column, lower: Number(a.literal), upper: Number(b.literal), lowerOpen: lo?.localName === 'PropertyIsGreaterThan' }
      }
      return null
    } else return null
  }
  if (!node) return null
  if (node.localName === 'Or' && Array.from(node.children).every(GEOMETRY_FN)) return { kind: 'other' }
  if (node.localName === 'PropertyIsNull') {
    const column = directChild(node, 'PropertyName')?.textContent?.trim()
    return column ? { kind: 'noValue', column } : null
  }
  const c = comparison(node)
  if (!c) return null
  if (node.localName === 'PropertyIsEqualTo') return { kind: 'value', column: c.column, value: c.literal }
  if (node.localName === 'PropertyIsLessThan') return { kind: 'guard', column: c.column }
  if (node.localName === 'PropertyIsGreaterThanOrEqualTo' || node.localName === 'PropertyIsGreaterThan') {
    // An open-ended top class (GeoLibre writes ">= last break").
    return { kind: 'range', column: c.column, lower: Number(c.literal), upper: Number.MAX_VALUE, lowerOpen: node.localName === 'PropertyIsGreaterThan' }
  }
  return null
}

function ruleColor(rule: Element): string | undefined {
  const polygon = byLocal(rule, 'PolygonSymbolizer')[0]
  const point = byLocal(rule, 'PointSymbolizer')[0]
  const line = byLocal(rule, 'LineSymbolizer')[0]
  const params = polygon ? readParams(directChild(polygon, 'Fill')) : point ? readParams(byLocal(point, 'Fill')[0]) : line ? readParams(directChild(line, 'Stroke')) : new Map<string, string>()
  const c = parseColor(params.get(line && !polygon && !point ? 'stroke' : 'fill'))
  return c ? rgbToHex(c) : undefined
}

/** A point mark's shape and radius, px (a square turned 45 degrees is a diamond). */
function readMark(point: Element, notes: string[]): { shape: MarkerShape; radius?: number; rotation: number } {
  const wkn = (byLocal(point, 'WellKnownName')[0]?.textContent?.trim() ?? 'circle').toLowerCase()
  const size = Number(byLocal(point, 'Size')[0]?.textContent?.trim())
  const rotation = Number(byLocal(point, 'Rotation')[0]?.textContent?.trim() ?? '0') || 0
  const turned = Math.abs(((rotation % 90) + 90) % 90) === 45
  const radius = Number.isFinite(size) ? size / 2 : undefined
  // Spec 011: what remains of the rotation after the shape's own turn is the style's rotation.
  const rest = (turn: number, period = 360) => round((((rotation - turn) % period) + period) % period, 4)
  if (byLocal(point, 'ExternalGraphic').length > 0) notes.push('External graphic markers are not supported; a circle was used.')
  if (wkn === 'square' && turned) return { shape: 'diamond', radius: radius !== undefined ? radius * Math.SQRT2 : undefined, rotation: rest(45, 90) }
  // QGIS writes its own names (cross_fill, cross2) into SLD.
  if (wkn === 'cross' || wkn === 'cross_fill') return { shape: turned ? 'x' : 'cross', radius, rotation: rest(turned ? 45 : 0, 90) }
  if (wkn === 'x' || wkn === 'cross2') return { shape: turned ? 'cross' : 'x', radius, rotation: rest(turned ? 45 : 0, 90) }
  if (wkn === 'circle' || wkn === 'square' || wkn === 'triangle' || wkn === 'diamond' || wkn === 'star') return { shape: wkn, radius, rotation: rest(0) }
  notes.push(`The "${wkn}" marker shape was imported as a circle.`)
  return { shape: 'circle', radius, rotation: rest(0) }
}

/** A rule's symbol size: the marker radius, or the line width; undefined for polygons. */
function ruleSize(rule: Element): number | undefined {
  const point = byLocal(rule, 'PointSymbolizer')[0]
  if (point) return readMark(point, []).radius
  const line = byLocal(rule, 'LineSymbolizer')[0]
  const w = line ? Number(readParams(directChild(line, 'Stroke')).get('stroke-width')) : NaN
  return Number.isFinite(w) ? w : undefined
}

function ruleLabel(rule: Element): string | undefined {
  return (byLocal(rule, 'Title')[0] ?? byLocal(rule, 'Name')[0])?.textContent?.trim() || undefined
}

/** Spec 011: what a rule's symbol draws besides its color (null: the symbol doesn't have it). */
function ruleLook(rule: Element): Partial<Record<ChannelId, Output | null>> {
  const polygon = byLocal(rule, 'PolygonSymbolizer')[0]
  const point = byLocal(rule, 'PointSymbolizer')[0]
  const line = byLocal(rule, 'LineSymbolizer')[0]
  const mark = point ? byLocal(point, 'Mark')[0] : undefined
  const outline = (polygon && directChild(polygon, 'Stroke')) || (mark && directChild(mark, 'Stroke')) || undefined
  const p = readParams(outline)
  const dashed = readParams((polygon && directChild(polygon, 'Stroke')) || (line && directChild(line, 'Stroke')) || undefined).get('stroke-dasharray')
  const color = parseColor(p.get('stroke'))
  const width = Number(p.get('stroke-width'))
  const m = point ? readMark(point, []) : null
  const lineOnly = !!line && !polygon && !point
  return {
    strokeColor: lineOnly ? null : color ? rgbToHex(color) : null,
    strokeWidth: lineOnly ? null : outline ? (Number.isFinite(width) ? width : 1) : 0,
    shape: m ? m.shape : null,
    rotation: m ? m.rotation : null,
    dash: polygon || line ? (dashed ? (dashFromPattern(dashed.split(/[\s,]+/).filter(Boolean).map(Number)) ?? 'solid') : 'solid') : null,
  }
}

/** Spec 011: the properties whose output differs between the classes, as properties by the column (same classes). */
function channelsFromRules(column: string, read: Array<{ cls: RuleClass; look: Partial<Record<ChannelId, Output | null>> }>): Channels {
  const out: Channels = {}
  const ranges = read.filter((r) => r.cls.kind === 'range')
  for (const id of ['strokeColor', 'strokeWidth', 'shape', 'dash', 'rotation'] as const) {
    const outputs = read.map((r) => r.look[id])
    if (outputs.some((o) => o === null || o === undefined) || new Set(outputs).size < 2) continue
    const def = (o: Output | null | undefined): ClassDef => (o === null || o === undefined ? {} : { output: o })
    const noValue = read.find((r) => r.cls.kind === 'noValue')
    const source = { kind: 'column' as const, column }
    if (ranges.length) {
      const bounds = (r: (typeof read)[number]) => r.cls as { lower: number; upper: number }
      const sorted = [...ranges].sort((a, b) => bounds(a).lower - bounds(b).lower)
      const classes = sorted.map((r, index) => ({ index, lower: bounds(r).lower, upper: bounds(r).upper, ...def(r.look[id]) }))
      if (classes.length < 2 || classes.length > 10 || classes.some((c) => c.upper === Number.MAX_VALUE)) continue
      out[id] = { source, scale: { kind: 'classes', method: 'manual', classCount: classes.length, classes, noValue: def(noValue?.look[id]) } }
    } else {
      const categories = read.flatMap((r) => (r.cls.kind === 'value' ? [{ value: r.cls.value, ...def(r.look[id]) }] : []))
      const other = read.find((r) => r.cls.kind === 'other')
      out[id] = { source, scale: { kind: 'categories', manual: true, categories, other: def(other?.look[id]), noValue: def(noValue?.look[id]), cap: Math.max(categories.length, 1) } }
    }
  }
  return out
}

/** Thematic classes from the rules (and, spec 011, the other properties they vary), or null when the rules aren't a thematic style. */
function thematicFromRules(rules: Element[], notes: string[]): { renderer: LayerStyle['renderer'] | null; channels: Channels } | null {
  const read = rules.map((r) => ({ rule: r, cls: ruleClass(r) }))
  const thematic = read.filter((r) => r.cls !== null)
  if (thematic.length < 2 || thematic.length !== read.length) {
    if (thematic.length >= 2) notes.push(`${read.length - thematic.length} of ${read.length} rules couldn't be read as classes.`)
    if (thematic.length < 2) return null
  }
  const columns = new Set(thematic.flatMap((r) => (r.cls && 'column' in r.cls ? [r.cls.column] : [])))
  // Classes on two columns (spec 009) get their note in sldToStyle.
  if (columns.size !== 1) return null
  const column = [...columns][0]
  const seen = new Set<string>()
  if (thematic.some((r) => r.cls?.kind === 'guard')) notes.push('A rule for values below the first class was skipped; such values fall in "Other".')
  const ranges: ImportedRange[] = []
  const rangeSizes: number[] = []
  const categories: ImportedCategory[] = []
  const looks: Array<{ cls: RuleClass; look: Partial<Record<ChannelId, Output | null>>; color?: string }> = []
  for (const { rule, cls } of thematic) {
    if (!cls || cls.kind === 'guard') continue
    const key = cls.kind === 'value' ? `v:${cls.value}` : cls.kind === 'range' ? `r:${cls.lower}:${cls.upper}` : cls.kind
    if (seen.has(key)) continue // our mixed-geometry export repeats each class per geometry family
    seen.add(key)
    const color = ruleColor(rule)
    const label = ruleLabel(rule)
    looks.push({ cls, look: ruleLook(rule), color })
    if (cls.kind === 'range') {
      ranges.push({ lower: cls.lower, upper: cls.upper, color, label })
      const size = ruleSize(rule)
      if (size !== undefined) rangeSizes.push(size)
    }
    else categories.push({ value: cls.kind === 'value' ? cls.value : cls.kind === 'noValue' ? null : undefined, color, label })
  }
  if (ranges.length) {
    ranges.sort((a, b) => a.lower - b.lower)
    // A ">= x" top class has no upper bound in SLD: close it at the next power of ten above x.
    const last = ranges[ranges.length - 1]
    if (last.upper === Number.MAX_VALUE) last.upper = last.lower === 0 ? 1 : 10 ** Math.ceil(Math.log10(Math.abs(last.lower) * 10))
    notes.push("SLD doesn't store the classification method; the classes were imported as fixed (Manual).")
    const noValue = categories.find((c) => c.value === null)
    // Ranges drawn at different sizes are size classes (QGIS's GraduatedSize writes them so).
    const sizes = rangeSizes.length === ranges.length ? rangeSizes : []
    const size = new Set(sizes).size > 1 ? { min: Math.min(...sizes), max: Math.max(...sizes) } : undefined
    if (size && new Set(ranges.map((r) => r.color)).size > 1) notes.push('The classes vary both color and size; the sizes were imported and the colors left out.')
    return withChannels(graduatedFrom(column, ranges, { noValue, size }))
  }
  return withChannels(categorizedFrom(column, categories))

  // Spec 011: other properties by the same column; one color for every class is no color classes at all.
  function withChannels(renderer: LayerStyle['renderer']): { renderer: LayerStyle['renderer'] | null; channels: Channels } {
    const channels = channelsFromRules(column, looks)
    const oneColor = new Set(looks.map((l) => l.color)).size === 1
    return { renderer: Object.keys(channels).length && oneColor ? null : renderer, channels }
  }
}

export function sldToStyle(text: string): StyleImportResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('This SLD file is not valid XML.')
  const notes: string[] = []
  const rules = byLocal(doc, 'Rule')
  if (rules.length === 0) throw new Error('This SLD file has no <Rule> elements.')
  const fromRules = thematicFromRules(rules, notes)
  const renderer = fromRules?.renderer ?? null
  const channels = fromRules?.channels ?? {}

  const polygon = byLocal(doc, 'PolygonSymbolizer')[0]
  const line = byLocal(doc, 'LineSymbolizer')[0]
  const point = byLocal(doc, 'PointSymbolizer')[0]
  if (!polygon && !line && !point) throw new Error('This SLD file has no polygon, line or point symbolizer.')

  const distinctFamilies = [polygon, line, point].filter(Boolean).length
  // Spec 009: rules that test two columns (color and size classes, or bivariate cells).
  const twoColumns = !fromRules && rules.some((r) => new Set(byLocal(r, 'PropertyName').map((p) => p.textContent?.trim()).filter((n) => n && n !== 'geometry')).size > 1)
  if (!renderer && twoColumns) {
    notes.push("Classes on two columns can't be read from SLD; use QML or Mapbox GL to keep them. The single symbol was imported.")
  } else if (!fromRules && rules.length > distinctFamilies) {
    notes.push(`This SLD has ${rules.length} rules; only the first symbolizer of each geometry type was imported (rule-based styles are not supported yet).`)
  }

  const style: Partial<LayerStyle> = {}
  const num = (s: string | undefined): number | undefined => (s !== undefined && Number.isFinite(Number(s)) ? Number(s) : undefined)

  // Fill comes from the polygon symbolizer, else the point marker.
  const mark = point ? byLocal(point, 'Mark')[0] : undefined
  const fillParams = readParams(polygon ? directChild(polygon, 'Fill') : mark ? directChild(mark, 'Fill') : undefined)
  if (fillParams.has('fill')) style.fillColor = fillParams.get('fill')
  if (fillParams.has('fill-opacity')) style.fillOpacity = num(fillParams.get('fill-opacity'))

  // Stroke from polygon outline, else the line, else the marker outline.
  const strokeEl = (polygon && directChild(polygon, 'Stroke')) || (line && directChild(line, 'Stroke')) || (mark && directChild(mark, 'Stroke'))
  const strokeParams = readParams(strokeEl)
  if (strokeParams.has('stroke')) style.strokeColor = strokeParams.get('stroke')
  if (strokeParams.has('stroke-width')) style.strokeWidth = num(strokeParams.get('stroke-width'))
  if (strokeParams.has('stroke-opacity')) style.strokeOpacity = num(strokeParams.get('stroke-opacity'))
  // The dash pattern of the line or polygon outline, in any unit (QGIS writes Qt's, in line widths).
  const lineStroke = readParams((polygon && directChild(polygon, 'Stroke')) || (line && directChild(line, 'Stroke')) || undefined)
  const dasharray = lineStroke.get('stroke-dasharray')
  if (dasharray) {
    const dash = dashFromPattern(dasharray.split(/[\s,]+/).filter(Boolean).map(Number))
    if (dash) style.lineDash = dash
  }
  if ((polygon || mark) && !strokeEl) style.strokeWidth = 0

  if (point) {
    const m = readMark(point, notes)
    if (m.radius !== undefined) style.pointRadius = m.radius
    style.markerShape = m.shape
    if (m.rotation !== 0) style.rotation = m.rotation
  }

  if (renderer) {
    style.renderer = renderer
    // The symbol color of the first rule is a class color, not the single symbol's.
    delete style.fillColor
  }
  const labels = labelsFromSld(doc, notes)
  if (labels) style.labels = labels
  // Spec 011: the first rule's outline, shape, pattern and rotation are a class's when they vary by class.
  if (Object.keys(channels).length) {
    style.channels = channels
    if (channels.rotation) delete style.rotation
  }
  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...style }), format: 'sld', notes }
}
