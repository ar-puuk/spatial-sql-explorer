// Spec 017: cell-count estimates and the starting resolution (grid/binEstimate.ts).
import { describe, expect, it } from 'vitest'
import { CELL_LIMIT, PREVIEW_CELL_LIMIT, TARGET_CELLS, estimateCells, extentAreaKm2, getGridSystem, suggestResolution, type Bbox } from '@spatial-explorer/core'

const h3 = getGridSystem('h3')!
const a5 = getGridSystem('a5')!
const utah: Bbox = [-114.05, 36.99, -109.04, 42.0]
const world: Bbox = [-180, -90, 180, 90]

describe('extentAreaKm2', () => {
  it('is the sphere area of a box', () => {
    expect(extentAreaKm2(world)).toBeCloseTo(510_065_622, -4) // 4 pi R^2
    expect(extentAreaKm2(utah)).toBeGreaterThan(200_000)
    expect(extentAreaKm2(utah)).toBeLessThan(500_000)
  })
})

describe('estimateCells', () => {
  it('is the extent over the cell area, never more than the rows and never fewer than one', () => {
    const area = extentAreaKm2(utah)
    expect(estimateCells(h3, 4, utah, 10_000_000)).toBeCloseTo(area / h3.cellAreaKm2[4] + 1, -1)
    expect(estimateCells(h3, 15, utah, 500)).toBe(500)
    expect(estimateCells(h3, 0, utah, 500)).toBeGreaterThanOrEqual(1)
    expect(estimateCells(h3, 0, [0, 0, 0.0001, 0.0001], 500)).toBe(1)
  })

  it('knows only the rows without an extent, and nothing for a resolution outside the table', () => {
    expect(estimateCells(h3, 7, null, 1234)).toBe(1234)
    expect(estimateCells(h3, 99, utah, 1234)).toBe(0)
  })

  it('grows as the resolution rises, for both systems', () => {
    for (const system of [h3, a5]) {
      let last = 0
      for (let r = system.minRes; r < system.maxRes; r++) {
        const n = estimateCells(system, r, world, Number.MAX_SAFE_INTEGER)
        expect(n).toBeGreaterThanOrEqual(last)
        last = n
      }
    }
  })
})

describe('suggestResolution', () => {
  it('aims for about a couple of thousand cells over the layer', () => {
    for (const system of [h3, a5]) {
      const res = suggestResolution(system, utah, 1_000_000)
      const n = estimateCells(system, res, utah, 1_000_000)
      expect(n).toBeLessThanOrEqual(TARGET_CELLS)
      // one step finer would be over the target
      if (res < system.maxRes) expect(estimateCells(system, res + 1, utah, 1_000_000)).toBeGreaterThan(TARGET_CELLS)
    }
  })

  it('starts coarser for a small layer, so a hundred points are not a hundred cells', () => {
    const many = suggestResolution(h3, utah, 1_000_000)
    const few = suggestResolution(h3, utah, 100)
    expect(few).toBeLessThan(many)
    expect(estimateCells(h3, few, utah, 100)).toBeLessThanOrEqual(25)
  })

  it('stays inside the system range, and picks a middle size without an extent', () => {
    expect(suggestResolution(a5, world, 10)).toBeGreaterThanOrEqual(a5.minRes)
    expect(suggestResolution(h3, [0, 0, 1e-6, 1e-6], 1_000_000)).toBeLessThanOrEqual(h3.maxRes)
    const noExtent = suggestResolution(h3, null, 1000)
    expect(h3.cellAreaKm2[noExtent]).toBeGreaterThan(100)
    expect(h3.cellAreaKm2[noExtent]).toBeLessThan(10_000)
  })

  it('has limits the dialog can rely on', () => {
    expect(PREVIEW_CELL_LIMIT).toBeLessThan(CELL_LIMIT)
    expect(TARGET_CELLS).toBeLessThan(PREVIEW_CELL_LIMIT)
  })
})
