// Spec 014: the map's controls as data, and the saved choices about them.
import { describe, expect, it } from 'vitest'
import {
  CONTROL_POSITIONS,
  CONTROL_GROUPS,
  controlAvailable,
  controlsAt,
  positionOf,
  positionsFor,
  DEFAULT_MAP_CONTROLS,
  isControlOn,
  isAllowedPosition,
  isDefaultMapControls,
  MAP_CONTROLS,
  readMapControls,
  setControlPosition,
  setControlOn,
} from '@spatial-explorer/core'

describe('registry', () => {
  it('has unique control ids, each in a known group', () => {
    const ids = MAP_CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of MAP_CONTROLS) expect(CONTROL_GROUPS.some((g) => g.id === c.group)).toBe(true)
  })
  it('knows six positions: the four corners and the middle of the top and bottom edges', () => {
    expect(CONTROL_POSITIONS.map((c) => c.id)).toEqual(['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'])
  })
  it('each control offers the positions that suit it: buttons the corners, the readout the edges', () => {
    expect(positionsFor('zoom')).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    expect(positionsFor('coordinates')).toEqual(['top-center', 'bottom-center'])
    expect(positionsFor('tooltip')).toEqual([])
    for (const c of MAP_CONTROLS) {
      if (c.defaultPosition === null) expect(c.positions).toEqual([])
      else expect(c.positions).toContain(c.defaultPosition)
    }
  })
  it('the defaults are what the map showed before positions were configurable, and the logo is on', () => {
    expect(positionOf(DEFAULT_MAP_CONTROLS, 'search')).toBe('top-left')
    expect(positionOf(DEFAULT_MAP_CONTROLS, 'zoom')).toBe('top-right')
    expect(positionOf(DEFAULT_MAP_CONTROLS, 'legend')).toBe('bottom-left')
    expect(positionOf(DEFAULT_MAP_CONTROLS, 'scale')).toBe('bottom-left')
    expect(isControlOn(DEFAULT_MAP_CONTROLS, 'logo')).toBe(true)
    expect(isControlOn(DEFAULT_MAP_CONTROLS, 'coordinates')).toBe(false)
    expect(positionOf(DEFAULT_MAP_CONTROLS, 'coordinates')).toBe('bottom-center')
    expect(isControlOn(DEFAULT_MAP_CONTROLS, 'tooltip')).toBe(false)
  })
  it('the hover tooltip has no place on the map', () => {
    expect(positionOf(DEFAULT_MAP_CONTROLS, 'tooltip')).toBeNull()
    expect(setControlPosition(DEFAULT_MAP_CONTROLS, 'tooltip', 'top-left')).toBe(DEFAULT_MAP_CONTROLS)
  })
  it('a control cannot be moved to a position it does not offer', () => {
    expect(isAllowedPosition('coordinates', 'top-left')).toBe(false)
    expect(setControlPosition(DEFAULT_MAP_CONTROLS, 'coordinates', 'top-left')).toBe(DEFAULT_MAP_CONTROLS)
    expect(setControlPosition(DEFAULT_MAP_CONTROLS, 'zoom', 'top-center')).toBe(DEFAULT_MAP_CONTROLS)
    expect(positionOf(setControlPosition(DEFAULT_MAP_CONTROLS, 'coordinates', 'top-center'), 'coordinates')).toBe('top-center')
  })
})

describe('stacks', () => {
  it('a corner stacks its controls in registry order', () => {
    expect(controlsAt(DEFAULT_MAP_CONTROLS, 'top-right')).toEqual(['zoom', 'zoomToLayer', 'resetView', 'globe', 'terrain', 'draw', 'measure', 'select', 'binCells', 'dotDensity', 'timeSlider', 'exportImage'])
    expect(controlsAt(DEFAULT_MAP_CONTROLS, 'bottom-left')).toEqual(['legend', 'logo', 'scale'])
    expect(controlsAt(DEFAULT_MAP_CONTROLS, 'top-left')).toEqual(['search'])
    expect(controlsAt(DEFAULT_MAP_CONTROLS, 'bottom-right')).toEqual([])
    expect(controlsAt(DEFAULT_MAP_CONTROLS, 'bottom-center')).toEqual([])
  })
  it('a control that is off, or that the host cannot offer, is not in its corner', () => {
    const off = setControlOn(DEFAULT_MAP_CONTROLS, 'globe', false)
    expect(controlsAt(off, 'top-right')).not.toContain('globe')
    expect(controlsAt(DEFAULT_MAP_CONTROLS, 'top-right', (id) => id !== 'draw')).not.toContain('draw')
  })
  it('moving one control leaves the others where they were', () => {
    const moved = setControlPosition(DEFAULT_MAP_CONTROLS, 'globe', 'bottom-right')
    expect(controlsAt(moved, 'bottom-right')).toEqual(['globe'])
    expect(controlsAt(moved, 'top-right')).not.toContain('globe')
    expect(controlsAt(moved, 'top-right')).toContain('zoom')
    const both = setControlOn(setControlPosition(moved, 'coordinates', 'top-center'), 'coordinates', true)
    expect(controlsAt(both, 'top-center')).toEqual(['coordinates'])
    expect(controlsAt(both, 'bottom-right')).toEqual(['globe'])
  })
})

describe('choices', () => {
  it('a value equal to the default is not kept', () => {
    const back = setControlOn(setControlOn(DEFAULT_MAP_CONTROLS, 'globe', false), 'globe', true)
    expect(back.visible).toEqual({})
    const home = setControlPosition(setControlPosition(DEFAULT_MAP_CONTROLS, 'search', 'bottom-left'), 'search', 'top-left')
    expect(home.positions).toEqual({})
    expect(isDefaultMapControls(home)).toBe(true)
    expect(isDefaultMapControls(setControlPosition(DEFAULT_MAP_CONTROLS, 'search', 'bottom-left'))).toBe(false)
  })
})

describe('readMapControls', () => {
  it('anything odd falls back to the defaults', () => {
    for (const bad of [undefined, null, 7, 'x', [], { visible: 3, corners: 'x' }]) expect(readMapControls(bad)).toEqual(DEFAULT_MAP_CONTROLS)
  })
  it('a saved position the control does not offer is dropped; the older `corners` key still reads', () => {
    expect(readMapControls({ positions: { coordinates: 'top-left', zoom: 'top-center', legend: 'top-right' } }).positions).toEqual({ legend: 'top-right' })
    expect(readMapControls({ corners: { globe: 'bottom-right' } }).positions).toEqual({ globe: 'bottom-right' })
  })
  it('keeps valid entries and drops unknown ones', () => {
    const p = readMapControls({ visible: { globe: false, nope: true, scale: 'yes' }, positions: { search: 'bottom-right', legend: 'middle', nope: 'top-left', tooltip: 'top-left' } })
    expect(p.visible).toEqual({ globe: false })
    expect(p.positions).toEqual({ search: 'bottom-right' })
  })
  it("the first version's group corners carry over to each control in the group", () => {
    const p = readMapControls({ visible: {}, corners: { navigation: 'bottom-right', tools: 'top-right', display: 'top-left' } })
    expect(positionOf(p, 'zoom')).toBe('bottom-right')
    expect(positionOf(p, 'terrain')).toBe('bottom-right')
    // The tools group stayed where it was by default: nothing to keep. The display group was never movable.
    expect(p.positions.draw).toBeUndefined()
    expect(positionOf(p, 'scale')).toBe('bottom-left')
    expect(positionOf(p, 'search')).toBe('top-left')
  })
})

describe('rasters (spec 026): the controls that need rows are not offered', () => {
  const NEEDS_ROWS = ['search', 'draw', 'measure', 'select', 'binCells', 'dotDensity', 'timeSlider', 'tooltip']
  it('a vector layer is offered every control', () => {
    for (const c of MAP_CONTROLS) expect(controlAvailable(c.id, 'vector'), c.id).toBe(true)
  })
  it('a raster is not offered search, the drawing and selecting tools, the grid and dot tools, the time slider or the tooltip', () => {
    for (const id of NEEDS_ROWS) expect(controlAvailable(id as never, 'raster'), id).toBe(false)
  })
  it('a raster keeps zoom, zoom to layer, reset view, globe, terrain, print, legend, coordinates, logo and the scale bar', () => {
    const kept = MAP_CONTROLS.filter((c) => controlAvailable(c.id, 'raster')).map((c) => c.id)
    expect(kept).toEqual(['zoom', 'zoomToLayer', 'resetView', 'globe', 'terrain', 'exportImage', 'legend', 'coordinates', 'logo', 'scale'])
  })
  it('the stacks at a position leave them out, so nothing is left behind (saved choices are not touched)', () => {
    const all = controlsAt(DEFAULT_MAP_CONTROLS, 'top-right')
    expect(all).toContain('draw')
    const raster = controlsAt(DEFAULT_MAP_CONTROLS, 'top-right', (id) => controlAvailable(id, 'raster'))
    expect(raster).not.toContain('draw')
    expect(raster).toContain('zoom')
    // The saved preferences still say draw is on: it comes back with the next vector layer.
    expect(isControlOn(DEFAULT_MAP_CONTROLS, 'draw')).toBe(true)
  })
})
