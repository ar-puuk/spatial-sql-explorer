// Spec 010 T010: GeoJSON for small results, engine tiles for big ones (GeoLibre's thresholds).
import { afterEach, describe, expect, it } from 'vitest'
import { drawModeFor, setTestOverrides, TILE_BYTES } from '@spatial-explorer/core'

const MiB = 1024 * 1024
const base = { fileBytes: null, defaultView: false, loadAll: false }

describe('drawModeFor', () => {
  afterEach(() => setTestOverrides({}))

  it('draws results under 100,000 rows as GeoJSON, and from 100,000 as tiles', () => {
    expect(drawModeFor({ ...base, rows: 99_999 })).toBe('geojson')
    expect(drawModeFor({ ...base, rows: 100_000 })).toBe('tiles')
  })

  it('draws the default view of a file of 100 MiB or more as tiles, whatever its rows', () => {
    expect(TILE_BYTES).toBe(100 * MiB)
    expect(drawModeFor({ rows: 10, fileBytes: 100 * MiB, defaultView: true, loadAll: false })).toBe('tiles')
  })

  it('ignores the file size for a query result', () => {
    expect(drawModeFor({ rows: 10, fileBytes: 200 * MiB, defaultView: false, loadAll: false })).toBe('geojson')
  })

  it('"Load all" always draws GeoJSON', () => {
    expect(drawModeFor({ ...base, rows: 5_000_000, loadAll: true })).toBe('geojson')
  })

  it('honors the e2e tileRows override', () => {
    setTestOverrides({ tileRows: 50 })
    expect(drawModeFor({ ...base, rows: 50 })).toBe('tiles')
    expect(drawModeFor({ ...base, rows: 49 })).toBe('geojson')
  })
})
