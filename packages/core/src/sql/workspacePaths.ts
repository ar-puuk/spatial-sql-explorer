// Spec 010 phase 9: SQL can read other workspace files by their path relative
// to the workspace root (VS Code) or by the name of a file the user added (web):
// `SELECT * FROM layer JOIN ST_Read('data/links.shp') …`. The engine only reads
// registered files under /se-source/, and DuckDB's file_search_path does not
// make relative paths work there (research.md S4: refused by the access check;
// GDAL ignores it). So each referenced literal is rewritten to its registered
// path before the statement runs, and error positions are mapped back.
import { tokenize } from './scanner.js'
import { SOURCE_DIR } from '../duckdbService.js'

/** Data files a query can name (spec 010 T061, plus the formats the app opens). */
export const WORKSPACE_DATA_EXTENSIONS = ['geojson', 'json', 'shp', 'gpkg', 'fgb', 'flatgeobuf', 'parquet', 'geoparquet', 'csv', 'tsv', 'gml', 'kml', 'gpx', 'sqlite', 'db', 'xlsx'] as const

/** Where workspace files are registered with the engine. */
export const WORKSPACE_DIR = `${SOURCE_DIR}ws/`

/** Functions whose first argument is a file: a path there that can't be read is worth saying so. */
const READERS = new Set(['st_read', 'st_read_meta', 'read_parquet', 'parquet_scan', 'read_csv', 'read_csv_auto', 'read_json', 'read_json_auto', 'read_ndjson', 'read_xlsx', 'sqlite_scan', 'read_text', 'read_blob'])

const EXTENSION = new RegExp(`\\.(${WORKSPACE_DATA_EXTENSIONS.join('|')})$`, 'i')

/** A path the workspace could hold: relative, inside the root, a data file. */
export function isWorkspacePath(p: string): boolean {
  if (!p || !EXTENSION.test(p)) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return false // a scheme (http:, s3:) or a drive letter (C:)
  if (p.startsWith('/') || p.startsWith('\\') || p.includes('\\')) return false
  if (p.split('/').some((s) => s === '..' || s === '.')) return false
  if (p.startsWith(SOURCE_DIR.slice(1))) return false
  return true
}

export interface PathLiteral {
  /** The path, unescaped (`''` collapsed). */
  path: string
  /** The literal's offsets in the SQL (quotes included). */
  from: number
  to: number
  /** The first argument of a file reader (ST_Read, read_parquet, …) or a FROM/JOIN 'file' table. */
  asFile: boolean
}

/** Every plain string literal that names a workspace data file. Comments are skipped by the tokenizer. */
export function pathLiterals(sql: string): PathLiteral[] {
  const tokens = tokenize(sql)
  const out: PathLiteral[] = []
  tokens.forEach((t, i) => {
    if (t.type !== 'string' || !t.text.startsWith("'") || t.text.length < 2 || !t.text.endsWith("'")) return
    const path = t.text.slice(1, -1).replace(/''/g, "'")
    if (!isWorkspacePath(path)) return
    const prev = tokens[i - 1]
    const before = tokens[i - 2]
    const asFile =
      (prev?.type === 'lparen' && before?.type === 'word' && READERS.has(before.text.toLowerCase())) ||
      (prev?.type === 'word' && /^(from|join)$/i.test(prev.text))
    out.push({ path, from: t.from, to: t.to, asFile })
  })
  return out
}

/** The distinct workspace paths a statement names, in order. */
export function referencedPaths(sql: string): string[] {
  return [...new Set(pathLiterals(sql).map((l) => l.path))]
}

export interface Rewritten {
  text: string
  /** Maps an offset in `text` back to the original statement (inside a rewritten literal: its start). */
  toOriginal(offset: number): number
}

/** Rewrites each literal whose path is in `registered` to its engine path (`/se-source/ws/<path>`). */
export function rewritePaths(sql: string, registered: ReadonlySet<string>): Rewritten {
  const edits: Array<{ from: number; to: number; text: string }> = []
  for (const l of pathLiterals(sql)) if (registered.has(l.path)) edits.push({ from: l.from, to: l.to, text: `'${(WORKSPACE_DIR + l.path).replace(/'/g, "''")}'` })
  if (!edits.length) return { text: sql, toOriginal: (o) => o }
  let text = ''
  let at = 0
  // Each edit's position in the rewritten text, to map back.
  const spans: Array<{ newFrom: number; newTo: number; from: number; to: number }> = []
  for (const e of edits) {
    text += sql.slice(at, e.from)
    const newFrom = text.length
    text += e.text
    spans.push({ newFrom, newTo: text.length, from: e.from, to: e.to })
    at = e.to
  }
  text += sql.slice(at)
  return {
    text,
    toOriginal(offset) {
      let shift = 0
      for (const s of spans) {
        if (offset < s.newFrom) break
        if (offset < s.newTo) return s.from
        shift = s.to - s.newTo
      }
      return offset + shift
    },
  }
}
