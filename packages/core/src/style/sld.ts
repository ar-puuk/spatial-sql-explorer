// OGC Styled Layer Descriptor (SLD 1.0.0), the format GeoServer, MapServer
// and QGIS ("Save as SLD") all exchange. 1.0.0 with `CssParameter` is the
// most widely accepted dialect; the importer also reads SLD 1.1 / SE
// (`SvgParameter`, `se:` namespace) by matching local names only.
// SLD sizes are in pixels by default, and marker `Size` is a diameter.
import {
  DEFAULT_LAYER_STYLE,
  escapeXml,
  round,
  sanitizeStyle,
  type LayerStyle,
  type StyleGeometry,
  type StyleImportResult,
} from './model.js'
import type { StyleExport } from './qml.js'

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

export function styleToSld(input: LayerStyle, geometry: StyleGeometry, layerName: string): StyleExport {
  const style = sanitizeStyle(input)
  const rules =
    geometry === 'Mixed'
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
  return { text, notes: [] }
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

export function sldToStyle(text: string): StyleImportResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('This SLD file is not valid XML.')
  const notes: string[] = []
  const rules = byLocal(doc, 'Rule')
  if (rules.length === 0) throw new Error('This SLD file has no <Rule> elements.')

  const polygon = byLocal(doc, 'PolygonSymbolizer')[0]
  const line = byLocal(doc, 'LineSymbolizer')[0]
  const point = byLocal(doc, 'PointSymbolizer')[0]
  if (!polygon && !line && !point) throw new Error('This SLD file has no polygon, line or point symbolizer.')

  const distinctFamilies = [polygon, line, point].filter(Boolean).length
  if (rules.length > distinctFamilies) {
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

  return { style: sanitizeStyle({ ...DEFAULT_LAYER_STYLE, ...style }), format: 'sld', notes }
}
