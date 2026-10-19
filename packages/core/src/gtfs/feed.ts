// Spec 024: taking a feed apart. GDAL's GTFS driver reads all of `stop_times.txt` when it opens
// a feed (about 3 s per million rows, research §6) although the stops and the shapes it draws
// do not depend on it. So GDAL is handed a flat copy of the feed whose `stop_times.txt` is only
// its header line, and the real file is registered with the SQL engine (which reads it with
// `read_csv`, and only when a query needs it).
import { Unzip, UnzipInflate, UnzipPassThrough, unzipSync, zipSync } from 'fflate'

/** The layers GDAL's GTFS driver makes geometry for. */
export type GtfsGdalLayer = 'stops' | 'shapes_geom' | 'trips'

const baseOf = (name: string): string => name.slice(name.lastIndexOf('/') + 1).toLowerCase()

/** The entry names of the feed's own text files: directly under `root`, any case, `.txt`. */
function feedEntries(zip: Uint8Array, root: string): string[] {
  const names: string[] = []
  const prefix = root.toLowerCase()
  unzipSync(zip, {
    filter(file) {
      const lower = file.name.toLowerCase().replace(/\\/g, '/')
      if (lower.startsWith(prefix) && lower.slice(prefix.length).indexOf('/') < 0 && lower.endsWith('.txt')) names.push(file.name)
      return false
    },
  })
  return names
}

/** The first line of one entry, without inflating the rest of it (a big feed's `stop_times.txt` is hundreds of MB). */
export function firstLineOf(zip: Uint8Array, entry: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = ''
    let done = false
    const decoder = new TextDecoder()
    const unzip = new Unzip()
    unzip.register(UnzipInflate)
    unzip.register(UnzipPassThrough)
    unzip.onfile = (file) => {
      if (file.name !== entry) return
      file.ondata = (err, chunk, final) => {
        if (done) return
        if (err) {
          done = true
          return reject(err)
        }
        text += decoder.decode(chunk, { stream: !final })
        const end = text.search(/\r|\n/)
        if (end >= 0 || final) {
          done = true
          file.terminate()
          resolve(end >= 0 ? text.slice(0, end) : text)
        }
      }
      file.start()
    }
    try {
      unzip.push(zip, true)
    } catch (err) {
      if (!done) reject(err)
    }
    if (!done) queueMicrotask(() => !done && resolve(text))
  })
}

export interface GtfsParts {
  /** The feed's text files except `stop_times.txt`, keyed by lower-case file name (`routes.txt`). */
  tables: Record<string, Uint8Array>
  /** What GDAL reads: the same files flat, with `stop_times.txt` cut to its header line (stored, not compressed). */
  lite: Uint8Array
  /** The entry holding the real `stop_times.txt`. */
  stopTimesEntry: string
}

/** Splits the feed at `root` into the small tables, GDAL's light copy and the name of the big one. */
export async function splitFeed(zip: Uint8Array, root: string): Promise<GtfsParts> {
  const entries = feedEntries(zip, root)
  const stopTimesEntry = entries.find((n) => baseOf(n) === 'stop_times.txt')
  if (!stopTimesEntry) throw new Error('This feed has no stop_times.txt.')
  const header = await firstLineOf(zip, stopTimesEntry)
  const wanted = new Set(entries.filter((n) => n !== stopTimesEntry))
  const files = unzipSync(zip, { filter: (f) => wanted.has(f.name) })
  const tables: Record<string, Uint8Array> = {}
  for (const name of wanted) tables[baseOf(name)] = files[name]
  const flat: Record<string, Uint8Array> = { ...tables, 'stop_times.txt': new TextEncoder().encode(`${header}\n`) }
  return { tables, lite: zipSync(flat, { level: 0 }), stopTimesEntry }
}

/** The real `stop_times.txt` (all of it: the engine reads it from memory; it is the one big file of a feed). */
export function readStopTimes(zip: Uint8Array, entry: string): Uint8Array {
  return unzipSync(zip, { filter: (f) => f.name === entry })[entry]
}

/** Splits one CSV record into cells (quotes honored). */
function csvCells(record: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < record.length; i++) {
    const ch = record[i]
    if (ch === '"') {
      if (quoted && record[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else cell += ch
  }
  cells.push(cell)
  return cells
}

/**
 * Whether some trip names no shape (or `trips.txt` has no `shape_id` column at all). Those trips
 * are drawn from GDAL's `trips` layer, which costs a full read of `stop_times.txt`.
 */
export function tripsLackShapes(trips: Uint8Array): boolean {
  const lines = new TextDecoder().decode(trips).replace(/^\u{FEFF}/u, '').split(/\r\n|\n|\r/)
  const index = csvCells(lines[0] ?? '').map((c) => c.trim().toLowerCase()).indexOf('shape_id')
  if (index < 0) return true
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue
    // A quoted field that holds a line break is rare in trips.txt and does not hide an empty shape_id: the cell count is what matters.
    if ((csvCells(lines[i])[index] ?? '').trim() === '') return true
  }
  return false
}

/** The feed with its real `stop_times.txt`, flat and stored: what GDAL reads when it must build trip lines. */
export function fullZip(parts: Pick<GtfsParts, 'tables'>, stopTimes: Uint8Array): Uint8Array {
  return zipSync({ ...parts.tables, 'stop_times.txt': stopTimes }, { level: 0 })
}
