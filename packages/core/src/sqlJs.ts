// sql.js, loaded once, with its wasm downloaded and hash-checked (spec 008
// research §15). Used where the engine provably can't: writing GeoPackage
// (research §3) and reading SQLite primary keys GDAL hides (research §16).
import type { SqlJsStatic } from 'sql.js'

let sqlJs: Promise<SqlJsStatic> | null = null

export function loadSqlJs(loadWasm: () => Promise<ArrayBuffer>): Promise<SqlJsStatic> {
  if (!sqlJs) {
    const attempt = Promise.all([import('sql.js'), loadWasm()]).then(([m, wasmBinary]) => (m.default as unknown as (config: { wasmBinary: ArrayBuffer }) => Promise<SqlJsStatic>)({ wasmBinary }))
    sqlJs = attempt
    attempt.catch(() => {
      if (sqlJs === attempt) sqlJs = null
    })
  }
  return sqlJs
}
