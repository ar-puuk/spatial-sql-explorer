// Spec 017: the grid-system registry and its size tables (the engine's own numbers, specs/017-grid-cells/spikes/cell-sizes.json).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GRID_SYSTEMS, getGridSystem, splitDateLineSql } from '@spatial-explorer/core'

const here = path.dirname(fileURLToPath(import.meta.url))
const spike = JSON.parse(fs.readFileSync(path.join(here, '../../specs/017-grid-cells/spikes/cell-sizes.json'), 'utf8')) as Record<'h3' | 'a5', Array<{ r: number; area_km2: number; edge_km: number }>>

describe('grid systems (spec 017)', () => {
  it('offers H3 and A5, with their resolution ranges', () => {
    expect(GRID_SYSTEMS.map((s) => s.id)).toEqual(['h3', 'a5'])
    expect(getGridSystem('h3')).toMatchObject({ minRes: 0, maxRes: 15 })
    // A5 resolution 0 fails the date-line split in the engine (research §4), so it is not offered.
    expect(getGridSystem('a5')).toMatchObject({ minRes: 1, maxRes: 30 })
    expect(getGridSystem('nope')).toBeNull()
  })

  it("knows each system's argument order, hidden from users: H3 latitude first, A5 longitude first", () => {
    expect(getGridSystem('h3')!.argumentOrder).toBe('latlng')
    expect(getGridSystem('a5')!.argumentOrder).toBe('lonlat')
    expect(getGridSystem('h3')!.cellSql('ST_X(p)', 'ST_Y(p)', 7)).toBe('h3_latlng_to_cell(ST_Y(p), ST_X(p), 7)')
    expect(getGridSystem('a5')!.cellSql('ST_X(p)', 'ST_Y(p)', 7)).toBe('a5_lonlat_to_cell(ST_X(p), ST_Y(p), 7)')
  })

  it('only A5 is equal-area', () => {
    expect(GRID_SYSTEMS.filter((s) => s.equalArea).map((s) => s.id)).toEqual(['a5'])
  })

  it('has a size for every resolution, equal to the numbers measured in the engine within 0.5%', () => {
    for (const system of GRID_SYSTEMS) {
      const rows = spike[system.id]
      expect(system.cellAreaKm2).toHaveLength(system.maxRes + 1)
      expect(system.edgeKm).toHaveLength(system.maxRes + 1)
      for (const row of rows) {
        expect(Math.abs(system.cellAreaKm2[row.r] / row.area_km2 - 1)).toBeLessThan(0.005)
        expect(Math.abs(system.edgeKm[row.r] / row.edge_km - 1)).toBeLessThan(0.005)
      }
    }
  })

  it('sizes fall as the resolution rises, and A5 areas fall by exactly 4 per step from resolution 1 (0 to 1 is 5)', () => {
    for (const system of GRID_SYSTEMS) {
      for (let r = 1; r <= system.maxRes; r++) expect(system.cellAreaKm2[r]).toBeLessThan(system.cellAreaKm2[r - 1])
    }
    const a5 = getGridSystem('a5')!
    for (let r = 2; r <= 12; r++) expect(a5.cellAreaKm2[r - 1] / a5.cellAreaKm2[r]).toBeCloseTo(4, 3)
  })

  it('splits a ring across the date line on either side, and leaves other rings alone', () => {
    const sql = splitDateLineSql('ring')
    expect(sql).toContain('ST_XMax(ring) > 180')
    expect(sql).toContain('ST_XMin(ring) < -180')
    expect(sql).toContain('ST_Affine')
    expect(sql).toMatch(/ELSE ring END$/)
  })
})
