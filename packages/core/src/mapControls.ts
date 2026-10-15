// Spec 014: the map's buttons as data (the same idea as the basemap catalog:
// the UI renders from this table, and adding a control is adding a row), and
// the user's choices about them: which are shown, and in which corner each
// group sits. Pure and platform-free; the choice is remembered through
// HostAdapter.saveState('mapControls').

export type MapControlId = 'zoom' | 'zoomToLayer' | 'resetView' | 'globe' | 'exportImage' | 'scale' | 'coordinates' | 'tooltip'

/** A set of buttons that sit together and move together. */
export type ControlGroupId = 'navigation' | 'tools' | 'display'

/**
 * Corners a group of buttons can sit in. Bottom-left is not offered: the legend and the scale bar live
 * there. Top-left sits under the search box.
 */
export type ControlCorner = 'top-right' | 'bottom-right' | 'top-left'

export interface MapControlDef {
  id: MapControlId
  group: ControlGroupId
  label: string
  /** One line for the panel. */
  description: string
  defaultOn: boolean
}

export interface ControlGroupDef {
  id: ControlGroupId
  label: string
  /** The corner the group sits in until the user moves it; `null`: not movable (it is drawn where MapLibre puts it). */
  defaultCorner: ControlCorner | null
}

export const CONTROL_CORNERS: ReadonlyArray<{ id: ControlCorner; label: string }> = [
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'top-left', label: 'Top left' },
]

export const CONTROL_GROUPS: readonly ControlGroupDef[] = [
  { id: 'navigation', label: 'Navigation', defaultCorner: 'top-right' },
  { id: 'tools', label: 'Tools', defaultCorner: 'top-right' },
  { id: 'display', label: 'Display', defaultCorner: null },
]

export const MAP_CONTROLS: readonly MapControlDef[] = [
  { id: 'zoom', group: 'navigation', label: 'Zoom in and out', description: 'The + and − buttons.', defaultOn: true },
  { id: 'zoomToLayer', group: 'navigation', label: 'Zoom to layer', description: 'Fits the map to the data.', defaultOn: true },
  { id: 'resetView', group: 'navigation', label: 'Reset view', description: 'Appears when the map is tilted or rotated; brings it back flat and north-up.', defaultOn: true },
  { id: 'globe', group: 'navigation', label: 'Globe view', description: 'Switches between the flat map and the globe.', defaultOn: true },
  { id: 'exportImage', group: 'tools', label: 'Export map image', description: 'Saves the map as a PNG.', defaultOn: true },
  { id: 'scale', group: 'display', label: 'Scale bar', description: 'Shows distances at the bottom left.', defaultOn: true },
  { id: 'tooltip', group: 'display', label: 'Hover tooltip', description: 'Shows a few columns of the feature under the cursor.', defaultOn: false },
  { id: 'coordinates', group: 'display', label: 'Coordinates', description: 'Shows the cursor position at the bottom; click it to copy.', defaultOn: false },
]

export interface MapControlsPrefs {
  /** Only the controls the user changed; everything else follows `defaultOn`. */
  visible: Partial<Record<MapControlId, boolean>>
  corners: Record<ControlGroupId, ControlCorner | null>
}

export const DEFAULT_MAP_CONTROLS: MapControlsPrefs = {
  visible: {},
  corners: Object.fromEntries(CONTROL_GROUPS.map((g) => [g.id, g.defaultCorner])) as MapControlsPrefs['corners'],
}

const CONTROL_IDS = new Set<string>(MAP_CONTROLS.map((c) => c.id))
const CORNER_IDS = new Set<string>(CONTROL_CORNERS.map((c) => c.id))

/** A saved preference, checked field by field (anything odd falls back to the default). */
export function readMapControls(saved: unknown): MapControlsPrefs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as { visible?: unknown; corners?: unknown }
  const visible: MapControlsPrefs['visible'] = {}
  if (s.visible && typeof s.visible === 'object') {
    for (const [id, v] of Object.entries(s.visible)) if (CONTROL_IDS.has(id) && typeof v === 'boolean') visible[id as MapControlId] = v
  }
  const corners = { ...DEFAULT_MAP_CONTROLS.corners }
  if (s.corners && typeof s.corners === 'object') {
    const saved = s.corners as Record<string, unknown>
    for (const g of CONTROL_GROUPS) {
      const c = saved[g.id]
      if (g.defaultCorner !== null && typeof c === 'string' && CORNER_IDS.has(c)) corners[g.id] = c as ControlCorner
    }
  }
  return { visible, corners }
}

export function isControlOn(prefs: MapControlsPrefs, id: MapControlId): boolean {
  const set = prefs.visible[id]
  if (set !== undefined) return set
  return MAP_CONTROLS.find((c) => c.id === id)?.defaultOn ?? false
}

/** The shown controls of a group, in registry order. */
export function shownControls(prefs: MapControlsPrefs, group: ControlGroupId, available: (id: MapControlId) => boolean = () => true): MapControlId[] {
  return MAP_CONTROLS.filter((c) => c.group === group && isControlOn(prefs, c.id) && available(c.id)).map((c) => c.id)
}

/** The groups sitting in a corner, in registry order (the stack there reads top to bottom). */
export function groupsInCorner(prefs: MapControlsPrefs, corner: ControlCorner): ControlGroupId[] {
  return CONTROL_GROUPS.filter((g) => prefs.corners[g.id] === corner).map((g) => g.id)
}

/** A change set against the saved choices: a value equal to the default is dropped, so the saved form stays small. */
export function setControlOn(prefs: MapControlsPrefs, id: MapControlId, on: boolean): MapControlsPrefs {
  const def = MAP_CONTROLS.find((c) => c.id === id)
  const visible = { ...prefs.visible }
  if (def && def.defaultOn === on) delete visible[id]
  else visible[id] = on
  return { ...prefs, visible }
}

export function setGroupCorner(prefs: MapControlsPrefs, group: ControlGroupId, corner: ControlCorner): MapControlsPrefs {
  const def = CONTROL_GROUPS.find((g) => g.id === group)
  if (!def || def.defaultCorner === null || !CORNER_IDS.has(corner)) return prefs
  return { ...prefs, corners: { ...prefs.corners, [group]: corner } }
}

export function isDefaultMapControls(prefs: MapControlsPrefs): boolean {
  return Object.keys(prefs.visible).length === 0 && CONTROL_GROUPS.every((g) => prefs.corners[g.id] === g.defaultCorner)
}
