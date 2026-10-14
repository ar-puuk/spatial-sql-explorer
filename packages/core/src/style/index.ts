export * from './model.js'
export * from './ramps.js'
export * from './classify.js'
export * from './edit.js'
export { previewExportNotice, thematicForExport } from './interchange.js'
export * from './resolve.js'
export * from './expressions.js'
export * from './extrusion.js'
export * from './symbol.js'
export * from './bivariate.js'
export * from './sqlExpression.js'
export * from './simpleWhere.js'
export { COMPLEX_RULES_NOTE, portableRules } from './interchange.js'
export { styleToQml, qmlToStyle, type StyleExport } from './qml.js'
export { styleToSld, sldToStyle } from './sld.js'
export { styleToMapbox, mapboxToStyle } from './mapbox.js'

import { withLayerOpacity, type LayerStyle, type ResolvedStyle, type StyleFormat, type StyleGeometry, type StyleImportResult } from './model.js'
import { qmlToStyle, styleToQml, type StyleExport } from './qml.js'
import { sldToStyle, styleToSld } from './sld.js'
import { mapboxToStyle, styleToMapbox } from './mapbox.js'

export const STYLE_FORMATS: ReadonlyArray<{ format: StyleFormat; label: string; extension: string }> = [
  { format: 'qml', label: 'QGIS style (.qml)', extension: '.qml' },
  { format: 'sld', label: 'OGC SLD (.sld)', extension: '.sld' },
  { format: 'mapbox', label: 'Mapbox GL style (.json)', extension: '.style.json' },
]

/** Extensions a style file may have, for open-file dialogs and sidecar detection. */
export const STYLE_FILE_EXTENSIONS = ['.qml', '.sld', '.json'] as const

/** `world.geojson` -> `world` (also strips the last extension of `world.shp`, etc.). */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export function styleFileName(dataFileName: string, format: StyleFormat): string {
  const ext = STYLE_FORMATS.find((f) => f.format === format)?.extension ?? '.qml'
  return baseName(dataFileName) + ext
}

/** The QGIS-convention sidecar: same basename, `.qml`, next to the data file. */
export function sidecarStyleFileName(dataFileName: string): string {
  return styleFileName(dataFileName, 'qml')
}

/**
 * Writes the style in a format. Thematic styles need `resolved` (the classes
 * as drawn) and, for QGIS category types, the result's `columns`.
 */
export function exportStyle(
  style: LayerStyle,
  format: StyleFormat,
  geometry: StyleGeometry,
  dataFileName: string,
  resolved?: ResolvedStyle,
  columns?: Array<{ name: string; type: string }>
): StyleExport {
  const layerName = baseName(dataFileName)
  switch (format) {
    case 'qml': {
      const r = style.renderer
      const column = r && (r.kind === 'categorized' || r.kind === 'graduated') ? r.column : ''
      return styleToQml(style, geometry, resolved, columns?.find((c) => c.name === column)?.type)
    }
    // Neither has a layer-level opacity: it is folded into the symbol opacities.
    case 'sld':
      return styleToSld(withLayerOpacity(style), geometry, layerName, resolved)
    case 'mapbox':
      return styleToMapbox(withLayerOpacity(style), geometry, layerName, dataFileName, resolved)
  }
}

/** Detects the format by extension first, then by content, and parses it. */
export function importStyle(fileName: string, text: string): StyleImportResult {
  const lower = fileName.toLowerCase()
  const head = text.trimStart().slice(0, 512)
  if (lower.endsWith('.qml') || /<qgis[\s>]/.test(head)) return qmlToStyle(text)
  if (lower.endsWith('.sld') || /StyledLayerDescriptor/.test(head)) return sldToStyle(text)
  if (lower.endsWith('.json') || head.startsWith('{') || head.startsWith('[')) return mapboxToStyle(text)
  throw new Error(`"${fileName}" is not a recognized style file (QGIS .qml, OGC .sld, or Mapbox GL style .json).`)
}
