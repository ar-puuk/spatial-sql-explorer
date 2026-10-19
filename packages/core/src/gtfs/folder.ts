// Spec 024: a feed that is a folder of text files (picked or dropped in the browser, opened from
// the explorer in VS Code) is made into the one thing the rest of the app already opens, a zip
// of the feed's files. The files are stored, not compressed: nothing leaves the machine and the
// zip is read once. Detection is the same as for a zip (gtfs/detect.ts): the right files, then
// the columns of two of them, never the folder's or the files' names beyond `stops.txt` and so on.
import { zipSync } from 'fflate'
import { confirmGtfsHeaders, csvHeader, findGtfsRoot, findPartialGtfs, gtfsConfirmingFiles } from './detect.js'

/** A file of a picked folder: its path inside the folder (`gtfs/stops.txt`) and ways to read it. */
export interface FolderEntry {
  path: string
  /** The first bytes (enough for the header line). */
  head(): Promise<Uint8Array>
  /** All of it. */
  read(): Promise<Uint8Array>
}

export interface FolderFeed {
  /** The feed as a zip, flat: only the `.txt` files directly in the feed's folder. */
  zip: Uint8Array
  /** What to call it: the folder's name with `.zip`, or `gtfs.zip` for loose files. */
  name: string
}

/** Whether some entry's name is one a feed has (a cheap check before anything is read). */
export function mayBeGtfs(paths: readonly string[]): boolean {
  return paths.some((p) => /(^|[\\/])(stops|routes|trips|stop_times)\.txt$/i.test(p))
}

/** The feed in these files, as a zip, or null when they are not one. */
export async function zipGtfsFolder(entries: readonly FolderEntry[]): Promise<FolderFeed | null> {
  const paths = entries.map((e) => e.path.replace(/\\/g, '/'))
  if (!mayBeGtfs(paths)) return null
  const found = findGtfsRoot(paths)
  if (!found) return incompleteFeed(entries, paths)
  const byPath = new Map(entries.map((e, i) => [paths[i], e]))
  for (const root of [found.root, ...found.alternatives]) {
    const heads: Record<string, Uint8Array> = {}
    for (const wanted of gtfsConfirmingFiles(root.toLowerCase())) {
      const at = paths.findIndex((p) => p.toLowerCase() === wanted)
      if (at >= 0) heads[wanted.slice(wanted.lastIndexOf('/') + 1)] = await entries[at].head()
    }
    if (!confirmGtfsHeaders(heads)) continue
    const own = [...byPath.entries()].filter(([p]) => p.toLowerCase().startsWith(root.toLowerCase()) && p.slice(root.length).indexOf('/') < 0 && p.toLowerCase().endsWith('.txt'))
    const files: Record<string, Uint8Array> = {}
    for (const [p, entry] of own) files[p.slice(root.length)] = await entry.read()
    const folder = root ? root.replace(/\/$/, '').split('/').pop() : ''
    return { zip: zipSync(files, { level: 0 }), name: `${folder || 'gtfs'}.zip` }
  }
  return null
}

/**
 * A folder with some of a feed's files and not all of them (and the columns of those it has that a feed's
 * stops and routes need) is still zipped, so that opening it says which files are missing.
 */
async function incompleteFeed(entries: readonly FolderEntry[], paths: readonly string[]): Promise<FolderFeed | null> {
  const partial = findPartialGtfs(paths)
  if (!partial) return null
  const present = (file: string): number => paths.findIndex((p) => p.toLowerCase() === partial.root.toLowerCase() + file)
  for (const [file, column] of [['stops.txt', 'stop_id'], ['routes.txt', 'route_id']] as const) {
    const at = present(file)
    if (at >= 0 && !csvHeader(await entries[at].head()).includes(column)) return null
  }
  const files: Record<string, Uint8Array> = {}
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i]
    if (p.toLowerCase().startsWith(partial.root.toLowerCase()) && p.slice(partial.root.length).indexOf('/') < 0 && p.toLowerCase().endsWith('.txt')) files[p.slice(partial.root.length)] = await entries[i].read()
  }
  const folder = partial.root ? partial.root.replace(/\/$/, '').split('/').pop() : ''
  return { zip: zipSync(files, { level: 0 }), name: `${folder || 'gtfs'}.zip` }
}
