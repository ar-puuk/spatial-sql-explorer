// Spec 017: the remembered choices of the Bin into cells dialog (grid/binPreference.ts).
import { describe, expect, it } from 'vitest'
import { BIN_PREFERENCE_KEY, DEFAULT_BIN_PREFERENCE, normalizeBinPreference } from '@spatial-explorer/core'

describe('normalizeBinPreference (spec 017)', () => {
  it('reads what was saved', () => {
    expect(normalizeBinPreference({ system: 'a5', measureKind: 'avg' })).toEqual({ system: 'a5', measureKind: 'avg' })
    expect(normalizeBinPreference({ system: 'h3', measureKind: 'median' })).toEqual({ system: 'h3', measureKind: 'median' })
  })

  it('falls back to H3 and a count for anything else', () => {
    for (const bad of [undefined, null, 5, 'a5', [], { system: 'x', measureKind: 'y' }, { system: 7, measureKind: {} }]) {
      expect(normalizeBinPreference(bad)).toEqual(DEFAULT_BIN_PREFERENCE)
    }
  })

  it('keeps the part that is valid when the other is not', () => {
    expect(normalizeBinPreference({ system: 'a5', measureKind: 'weird' })).toEqual({ system: 'a5', measureKind: 'count' })
    expect(normalizeBinPreference({ system: 'nope', measureKind: 'sum' })).toEqual({ system: 'h3', measureKind: 'sum' })
  })

  it('never returns the shared default object itself', () => {
    expect(normalizeBinPreference(undefined)).not.toBe(DEFAULT_BIN_PREFERENCE)
    expect(BIN_PREFERENCE_KEY).toBe('binCells')
  })
})
