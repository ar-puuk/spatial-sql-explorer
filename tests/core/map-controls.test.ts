// Spec 014: the map's buttons as data, and the saved choices about them.
import { describe, expect, it } from 'vitest'
import {
  CONTROL_GROUPS,
  DEFAULT_MAP_CONTROLS,
  groupsInCorner,
  isControlOn,
  isDefaultMapControls,
  MAP_CONTROLS,
  readMapControls,
  setControlOn,
  setGroupCorner,
  shownControls,
} from '@spatial-explorer/core'

describe('registry', () => {
  it('has unique control ids, each in a known group', () => {
    const ids = MAP_CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of MAP_CONTROLS) expect(CONTROL_GROUPS.some((g) => g.id === c.group)).toBe(true)
  })
})

describe('readMapControls', () => {
  it('anything odd falls back to the defaults', () => {
    for (const bad of [undefined, null, 7, 'x', [], { visible: 3, corners: 'x' }]) expect(readMapControls(bad)).toEqual(DEFAULT_MAP_CONTROLS)
  })
  it('keeps valid entries and drops unknown ones', () => {
    const p = readMapControls({ visible: { globe: false, nope: true, scale: 'yes' }, corners: { navigation: 'bottom-right', tools: 'middle', display: 'top-left', nope: 'top-left' } })
    expect(p.visible).toEqual({ globe: false })
    expect(p.corners.navigation).toBe('bottom-right')
    expect(p.corners.tools).toBe('top-right')
    // The display group is not movable.
    expect(p.corners.display).toBeNull()
  })
})

describe('choices', () => {
  it('a control follows its default until the user changes it', () => {
    expect(isControlOn(DEFAULT_MAP_CONTROLS, 'globe')).toBe(true)
    const off = setControlOn(DEFAULT_MAP_CONTROLS, 'globe', false)
    expect(isControlOn(off, 'globe')).toBe(false)
    expect(shownControls(off, 'navigation')).not.toContain('globe')
  })
  it('setting a control back to its default drops the saved entry', () => {
    const back = setControlOn(setControlOn(DEFAULT_MAP_CONTROLS, 'globe', false), 'globe', true)
    expect(back.visible).toEqual({})
    expect(isDefaultMapControls(back)).toBe(true)
  })
  it('a control the host cannot offer is not shown', () => {
    expect(shownControls(DEFAULT_MAP_CONTROLS, 'tools', (id) => id !== 'exportImage')).toEqual([])
  })
  it('moves a group to another corner, and refuses the unmovable display group', () => {
    const moved = setGroupCorner(DEFAULT_MAP_CONTROLS, 'navigation', 'bottom-right')
    expect(groupsInCorner(moved, 'bottom-right')).toEqual(['navigation'])
    expect(groupsInCorner(moved, 'top-right')).toEqual(['tools'])
    expect(setGroupCorner(DEFAULT_MAP_CONTROLS, 'display', 'top-left')).toBe(DEFAULT_MAP_CONTROLS)
    expect(isDefaultMapControls(moved)).toBe(false)
  })
})
