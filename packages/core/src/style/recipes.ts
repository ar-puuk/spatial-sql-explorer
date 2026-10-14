// Spec 011 US3 (research §11): one-click starting points. A recipe sets the
// properties a common map is about and leaves the rest alone; it isn't
// stored (the style only holds properties). "Draw as" chooses how points and
// polygons are drawn (markers or a heatmap; fills or 3D).
import { drawOf, type DrawAs } from './channels.js'
import { setSizeChannel, setSizeMode, startStyle } from './edit.js'
import { toChannelShape } from './legacy.js'
import { HEATMAP_INTENSITY, HEATMAP_RADIUS, DEFAULT_HEATMAP_RAMP, type LayerStyle, type StyleGeometry } from './model.js'
import { eligibleColumns, isNumericType, measureColumns, type ResolveInput } from './resolve.js'

export type RecipeId = 'categorized' | 'graduated' | 'proportional' | 'bivariate' | 'rules' | 'heatmap' | 'flow'

export const RECIPES: ReadonlyArray<{ id: RecipeId; label: string; hint: string }> = Object.freeze([
  { id: 'categorized', label: 'Categorized', hint: 'A color for each value of a column' },
  { id: 'graduated', label: 'Graduated', hint: 'Colors by ranges of a number' },
  { id: 'proportional', label: 'Proportional symbols', hint: 'Sizes that follow a number smoothly' },
  { id: 'bivariate', label: 'Bivariate', hint: 'Two numeric columns at once, on a 3×3 color grid' },
  { id: 'rules', label: 'Rules', hint: 'SQL conditions: the first one a feature meets colors it' },
  { id: 'heatmap', label: 'Heatmap', hint: 'Where points cluster, as a smooth density surface' },
  { id: 'flow', label: 'Flow / network', hint: 'Lines colored by a category and widened by a number' },
])

const hasPoints = (g: StyleGeometry | null | undefined) => g === 'Point' || g === 'Mixed'
const hasLines = (g: StyleGeometry | null | undefined) => g === 'LineString' || g === 'Mixed'
const textColumns = (layer: ResolveInput | null) => eligibleColumns(layer?.columns, 'categorized').filter((c) => !isNumericType(c.type))

/** Why a recipe can't be applied to this layer (one line), or null. */
export function recipeUnavailable(id: RecipeId, geometry: StyleGeometry | null | undefined, layer: ResolveInput | null): string | null {
  const columns = layer?.columns ?? []
  const numeric = measureColumns(columns)
  switch (id) {
    case 'categorized':
      return eligibleColumns(columns, 'categorized').length ? null : 'This result has no attribute columns.'
    case 'graduated':
      return numeric.length ? null : 'Graduated colors need a numeric column.'
    case 'proportional':
      if (geometry === 'Polygon') return 'Polygons have no size: proportional symbols are for points and lines.'
      return numeric.length ? null : 'Proportional symbols need a numeric column.'
    case 'bivariate':
      return numeric.length >= 2 ? null : 'Bivariate maps need two numeric columns.'
    case 'rules':
      return columns.length ? null : 'This result has no attribute columns.'
    case 'heatmap':
      return hasPoints(geometry) ? null : 'Heatmaps need points; this layer has none.'
    case 'flow':
      if (!hasLines(geometry)) return 'Flow maps are for lines.'
      if (!textColumns(layer).length) return 'Flow maps need a text column for the color.'
      return numeric.length ? null : 'Flow maps need a numeric column for the width.'
  }
}

/**
 * The style with `id` applied: only the properties the recipe is about change
 * (research §11). A heatmap recipe draws the points as a heatmap, keeping the
 * markers' properties for when they're drawn again.
 */
export function applyRecipe(style: LayerStyle, id: RecipeId, geometry: StyleGeometry | null | undefined, layer: ResolveInput | null): LayerStyle {
  const s = toChannelShape(style)
  switch (id) {
    case 'graduated':
      // The first measure: identifier-like columns go last (spec 009 SC-001).
      return toChannelShape(startStyle(markersAgain(s), id, layer, measureColumns(layer?.columns)[0]?.name))
    case 'categorized':
    case 'bivariate':
    case 'rules':
      return toChannelShape(startStyle(markersAgain(s), id, layer))
    case 'heatmap':
      return setDraw(s, { points: 'heatmap' })
    case 'proportional': {
      const column = measureColumns(layer?.columns)[0]?.name
      if (!column) return s
      const sized = setSizeChannel(markersAgain(s), column, geometry === 'LineString' ? 'line' : 'point')
      return toChannelShape(setSizeMode(sized, 'proportional'))
    }
    case 'flow': {
      const text = textColumns(layer)[0]?.name
      const number = measureColumns(layer?.columns)[0]?.name
      if (!text || !number) return s
      const colored = startStyle(markersAgain(s), 'categorized', layer, text)
      return toChannelShape(setSizeChannel(toChannelShape(colored), number, 'line'))
    }
  }
}

/** Points drawn as markers again (a color or size recipe on a heatmap brings the markers back). */
function markersAgain(style: LayerStyle): LayerStyle {
  return drawOf(style).points === 'heatmap' ? setDraw(style, { points: 'markers' }) : style
}

/**
 * How points and polygons are drawn. Switching to a heatmap keeps the
 * markers' properties (set aside: drawn again when markers come back) and
 * starts the heatmap's settings the first time; 3D draws the height.
 */
export function setDraw(style: LayerStyle, patch: Partial<DrawAs>): LayerStyle {
  const s = toChannelShape(style)
  const draw: DrawAs = { ...drawOf(s), ...patch }
  const out: LayerStyle = { ...s, draw: { ...(draw.points === 'heatmap' ? { points: 'heatmap' as const } : {}), ...(draw.polygons === '3d' ? { polygons: '3d' as const } : {}) } }
  if (draw.points === 'heatmap' && !out.heatmap) out.heatmap = { weight: '', radius: HEATMAP_RADIUS.default, intensity: HEATMAP_INTENSITY.default, ramp: { id: DEFAULT_HEATMAP_RAMP, reversed: false } }
  if (out.draw && !Object.keys(out.draw).length) out.draw = undefined
  return out
}
