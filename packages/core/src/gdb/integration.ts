// Spec 013 (experimental): what the open path needs from the geodatabase reader, kept out of openFile.ts.
// When the SQL engine reads .gdb natively this file, the rest of this folder and the shells' readers are deleted
// (specs/013-file-geodatabase/removal.md).
import type { AsyncDuckDB } from '@duckdb/duckdb-wasm'
import type { FileSource, HostAdapter, OpenedFileRef } from '../hostAdapter.js'
import type { OpenHooks } from '../openFile.js'
import { QueryCancelledError } from '../query/util.js'
import type { QuerySession } from '../query/session.js'
import { registerSource } from '../source/register.js'
import type { FileSqlNames } from '../sql/names.js'
import { convertedViewSql, openGeodatabaseLayer, placeholderViewSql, type GdbOpened } from './open.js'
import { GdbError, type GdbLayerInfo, type GdbProgress } from './types.js'

/** Spec 013: the shell's reader lists the geodatabase and converts the layer to open. */
export async function openGdb(ref: OpenedFileRef, deps: { hostAdapter: HostAdapter }, hooks: OpenHooks, options: { layer?: string }, signal: AbortSignal): Promise<GdbOpened> {
  hooks.onPhase?.('converting', { note: 'Reading the geodatabase…' })
  try {
    return await openGeodatabaseLayer(ref, deps.hostAdapter.gdb, {
      layer: options.layer,
      signal,
      onProgress: (step) => hooks.onPhase?.('converting', { note: gdbNote(step) }),
      chooseCrs: hooks.chooseCrs,
    })
  } catch (err) {
    if (signal.aborted || (err instanceof GdbError && err.code === 'cancelled')) throw new QueryCancelledError()
    throw err
  }
}

/** The converted layer again, as bytes (FlatGeobuf "load for queries", and re-registering after an out-of-memory). */
export async function gdbWhole(ref: OpenedFileRef, deps: { hostAdapter: HostAdapter }, layer: GdbLayerInfo, assumeCrs?: number): Promise<FileSource> {
  const host = deps.hostAdapter.gdb
  if (!host) throw new GdbError('The geodatabase reader is not available.', 'unreadable')
  return (await host.convert(ref, layer, { whole: true, ...(assumeCrs !== undefined ? { assumeCrs } : {}) })).source
}

const mb = (n: number): string => (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)
function gdbNote(step: GdbProgress): string {
  switch (step.phase) {
    case 'download':
      return `Downloading the geodatabase reader (first use only)… ${mb(step.loaded)} of ${mb(step.total)} MB`
    case 'list':
      return 'Reading the geodatabase…'
    case 'copy':
      return `Reading layer ${step.layer}…`
    case 'convert':
      return `Converting layer ${step.layer}…`
    case 'cache':
      return `Saving layer ${step.layer}…`
  }
}

/**
 * Spec 013 FR-004: every other layer is a view in the geodatabase's schema with
 * its columns and no rows; the first statement that names one converts it,
 * registers its FlatGeobuf and replaces the view (QuerySession's lazy layers).
 */
export async function setUpGeodatabaseLayers(session: QuerySession, db: AsyncDuckDB, gdb: GdbOpened, names: FileSqlNames, ref: OpenedFileRef, deps: { hostAdapter: HostAdapter }, hooks: OpenHooks): Promise<void> {
  const lazy = new Map<string, string>()
  for (const l of gdb.catalog.layers) {
    const sqlName = names.layers.get(l.name)
    if (l.name === gdb.active.name || !sqlName) continue
    await session.conn.query(placeholderViewSql(sqlName, l))
    lazy.set(l.name, sqlName)
  }
  session.setLazyLayers({
    names: lazy,
    async load(layerName, signal) {
      const info = gdb.catalog.layers.find((l) => l.name === layerName)
      const sqlName = lazy.get(layerName)
      const host = deps.hostAdapter.gdb
      if (!info || !sqlName || !host) throw new GdbError(`The layer "${layerName}" could not be found in the geodatabase.`, 'unreadable')
      const converted = await host.convert(ref, info, { signal, onProgress: (step) => hooks.onPhase?.('converting', { note: gdbNote(step) }) })
      const registered = await registerSource(db, converted.source)
      session.adoptPaths(registered.paths)
      await session.conn.query(convertedViewSql(sqlName, registered.primaryPath, info.spatial))
    },
  })
}
