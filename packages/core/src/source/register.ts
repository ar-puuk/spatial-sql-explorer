// Registers an opened file (and its sidecars) with the engine under
// /se-source/ (spec 007, contracts/core-data-access.md). Handles and URLs are
// read by the engine in parts and never copied into memory here (research
// §2–§3); only the `bytes` kind holds the whole file.
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import { SOURCE_DIR } from '../duckdbService.js'
import type { FileSource } from '../hostAdapter.js'

/** DuckDBDataProtocol values (duckdb-wasm runtime.d.ts); core avoids a value import of the enum. */
const BROWSER_FILEREADER = 2
const HTTP = 4

export interface RegisteredSource {
  /** `/se-source/<name>` of the primary file. */
  primaryPath: string
  /** Every registered path, primary first. */
  paths: string[]
  /**
   * Drops and registers everything again. Needed after an out-of-memory
   * error, which left a registered handle reading as empty (research §1).
   */
  reRegister(): Promise<void>
  /** Drops every registered path. */
  drop(): Promise<void>
}

/**
 * `refetch` returns the same file again; it is required to re-register a
 * `bytes` source (its buffers were transferred to the engine).
 */
export async function registerSource(db: AsyncDuckDB, source: FileSource, refetch?: () => Promise<FileSource>): Promise<RegisteredSource> {
  const entries: Array<{ path: string; register: () => Promise<void> }> = []
  const add = (name: string, register: (path: string) => Promise<void>): void => {
    const path = `${SOURCE_DIR}${name}`
    entries.push({ path, register: () => register(path) })
  }
  switch (source.kind) {
    case 'handle':
      add(source.name, (p) => db.registerFileHandle(p, source.handle, BROWSER_FILEREADER, true))
      for (const s of source.sidecars) add(s.name, (p) => db.registerFileHandle(p, s.handle, BROWSER_FILEREADER, true))
      break
    case 'url':
      add(source.name, (p) => db.registerFileURL(p, source.url, HTTP, false))
      for (const s of source.sidecars) add(s.name, (p) => db.registerFileURL(p, s.url, HTTP, false))
      break
    case 'bytes':
      // registerFileBuffer transfers (detaches) the buffer: re-registering
      // fetches the bytes again (`refetch`) rather than keeping a second copy.
      add(source.name, (p) => db.registerFileBuffer(p, source.bytes))
      for (const s of source.sidecars) add(s.name, (p) => db.registerFileBuffer(p, s.bytes))
      break
  }
  const drop = async (): Promise<void> => {
    for (const e of entries) await db.dropFile(e.path).catch(() => {})
  }
  for (const e of entries) await e.register()
  return {
    primaryPath: entries[0].path,
    paths: entries.map((e) => e.path),
    async reRegister() {
      await drop()
      if (source.kind !== 'bytes') {
        for (const e of entries) await e.register()
        return
      }
      if (!refetch) throw new Error('Reopen the file to continue.')
      const again = await refetch()
      const next = await registerSource(db, again, refetch)
      entries.splice(0, entries.length, ...next.paths.map((path) => ({ path, register: async () => {} })))
    },
    drop,
  }
}
