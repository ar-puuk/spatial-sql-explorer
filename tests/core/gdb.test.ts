// Spec 013 (File Geodatabase): the catalog read from gdal3.js's `ogrinfo -json`,
// domains for display, the reader's helpers and its error messages. The
// fixtures are saved output of the real reader (specs/013-file-geodatabase/spikes).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  cacheFileName,
  codesMatching,
  convertArgs,
  describeCode,
  displayValue,
  explainGdalError,
  geometryTypeFromOgr,
  hasDomains,
  isFileGeodatabase,
  isGdbSystemTable,
  layerDomains,
  parseCatalog,
  tableFiles,
  type GdalApi,
  type OgrInfoJson,
} from '@spatial-explorer/core'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const fixture = (name: string): OgrInfoJson => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))

describe('parseCatalog', () => {
  const catalog = parseCatalog(fixture('gdb-ogrinfo-network.json'), 'network.gdb')

  it('lists the layers and tables, and leaves out the geodatabase system tables', () => {
    expect(catalog.name).toBe('network.gdb')
    expect(catalog.layers.map((l) => l.name)).toEqual(['WFv1000_MasterNet_20260903_Node', 'mag_brt_2032_PTLine', 'CITILABS_TRANSITGROUPS'])
    expect(isGdbSystemTable('GDB_Items')).toBe(true)
    expect(isGdbSystemTable('gdb_SystemCatalog')).toBe(true)
    expect(isGdbSystemTable('Roads')).toBe(false)
  })

  it('reads each layer: geometry, count, EPSG code, feature dataset', () => {
    const node = catalog.layers[0]
    expect(node).toMatchObject({ geometryType: 'Point', geometryColumn: 'geom', featureCount: 21964, srid: 26912, spatial: true, featureDataset: 'WFv1000_MasterNet_20260903' })
    expect(catalog.layers[1]).toMatchObject({ geometryType: 'LineString', featureDataset: 'mag_brt_2032' })
    expect(node.crsWkt).toContain('NAD83')
  })

  it('keeps an attribute-only table: no geometry, not spatial, no dataset', () => {
    expect(catalog.layers[2]).toMatchObject({ geometryType: null, geometryColumn: null, spatial: false, featureCount: 17, srid: null, featureDataset: null })
  })

  it('maps OGR geometry names (curves are lines, surfaces are polygons)', () => {
    expect(geometryTypeFromOgr('MultiLineString')).toBe('LineString')
    expect(geometryTypeFromOgr('CompoundCurve')).toBe('LineString')
    expect(geometryTypeFromOgr('MultiSurface')).toBe('Polygon')
    expect(geometryTypeFromOgr('CurvePolygon')).toBe('Polygon')
    expect(geometryTypeFromOgr('3D Point')).toBe('Point')
    expect(geometryTypeFromOgr('Unknown')).toBe('Mixed')
    expect(geometryTypeFromOgr(undefined)).toBeNull()
  })
})

describe('domains', () => {
  const catalog = parseCatalog(fixture('gdb-ogrinfo-domains.json'), 'domains.gdb')
  const roads = catalog.layers[0]
  const domains = layerDomains(roads, catalog.domains)

  it('reads coded and range domains and which column uses each', () => {
    expect(catalog.domains.RoadClass).toMatchObject({ kind: 'coded', fieldType: 'Integer', codes: { '1': 'Freeway', '2': 'Arterial', '3': 'Local' } })
    expect(catalog.domains.Lanes).toMatchObject({ kind: 'range', codes: {} })
    expect(roads.fields.find((f) => f.name === 'class')?.domain).toBe('RoadClass')
    expect(roads.fields.find((f) => f.name === 'name')?.domain).toBeNull()
  })

  it('only coded domains describe values; range domains and plain columns change nothing', () => {
    expect(Object.keys(domains)).toEqual(['class'])
    expect(hasDomains(domains)).toBe(true)
    expect(hasDomains({})).toBe(false)
    expect(hasDomains(undefined)).toBe(false)
  })

  it('shows the description by default, the code when asked, and the value itself when the domain has no entry', () => {
    expect(displayValue(domains, 'class', 2, 'descriptions')).toBe('Arterial')
    expect(displayValue(domains, 'class', 2n, 'descriptions')).toBe('Arterial')
    expect(displayValue(domains, 'class', '3', 'descriptions')).toBe('Local')
    expect(displayValue(domains, 'class', 2, 'codes')).toBe(2)
    expect(displayValue(domains, 'class', 9, 'descriptions')).toBe(9)
    expect(displayValue(domains, 'lanes', 4, 'descriptions')).toBe(4)
    expect(displayValue(domains, 'class', null, 'descriptions')).toBeNull()
    expect(describeCode(domains, 'class', 1)).toBe('Freeway')
    expect(describeCode(undefined, 'class', 1)).toBeNull()
  })

  it('does not trust a code that is a prototype property', () => {
    expect(describeCode(domains, 'class', 'constructor')).toBeNull()
    expect(describeCode(domains, 'class', '__proto__')).toBeNull()
  })

  it('finds the codes whose description matches what the user typed', () => {
    expect(codesMatching(domains, 'class', 'free')).toEqual(['1'])
    expect(codesMatching(domains, 'class', 'a')).toEqual(['1', '2', '3'])
    expect(codesMatching(domains, 'name', 'x')).toEqual([])
  })
})

describe('converting a layer', () => {
  it('keeps every column; a table without shapes gets no spatial index', () => {
    expect(convertArgs({ name: 'Roads', spatial: true })).toEqual(['-f', 'FlatGeobuf', '-nln', 'Roads', 'Roads'])
    expect(convertArgs({ name: 'Codes', spatial: false })).toEqual(['-f', 'FlatGeobuf', '-lco', 'SPATIAL_INDEX=NO', '-nln', 'Codes', 'Codes'])
  })

  it('names a layer’s cached file safely', () => {
    expect(cacheFileName('Roads')).toBe('Roads')
    expect(cacheFileName('a/b\\c:d')).toBe('a_b_c_d')
    expect(cacheFileName('..hidden')).toBe('_hidden')
    expect(cacheFileName('')).toBe('layer')
  })

  it('finds which table file holds a layer from the catalog table (row id in hexadecimal)', async () => {
    const gdal = { ogr2ogr: async () => ({ local: '/output/se-catalog.csv', real: '' }) } as unknown as GdalApi
    const csv = 'FID,Name\n1,GDB_SystemCatalog\n14,Roads\n15,"Nodes"\n\n'
    const files = await tableFiles(gdal, {}, async () => csv)
    expect(files.get('Roads')).toBe('a0000000e')
    expect(files.get('Nodes')).toBe('a0000000f')
    expect(files.get('GDB_SystemCatalog')).toBe('a00000001')
  })
})

describe('explainGdalError', () => {
  it('says what to do for a compressed geodatabase', () => {
    const e = explainGdalError(new Error('OpenFileGDB: this is a compressed (CDF) file'))
    expect(e.code).toBe('compressed')
    expect(e.message).toContain('Uncompress File Geodatabase Data')
  })
  it('says what to do for 64-bit object ids and for memory', () => {
    expect(explainGdalError('64-bit ObjectID tables are not supported').code).toBe('oid64')
    expect(explainGdalError(new RangeError('Array buffer allocation failed')).code).toBe('too-large')
    expect(explainGdalError('Cannot enlarge memory arrays').code).toBe('too-large')
  })
  it('explains a folder that is not a geodatabase, and keeps an unknown message', () => {
    expect(explainGdalError('Failed to open dataset').code).toBe('unreadable')
    expect(explainGdalError('Failed to open dataset').message).toContain('.gdb')
    expect(explainGdalError(new Error('boom')).message).toContain('boom')
    expect(explainGdalError([]).message).toContain('could not be read')
  })
})

describe('what counts as a geodatabase', () => {
  it('a folder, a file inside it, or a zip of one', () => {
    expect(isFileGeodatabase('network.gdb')).toBe(true)
    expect(isFileGeodatabase('C:\\data\\network.gdb\\a00000001.gdbtable')).toBe(true)
    expect(isFileGeodatabase('network.gdb.zip')).toBe(true)
    expect(isFileGeodatabase('network.gpkg')).toBe(false)
  })
})
