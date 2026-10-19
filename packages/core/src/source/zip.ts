// Zipped data (spec 013 US4). The SQL engine cannot read inside a zip (its
// lockdown refuses `/vsizip/`, and it fails even unlocked: research §8), so the
// shell's bytes are unzipped here: one dataset (a Shapefile with its parts, a
// GeoPackage, a GeoJSON, ...) becomes an ordinary in-memory source. A zip
// holding a File Geodatabase goes to the geodatabase reader instead.
import { unzipSync } from 'fflate'
import type { FileSource } from '../hostAdapter.js'
import { confirmGtfsHeaders, findGtfsRoot, findPartialGtfs, gtfsConfirmingFiles } from '../gtfs/detect.js'

/** Files a zip may hold as the data itself (the app's own list, openFile.ts). */
const DATASET_EXTENSIONS = ['.shp', '.geojson', '.json', '.fgb', '.flatgeobuf', '.gpkg', '.sqlite', '.db', '.gml', '.parquet', '.geoparquet', '.csv', '.xlsx']
const STYLE_EXTENSIONS = ['.qml', '.sld']
/** The most a zip may inflate to before it is refused (a zip bomb, or simply too much for one tab). */
export const MAX_UNZIPPED_BYTES = 3 * 1024 * 1024 * 1024

export interface ZipDataset {
  /** The primary file's path inside the zip (what the user picks among several). */
  name: string
  /** Every entry of the dataset: the primary and its same-name parts. */
  entries: string[]
  /** Uncompressed size of those entries. */
  size: number
}

export type ZipContents = { kind: 'gdb'; folder: string } | { kind: 'gtfs'; root: string; alternatives: string[] } | { kind: 'datasets'; datasets: ZipDataset[] } | { kind: 'empty'; gtfsMissing?: string[] }

/** More than one dataset and none was chosen: the shell asks which. */
export class ZipChoiceError extends Error {
  constructor(readonly datasets: readonly ZipDataset[]) {
    super(`This zip holds ${datasets.length} datasets: ${datasets.map((d) => d.name).join(', ')}. Choose one.`)
    this.name = 'ZipChoiceError'
  }
}

export function isZipName(name: string): boolean {
  return /\.zip$/i.test(name)
}

const extensionOf = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot < 0 ? '' : base.slice(dot).toLowerCase()
}
const stemOf = (path: string): string => path.replace(/\.[^./]+$/, '').toLowerCase()
const junk = (name: string): boolean => name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(name)

/** What a zip holds, from its table of contents only (nothing is inflated). */
export function inspectZip(bytes: Uint8Array): ZipContents {
  const sizes = new Map<string, number>()
  unzipSync(bytes, {
    filter(file) {
      if (!junk(file.name)) sizes.set(file.name, file.originalSize)
      return false
    },
  })
  const names = [...sizes.keys()]
  const gdb = names.find((n) => /(^|\/)[^/]+\.gdb\//i.test(n))
  if (gdb) return { kind: 'gdb', folder: gdb.slice(0, gdb.toLowerCase().indexOf('.gdb/') + 4) }
  const gtfs = gtfsFeedIn(bytes, names)
  if (gtfs) return { kind: 'gtfs', ...gtfs }
  const datasets: ZipDataset[] = []
  for (const name of names) {
    if (!DATASET_EXTENSIONS.includes(extensionOf(name))) continue
    const stem = stemOf(name)
    const entries = names.filter((n) => n === name || (stemOf(n) === stem && !DATASET_EXTENSIONS.includes(extensionOf(n)) && n.slice(0, n.lastIndexOf('/') + 1) === name.slice(0, name.lastIndexOf('/') + 1)))
    datasets.push({ name, entries, size: entries.reduce((sum, n) => sum + (sizes.get(n) ?? 0), 0) })
  }
  if (datasets.length) return { kind: 'datasets', datasets }
  // Spec 024: some of a feed's files and not all: say which are missing.
  const partial = findPartialGtfs(names)
  return partial ? { kind: 'empty', gtfsMissing: partial.missing } : { kind: 'empty' }
}

/** Spec 024: a GTFS feed (by content: the right files, then the columns of two of them), or null. Inflates only those two files. */
function gtfsFeedIn(bytes: Uint8Array, names: readonly string[]): { root: string; alternatives: string[] } | null {
  const found = findGtfsRoot(names)
  if (!found) return null
  const confirmed = [found.root, ...found.alternatives].filter((root) => {
    const wanted = new Map(names.filter((n) => gtfsConfirmingFiles(root.toLowerCase()).includes(n.toLowerCase())).map((n) => [n, n.slice(n.lastIndexOf('/') + 1).toLowerCase()]))
    const files = unzipSync(bytes, { filter: (f) => wanted.has(f.name) })
    const heads: Record<string, Uint8Array> = {}
    for (const [name, base] of wanted) if (files[name]) heads[base] = files[name]
    return confirmGtfsHeaders(heads)
  })
  return confirmed.length ? { root: confirmed[0], alternatives: confirmed.slice(1) } : null
}

/** The dataset to open: the requested one, or the only one. */
export function chooseDataset(datasets: readonly ZipDataset[], requested?: string): ZipDataset {
  const hit = requested === undefined ? undefined : datasets.find((d) => d.name === requested)
  if (hit) return hit
  if (datasets.length === 1) return datasets[0]
  throw new ZipChoiceError(datasets)
}

/** The dataset as an in-memory source (only its own entries are inflated). */
export function extractDataset(bytes: Uint8Array, dataset: ZipDataset): FileSource {
  if (dataset.size > MAX_UNZIPPED_BYTES) throw new Error(`"${dataset.name}" is ${(dataset.size / 1024 ** 3).toFixed(1)} GB unzipped, more than can be opened from a zip. Unzip it and open the file itself.`)
  const wanted = new Set(dataset.entries)
  const files = unzipSync(bytes, { filter: (f) => wanted.has(f.name) })
  const baseOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1)
  const primary = files[dataset.name]
  if (!primary) throw new Error(`"${dataset.name}" could not be read from the zip.`)
  const styleName = dataset.entries.find((n) => n !== dataset.name && STYLE_EXTENSIONS.includes(extensionOf(n)) && extensionOf(n) === '.qml')
  const sidecars = dataset.entries.filter((n) => n !== dataset.name && !STYLE_EXTENSIONS.includes(extensionOf(n))).map((n) => ({ name: baseOf(n), bytes: files[n] }))
  return {
    kind: 'bytes',
    name: baseOf(dataset.name),
    size: primary.byteLength,
    bytes: primary,
    sidecars,
    styleSidecar: styleName ? { fileName: baseOf(styleName), text: new TextDecoder().decode(files[styleName]) } : null,
  }
}

/**
 * Entry names from a zip's central directory alone (nothing is inflated and a
 * multi-gigabyte zip is not read), through a function that reads a byte range.
 * Used where the whole zip is not in memory: the geodatabase readers.
 */
export async function listZipNames(size: number, read: (offset: number, length: number) => Promise<Uint8Array>): Promise<string[]> {
  const tailLength = Math.min(size, 65536 + 22 + 20)
  const tailBytes = await read(size - tailLength, tailLength)
  const tail = new DataView(tailBytes.buffer, tailBytes.byteOffset, tailBytes.byteLength)
  let eocd = -1
  for (let i = tailLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('it is not a zip file')
  let entries = tail.getUint16(eocd + 10, true)
  let directorySize = tail.getUint32(eocd + 12, true)
  let directoryOffset = tail.getUint32(eocd + 16, true)
  if ((directoryOffset === 0xffffffff || entries === 0xffff) && eocd >= 20 && tail.getUint32(eocd - 20, true) === 0x07064b50) {
    const recordBytes = await read(Number(tail.getBigUint64(eocd - 20 + 8, true)), 56)
    const record = new DataView(recordBytes.buffer, recordBytes.byteOffset, recordBytes.byteLength)
    entries = Number(record.getBigUint64(32, true))
    directorySize = Number(record.getBigUint64(40, true))
    directoryOffset = Number(record.getBigUint64(48, true))
  }
  const bytes = await read(directoryOffset, directorySize)
  const directory = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const names: string[] = []
  const decoder = new TextDecoder()
  let p = 0
  for (let n = 0; n < entries && p + 46 <= bytes.length && directory.getUint32(p, true) === 0x02014b50; n++) {
    const nameLength = directory.getUint16(p + 28, true)
    const extraLength = directory.getUint16(p + 30, true)
    const commentLength = directory.getUint16(p + 32, true)
    names.push(decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength)))
    p += 46 + nameLength + extraLength + commentLength
  }
  return names
}

/** The `x.gdb` folder inside a zip (from its entry names), or null when the geodatabase's files are at the top level. */
export function gdbFolderOf(names: readonly string[]): string | null {
  for (const name of names) {
    const at = name.toLowerCase().indexOf('.gdb/')
    if (at >= 0) return name.slice(0, at + 4)
  }
  return null
}
