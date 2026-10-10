// Autocomplete data from the live engine catalog (spec 002 FR-015; research
// §7): tables and views (the file's `layer`, its alias, the user's temp
// objects) with their columns and types, every function with its overload
// signatures and description, and the engine's keyword list. Internal
// objects (`__se_*`) and engine internals (pg_*, __*) are hidden.
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { CatalogSnapshot } from '../models.js'
import { streamRows } from './util.js'

const HIDDEN = (name: string): boolean => /^(__|pg_|sqlite_|information_schema)/i.test(name)

async function rows(conn: AsyncDuckDBConnection, sql: string, isCancelled: () => boolean): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  await streamRows(conn, sql, isCancelled, (batch) => {
    out.push(...batch)
  })
  return out
}

export async function loadCatalog(conn: AsyncDuckDBConnection, isCancelled: () => boolean): Promise<CatalogSnapshot> {
  const objects = await rows(
    conn,
    `SELECT table_name AS name, 'table' AS kind FROM duckdb_tables() WHERE NOT internal
     UNION ALL SELECT view_name, 'view' FROM duckdb_views() WHERE NOT internal`,
    isCancelled
  )
  const columns = await rows(conn, `SELECT table_name, column_name, data_type FROM duckdb_columns() WHERE NOT internal ORDER BY table_name, column_index`, isCancelled)
  const byTable = new Map<string, Array<{ name: string; type: string }>>()
  for (const c of columns) {
    const t = String(c.table_name)
    const list = byTable.get(t) ?? []
    list.push({ name: String(c.column_name), type: String(c.data_type) })
    byTable.set(t, list)
  }
  const tables = objects
    .map((o) => ({ name: String(o.name), kind: String(o.kind) as 'table' | 'view' }))
    .filter((o) => !HIDDEN(o.name))
    .map((o) => ({ ...o, columns: byTable.get(o.name) ?? [] }))

  const fns = await rows(
    conn,
    `SELECT function_name AS name, array_to_string(parameters, ', ') AS params, return_type AS ret, description AS d
     FROM duckdb_functions()
     WHERE function_type IN ('scalar', 'aggregate', 'macro')`,
    isCancelled
  )
  const grouped = new Map<string, { name: string; signatures: Set<string>; description: string }>()
  for (const f of fns) {
    const name = String(f.name)
    if (HIDDEN(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
    const key = name.toLowerCase()
    const entry = grouped.get(key) ?? { name, signatures: new Set<string>(), description: '' }
    entry.signatures.add(`${name}(${f.params ?? ''})${f.ret ? ` → ${String(f.ret)}` : ''}`)
    if (!entry.description && f.d) entry.description = String(f.d).split(/\n\s*\n/)[0].trim()
    grouped.set(key, entry)
  }
  const functions = [...grouped.values()].map((g) => ({
    name: g.name,
    signatures: [...g.signatures].slice(0, 6),
    description: g.description,
    spatial: /^st_/i.test(g.name),
  }))

  const keywords = (await rows(conn, 'SELECT keyword_name AS k FROM duckdb_keywords()', isCancelled)).map((r) => String(r.k).toUpperCase())
  return { tables, functions, keywords }
}
