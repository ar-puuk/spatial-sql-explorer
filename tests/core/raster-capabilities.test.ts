// Spec 026 T011: one place decides what the interface shows for the open layer.
import { describe, expect, it } from 'vitest'
import { RASTER_NO_QUERY_NOTE, capabilitiesFor, factsFromTiler, placeholderLayer, type FactsInput } from '@spatial-explorer/core'
import captured from './fixtures/raster/tiler-info.json'

const raster = placeholderLayer('dem.tif', factsFromTiler((captured as unknown as Record<string, FactsInput>).dem_32612))

describe('capabilities', () => {
  it('a raster shows no control that needs rows (FR-013)', () => {
    const c = capabilitiesFor(raster)
    expect(c.kind).toBe('raster')
    for (const k of ['query', 'table', 'search', 'selection', 'shapes', 'grid', 'time', 'exportRows', 'tooltip', 'vectorStyle'] as const) expect(c[k], k).toBe(false)
    expect(c.rasterStyle).toBe(true)
    expect(c.print).toEqual({ blocks: false, atlas: false })
  })

  it('a vector layer, or nothing open, keeps everything', () => {
    for (const layer of [null, { raster: undefined }]) {
      const c = capabilitiesFor(layer)
      expect(c.kind).toBe('vector')
      for (const k of ['query', 'table', 'search', 'selection', 'shapes', 'grid', 'time', 'exportRows', 'tooltip', 'vectorStyle'] as const) expect(c[k], k).toBe(true)
      expect(c.rasterStyle).toBe(false)
      expect(c.print).toEqual({ blocks: true, atlas: true })
    }
  })

  it('PMTiles keeps what it had: Style, Labels, SQL, table and export off, the rest as for any vector layer', () => {
    const c = capabilitiesFor({ raster: undefined }, { tilesOnly: true })
    expect(c).toMatchObject({ kind: 'vector', query: false, table: false, exportRows: false, vectorStyle: false, rasterStyle: false })
    expect(c).toMatchObject({ search: true, selection: true, shapes: true, grid: true, time: true, tooltip: true })
  })

  it('the raster flag wins over tiles-only', () => {
    expect(capabilitiesFor(raster, { tilesOnly: true }).kind).toBe('raster')
  })

  it('says in plain words where the SQL went', () => {
    expect(RASTER_NO_QUERY_NOTE).toMatch(/raster.*vector layer/)
  })
})
