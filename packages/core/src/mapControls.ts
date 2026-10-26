// Spec 014: the map's controls as data (the same idea as the basemap catalog: the UI renders from this table,
// and adding a control is adding a row), and the user's choices about them: which are shown, and where each
// sits (after mapgl, where a developer gives every control a `position`; here the user does). Each control says
// which positions make sense for it: a column of buttons belongs in a corner, a cursor readout also reads well
// centered along the top or the bottom edge. Pure and platform-free; the choice is remembered through
// HostAdapter.saveState('mapControls').
//
// Controls at a position stack in registry order, top to bottom. The attribution is not a control here: it
// stays at the bottom right, where the basemaps' licences want it.

import type { LayerKind } from './raster/capabilities.js'

export type MapControlId =
  | 'search'
  | 'zoom'
  | 'zoomToLayer'
  | 'resetView'
  | 'globe'
  | 'terrain'
  | 'draw'
  | 'measure'
  | 'select'
  | 'binCells'
  | 'dotDensity'
  | 'timeSlider'
  | 'exportImage'
  | 'legend'
  | 'coordinates'
  | 'logo'
  | 'scale'
  | 'tooltip'

/** A heading in the panel, and the box buttons of the same heading share when they sit side by side. */
export type ControlGroupId = 'navigation' | 'tools' | 'output' | 'display'

export type ControlPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'

export interface MapControlDef {
  id: MapControlId
  group: ControlGroupId
  label: string
  /** One line for the panel. */
  description: string
  defaultOn: boolean
  /** The positions the user can choose from, in the order the panel lists them; empty: it has no place on the map (the hover tooltip). */
  positions: readonly ControlPosition[]
  /** Where it sits until the user moves it (one of `positions`); null when `positions` is empty. */
  defaultPosition: ControlPosition | null
}

export interface ControlGroupDef {
  id: ControlGroupId
  label: string
}

export const CONTROL_POSITIONS: ReadonlyArray<{ id: ControlPosition; label: string }> = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-center', label: 'Top center' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-center', label: 'Bottom center' },
  { id: 'bottom-right', label: 'Bottom right' },
]

export const CONTROL_GROUPS: readonly ControlGroupDef[] = [
  { id: 'navigation', label: 'Navigation' },
  { id: 'tools', label: 'Tools' },
  { id: 'output', label: 'Output' },
  { id: 'display', label: 'Display' },
]

const CORNERS: readonly ControlPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
/** Along an edge, centered: for what is wide and short. */
const EDGES: readonly ControlPosition[] = ['top-center', 'bottom-center']

const control = (
  id: MapControlId,
  group: ControlGroupId,
  label: string,
  description: string,
  defaultOn: boolean,
  positions: readonly ControlPosition[],
  defaultPosition: ControlPosition | null
): MapControlDef => ({ id, group, label, description, defaultOn, positions, defaultPosition })

export const MAP_CONTROLS: readonly MapControlDef[] = [
  control('search', 'navigation', 'Search', 'Finds values in the layer, coordinates and places.', true, CORNERS, 'top-left'),
  control('zoom', 'navigation', 'Zoom in and out', 'The + and − buttons.', true, CORNERS, 'top-right'),
  control('zoomToLayer', 'navigation', 'Zoom to layer', 'Fits the map to the data.', true, CORNERS, 'top-right'),
  control('resetView', 'navigation', 'Reset view', 'Appears when the map is tilted or rotated; brings it back flat and north-up.', true, CORNERS, 'top-right'),
  control('globe', 'navigation', 'Globe view', 'Switches between the flat map and the globe.', true, CORNERS, 'top-right'),
  control('terrain', 'navigation', 'Terrain', 'Switches 3D terrain on and off (set it up in the Basemap panel).', true, CORNERS, 'top-right'),
  control('draw', 'tools', 'Draw shapes', 'Points, lines and shapes to use in queries and filters. They are scratch geometry, never edits to the data.', true, CORNERS, 'top-right'),
  control('measure', 'tools', 'Measure', 'Distances and areas, live while you draw.', true, CORNERS, 'top-right'),
  control('select', 'tools', 'Select by shape', 'Draw a shape to select the rows inside it.', true, CORNERS, 'top-right'),
  control('binCells', 'tools', 'Bin into cells', 'Counts or averages the layer in H3 or A5 grid cells and draws them (spec 017).', true, CORNERS, 'top-right'),
  control('dotDensity', 'tools', 'Dot density', 'Draws a count as dots placed inside its polygons: one dot stands for a fixed amount (spec 022).', true, CORNERS, 'top-right'),
  control('timeSlider', 'tools', 'Time slider', 'Shows the rows within a window of a date column, and plays the window across time (spec 020).', true, CORNERS, 'top-right'),
  control('exportImage', 'output', 'Print map', 'Saves the map as a PNG, PDF or SVG, with a title, legend, scale bar and north arrow.', true, CORNERS, 'top-right'),
  control('legend', 'display', 'Legend', 'What the colors, sizes and shapes mean.', true, CORNERS, 'bottom-left'),
  // A wide, short readout: along the top or the bottom edge.
  control('coordinates', 'display', 'Coordinates', 'Shows the cursor position (and elevation). To copy a position, right-click the map.', false, EDGES, 'bottom-center'),
  control('logo', 'display', 'MapLibre logo', "MapLibre's mark, which links to maplibre.org.", true, CORNERS, 'bottom-left'),
  control('scale', 'display', 'Scale bar', 'Shows distances.', true, CORNERS, 'bottom-left'),
  control('tooltip', 'display', 'Hover tooltip', 'Shows a few columns of the feature under the cursor.', false, [], null),
]

/**
 * Spec 026 (FR-013): the controls that work on rows (a table, a query, shapes that select rows, the hover tooltip over
 * features) are not shown for a raster. Everything else (zoom, globe, terrain, print, legend, coordinates, scale, logo)
 * is.
 */
const VECTOR_ONLY: ReadonlySet<MapControlId> = new Set<MapControlId>(['search', 'draw', 'measure', 'select', 'binCells', 'dotDensity', 'timeSlider', 'tooltip'])

/** Whether a control is offered while a layer of this kind is open. */
export function controlAvailable(id: MapControlId, kind: LayerKind): boolean {
  return kind === 'vector' || !VECTOR_ONLY.has(id)
}

export interface MapControlsPrefs {
  /** Only the controls the user switched; everything else follows `defaultOn`. */
  visible: Partial<Record<MapControlId, boolean>>
  /** Only the controls the user moved; everything else sits at `defaultPosition`. */
  positions: Partial<Record<MapControlId, ControlPosition>>
}

export const DEFAULT_MAP_CONTROLS: MapControlsPrefs = { visible: {}, positions: {} }

const BY_ID = new Map<string, MapControlDef>(MAP_CONTROLS.map((c) => [c.id, c]))

/** What the first version of this preference called its movable groups (spec 014 before per-control positions). */
const LEGACY_GROUPS: Record<string, MapControlId[]> = {
  navigation: ['zoom', 'zoomToLayer', 'resetView', 'globe', 'terrain'],
  tools: ['draw', 'measure', 'select', 'exportImage'],
}

/** Is `position` one the control offers? */
export function isAllowedPosition(id: MapControlId, position: string): position is ControlPosition {
  return !!BY_ID.get(id)?.positions.includes(position as ControlPosition)
}

/**
 * A saved preference, checked field by field (anything odd falls back to the default). A position the control
 * does not offer is dropped. Older saves carry over: positions were once `corners`, and once per group.
 */
export function readMapControls(saved: unknown): MapControlsPrefs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as { visible?: unknown; positions?: unknown; corners?: unknown }
  const visible: MapControlsPrefs['visible'] = {}
  if (s.visible && typeof s.visible === 'object') {
    for (const [id, v] of Object.entries(s.visible)) if (BY_ID.has(id) && typeof v === 'boolean') visible[id as MapControlId] = v
  }
  const positions: MapControlsPrefs['positions'] = {}
  for (const source of [s.corners, s.positions]) {
    if (!source || typeof source !== 'object') continue
    for (const [key, value] of Object.entries(source)) {
      if (typeof value !== 'string') continue
      const ids = LEGACY_GROUPS[key] ?? (BY_ID.has(key) ? [key as MapControlId] : [])
      for (const id of ids) {
        const def = BY_ID.get(id)
        if (def && isAllowedPosition(id, value) && value !== def.defaultPosition) positions[id] = value
      }
    }
  }
  return { visible, positions }
}

export function isControlOn(prefs: MapControlsPrefs, id: MapControlId): boolean {
  const set = prefs.visible[id]
  if (set !== undefined) return set
  return BY_ID.get(id)?.defaultOn ?? false
}

/** Where a control sits; null for one with no place on the map. */
export function positionOf(prefs: MapControlsPrefs, id: MapControlId): ControlPosition | null {
  const def = BY_ID.get(id)
  if (!def || def.defaultPosition === null) return null
  return prefs.positions[id] ?? def.defaultPosition
}

/** The positions a control offers, in the order the panel lists them. */
export function positionsFor(id: MapControlId): readonly ControlPosition[] {
  return BY_ID.get(id)?.positions ?? []
}

/** The shown controls at a position, in registry order (the stack there reads top to bottom). */
export function controlsAt(prefs: MapControlsPrefs, position: ControlPosition, available: (id: MapControlId) => boolean = () => true): MapControlId[] {
  return MAP_CONTROLS.filter((c) => isControlOn(prefs, c.id) && positionOf(prefs, c.id) === position && available(c.id)).map((c) => c.id)
}

/** A change set against the saved choices: a value equal to the default is dropped, so the saved form stays small. */
export function setControlOn(prefs: MapControlsPrefs, id: MapControlId, on: boolean): MapControlsPrefs {
  const def = BY_ID.get(id)
  const visible = { ...prefs.visible }
  if (def && def.defaultOn === on) delete visible[id]
  else visible[id] = on
  return { ...prefs, visible }
}

/** Moves a control; a position it does not offer changes nothing. */
export function setControlPosition(prefs: MapControlsPrefs, id: MapControlId, position: ControlPosition): MapControlsPrefs {
  const def = BY_ID.get(id)
  if (!def || !isAllowedPosition(id, position)) return prefs
  const positions = { ...prefs.positions }
  if (position === def.defaultPosition) delete positions[id]
  else positions[id] = position
  return { ...prefs, positions }
}

export function isDefaultMapControls(prefs: MapControlsPrefs): boolean {
  return Object.keys(prefs.visible).length === 0 && Object.keys(prefs.positions).length === 0
}
