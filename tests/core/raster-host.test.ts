// Spec 026 T009: a raster is never read whole, so a shell that cannot read in parts says so instead of falling back.
import { describe, expect, it } from 'vitest'
import { RangeNotSupportedError } from '@spatial-explorer/core'

describe('RangeNotSupportedError', () => {
  it('says why and that a raster is too large to read whole', () => {
    const e = new RangeNotSupportedError('the local file server is unreachable')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('RangeNotSupportedError')
    expect(e.reason).toBe('the local file server is unreachable')
    expect(e.message).toMatch(/cannot be read in parts here \(the local file server is unreachable\).*too large to read whole/)
  })
})
