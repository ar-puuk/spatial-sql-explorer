// T005 (spec 007, research §4, FR-003/FR-004/FR-015): how the engine reaches each format.
import { afterEach, describe, expect, it } from 'vitest'
import { READ_MODES, formatFromFileName, readModeFor, setTestOverrides, testOverrides, WHOLE_READ_THRESHOLD_BYTES } from '@spatial-explorer/core'

const MB = 1024 * 1024

afterEach(() => setTestOverrides({}))

describe('read-mode catalog', () => {
  it('has exactly one row per format', () => {
    const ids = READ_MODES.map((r) => r.format)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(['csv', 'flatgeobuf', 'geojson', 'geopackage', 'geoparquet', 'gml', 'pmtiles', 'shapefile', 'sqlite', 'xlsx'])
  })

  it('maps each format to its measured mode', () => {
    const mode = (f: string) => READ_MODES.find((r) => r.format === f)?.mode
    expect(mode('geoparquet')).toBe('partial')
    for (const f of ['flatgeobuf', 'geojson', 'shapefile', 'csv', 'xlsx', 'gml', 'geopackage']) expect(mode(f)).toBe('whole')
    expect(mode('pmtiles')).toBe('tiles')
  })

  it('announces whole reads above 100 MB', () => {
    expect(WHOLE_READ_THRESHOLD_BYTES).toBe(100 * MB)
    expect(readModeFor('geojson', 1 * MB, { partialReads: true }).wholeReadThresholdBytes).toBe(100 * MB)
  })

  it('reads FlatGeobuf whole at any size (spec 010: engine tiles draw big files)', () => {
    expect(readModeFor('flatgeobuf', 50 * MB, { partialReads: true }).mode).toBe('whole')
    expect(readModeFor('flatgeobuf', 500 * MB, { partialReads: true }).mode).toBe('whole')
  })
})

describe('platform override (FR-015)', () => {
  it('reads every engine format whole when partial reads are unavailable', () => {
    for (const f of ['geoparquet', 'flatgeobuf', 'geojson', 'csv'] as const) {
      expect(readModeFor(f, 2000 * MB, { partialReads: false }).mode).toBe('whole')
    }
  })

  it('leaves PMTiles to the map', () => {
    expect(readModeFor('pmtiles', 2000 * MB, { partialReads: false }).mode).toBe('tiles')
  })
})

describe('format detection', () => {
  it('detects formats from the file name', () => {
    expect(formatFromFileName('a.parquet')).toBe('geoparquet')
    expect(formatFromFileName('a.GeoParquet')).toBe('geoparquet')
    expect(formatFromFileName('a.fgb')).toBe('flatgeobuf')
    expect(formatFromFileName('a.flatgeobuf')).toBe('flatgeobuf')
    expect(formatFromFileName('a.geojson')).toBe('geojson')
    expect(formatFromFileName('a.json')).toBe('geojson')
    expect(formatFromFileName('a.shp')).toBe('shapefile')
    expect(formatFromFileName('a.gpkg')).toBe('geopackage')
    expect(formatFromFileName('a.gml')).toBe('gml')
    expect(formatFromFileName('a.csv')).toBe('csv')
    expect(formatFromFileName('a.pmtiles')).toBe('pmtiles')
    expect(formatFromFileName('a.txt')).toBeNull()
  })
})

describe('test overrides', () => {
  it('apply only when set', () => {
    expect(testOverrides()).toEqual({})
    setTestOverrides({ wholeThreshold: 1 })
    expect(readModeFor('geojson', MB, { partialReads: true }).wholeReadThresholdBytes).toBe(1)
    expect(readModeFor('flatgeobuf', 2 * MB, { partialReads: true }).mode).toBe('whole')
  })

  it('parse from a query string, numbers only, and only with e2e=1', async () => {
    const { parseTestOverrides } = await import('@spatial-explorer/core')
    expect(parseTestOverrides('?tileRows=1000')).toEqual({})
    // Spec 010: cap and slowViewMs went with per-pan views (ignored like any unknown key).
    expect(parseTestOverrides('?e2e=1&tileRows=1000&slowTileMs=200&cap=1000&materializeCap=5000&jenksSample=2000&memoryLimit=64MB&slowViewMs=500&slowParse=1&bogus=3')).toEqual({
      tileRows: 1000,
      slowTileMs: 200,
      materializeCap: 5000,
      jenksSample: 2000,
      memoryLimit: '64MB',
      slowParse: true,
    })
  })
})
