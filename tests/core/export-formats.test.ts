// T004 (spec 005, FR-003/FR-004, research §2) and T047 (spec 008 FR-019–FR-021,
// research §3): only verified formats exist, grouped by whether they hold geometry.
import { describe, expect, it } from 'vitest'
import { EXPORT_FORMATS, exportFormat } from '@spatial-explorer/core'

describe('export formats', () => {
  it('are exactly the formats verified end to end (engine or JS writer, then QGIS or a reader)', () => {
    expect(EXPORT_FORMATS.map((f) => f.id).sort()).toEqual(['csv', 'flatgeobuf', 'geojson', 'geojsonseq', 'geopackage', 'geoparquet', 'json', 'kml', 'parquet', 'shapefile', 'xlsx'])
  })

  it('each has a label, an extension, a group, a CRS rule and a writer', () => {
    for (const f of EXPORT_FORMATS) {
      expect(f.label.length).toBeGreaterThan(0)
      expect(f.extension).toMatch(/^(\.[a-z]+)+$/)
      expect(['spatial', 'attributes', 'both']).toContain(f.group)
      expect(['wgs84-only', 'any']).toContain(f.crs)
      expect(['engine', 'js']).toContain(f.writer)
    }
  })

  it('GeoJSON, GeoJSONSeq and KML are WGS84 only; the engine writes only Parquet, CSV and JSON', () => {
    for (const id of ['geojson', 'geojsonseq', 'kml'] as const) expect(exportFormat(id).crs).toBe('wgs84-only')
    expect(EXPORT_FORMATS.filter((f) => f.writer === 'engine').map((f) => f.id).sort()).toEqual(['csv', 'geojsonseq', 'geoparquet', 'json', 'parquet'])
    expect(exportFormat('parquet').group).toBe('attributes')
    expect(exportFormat('csv').group).toBe('both')
    expect(exportFormat('shapefile').extension).toBe('.shp.zip')
  })
})
