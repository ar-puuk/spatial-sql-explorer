// Spec 013 US4: zipped data. The engine cannot read inside a zip, so the shell's
// bytes are unzipped in core: a dataset becomes an in-memory source; a zip with
// a geodatabase goes to the geodatabase reader.
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { chooseDataset, extractDataset, gdbFolderOf, inspectZip, isZipName, listZipNames, ZipChoiceError } from '@spatial-explorer/core'

const text = (s: string): Uint8Array => new TextEncoder().encode(s)
const zip = (files: Record<string, string>): Uint8Array => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, text(v)])))

describe('inspectZip', () => {
  it('a Shapefile is one dataset with its parts, and nothing is inflated to find out', () => {
    const c = inspectZip(zip({ 'roads.shp': 'SHP', 'roads.dbf': 'DBF', 'roads.shx': 'SHX', 'roads.prj': 'PRJ', 'readme.txt': 'hi' }))
    expect(c.kind).toBe('datasets')
    if (c.kind !== 'datasets') return
    expect(c.datasets).toHaveLength(1)
    expect(c.datasets[0].name).toBe('roads.shp')
    expect(c.datasets[0].entries.sort()).toEqual(['roads.dbf', 'roads.prj', 'roads.shp', 'roads.shx'])
  })

  it('finds datasets in a folder inside the zip, and ignores macOS leftovers', () => {
    const c = inspectZip(zip({ 'data/places.geojson': '{}', '__MACOSX/data/._places.geojson': 'x', 'data/.DS_Store': 'x' }))
    expect(c.kind === 'datasets' && c.datasets.map((d) => d.name)).toEqual(['data/places.geojson'])
  })

  it('several datasets in one zip', () => {
    const c = inspectZip(zip({ 'a.geojson': '{}', 'b.csv': 'lon,lat', 'b.qml': '<qgis/>' }))
    expect(c.kind === 'datasets' && c.datasets.map((d) => d.name)).toEqual(['a.geojson', 'b.csv'])
  })

  it('a geodatabase folder wins, wherever it is in the zip', () => {
    expect(inspectZip(zip({ 'net.gdb/a00000001.gdbtable': 'x', 'net.gdb/gdb': 'y' }))).toEqual({ kind: 'gdb', folder: 'net.gdb' })
    expect(inspectZip(zip({ 'deliverable/net.GDB/a00000001.gdbtable': 'x' }))).toEqual({ kind: 'gdb', folder: 'deliverable/net.GDB' })
  })

  it('an empty zip, or one with nothing we open', () => {
    expect(inspectZip(zip({ 'notes.txt': 'x' })).kind).toBe('empty')
  })

  it('knows zip names', () => {
    expect(isZipName('x.shp.zip')).toBe(true)
    expect(isZipName('x.ZIP')).toBe(true)
    expect(isZipName('x.gpkg')).toBe(false)
  })
})

describe('choosing and extracting', () => {
  const bytes = zip({ 'roads.shp': 'SHP', 'roads.dbf': 'DBF', 'roads.qml': '<qgis/>', 'sub/places.geojson': '{"type":"FeatureCollection","features":[]}', 'sub/places.cpg': 'UTF-8' })
  const contents = inspectZip(bytes)
  if (contents.kind !== 'datasets') throw new Error('expected datasets')

  it('asks which when there are several and none was chosen', () => {
    expect(() => chooseDataset(contents.datasets)).toThrow(ZipChoiceError)
    expect(chooseDataset(contents.datasets, 'sub/places.geojson').name).toBe('sub/places.geojson')
    expect(chooseDataset([contents.datasets[0]]).name).toBe('roads.shp')
    try {
      chooseDataset(contents.datasets)
    } catch (e) {
      expect((e as ZipChoiceError).datasets.map((d) => d.name)).toEqual(['roads.shp', 'sub/places.geojson'])
    }
  })

  it('extracts the primary file as bytes, its parts as sidecars, and the QGIS style as text', () => {
    const source = extractDataset(bytes, contents.datasets[0])
    expect(source.kind).toBe('bytes')
    if (source.kind !== 'bytes') return
    expect(source.name).toBe('roads.shp')
    expect(new TextDecoder().decode(source.bytes)).toBe('SHP')
    expect(source.sidecars.map((s) => s.name)).toEqual(['roads.dbf'])
    expect(source.styleSidecar).toEqual({ fileName: 'roads.qml', text: '<qgis/>' })
  })

  it('a dataset inside a folder is named by its file name, with its own folder’s parts', () => {
    const source = extractDataset(bytes, contents.datasets[1])
    expect(source.name).toBe('places.geojson')
    expect(source.kind === 'bytes' && source.sidecars.map((s) => s.name)).toEqual(['places.cpg'])
  })

  it('refuses a dataset that would inflate past the limit', () => {
    expect(() => extractDataset(bytes, { ...contents.datasets[0], size: 4 * 1024 ** 3 })).toThrow(/unzipped/)
  })
})

describe('listZipNames', () => {
  it('reads the entry names from the end of the zip, in ranges, without the contents', async () => {
    const noise = new Uint8Array(200_000) // does not compress, so the zip is big
    for (let i = 0; i < noise.length; i += 65_536) crypto.getRandomValues(noise.subarray(i, i + 65_536))
    const bytes = zipSync({ 'net.gdb/a00000001.gdbtable': noise, 'net.gdb/gdb': text('y'), 'other/readme.txt': text('z') })
    const reads: Array<[number, number]> = []
    const names = await listZipNames(bytes.byteLength, async (offset, length) => {
      reads.push([offset, length])
      return bytes.slice(offset, offset + length)
    })
    expect(names).toEqual(['net.gdb/a00000001.gdbtable', 'net.gdb/gdb', 'other/readme.txt'])
    expect(reads.reduce((sum, [, length]) => sum + length, 0)).toBeLessThan(bytes.byteLength)
    expect(gdbFolderOf(names)).toBe('net.gdb')
    expect(gdbFolderOf(['a00000001.gdbtable', 'gdb'])).toBeNull()
  })
  it('refuses something that is not a zip', async () => {
    await expect(listZipNames(100, async (o, l) => new Uint8Array(l))).rejects.toThrow(/not a zip/)
  })
})
