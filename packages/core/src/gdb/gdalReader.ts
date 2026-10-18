// The part of reading a File Geodatabase that is the same in both shells:
// what to ask gdal3.js (GDAL 3.8.4 in WebAssembly) and how to read its answers.
// The shell owns the rest (loading gdal3.js, mounting the files, where the
// converted FlatGeobuf goes): the extension host in VS Code, a worker on the web.
import { parseCatalog, type OgrInfoJson } from './catalog.js'
import { GdbError, type GdbCatalog, type GdbLayerInfo } from './types.js'

/** The slice of gdal3.js used here. A dataset is opaque. */
export interface GdalApi {
  open(path: string, openOptions?: string[], vfsHandlers?: string[]): Promise<{ datasets: unknown[]; errors: unknown[] }>
  ogrinfo(dataset: unknown, args: string[]): Promise<unknown>
  ogr2ogr(dataset: unknown, args: string[], outName?: string): Promise<{ local: string; real: string }>
  close?(dataset: unknown): Promise<void>
}

/** Turns a failure from GDAL into a message that says what to do. */
export function explainGdalError(err: unknown): GdbError {
  if (err instanceof GdbError) return err
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : Array.isArray(err) ? err.map((e) => (typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e))).filter(Boolean).join('; ') : JSON.stringify(err)
  const text = raw && raw !== '{}' ? raw : ''
  if (!text) return new GdbError('This folder is not a readable File Geodatabase. Pick the folder that ends in .gdb (or a .gdb.zip).', 'unreadable')
  if (/uncompress|compressed|CDF|\.cdf|SDC/i.test(text)) {
    return new GdbError('This geodatabase is compressed, which no open-source reader can open. In ArcGIS, run "Uncompress File Geodatabase Data" on it, then open it again.', 'compressed')
  }
  if (/64.?bit|int64|object ?id/i.test(text) && /object|oid/i.test(text)) {
    return new GdbError('This layer uses 64-bit ObjectIDs (ArcGIS Pro 3.2 or newer), which the bundled reader (GDAL 3.8) cannot read yet. Export the layer to a GeoPackage in ArcGIS Pro and open that instead.', 'oid64')
  }
  if (/out of memory|cannot enlarge memory|memory access out of bounds|RangeError|allocation failed|array buffer allocation/i.test(text)) {
    return new GdbError('This layer is too large to read in the browser (its files and the converted layer must fit in memory). Open it in VS Code, or export the layer to a GeoPackage first.', 'too-large')
  }
  if (/not recognized as|not a supported|Could not open|failed to open/i.test(text)) {
    return new GdbError('This folder is not a readable File Geodatabase. Pick the folder that ends in .gdb (or a .gdb.zip).', 'unreadable')
  }
  return new GdbError(`The geodatabase could not be read: ${text}`, 'unreadable')
}

function failure(errors: unknown[]): unknown {
  return errors.length ? errors.map((e) => (typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e))).join('; ') : 'could not open it'
}

/** Opens `path` (inside gdal3.js's file system) as a geodatabase. */
export async function openGeodatabase(gdal: GdalApi, path: string, openOptions: string[] = []): Promise<unknown> {
  let opened: Awaited<ReturnType<GdalApi['open']>>
  try {
    opened = await gdal.open(path, openOptions)
  } catch (err) {
    throw explainGdalError(err)
  }
  if (!opened.datasets.length) throw explainGdalError(failure(opened.errors))
  return opened.datasets[0]
}

/** The layers and domains of an opened geodatabase (`ogrinfo -json`: tens of milliseconds even for hundreds of layers). */
export async function readCatalog(gdal: GdalApi, dataset: unknown, name: string): Promise<GdbCatalog> {
  try {
    const info = (await gdal.ogrinfo(dataset, ['-json', '-so', '-al'])) as OgrInfoJson
    return parseCatalog(info, name)
  } catch (err) {
    throw explainGdalError(err)
  }
}

/** ogr2ogr's arguments for one layer: FlatGeobuf, every column kept; an attribute-only table gets no spatial index (FlatGeobuf refuses rows without a shape in an indexed file). */
export function convertArgs(layer: Pick<GdbLayerInfo, 'name' | 'spatial'>): string[] {
  return ['-f', 'FlatGeobuf', ...(layer.spatial ? [] : ['-lco', 'SPATIAL_INDEX=NO']), '-nln', layer.name, layer.name]
}

/** Converts one layer; `outName` is gdal3.js's output name (no extension). Resolves with gdal3.js's path of the `.fgb`. */
export async function convertLayer(gdal: GdalApi, dataset: unknown, layer: Pick<GdbLayerInfo, 'name' | 'spatial'>, outName: string): Promise<string> {
  try {
    const out = await gdal.ogr2ogr(dataset, convertArgs(layer), outName)
    return out.local
  } catch (err) {
    throw explainGdalError(err)
  }
}

/**
 * Layer name to the table file that holds it (`a0000000e`): the geodatabase's
 * catalog table lists every table, and a row's id is its file's number.
 * The web reader copies a layer's files into memory before converting it
 * (reading them straight from the picked folder is 25x slower, research §9).
 * `dataset` must have been opened with `LIST_ALL_TABLES=YES`.
 */
export async function tableFiles(gdal: GdalApi, dataset: unknown, readText: (path: string) => Promise<string>): Promise<Map<string, string>> {
  const out = await gdal.ogr2ogr(dataset, ['-f', 'CSV', '-sql', 'SELECT FID, Name FROM GDB_SystemCatalog'], 'se-catalog')
  const text = await readText(out.local)
  const files = new Map<string, string>()
  for (const line of text.split('\n').slice(1)) {
    const comma = line.indexOf(',')
    if (comma < 1) continue
    const fid = Number(line.slice(0, comma))
    const name = line
      .slice(comma + 1)
      .trim()
      .replace(/^"|"$/g, '')
    if (Number.isInteger(fid) && name) files.set(name, `a${fid.toString(16).padStart(8, '0')}`)
  }
  return files
}

/** A file name that is safe on any file system, for a layer's cached file. */
export function cacheFileName(layerName: string): string {
  const clean = layerName.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^\.+/, '_')
  return clean || 'layer'
}
