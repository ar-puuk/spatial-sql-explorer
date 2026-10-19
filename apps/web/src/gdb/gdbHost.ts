// Spec 013: the web app's File Geodatabase reader. The picked folder (or zip)
// is read by gdal3.js in a worker (gdbWorker.ts); each converted layer is a
// FlatGeobuf kept in the origin-private file system, keyed by the geodatabase's
// files and their modification times, so opening it again is immediate.
import {
  convertedName,
  gdalFileRefs,
  gdbFolderOf,
  GdbError,
  layerDomains,
  listZipNames,
  loadGdalFile,
  type EngineSource,
  type FileSource,
  type GdbCallOptions,
  type GdbCatalog,
  type GdbConverted,
  type GdbHost,
  type GdbLayerInfo,
  type GdbProgress,
  type OpenedFileRef,
} from '@spatial-explorer/core'
import { CACHE_DIR, type ConvertResult, type FromWorker, type GdbFiles, type ToWorker } from './protocol.js'

/** The converted layers may use this much of the origin's storage; the least recently used geodatabases go first. */
const CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024
const IDLE_MS = 30_000

/** The picked files of a geodatabase: a folder's files or one zip. Null when these files are neither. */
export async function geodatabaseFiles(files: readonly File[]): Promise<GdbFiles | null> {
  const folder = files.find((f) => /^[^/]+\.gdb\//i.test(f.webkitRelativePath))
  if (folder) {
    const name = folder.webkitRelativePath.split('/')[0]
    const inside = files.filter((f) => f.webkitRelativePath.startsWith(`${name}/`) && f.webkitRelativePath.split('/').length === 2)
    return inside.length ? { kind: 'folder', files: inside, zipFolder: null, name } : null
  }
  const zip = files.length === 1 && /\.zip$/i.test(files[0].name) ? files[0] : null
  if (!zip) return null
  let names: string[]
  try {
    names = await listZipNames(zip.size, async (offset, length) => new Uint8Array(await zip.slice(offset, offset + length).arrayBuffer()))
  } catch {
    return null
  }
  const inner = gdbFolderOf(names)
  if (inner === null && !names.some((n) => /(^|\/)a[0-9a-f]{8}\.gdbtable$/i.test(n))) return null
  return { kind: 'zip', files: [zip], zipFolder: inner, name: zip.name.replace(/\.zip$/i, '') }
}

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24)
}

const keyOf = (source: GdbFiles): Promise<string> => digest(`${source.name}|${source.files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).sort().join(',')}`)

async function cacheRoot(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await (await navigator.storage.getDirectory()).getDirectoryHandle(CACHE_DIR, { create })
  } catch {
    return null
  }
}

async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    return await (await (await dir.getFileHandle(name)).getFile()).text()
  } catch {
    return null
  }
}

export function createWebGdbHost(options: { engine: Pick<EngineSource, 'host'>; getFiles: (ref: OpenedFileRef) => Promise<GdbFiles | null> }): GdbHost {
  const mirror = (import.meta.env.VITE_ENGINE_MIRROR as string | undefined) || undefined
  let worker: Worker | null = null
  let ready: Promise<Worker> | null = null
  let nextId = 1
  let idle: ReturnType<typeof setTimeout> | null = null
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (p: GdbProgress) => void }>()
  const catalogs = new Map<string, GdbCatalog>()
  /** Converted layers held in memory where the browser has no origin-private storage (keyed `<key>/<file>`). */
  const inMemory = new Map<string, File>()
  /** One command at a time: a worker runs one GDAL call at a time anyway. */
  let queue: Promise<unknown> = Promise.resolve()

  const stop = (): void => {
    if (idle) clearTimeout(idle)
    idle = null
    worker?.terminate()
    worker = null
    ready = null
  }

  const post = <T>(w: Worker, message: ToWorker, progress?: (p: GdbProgress) => void, transfer: Transferable[] = []): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pending.set(message.id, { resolve: resolve as (v: unknown) => void, reject, progress })
      w.postMessage(message, transfer)
    })

  const start = async (onProgress?: (p: GdbProgress) => void): Promise<Worker> => {
    if (idle) clearTimeout(idle)
    idle = null
    if (worker && ready) return ready
    const source: EngineSource = { mirror, host: options.engine.host }
    const files: Record<string, ArrayBuffer> = {}
    try {
      for (const ref of gdalFileRefs('web')) {
        onProgress?.({ phase: 'download', file: ref.name, loaded: 0, total: ref.bytes })
        files[ref.file] = await loadGdalFile(ref.file, source)
      }
    } catch (err) {
      throw new GdbError(`The geodatabase reader could not be loaded: ${err instanceof Error ? err.message : String(err)}`, 'offline')
    }
    const w = new Worker(new URL('./gdbWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data
      const p = pending.get(m.id)
      if (!p) return
      if ('progress' in m) return p.progress?.(m.progress)
      pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new GdbError(m.message, m.code as GdbError['code']))
    }
    w.onerror = (event) => {
      const error = new GdbError(`The geodatabase reader stopped: ${event.message || 'unknown error'}`, 'unreadable')
      for (const [id, p] of pending) {
        pending.delete(id)
        p.reject(error)
      }
      stop()
    }
    worker = w
    const glue = new TextDecoder().decode(files['gdal3.js'])
    ready = post<void>(w, { op: 'init', id: nextId++, glue, wasm: files['gdal3WebAssembly.wasm'], data: files['gdal3WebAssembly.data'] }, undefined, [files['gdal3WebAssembly.wasm'], files['gdal3WebAssembly.data']]).then(() => w)
    try {
      return await ready
    } catch (err) {
      stop()
      throw err
    }
  }

  const run = <T>(message: (id: number) => ToWorker, callOptions: GdbCallOptions): Promise<T> => {
    const task = async (): Promise<T> => {
      if (callOptions.signal?.aborted) throw new GdbError('Cancelled.', 'cancelled')
      const w = await start(callOptions.onProgress)
      const id = nextId++
      const done = post<T>(w, message(id), callOptions.onProgress)
      const onAbort = (): void => {
        // GDAL cannot be interrupted inside the wasm: stop the worker; the next call starts a new one.
        pending.get(id)?.reject(new GdbError('Cancelled.', 'cancelled'))
        pending.delete(id)
        stop()
      }
      callOptions.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        return await done
      } finally {
        callOptions.signal?.removeEventListener('abort', onAbort)
        if (worker) idle = setTimeout(stop, IDLE_MS)
      }
    }
    const next = queue.then(task, task)
    queue = next.catch(() => {})
    return next
  }

  const filesOf = async (ref: OpenedFileRef): Promise<GdbFiles> => {
    const source = await options.getFiles(ref)
    if (!source) throw new GdbError('These files are not a File Geodatabase. Pick the folder that ends in .gdb (or a .gdb.zip).', 'unreadable')
    return source
  }

  const prune = async (keep: string): Promise<void> => {
    const root = await cacheRoot(false)
    if (!root) return
    const dirs: Array<{ name: string; bytes: number; used: number }> = []
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory') continue
      let bytes = 0
      let used = 0
      for await (const [, entry] of (handle as FileSystemDirectoryHandle).entries()) {
        if (entry.kind !== 'file') continue
        const file = await (entry as FileSystemFileHandle).getFile()
        bytes += file.size
        used = Math.max(used, file.lastModified)
      }
      dirs.push({ name, bytes, used })
    }
    let total = dirs.reduce((sum, d) => sum + d.bytes, 0)
    for (const d of dirs.sort((a, b) => a.used - b.used)) {
      if (total <= CACHE_LIMIT_BYTES) break
      if (d.name === keep) continue
      await root.removeEntry(d.name, { recursive: true }).catch(() => {})
      total -= d.bytes
    }
  }

  /** The converted layers kept in the origin-private file system (the catalogs are not counted). */
  const measure = async (): Promise<{ files: number; bytes: number }> => {
    const root = await cacheRoot(false)
    let files = 0
    let bytes = 0
    if (root) {
      for await (const [, handle] of root.entries()) {
        if (handle.kind !== 'directory') continue
        for await (const [name, entry] of (handle as FileSystemDirectoryHandle).entries()) {
          if (entry.kind !== 'file' || !name.endsWith('.fgb')) continue
          files++
          bytes += (await (entry as FileSystemFileHandle).getFile()).size
        }
      }
    }
    for (const f of inMemory.values()) {
      files++
      bytes += f.size
    }
    return { files, bytes }
  }

  return {
    async list(ref: OpenedFileRef, callOptions: GdbCallOptions = {}): Promise<GdbCatalog> {
      const source = await filesOf(ref)
      const key = await keyOf(source)
      const known = catalogs.get(key)
      if (known) return known
      const dir = await cacheRoot(false).then((root) => root?.getDirectoryHandle(key).catch(() => null) ?? null)
      const saved = dir ? await readText(dir, 'catalog.json') : null
      if (saved) {
        try {
          const catalog = JSON.parse(saved) as GdbCatalog
          catalogs.set(key, catalog)
          return catalog
        } catch {
          // Unreadable: read the geodatabase again.
        }
      }
      const catalog = await run<GdbCatalog>((id) => ({ op: 'list', id, source, key }), callOptions)
      catalogs.set(key, catalog)
      return catalog
    },

    async convert(ref: OpenedFileRef, layer: GdbLayerInfo, callOptions: GdbCallOptions = {}): Promise<GdbConverted> {
      const source = await filesOf(ref)
      const key = await keyOf(source)
      const catalog = catalogs.get(key) ?? (await this.list(ref, callOptions))
      const file = `${convertedName(layer.name, callOptions.assumeCrs)}.fgb`
      const memoryKey = `${key}/${file}`
      let dir = await cacheRoot(false).then((root) => root?.getDirectoryHandle(key).catch(() => null) ?? null)
      let handle: File | undefined = inMemory.get(memoryKey)
      const cached = handle !== undefined || (dir !== null && (await readText(dir, `${file}.done`)) !== null)
      if (!cached) {
        let result: ConvertResult
        try {
          result = await run<ConvertResult>((id) => ({ op: 'convert', id, source, key, layer: { name: layer.name, spatial: layer.spatial }, assumeCrs: callOptions.assumeCrs, file }), callOptions)
        } catch (err) {
          if (err instanceof DOMException && err.name === 'QuotaExceededError') throw new GdbError('The browser has no room to keep the converted layer. Clear the stored layers (the button in the header) or free some disk space.', 'too-large')
          throw err
        }
        if (result.bytes) {
          // No origin-private storage here (a Firefox private window, blocked site data): kept in memory until the tab closes.
          handle = new File([result.bytes], file)
          inMemory.set(memoryKey, handle)
        } else {
          dir = await cacheRoot(false).then((root) => root?.getDirectoryHandle(key) ?? null)
          void prune(key)
          void navigator.storage?.persist?.().catch(() => false)
        }
      }
      if (!handle) {
        if (!dir) throw new GdbError('The converted layer could not be found in the browser storage.', 'unreadable')
        handle = await (await dir.getFileHandle(file)).getFile()
      }
      const domains = layerDomains(layer, catalog.domains)
      const sourceFile: FileSource = callOptions.whole
        ? { kind: 'bytes', name: file, size: handle.size, bytes: new Uint8Array(await handle.arrayBuffer()), sidecars: [], styleSidecar: null }
        : { kind: 'handle', name: file, size: handle.size, handle, sidecars: [], styleSidecar: null }
      return { source: sourceFile, domains }
    },

    /** Spec 024: GDAL's GTFS geometry layers, from the feed's light zip. Nothing is cached (about a second of work). */
    async convertFeed(zip: Uint8Array, layers: readonly string[], callOptions: GdbCallOptions = {}): Promise<Record<string, Uint8Array>> {
      const copy = zip.slice().buffer as ArrayBuffer
      const result = await run<Record<string, ArrayBuffer>>((id) => ({ op: 'feed', id, zip: copy, layers: [...layers] }), callOptions)
      return Object.fromEntries(Object.entries(result).map(([name, buffer]) => [name, new Uint8Array(buffer)]))
    },

    async cacheInfo(): Promise<{ files: number; bytes: number }> {
      return measure()
    },

    async clearCache(): Promise<{ files: number; bytes: number }> {
      stop()
      catalogs.clear()
      const { files, bytes } = await measure()
      inMemory.clear()
      try {
        await (await navigator.storage.getDirectory()).removeEntry(CACHE_DIR, { recursive: true })
      } catch {
        // Nothing cached.
      }
      return { files, bytes }
    },
  }
}
