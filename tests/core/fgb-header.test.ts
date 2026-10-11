// T020 (spec 007 FR-001): FlatGeobuf facts from the header bytes, no scan.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { FGB_PREFIX_BYTES, fgbHeaderSize, parseFgbHeader } from '@spatial-explorer/core'

const file = readFileSync(`${import.meta.dirname}/../vscode-ext/fixtures/parcels-10k.fgb`)

describe('FlatGeobuf header', () => {
  it('reads the feature count, envelope and index from the first bytes only', () => {
    const size = fgbHeaderSize(file.subarray(0, FGB_PREFIX_BYTES))
    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThan(4096)
    const h = parseFgbHeader(file.subarray(0, FGB_PREFIX_BYTES + size))
    expect(h.featuresCount).toBe(10000)
    expect(h.indexNodeSize).toBeGreaterThan(0)
    const [x0, y0, x1, y1] = h.envelope!
    // The generator's parcels: Utah, -114..-109 by 37..42.
    expect(x0).toBeGreaterThan(-114.1)
    expect(x1).toBeLessThan(-108.9)
    expect(y0).toBeGreaterThan(36.9)
    expect(y1).toBeLessThan(42.1)
    expect(x0).toBeLessThan(x1)
  })

  it('refuses other files', () => {
    expect(() => fgbHeaderSize(new Uint8Array(12))).toThrow(/not a FlatGeobuf/i)
  })
})
