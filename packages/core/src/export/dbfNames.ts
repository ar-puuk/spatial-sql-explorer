// Shapefile (DBF) field names (spec 008 FR-021): at most 10 bytes, ASCII,
// unique ignoring case. Longer or clashing names are shortened and numbered;
// the export dialog lists every rename before anything is written.

const MAX = 10

function ascii(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9_]/g, '_')
  return cleaned.length ? cleaned : 'field'
}

/** The DBF name of each column, in order; same length as `names`. */
export function dbfFieldNames(names: readonly string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    const base = ascii(name).slice(0, MAX)
    let candidate = base
    for (let i = 1; used.has(candidate.toUpperCase()); i++) {
      const suffix = `_${i}`
      candidate = base.slice(0, MAX - suffix.length) + suffix
    }
    used.add(candidate.toUpperCase())
    return candidate
  })
}

/** Only the names that change: "original → DBF name". */
export function dbfRenames(names: readonly string[]): Array<{ from: string; to: string }> {
  const out = dbfFieldNames(names)
  return names.map((from, i) => ({ from, to: out[i] })).filter((r) => r.from !== r.to)
}
