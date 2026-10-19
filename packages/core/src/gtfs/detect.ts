// Spec 024: is this zip or folder a GTFS feed? Decided by what is inside, never by a name:
// a feed is called `GTFS.zip`, `google_transit.zip`, `feed_2026.zip` or `data.zip`, and a
// zip of CSV files may be called anything. Names only (a zip's table of contents or a
// folder's file list) find the feed's folder; the first line of two files confirms it.

/** The tables a feed must have to draw anything: stops and routes, joined by trips and stop times. */
export const GTFS_REQUIRED_FILES = ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'] as const

/** A column each confirming file must have. */
const CONFIRMING_COLUMNS = { 'stops.txt': 'stop_id', 'routes.txt': 'route_id' } as const

/** Where a feed's text files are: `''` for the top level, else `feed/` (one wrapper folder, with its slash). */
export interface GtfsLocation {
  root: string
  /** Other places that also hold a whole feed (a zip with two feeds): the first is `root`. */
  alternatives: string[]
}

const junk = (name: string): boolean => name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(name)

/**
 * The folder holding a whole feed, from entry names alone. The top level wins; failing
 * that, a single wrapper folder (some agencies zip the folder, not its files). Deeper
 * folders and zips inside the zip are ignored on purpose: `GTFS.zip` from a real agency
 * holds the ten text files and a second zip of the same feed.
 */
export function findGtfsRoot(names: readonly string[]): GtfsLocation | null {
  const folders = new Map<string, Set<string>>()
  for (const raw of names) {
    const name = raw.replace(/\\/g, '/')
    if (junk(name)) continue
    const slash = name.lastIndexOf('/')
    const dir = slash < 0 ? '' : name.slice(0, slash + 1)
    if (dir.split('/').length - 1 > 1) continue // more than one folder deep
    const set = folders.get(dir) ?? new Set<string>()
    set.add(name.slice(slash + 1).toLowerCase())
    folders.set(dir, set)
  }
  const whole = [...folders.entries()].filter(([, files]) => GTFS_REQUIRED_FILES.every((f) => files.has(f))).map(([dir]) => dir)
  if (!whole.length) return null
  // The top level first, then wrapper folders in the order the zip lists them.
  whole.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0))
  return { root: whole[0], alternatives: whole.slice(1) }
}

/** The header cells of a CSV's first line (a byte-order mark, quotes and case removed). */
export function csvHeader(head: Uint8Array | string): string[] {
  const text = typeof head === 'string' ? head : new TextDecoder().decode(head)
  const line = text.replace(/^\u{FEFF}/u, '').split(/\r\n|\n|\r/, 1)[0] ?? ''
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"'
        i++
      } else quoted = !quoted
    } else if (ch === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else cell += ch
  }
  cells.push(cell)
  return cells.map((c) => c.trim().toLowerCase())
}

/** The files whose first line confirms a feed, as entry names under `root`. */
export function gtfsConfirmingFiles(root: string): string[] {
  return Object.keys(CONFIRMING_COLUMNS).map((f) => root + f)
}

/**
 * Whether the heads of `stops.txt` and `routes.txt` have the columns of a feed. `heads` is
 * keyed by the file's lower-case base name; a missing head is a failure.
 */
export function confirmGtfsHeaders(heads: Readonly<Record<string, Uint8Array | string | undefined>>): boolean {
  return (Object.entries(CONFIRMING_COLUMNS) as [keyof typeof CONFIRMING_COLUMNS, string][]).every(([file, column]) => {
    const head = heads[file]
    return head !== undefined && csvHeader(head).includes(column)
  })
}

/** What is missing from a folder that looks like a feed, for a message (empty when nothing is). */
export function missingGtfsFiles(names: readonly string[], root = ''): string[] {
  const have = new Set(names.filter((n) => !junk(n)).map((n) => n.replace(/\\/g, '/').toLowerCase()))
  return GTFS_REQUIRED_FILES.filter((f) => !have.has(root.toLowerCase() + f))
}
