/// <reference lib="webworker" />
// Spec 013: reads File Geodatabases in the browser with gdal3.js (GDAL in
// WebAssembly), in a worker of our own (gdal3.js's own worker mode has no way
// to mount a folder). The picked files are mounted read-only (WORKERFS, no
// copy); a layer's table files are copied into memory before converting it,
// because reading them straight from the picked files is 25 times slower
// (research §9). The result is written to the origin-private file system.
import { convertedName, convertLayer, explainGdalError, GdbError, openGeodatabase, readCatalog, tableFiles, type GdalApi } from '@spatial-explorer/core'
import { CACHE_DIR, type ConvertResult, type FromWorker, type GdbFiles, type ToWorker } from './protocol.js'

interface Stream {
  readonly _brand: 'stream'
}
interface Fs {
  mkdir(path: string): void
  rmdir(path: string): void
  mount(type: unknown, opts: { files: File[] }, mountpoint: string): void
  unmount(mountpoint: string): void
  writeFile(path: string, data: Uint8Array): void
  readFile(path: string, opts: { encoding: 'utf8' }): string
  readFile(path: string, opts: { encoding: 'binary' }): Uint8Array
  readdir(path: string): string[]
  unlink(path: string): void
  stat(path: string): { size: number }
  open(path: string, flags: string): Stream
  read(stream: Stream, buffer: Uint8Array, offset: number, length: number, position: number): number
  close(stream: Stream): void
}
interface Gdal extends GdalApi {
  Module: { FS: Fs; WORKERFS: unknown }
  close(dataset: unknown): Promise<void>
}

/** Table files under this size are copied with the layer's own (the catalog, indexes, small tables). */
const COPY_SMALL_BYTES = 2 * 1024 * 1024
const CHUNK = 8 * 1024 * 1024

let gdal: Gdal | null = null
const recent: string[] = []
let mounts = 0

function reply(message: FromWorker, transfer: Transferable[] = []): void {
  postMessage(message, transfer)
}

/** Loads gdal3.js from the bytes the app verified (hash-checked), without any network request of its own. */
async function init(glue: string, wasm: ArrayBuffer, data: ArrayBuffer): Promise<void> {
  if (gdal) return
  const url = URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }))
  const g = globalThis as unknown as Record<string, unknown>
  const fetch0 = globalThis.fetch
  const Xhr0 = globalThis.XMLHttpRequest
  try {
    await import(/* @vite-ignore */ url)
    // gdal3.js's own worker mode answers messages sent to this worker: not wanted here.
    self.onmessage = null
    const initGdalJs = g.initGdalJs as (config: unknown) => Promise<Gdal>
    // Its loader fetches the wasm and the data by URL; both are served from memory instead.
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (target.endsWith('/gdal3WebAssembly.wasm')) return Promise.resolve(new Response(wasm, { headers: { 'Content-Type': 'application/wasm' } }))
      return fetch0(input, init)
    }) as typeof fetch
    class MemoryXhr {
      status = 0
      response: ArrayBuffer | null = null
      responseType = ''
      onload: ((e: unknown) => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      onprogress: ((e: unknown) => void) | null = null
      private target = ''
      open(_method: string, target: string): void {
        this.target = target
      }
      send(): void {
        queueMicrotask(() => {
          if (!this.target.endsWith('/gdal3WebAssembly.data')) return void this.onerror?.({})
          this.status = 200
          this.response = data
          this.onprogress?.({ loaded: data.byteLength, total: data.byteLength, lengthComputable: true })
          this.onload?.({})
        })
      }
    }
    globalThis.XMLHttpRequest = MemoryXhr as unknown as typeof XMLHttpRequest
    gdal = await initGdalJs({
      path: '/__gdal',
      useWorker: false,
      logHandler: () => {},
      errorHandler: (line: string) => {
        recent.push(line)
        if (recent.length > 20) recent.shift()
      },
    })
  } finally {
    globalThis.fetch = fetch0
    globalThis.XMLHttpRequest = Xhr0
    URL.revokeObjectURL(url)
  }
}

function need(): Gdal {
  if (!gdal) throw new GdbError('The geodatabase reader is not loaded.', 'unreadable')
  return gdal
}

/** Mounts the picked files where gdal3.js can open them; `release` undoes it. */
function mountSource(g: Gdal, source: GdbFiles): { open: string; vfs: string[]; release: () => void } {
  const FS = g.Module.FS
  const point = source.kind === 'folder' ? `/input/m${++mounts}.gdb` : `/input/m${++mounts}`
  FS.mkdir(point)
  FS.mount(g.Module.WORKERFS, { files: source.files }, point)
  const release = (): void => {
    try {
      FS.unmount(point)
      FS.rmdir(point)
    } catch {
      // Already gone.
    }
  }
  if (source.kind === 'folder') return { open: point, vfs: [], release }
  return { open: `${point}/${source.files[0].name}${source.zipFolder ? `/${source.zipFolder}` : ''}`, vfs: ['vsizip'], release }
}

async function openMounted(g: Gdal, mounted: { open: string; vfs: string[] }, options: string[] = []): Promise<unknown> {
  if (!mounted.vfs.length) return openGeodatabase(g, mounted.open, options)
  const opened = await g.open(mounted.open, options, mounted.vfs)
  if (!opened.datasets.length) throw explainGdalError(recent.join(' '))
  return opened.datasets[0]
}

/** The folder for this geodatabase's converted layers, or null where the browser has no origin-private storage (Firefox private windows, blocked site data). */
async function cacheDir(key: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    return await (await root.getDirectoryHandle(CACHE_DIR, { create: true })).getDirectoryHandle(key, { create: true })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') throw err
    return null
  }
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, write: (handle: FileSystemSyncAccessHandle) => void | Promise<void>): Promise<void> {
  const handle = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle()
  try {
    handle.truncate(0)
    await write(handle)
    handle.flush()
  } finally {
    handle.close()
  }
}

async function list(id: number, source: GdbFiles, key: string): Promise<unknown> {
  const g = need()
  reply({ id, progress: { phase: 'list' } })
  const mounted = mountSource(g, source)
  try {
    const dataset = await openMounted(g, mounted)
    try {
      const catalog = await readCatalog(g, dataset, source.name)
      const dir = await cacheDir(key)
      if (dir) {
        const bytes = new TextEncoder().encode(JSON.stringify(catalog))
        await writeFile(dir, 'catalog.json', (h) => void h.write(bytes, { at: 0 }))
      }
      return catalog
    } finally {
      await g.close(dataset).catch(() => {})
    }
  } finally {
    mounted.release()
  }
}

/** Removes a folder of in-memory files. */
function removeTree(FS: Fs, dir: string): void {
  for (const name of FS.readdir(dir)) if (name !== '.' && name !== '..') FS.unlink(`${dir}/${name}`)
  FS.rmdir(dir)
}

async function convert(id: number, source: GdbFiles, key: string, layer: { name: string; spatial: boolean }, assumeCrs: number | undefined, file: string): Promise<ConvertResult> {
  const g = need()
  const FS = g.Module.FS
  const mounted = mountSource(g, source)
  let copy: string | null = null
  try {
    let open = mounted
    if (source.kind === 'folder') {
      // Which table files hold this layer: the catalog table's row id is the file number.
      reply({ id, progress: { phase: 'copy', layer: layer.name } })
      const all = await openGeodatabase(g, mounted.open, ['LIST_ALL_TABLES=YES'])
      let fileId: string | undefined
      try {
        fileId = (await tableFiles(g, all, async (p) => FS.readFile(p, { encoding: 'utf8' }))).get(layer.name)
      } finally {
        await g.close(all).catch(() => {})
      }
      if (!fileId) throw new GdbError(`The layer "${layer.name}" was not found in the geodatabase.`, 'unreadable')
      copy = `/output/c${++mounts}.gdb`
      FS.mkdir(copy)
      for (const f of source.files) {
        if (!f.name.startsWith(`${fileId}.`) && f.size > COPY_SMALL_BYTES) continue
        FS.writeFile(`${copy}/${f.name}`, new Uint8Array(await f.arrayBuffer()))
      }
      open = { open: copy, vfs: [], release: () => {} }
    }
    reply({ id, progress: { phase: 'convert', layer: layer.name } })
    const dataset = await openMounted(g, open)
    let out: string
    try {
      out = await convertLayer(g, dataset, layer, convertedName(layer.name, assumeCrs), assumeCrs)
    } finally {
      await g.close(dataset).catch(() => {})
    }
    reply({ id, progress: { phase: 'cache', layer: layer.name } })
    const dir = await cacheDir(key)
    const size = FS.stat(out).size
    if (!dir) {
      // No storage to keep it in: the app holds the layer in memory for this session.
      const bytes = FS.readFile(out, { encoding: 'binary' })
      FS.unlink(out)
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      return { file, bytes: buffer }
    }
    const stream = FS.open(out, 'r')
    try {
      await writeFile(dir, file, (handle) => {
        const buffer = new Uint8Array(Math.min(CHUNK, Math.max(size, 1)))
        for (let at = 0; at < size; ) {
          const n = FS.read(stream, buffer, 0, Math.min(CHUNK, size - at), at)
          if (n <= 0) break
          handle.write(buffer.subarray(0, n), { at })
          at += n
        }
      })
    } finally {
      FS.close(stream)
      FS.unlink(out)
    }
    // A layer is usable once this marker exists (a half-written file never is).
    await writeFile(dir, `${file}.done`, (h) => void h.write(new TextEncoder().encode(String(size)), { at: 0 }))
    return { file }
  } finally {
    if (copy) removeTree(FS, copy)
    mounted.release()
  }
}

/** Spec 024: a GTFS feed's light zip (gtfs/feed.ts) opened in memory, each wanted layer converted to a FlatGeobuf and returned. */
async function feed(id: number, zip: ArrayBuffer, layers: string[]): Promise<Record<string, ArrayBuffer>> {
  const g = need()
  const FS = g.Module.FS
  const path = `/input/feed${++mounts}.zip`
  FS.writeFile(path, new Uint8Array(zip))
  const out: Record<string, ArrayBuffer> = {}
  try {
    const dataset = await openGeodatabase(g, path)
    try {
      for (const layer of layers) {
        reply({ id, progress: { phase: 'convert', layer } })
        const file = (await g.ogr2ogr(dataset, ['-f', 'FlatGeobuf', '-nln', layer, layer], `feed${mounts}-${layer}`)).local
        const bytes = FS.readFile(file, { encoding: 'binary' })
        FS.unlink(file)
        out[layer] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      }
    } finally {
      await g.close(dataset).catch(() => {})
    }
  } finally {
    FS.unlink(path)
  }
  return out
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const m = event.data
  const run = async (): Promise<unknown> => {
    if (m.op === 'init') return init(m.glue, m.wasm, m.data)
    recent.length = 0
    if (m.op === 'feed') return feed(m.id, m.zip, m.layers)
    if (m.op === 'list') return list(m.id, m.source, m.key)
    return convert(m.id, m.source, m.key, m.layer, m.assumeCrs, m.file)
  }
  run().then(
    (result) => {
      const bytes = (result as Partial<ConvertResult> | undefined)?.bytes
      const layers = m.op === 'feed' ? Object.values(result as Record<string, ArrayBuffer>) : []
      reply({ id: m.id, ok: true, result }, bytes ? [bytes] : layers)
    },
    (err: unknown) => {
      const e = explainGdalError(recent.length && !(err instanceof GdbError) ? new Error(`${err instanceof Error ? err.message : String(err)} ${recent.join(' ')}`) : err)
      reply({ id: m.id, ok: false, message: e.message, code: e.code })
    }
  )
})
