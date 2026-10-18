// Zipped data (spec 013 US4). The SQL engine cannot read inside a zip (its
// lockdown refuses `/vsizip/`, and it fails even unlocked: research §8), so the
// shell's bytes are unzipped here: one dataset (a Shapefile with its parts, a
// GeoPackage, a GeoJSON, ...) becomes an ordinary in-memory source. A zip
// holding a File Geodatabase goes to the geodatabase reader instead.
import { unzipSync } from 'fflate'
import type { FileSource } from '../hostAdapter.js'

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

export type ZipContents = { kind: 'gdb'; folder: string } | { kind: 'datasets'; datasets: ZipDataset[] } | { kind: 'empty' }

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
  const datasets: ZipDataset[] = []
  for (const name of names) {
    if (!DATASET_EXTENSIONS.includes(extensionOf(name))) continue
    const stem = stemOf(name)
    const entries = names.filter((n) => n === name || (stemOf(n) === stem && !DATASET_EXTENSIONS.includes(extensionOf(n)) && n.slice(0, n.lastIndexOf('/') + 1) === name.slice(0, name.lastIndexOf('/') + 1)))
    datasets.push({ name, entries, size: entries.reduce((sum, n) => sum + (sizes.get(n) ?? 0), 0) })
  }
  return datasets.length ? { kind: 'datasets', datasets } : { kind: 'empty' }
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
