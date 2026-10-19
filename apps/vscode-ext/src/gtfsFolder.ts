// Spec 024: a GTFS feed that is a folder of text files. VS Code opens a file, not a folder, so the
// feed is opened through one of its files (`stops.txt`, from the explorer menu); here the folder
// becomes a zip of its text files in the extension's storage (core's zipGtfsFolder decides, by
// content, whether it is a feed at all), and that zip is what the viewer is given. It is made again
// whenever a file of the folder changes, and the few most recent are kept.
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { zipGtfsFolder, type FolderEntry } from '../../../packages/core/src/gtfs/folder'

const KEEP = 5

export interface FolderZip {
  /** The zip's path. */
  fsPath: string
  /** What the viewer calls it: the folder's name and `.zip`. */
  name: string
}

/** Whether a document is a table of a feed (the explorer menu offers these). */
export const isGtfsTableName = (file: string): boolean => /\.txt$/i.test(file)

function entriesOf(dir: string): FolderEntry[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.txt$/i.test(e.name))
    .map((e) => {
      const file = path.join(dir, e.name)
      return {
        path: e.name,
        head: async () => {
          const fd = fs.openSync(file, 'r')
          try {
            const buffer = Buffer.alloc(8192)
            const n = fs.readSync(fd, buffer, 0, buffer.length, 0)
            return new Uint8Array(buffer.buffer, buffer.byteOffset, n)
          } finally {
            fs.closeSync(fd)
          }
        },
        read: async () => new Uint8Array(fs.readFileSync(file)),
      }
    })
}

/** What identifies the folder's current contents: its text files' names, sizes and modification times. */
function folderKey(dir: string): string {
  const hash = createHash('sha1').update(dir)
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.txt$/i.test(name)) continue
    const st = fs.statSync(path.join(dir, name))
    if (st.isFile()) hash.update(`|${name}:${st.size}:${st.mtimeMs}`)
  }
  return hash.digest('hex').slice(0, 24)
}

/** The folder that holds `file`, as a zip in `storage`, or null when it is not a GTFS feed. */
export async function gtfsFolderZip(file: string, storage: string): Promise<FolderZip | null> {
  if (!isGtfsTableName(file)) return null
  const dir = path.dirname(file)
  const name = `${path.basename(dir) || 'gtfs'}.zip`
  let target: string
  try {
    target = path.join(storage, `${folderKey(dir)}.zip`)
    if (fs.existsSync(target)) {
      const now = new Date()
      fs.utimesSync(target, now, now)
      return { fsPath: target, name }
    }
    const feed = await zipGtfsFolder(entriesOf(dir))
    if (!feed) return null
    fs.mkdirSync(storage, { recursive: true })
    fs.writeFileSync(`${target}.part`, feed.zip)
    fs.renameSync(`${target}.part`, target)
  } catch {
    return null
  }
  // Keep the most recent few.
  try {
    const zips = fs.readdirSync(storage).filter((n) => n.endsWith('.zip')).map((n) => ({ n, t: fs.statSync(path.join(storage, n)).mtimeMs })).sort((a, b) => b.t - a.t)
    for (const old of zips.slice(KEEP)) fs.rmSync(path.join(storage, old.n), { force: true })
  } catch {
    // The folder of kept zips is only a cache.
  }
  return { fsPath: target, name }
}

/** The table file of a folder to open it by (`stops.txt`), or null when the folder is not a feed. */
export async function gtfsMarkerIn(dir: string): Promise<string | null> {
  const stops = fs.readdirSync(dir).find((n) => n.toLowerCase() === 'stops.txt')
  if (!stops) return null
  return (await zipGtfsFolder(entriesOf(dir))) ? path.join(dir, stops) : null
}
