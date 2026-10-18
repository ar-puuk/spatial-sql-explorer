// Spec 017: cell-count estimates and the starting resolution (grid/binEstimate.ts).
import { describe, expect, it } from 'vitest'
import { CELL_LIMIT, MIN_USEFUL_CELLS, PREVIEW_CELL_LIMIT, TARGET_CELLS, estimateCells, extentAreaKm2, getGridSystem, resolutionChoices, suggestResolution, usableRange, type Bbox } from '@spatial-explorer/core'

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

describe('resolutionChoices', () => {
  it('has a choice for every resolution, with the size in the chosen units and the estimate', () => {
    const choices = resolutionChoices(h3, utah, 1_000_000, 'metric')
    expect(choices.map((c) => c.res)).toEqual(Array.from({ length: 16 }, (_, i) => i))
    const five = choices[5]
    expect(five.edge).toBe('9.85 km')
    expect(five.area).toBe('252.9 km²')
    expect(five.estimate).toBe(estimateCells(h3, 5, utah, 1_000_000))
    const imperial = resolutionChoices(h3, utah, 1_000_000, 'imperial')[5]
    expect(imperial.edge).toMatch(/mi$/)
    expect(imperial.area).toMatch(/mi²$/)
  })

  it('offers first the resolutions with a few cells and under the drawing limit; the rest are behind "all"', () => {
    const choices = resolutionChoices(h3, utah, 100_000_000, 'metric')
    for (const c of choices) {
      const byArea = extentAreaKm2(utah) / h3.cellAreaKm2[c.res] + 1
      expect(c.inRange).toBe(byArea >= MIN_USEFUL_CELLS && byArea <= CELL_LIMIT)
    }
    expect(choices[0].inRange).toBe(false) // one hexagon covers all of Utah
    expect(choices[15].inRange).toBe(false) // trillions of cells
    expect(choices.some((c) => c.inRange)).toBe(true)
  })

  it('flags a result over the drawing limit, and never more cells than rows', () => {
    const choices = resolutionChoices(h3, world, 10_000_000, 'metric')
    expect(choices.find((c) => c.overLimit)?.res).toBeGreaterThan(3)
    expect(choices.every((c) => c.overLimit === c.estimate > CELL_LIMIT)).toBe(true)
    for (const c of resolutionChoices(h3, world, 50, 'metric')) expect(c.estimate).toBeLessThanOrEqual(50)
  })

  it('offers every resolution when nothing is known about where the data is', () => {
    expect(resolutionChoices(a5, null, 1000, 'metric').every((c) => c.inRange)).toBe(true)
  })

  it('does not offer A5 resolution 0', () => {
    expect(resolutionChoices(a5, world, 1000, 'metric')[0].res).toBe(1)
  })
})

describe('usableRange', () => {
  it('is the first to the last resolution offered first', () => {
    const choices = resolutionChoices(h3, utah, 100_000_000, 'metric')
    const range = usableRange(choices)
    expect(choices[range.min].inRange).toBe(true)
    expect(choices[range.max].inRange).toBe(true)
    expect(range.min).toBeGreaterThan(0)
    expect(range.max).toBeLessThan(15)
  })

  it('is the whole range when none qualifies', () => {
    const tiny = resolutionChoices(h3, [0, 0, 1e-9, 1e-9], 5, 'metric')
    // a speck of a layer: only the finest resolutions have at least four cells over it, none within the limit
    const range = usableRange(tiny.map((c) => ({ ...c, inRange: false })))
    expect(range).toEqual({ min: 0, max: 15 })
  })
})
