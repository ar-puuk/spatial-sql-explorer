// Spec 011 US6: labels as MapLibre symbol layers. Two layers, because a
// symbol layer places all its labels one way: `label` (points around the
// point, polygons centered at their label point) and `label-line` (along the
// lines, never upside down). Both skip features the legend hides, and labels
// never overlap (MapLibre's collision detection drops the ones that would).
// Where the engine gives polygons one label point each (view/labelPoint.ts),
// a third, `label-area`, draws polygons' labels from those points, centered.
import { LABEL_COLUMN } from './channels.js'
import { visibilityFilter } from './expressions.js'
import type { LabelAnchor, LabelSettings } from './labels.js'
import type { LayerStyle, ResolvedStyle } from './model.js'

export type LabelLayerId = 'label' | 'label-line' | 'label-area'

export interface LabelLayerSpec {
  filter: unknown
  layout: Record<string, unknown>
  paint: Record<string, unknown>
}

/** The text system fonts draw (research §3: no glyphs are downloaded). */
export const LABEL_FONT = ['sans-serif']

const POINTS = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
const POLYGONS = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const LINES = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false]

/** Where a point's text sits: MapLibre's anchor is the side of the text that touches the point. */
const ANCHOR: Record<LabelAnchor, string> = { above: 'bottom', below: 'top', left: 'right', right: 'left', center: 'center' }

/** The text offset of a point label, in ems (MapLibre's unit), from an offset in px. */
export function labelOffset(anchor: LabelAnchor, offsetPx: number, size: number): [number, number] {
  const o = Math.round((offsetPx / size) * 1000) / 1000
  if (anchor === 'above') return [0, -o]
  if (anchor === 'below') return [0, o]
  if (anchor === 'left') return [-o, 0]
  if (anchor === 'right') return [o, 0]
  return [0, 0]
}

/** The feature property the label text is read from: the column, or the engine-computed text. */
export function labelTextProperty(labels: LabelSettings): string {
  return labels.source.kind === 'column' ? labels.source.column : LABEL_COLUMN
}

/** The label text: the property as text; missing values are empty (no label). */
export function labelTextField(labels: LabelSettings): unknown {
  return ['coalesce', ['to-string', ['get', labelTextProperty(labels)]], '']
}

/** True when the style draws labels (on, and an expression source the engine could compute). */
export function drawsLabels(style: LayerStyle, resolved: ResolvedStyle | null): boolean {
  const l = style.labels
  return !!l?.enabled && !(l.source.kind === 'expression' && resolved?.labelError)
}

/**
 * The label layers' filter, layout and paint, or null when labels are off.
 * Features hidden through the legend (`visibilityFilter`) get no label, and
 * empty text draws nothing. With `areaPoints`, polygons are labeled by
 * `label-area`, over their label points, and `label` takes points only.
 */
export function labelLayers(style: LayerStyle, resolved: ResolvedStyle, areaPoints = false): ({ label: LabelLayerSpec; 'label-line': LabelLayerSpec; 'label-area'?: LabelLayerSpec }) | null {
  const l = style.labels
  if (!l || !drawsLabels(style, resolved)) return null
  const hidden = visibilityFilter(style, resolved)
  const text = labelTextField(l)
  const hasText = ['!=', text, '']
  const filterOf = (geometry: unknown) => ['all', geometry, hasText, ...(hidden ? [hidden] : [])]
  const shared = {
    'text-field': text,
    'text-font': LABEL_FONT,
    'text-size': l.size,
    'text-allow-overlap': false,
    'text-ignore-placement': false,
    'text-padding': 2,
  }
  const paint = {
    'text-color': l.color,
    'text-halo-color': l.halo.color,
    'text-halo-width': l.halo.enabled ? l.halo.width : 0,
    'text-halo-blur': 0,
  }
  const anchor = l.placement.kind === 'point' ? l.placement.anchor : 'above'
  const offset = l.placement.kind === 'point' ? l.placement.offset : 0
  if (areaPoints)
    return {
      label: { filter: filterOf(POINTS), layout: { ...shared, 'text-anchor': ANCHOR[anchor], 'text-offset': ['literal', labelOffset(anchor, offset, l.size)], 'symbol-placement': 'point' }, paint },
      'label-area': { filter: filterOf(true), layout: { ...shared, 'text-anchor': 'center', 'symbol-placement': 'point' }, paint },
      'label-line': lineLabel(shared, paint, filterOf(LINES)),
    }
  return {
    label: {
      filter: filterOf(['any', POINTS, POLYGONS]),
      layout: {
        ...shared,
        // Points around the point; polygons centered at their label point (MapLibre's pole of inaccessibility).
        'text-anchor': ['case', POLYGONS, 'center', ANCHOR[anchor]],
        'text-offset': ['case', POLYGONS, ['literal', [0, 0]], ['literal', labelOffset(anchor, offset, l.size)]],
        'symbol-placement': 'point',
      },
      paint,
    },
    'label-line': lineLabel(shared, paint, filterOf(LINES)),
  }
}

function lineLabel(shared: Record<string, unknown>, paint: Record<string, unknown>, filter: unknown): LabelLayerSpec {
  return {
    filter,
    // Just above the line (QGIS's default, "Above line"): on it, the line shows through each word gap, where no glyph has a halo.
    layout: { ...shared, 'symbol-placement': 'line', 'text-keep-upright': true, 'text-rotation-alignment': 'map', 'text-max-angle': 45, 'text-anchor': 'bottom', 'text-offset': ['literal', [0, -0.2]] },
    paint,
  }
}
