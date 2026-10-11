export * from './model.js'
export * from './ramps.js'
export * from './classify.js'
export * from './edit.js'
export * from './resolve.js'
export * from './expressions.js'
export { styleToQml, qmlToStyle, type StyleExport } from './qml.js'
export { styleToSld, sldToStyle } from './sld.js'
export { styleToMapbox, mapboxToStyle } from './mapbox.js'

import type { LayerStyle, StyleFormat, StyleGeometry, StyleImportResult } from './model.js'
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

export function exportStyle(style: LayerStyle, format: StyleFormat, geometry: StyleGeometry, dataFileName: string): StyleExport {
  const layerName = baseName(dataFileName)
  switch (format) {
    case 'qml':
      return styleToQml(style, geometry)
    case 'sld':
      return styleToSld(style, geometry, layerName)
    case 'mapbox':
      return styleToMapbox(style, geometry, layerName, dataFileName)
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
