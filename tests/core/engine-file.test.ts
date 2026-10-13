// Spec 010 (research.md S7/S9): the engine's extension writers prepend one
// garbage byte; cleanEngineFile drops it only where the format's signature
// starts at byte 1, and refuses a file that isn't the format at all.
import { describe, expect, it } from 'vitest'
import { cleanEngineFile } from '@spatial-explorer/core'

const bytes = (...parts: Array<number[] | string>): Uint8Array =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

describe('cleanEngineFile', () => {
  const cases: Array<[string, Uint8Array]> = [
    ['fgb', bytes('fgb', [0x03], 'fgb', [0x01])],
    ['xlsx', bytes('PK', [0x03, 0x04, 0x14])],
  ]

  it('keeps a file that starts with its signature (the bug fixed upstream)', () => {
    for (const [kind, b] of cases) expect(cleanEngineFile(b, kind), kind).toEqual(b)
  })

  it('drops one stray byte in front of the signature, whatever its value', () => {
    for (const [kind, b] of cases) {
      for (const stray of [0x00, 0xe8, 0x30, 0x08, 0x03, 0x66, 0x50]) expect(cleanEngineFile(Uint8Array.from([stray, ...b]), kind), `${kind} ${stray}`).toEqual(b)
    }
  })

  it('refuses a file that is not the format', () => {
    expect(() => cleanEngineFile(bytes('hello world'), 'fgb', 'FlatGeobuf')).toThrow('The engine wrote an unreadable FlatGeobuf file.')
    expect(() => cleanEngineFile(bytes([1, 2, 3, 4, 5]), 'xlsx')).toThrow(/unreadable/)
  })

  it('leaves kinds without a signature alone', () => {
    const b = bytes('anything')
    expect(cleanEngineFile(b, 'csv')).toBe(b)
  })
})
