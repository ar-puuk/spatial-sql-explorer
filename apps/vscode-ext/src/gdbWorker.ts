// Spec 013: reads File Geodatabases with gdal3.js (GDAL in WebAssembly) in a
// child process of the extension host. GDAL runs synchronously inside the
// wasm, so on the host's own thread a big layer would freeze every extension;
// here it only blocks this process, which the host can also kill to cancel.
// A process, not a thread: gdal3.js reads its data file relative to the working
// directory, which a thread cannot change, and a layer too big for memory then
// ends this process, not VS Code.
//
// Commands come from gdbReader.ts over IPC; answers (and progress) go back the same way.
import * as fs from 'fs'
import { createRequire } from 'module'
import { convertLayer, explainGdalError, openGeodatabase, readCatalog, type GdalApi } from '../../../packages/core/src/gdb/gdalReader'
import { GdbError } from '../../../packages/core/src/gdb/types'

interface Init {
  /** The gdal3.js Node build (verified, downloaded by the host). */
  glue: string
  /** Where gdal3.js looks for its wasm and data, and the two file names. */
  dir: string
  wasm: string
  data: string
}

export type GdbSourceSpec = { kind: 'folder'; path: string } | { kind: 'zip'; path: string; folder: string | null }

export type WorkerRequest =
  | { id: number; op: 'list'; source: GdbSourceSpec; name: string }
  | { id: number; op: 'convert'; source: GdbSourceSpec; layer: { name: string; spatial: boolean }; assumeCrs?: number; outDir: string; outFile: string }

export type WorkerReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; message: string; code: GdbError['code'] }
  | { id: number; progress: { phase: 'list' } | { phase: 'convert'; layer: string } }

interface Gdal extends GdalApi {
  Module: { FS: { mkdir(p: string): void; mount(type: unknown, opts: { root: string }, mountpoint: string): void; filesystems: { NODEFS: unknown } } }
  close(dataset: unknown): Promise<void>
}

const init = JSON.parse(process.argv[2]) as Init
const send = (message: WorkerReply): void => void process.send?.(message)
const recent: string[] = []
let gdalPromise: Promise<Gdal> | null = null
const mounts = new Map<string, string>()
let mountedOutput: string | null = null

function load(): Promise<Gdal> {
  gdalPromise ??= (async () => {
    const initGdalJs = createRequire(__filename)(init.glue) as (config: unknown) => Promise<Gdal>
    return initGdalJs({
      // The working directory is the engine folder (the host forks this process there): gdal3.js joins this to it.
      path: '.',
      paths: { wasm: init.wasm, data: init.data },
      logHandler: () => {},
      errorHandler: (line: string) => {
        recent.push(line)
        if (recent.length > 20) recent.shift()
      },
    })
  })()
  return gdalPromise
}

/** The path gdal3.js opens for a source, mounting the host's folder into its file system on first use. */
function mountSource(gdal: Gdal, source: GdbSourceSpec): { open: string; vfs: string[] } {
  const FS = gdal.Module.FS
  const NODEFS = FS.filesystems.NODEFS
  const key = source.kind === 'folder' ? source.path : source.path.slice(0, Math.max(source.path.lastIndexOf('/'), source.path.lastIndexOf('\\')))
  let name = mounts.get(key)
  if (!name) {
    name = `m${mounts.size + 1}`
    mounts.set(key, name)
    if (source.kind === 'folder') {
      // OpenFileGDB only recognizes a directory whose name ends in .gdb.
      FS.mkdir(`/input/${name}.gdb`)
      FS.mount(NODEFS, { root: source.path }, `/input/${name}.gdb`)
    } else {
      FS.mkdir(`/input/${name}`)
      FS.mount(NODEFS, { root: key }, `/input/${name}`)
    }
  }
  if (source.kind === 'folder') return { open: `/input/${name}.gdb`, vfs: [] }
  const file = source.path.slice(key.length + 1)
  return { open: `/input/${name}/${file}${source.folder ? `/${source.folder}` : ''}`, vfs: ['vsizip'] }
}

function mountOutput(gdal: Gdal, outDir: string): string {
  // One mount at the cache's parent; gdal3.js writes relative to /output, so `../disk/...` lands there.
  const root = outDir.slice(0, Math.max(outDir.lastIndexOf('/'), outDir.lastIndexOf('\\')))
  if (mountedOutput !== root) {
    if (mountedOutput !== null) throw new Error('the cache folder changed while the reader was running')
    gdal.Module.FS.mkdir('/disk')
    gdal.Module.FS.mount(gdal.Module.FS.filesystems.NODEFS, { root }, '/disk')
    mountedOutput = root
  }
  return outDir.slice(root.length + 1)
}

async function handle(req: WorkerRequest): Promise<unknown> {
  const gdal = await load()
  recent.length = 0
  const mounted = mountSource(gdal, req.source)
  if (req.op === 'list') {
    send({ id: req.id, progress: { phase: 'list' } } satisfies WorkerReply)
    const dataset = await openGeodatabaseVia(gdal, mounted)
    try {
      return await readCatalog(gdal, dataset, req.name)
    } finally {
      await gdal.close(dataset).catch(() => {})
    }
  }
  send({ id: req.id, progress: { phase: 'convert', layer: req.layer.name } } satisfies WorkerReply)
  const sub = mountOutput(gdal, req.outDir)
  const dataset = await openGeodatabaseVia(gdal, mounted)
  try {
    const out = await convertLayer(gdal, dataset, req.layer, `../disk/${sub}/${req.outFile}`, req.assumeCrs)
    // gdal3.js returns its own path (/output/../disk/...): the real file is the outDir's.
    const real = `${req.outDir}/${req.outFile}.fgb`
    if (!fs.existsSync(real)) throw new Error(`the converted layer was not written (${out})`)
    return { path: real }
  } finally {
    await gdal.close(dataset).catch(() => {})
  }
}

async function openGeodatabaseVia(gdal: Gdal, mounted: { open: string; vfs: string[] }): Promise<unknown> {
  // openGeodatabase has no VFS argument: a zip goes through gdal3.js's handler list.
  if (!mounted.vfs.length) return openGeodatabase(gdal, mounted.open)
  const opened = await gdal.open(mounted.open, [], mounted.vfs)
  if (!opened.datasets.length) throw explainGdalError(recent.join(' ') || 'could not open it')
  return opened.datasets[0]
}

process.on('message', (req: WorkerRequest) => {
  handle(req).then(
    (result) => send({ id: req.id, ok: true, result } satisfies WorkerReply),
    (err: unknown) => {
      const e = explainGdalError(recent.length && !(err instanceof GdbError) ? new Error(`${err instanceof Error ? err.message : String(err)} ${recent.join(' ')}`) : err)
      send({ id: req.id, ok: false, message: e.message, code: e.code } satisfies WorkerReply)
    }
  )
})
