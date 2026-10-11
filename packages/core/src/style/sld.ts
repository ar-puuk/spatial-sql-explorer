// OGC Styled Layer Descriptor (SLD 1.0.0), the format GeoServer, MapServer
// and QGIS ("Save as SLD") all exchange. 1.0.0 with `CssParameter` is the
// most widely accepted dialect; the importer also reads SLD 1.1 / SE
// (`SvgParameter`, `se:` namespace) by matching local names only.
// SLD sizes are in pixels by default, and marker `Size` is a diameter.
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
import type { StyleExport } from './qml.js'
import { categorizedFrom, graduatedFrom, previewExportNotice, thematicForExport, type ExportClass, type ImportedCategory, type ImportedRange } from './interchange.js'

function param(name: string, value: string | number): string {
  return `<CssParameter name="${name}">${escapeXml(String(value))}</CssParameter>`
}

function fill(style: LayerStyle): string {
  return `<Fill>${param('fill', style.fillColor)}${param('fill-opacity', round(style.fillOpacity))}</Fill>`
}

function stroke(style: LayerStyle): string {
  if (style.strokeWidth <= 0) return ''
  return `<Stroke>${param('stroke', style.strokeColor)}${param('stroke-width', round(style.strokeWidth))}${param('stroke-opacity', round(style.strokeOpacity))}${param('stroke-linejoin', 'round')}</Stroke>`
}

function symbolizer(geom: Exclude<StyleGeometry, 'Mixed'>, style: LayerStyle): string {
  if (geom === 'Polygon') return `<PolygonSymbolizer>${fill(style)}${stroke(style)}</PolygonSymbolizer>`
  if (geom === 'LineString') return `<LineSymbolizer>${stroke(style)}</LineSymbolizer>`
  return `<PointSymbolizer><Graphic><Mark><WellKnownName>circle</WellKnownName>${fill(style)}${stroke(style)}</Mark><Size>${round(style.pointRadius * 2)}</Size></Graphic></PointSymbolizer>`
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

function classStyle(style: LayerStyle, geom: Exclude<StyleGeometry, 'Mixed'>, color: string): LayerStyle {
  return geom === 'LineString' ? { ...style, strokeColor: color } : { ...style, fillColor: color }
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
            ${symbolizer(f.geom as Exclude<StyleGeometry, 'Mixed'>, classStyle(style, f.geom as Exclude<StyleGeometry, 'Mixed'>, c.color))}
          </Rule>`)
    }
  })
  return rules.join('\n')
}

export function styleToSld(input: LayerStyle, geometry: StyleGeometry, layerName: string, resolved?: ResolvedStyle): StyleExport {
  const style = sanitizeStyle(input)
  const { thematic } = thematicForExport(style, resolved)
  const notes = previewExportNotice(style, 'sld', resolved).items
  const rules = thematic
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

function ruleLabel(rule: Element): string | undefined {
  return (byLocal(rule, 'Title')[0] ?? byLocal(rule, 'Name')[0])?.textContent?.trim() || undefined
}

/** Thematic classes from the rules, or null when the rules aren't a thematic style. */
function thematicFromRules(rules: Element[], notes: string[]): LayerStyle['renderer'] | null {
  const read = rules.map((r) => ({ rule: r, cls: ruleClass(r) }))
  const thematic = read.filter((r) => r.cls !== null)
  if (thematic.length < 2 || thematic.length !== read.length) {
    if (thematic.length >= 2) notes.push(`${read.length - thematic.length} of ${read.length} rules couldn't be read as classes.`)
    if (thematic.length < 2) return null
  }
  const columns = new Set(thematic.flatMap((r) => (r.cls && 'column' in r.cls ? [r.cls.column] : [])))
  if (columns.size !== 1) return null
  const column = [...columns][0]
  const seen = new Set<string>()
  if (thematic.some((r) => r.cls?.kind === 'guard')) notes.push('A rule for values below the first class was skipped; such values fall in "Other".')
  const ranges: ImportedRange[] = []
  const categories: ImportedCategory[] = []
  for (const { rule, cls } of thematic) {
    if (!cls || cls.kind === 'guard') continue
    const key = cls.kind === 'value' ? `v:${cls.value}` : cls.kind === 'range' ? `r:${cls.lower}:${cls.upper}` : cls.kind
    if (seen.has(key)) continue // our mixed-geometry export repeats each class per geometry family
    seen.add(key)
    const color = ruleColor(rule)
    const label = ruleLabel(rule)
    if (cls.kind === 'range') ranges.push({ lower: cls.lower, upper: cls.upper, color, label })
    else categories.push({ value: cls.kind === 'value' ? cls.value : cls.kind === 'noValue' ? null : undefined, color, label })
  }
  if (ranges.length) {
    ranges.sort((a, b) => a.lower - b.lower)
    // A ">= x" top class has no upper bound in SLD: close it at the next power of ten above x.
    const last = ranges[ranges.length - 1]
    if (last.upper === Number.MAX_VALUE) last.upper = last.lower === 0 ? 1 : 10 ** Math.ceil(Math.log10(Math.abs(last.lower) * 10))
    notes.push("SLD doesn't store the classification method; the classes were imported as fixed (Manual).")
    const noValue = categories.find((c) => c.value === null)
    return graduatedFrom(column, ranges, { noValue })
  }
  return categorizedFrom(column, categories)
}

export function sldToStyle(text: string): StyleImportResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('This SLD file is not valid XML.')
  const notes: string[] = []
  const rules = byLocal(doc, 'Rule')
  if (rules.length === 0) throw new Error('This SLD file has no <Rule> elements.')
  const renderer = thematicFromRules(rules, notes)

  const polygon = byLocal(doc, 'PolygonSymbolizer')[0]
  const line = byLocal(doc, 'LineSymbolizer')[0]
  const point = byLocal(doc, 'PointSymbolizer')[0]
  if (!polygon && !line && !point) throw new Error('This SLD file has no polygon, line or point symbolizer.')

  const distinctFamilies = [polygon, line, point].filter(Boolean).length
  if (!renderer && rules.length > distinctFamilies) {
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
  if ((polygon || mark) && !strokeEl) style.strokeWidth = 0

  if (point) {
    const size = num(byLocal(point, 'Size')[0]?.textContent?.trim())
    if (size !== undefined) style.pointRadius = size / 2
    const wkn = byLocal(point, 'WellKnownName')[0]?.textContent?.trim()
    if (wkn && wkn !== 'circle') notes.push(`The "${wkn}" marker shape was imported as a circle.`)
    if (byLocal(point, 'ExternalGraphic').length > 0) notes.push('External graphic markers are not supported; a circle was used.')
  }

  if (renderer) {
    style.renderer = renderer
    // The symbol color of the first rule is a class color, not the single symbol's.
    delete style.fillColor
  }
  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...style }), format: 'sld', notes }
}
