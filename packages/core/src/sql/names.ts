// The names a query uses for the opened file (user decision 2026-10-14):
// `us-counties.parquet` is `us_counties`, and each layer of a file holding
// several is `<file>.<layer>` (`us_boundaries.counties`). `layer` keeps
// working for any file. Adapted from GeoLibre's sanitizeTableName
// (apps/geolibre-desktop/src/lib/sql-table-names.ts, MIT): lower case, other
// characters as `_`; where GeoLibre prefixes `t_`, a name that can't be typed
// bare (a leading digit, a reserved word) is quoted instead, so it stays the
// file's own name.
import { quoteIdent } from '../query/util.js'

/**
 * Words DuckDB refuses as a bare table or schema name: its `reserved` and
 * `type_function` keywords (checked one by one against DuckDB 1.5).
 */
export const RESERVED_NAMES_SQL = "SELECT keyword_name AS k FROM duckdb_keywords() WHERE keyword_category IN ('reserved', 'type_function')"

/** Schema names DuckDB already uses (or that are catalogs): a file can't take them. */
const TAKEN_SCHEMAS = new Set(['main', 'temp', 'system', 'memory', 'information_schema', 'pg_catalog'])

/** A file's base name without folders or its extension. */
function baseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
}

/** Lower case, every run of other characters as one `_`, no leading or trailing `_` (so never an internal `__se_` name; null when nothing is left). */
export function cleanSqlName(name: string): string | null {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return clean && /[a-z0-9]/.test(clean) ? clean : null
}

/** A clean name as SQL: bare when it can be typed bare, else quoted. */
export function sqlNameText(clean: string, reserved: ReadonlySet<string>): string {
  return /^[a-z_]/.test(clean) && !reserved.has(clean) ? clean : quoteIdent(clean)
}

export interface FileSqlNames {
  /** What a query names the opened file (or its open layer) by, e.g. `us_counties` or `us_boundaries.counties`; null: only `layer`. */
  alias: string | null
  /** The schema holding a multi-layer file's layers (as SQL), or null. */
  schema: string | null
  /** Each layer's SQL name, by its name in the file (multi-layer files only). */
  layers: Map<string, string>
}

/**
 * The SQL names for an opened file. A single-layer file is one name; a file
 * with several layers is a schema named after the file with one view per
 * layer, the open one included. Layer names that clean to the same name get
 * `_2`, `_3`, … in file order.
 */
export function fileSqlNames(fileName: string, layerNames: readonly string[] | null, activeLayer: string | null, reserved: ReadonlySet<string>): FileSqlNames {
  const file = cleanSqlName(baseName(fileName))
  if (!layerNames) {
    return { alias: file !== null && file !== 'layer' ? sqlNameText(file, reserved) : null, schema: null, layers: new Map() }
  }
  const schemaName = file === null ? 'file' : TAKEN_SCHEMAS.has(file) ? `${file}_file` : file
  const schema = sqlNameText(schemaName, reserved)
  const layers = new Map<string, string>()
  const used = new Set<string>()
  for (const [i, name] of layerNames.entries()) {
    const base = cleanSqlName(name) ?? `layer_${i + 1}`
    let clean = base
    for (let n = 2; used.has(clean); n++) clean = `${base}_${n}`
    used.add(clean)
    layers.set(name, `${schema}.${sqlNameText(clean, reserved)}`)
  }
  return { alias: activeLayer !== null ? (layers.get(activeLayer) ?? null) : null, schema, layers }
}

/** The query that shows the whole opened file, by its own name when it has one. */
export function defaultQueryFor(alias: string | null): string {
  return `SELECT * FROM ${alias ?? 'layer'}`
}
