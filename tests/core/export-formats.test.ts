// T004 (spec 005, FR-003/FR-004, research §2): only verified formats exist.
import { describe, expect, it } from 'vitest'
import { EXPORT_FORMATS, exportFormat } from '@spatial-explorer/core'

describe('export formats', () => {
  it('are exactly the formats verified in the real engine and QGIS', () => {
    expect(EXPORT_FORMATS.map((f) => f.id).sort()).toEqual(['csv', 'geojson', 'geoparquet', 'parquet'])
    const ids = EXPORT_FORMATS.map((f) => f.id as string)
    for (const gdalOnly of ['flatgeobuf', 'gpkg', 'geopackage', 'shapefile', 'shp', 'kml']) expect(ids).not.toContain(gdalOnly)
  })

  it('each has a label, an extension, a geometry rule and a CRS rule', () => {
    for (const f of EXPORT_FORMATS) {
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.extension).toMatch(/^\.[a-z]+$/)
      expect(['required', 'optional', 'none']).toContain(f.geometry)
      expect(['wgs84-only', 'any']).toContain(f.crs)
    }
  })

  it('GeoJSON is WGS84 only and streamed; Parquet is for table results', () => {
    expect(exportFormat('geojson')).toMatchObject({ crs: 'wgs84-only', streams: true, geometry: 'required' })
    expect(exportFormat('parquet')).toMatchObject({ geometry: 'none' })
    expect(exportFormat('geoparquet')).toMatchObject({ geometry: 'required', crs: 'any' })
    expect(exportFormat('csv')).toMatchObject({ geometry: 'optional' })
  })
})
