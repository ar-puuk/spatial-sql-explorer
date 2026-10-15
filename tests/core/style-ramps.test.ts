// T007 (spec 003, FR-007/FR-008, research §6): the ramp catalog and its colors.
import { describe, expect, it } from 'vitest'
import { RAMPS, defaultRamp, rampColors, rampsFor } from '@spatial-explorer/core'

const HEX = /^#[0-9a-f]{6}$/

describe('ramp catalog', () => {
  it('every entry has an id, name, kind and license', () => {
    expect(RAMPS.length).toBeGreaterThanOrEqual(15)
    for (const r of RAMPS) {
      expect(r.id).toMatch(/^[a-z0-9-]+$/)
      expect(r.name.length).toBeGreaterThan(0)
      expect(['sequential', 'diverging', 'qualitative']).toContain(r.kind)
      expect(r.license).toMatch(/CC0|Apache-2.0|BSD-3-Clause|ISC|Published palette/)
    }
    expect(new Set(RAMPS.map((r) => r.id)).size).toBe(RAMPS.length)
  })

  it('every ramp yields valid colors for 2..12 classes', () => {
    for (const r of RAMPS) {
      for (let n = 2; n <= 12; n++) {
        const colors = rampColors({ id: r.id, reversed: false }, n)
        expect(colors).toHaveLength(n)
        for (const c of colors) expect(c).toMatch(HEX)
      }
    }
  })

  it('viridis: n distinct colors from its first anchor to its last', () => {
    for (let n = 2; n <= 10; n++) {
      const colors = rampColors({ id: 'viridis', reversed: false }, n)
      expect(new Set(colors).size).toBe(n)
      expect(colors[0]).toBe('#440154')
      expect(colors[n - 1]).toBe('#fde725')
    }
  })

  it('ColorBrewer ramps use their own n-class lists', () => {
    expect(rampColors({ id: 'brewer-blues', reversed: false }, 5)).toEqual(['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'])
    expect(rampColors({ id: 'brewer-rdbu', reversed: false }, 3)).toEqual(['#ef8a62', '#f7f7f7', '#67a9cf'])
  })

  it('beyond the longest ColorBrewer list, colors interpolate from it', () => {
    const ten = rampColors({ id: 'brewer-blues', reversed: false }, 10)
    expect(new Set(ten).size).toBe(10)
    expect(ten[0]).toBe('#f7fbff')
    expect(ten[9]).toBe('#08306b')
  })

  it('reversed reverses the list', () => {
    const fwd = rampColors({ id: 'magma', reversed: false }, 6)
    expect(rampColors({ id: 'magma', reversed: true }, 6)).toEqual([...fwd].reverse())
  })

  it('qualitative palettes repeat in order beyond their length', () => {
    const set2 = rampColors({ id: 'brewer-set2', reversed: false }, 10)
    expect(set2[8]).toBe(set2[0])
    expect(set2[9]).toBe(set2[1])
    expect(new Set(rampColors({ id: 'brewer-paired', reversed: false }, 12)).size).toBe(12)
  })

  it('renderers get the right kinds and defaults', () => {
    expect(rampsFor('graduated').every((r) => r.kind !== 'qualitative')).toBe(true)
    expect(rampsFor('categorized').every((r) => r.kind === 'qualitative')).toBe(true)
    expect(defaultRamp('graduated', 5).id).toBe('viridis')
    expect(defaultRamp('categorized', 8).id).toBe('brewer-set2')
    expect(defaultRamp('categorized', 9).id).toBe('brewer-paired')
  })
})
