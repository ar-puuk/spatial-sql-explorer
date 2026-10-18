// Spec 013: the extension host's File Geodatabase reader. It keeps a child
// process running gdal3.js (gdbWorker.ts), turns a layer into a cached
// FlatGeobuf (global storage, keyed by the geodatabase's files and their
// modification times), and hands the cache path to the webview's loopback server.
import { createHash } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { fork, type ChildProcess } from 'child_process'
import { gdalFileRefs } from '../../../packages/core/src/engineAssets'
import { cacheFileName } from '../../../packages/core/src/gdb/gdalReader'
import { layerDomains } from '../../../packages/core/src/gdb/catalog'
import { gdbFolderOf, listZipNames } from '../../../packages/core/src/source/zip'
import { GdbError, type ColumnDomains, type GdbCatalog, type GdbLayerInfo, type GdbProgress } from '../../../packages/core/src/gdb/types'
import type { GdbSourceSpec, WorkerReply, WorkerRequest } from './gdbWorker'

/** How long an idle reader process (about 300 MB once gdal3.js has loaded) is kept. */
const IDLE_MS = 60_000
export const DEFAULT_CACHE_LIMIT_MB = 2048

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export interface GdbSource {
  /** The `.gdb` folder, or the `.gdb.zip` / `.zip` file. */
  fsPath: string
  zip: boolean
}

export interface ConvertedLayer {
  path: string
  size: number
  domains: ColumnDomains
}

/** The `x.gdb` folder inside a zip, or null when the geodatabase's files are at the zip's top level (the zip's table of contents is read, not the zip). */
export async function gdbFolderInZip(file: string): Promise<string | null> {
  const fd = fs.openSync(file, 'r')
  try {
    const names = await listZipNames(fs.fstatSync(fd).size, async (offset, length) => {
      const buffer = Buffer.alloc(length)
      fs.readSync(fd, buffer, 0, length, offset)
      return new Uint8Array(buffer.buffer, buffer.byteOffset, length)
    })
    return gdbFolderOf(names)
  } finally {
    fs.closeSync(fd)
  }
}

/** What identifies the geodatabase's current contents: its files' names, sizes and modification times. */
export function sourceKey(source: GdbSource): string {
  const hash = createHash('sha1').update(source.fsPath)
  if (source.zip) {
    const st = fs.statSync(source.fsPath)
    hash.update(`|${st.size}|${st.mtimeMs}`)
  } else {
    for (const name of fs.readdirSync(source.fsPath).sort()) {
      const st = fs.statSync(path.join(source.fsPath, name))
      if (st.isFile()) hash.update(`|${name}:${st.size}:${st.mtimeMs}`)
    }
  }
  return hash.digest('hex').slice(0, 24)
}

export class GdbNodeReader {
  private worker: ChildProcess | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (p: GdbProgress) => void }>()
  private idle: ReturnType<typeof setTimeout> | null = null
  /** One command at a time: a worker runs one GDAL call at a time anyway. */
  private queue: Promise<unknown> = Promise.resolve()
  private assets: Promise<{ glue: string; dir: string; wasm: string; data: string }> | null = null

  constructor(
    private readonly cacheRoot: string,
    /** Downloads (once) and returns the local path of a verified engine file. */
    private readonly ensureFile: (file: { name: string; url: string; sha256: string; bytes: number }) => Promise<{ fsPath: string; fresh: boolean }>,
    private readonly cacheLimitBytes: () => number,
    private readonly log: (line: string) => void
  ) {}

  private cacheDir(key: string): string {
    return path.join(this.cacheRoot, key)
  }

  private async loadAssets(onProgress?: (p: GdbProgress) => void): Promise<{ glue: string; dir: string; wasm: string; data: string }> {
    this.assets ??= (async () => {
      const found: Record<string, string> = {}
      for (const ref of gdalFileRefs('node')) {
        onProgress?.({ phase: 'download', file: ref.name, loaded: 0, total: ref.bytes })
        found[ref.file] = (await this.ensureFile(ref)).fsPath
      }
      const wasm = found['gdal3WebAssembly.wasm']
      const data = found['gdal3WebAssembly.data']
      return { glue: found['gdal3.node.js'], dir: path.dirname(wasm), wasm: path.basename(wasm), data: path.basename(data) }
    })()
    try {
      return await this.assets
    } catch (err) {
      this.assets = null
      throw new GdbError(`The geodatabase reader could not be downloaded: ${err instanceof Error ? err.message : String(err)}. The first geodatabase needs an internet connection to cdn.jsdelivr.net; after that it works offline.`, 'offline')
    }
  }

  private async ensureWorker(onProgress?: (p: GdbProgress) => void): Promise<ChildProcess> {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    if (this.worker) return this.worker
    const assets = await this.loadAssets(onProgress)
    const worker = fork(path.join(__dirname, 'gdbWorker.cjs'), [JSON.stringify(assets)], { cwd: assets.dir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, silent: true, execArgv: [] })
    worker.on('message', (m: WorkerReply) => {
      const p = this.pending.get(m.id)
      if (!p) return
      if ('progress' in m) return p.progress?.(m.progress)
      this.pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new GdbError(m.message, m.code))
    })
    const gone = (err: Error): void => {
      if (this.worker === worker) this.worker = null
      for (const [id, p] of this.pending) {
        this.pending.delete(id)
        p.reject(new GdbError(`The geodatabase reader stopped: ${err.message}`, 'unreadable'))
      }
    }
    worker.on('error', gone)
    worker.on('exit', (code, signal) => gone(new Error(signal ? `stopped by ${signal}` : `exit code ${code}`)))
    this.worker = worker
    return worker
  }

  private async call<T>(request: Without<WorkerRequest, 'id'>, options: { signal?: AbortSignal; onProgress?: (p: GdbProgress) => void }): Promise<T> {
    const run = async (): Promise<T> => {
      if (options.signal?.aborted) throw new GdbError('Cancelled.', 'cancelled')
      const worker = await this.ensureWorker(options.onProgress)
      const id = this.nextId++
      const done = new Promise<T>((resolve, reject) => {
        this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress: options.onProgress })
      })
      const onAbort = (): void => {
        // GDAL cannot be interrupted inside the wasm: stop the process, the next call starts a new one.
        const p = this.pending.get(id)
        this.pending.delete(id)
        p?.reject(new GdbError('Cancelled.', 'cancelled'))
        this.worker?.kill()
        this.worker = null
      }
      options.signal?.addEventListener('abort', onAbort, { once: true })
      worker.send({ ...request, id } as WorkerRequest)
      try {
        return await done
      } finally {
        options.signal?.removeEventListener('abort', onAbort)
        if (this.worker) this.idle = setTimeout(() => this.stop(), IDLE_MS)
      }
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => {})
    return next
  }

  stop(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    this.worker?.kill()
    this.worker = null
  }

  private async spec(source: GdbSource): Promise<GdbSourceSpec> {
    return source.zip ? { kind: 'zip', path: source.fsPath, folder: await gdbFolderInZip(source.fsPath) } : { kind: 'folder', path: source.fsPath }
  }

  /** The geodatabase's layers and domains (kept with the cache: the second open needs no reader at all). */
  async list(source: GdbSource, name: string, options: { signal?: AbortSignal; onProgress?: (p: GdbProgress) => void } = {}): Promise<GdbCatalog> {
    const key = sourceKey(source)
    const file = path.join(this.cacheDir(key), 'catalog.json')
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as GdbCatalog
    } catch {
      // Not read yet.
    }
    const catalog = await this.call<GdbCatalog>({ op: 'list', source: await this.spec(source), name }, options)
    fs.mkdirSync(this.cacheDir(key), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(catalog))
    return catalog
  }

  /** The layer as a FlatGeobuf in the cache (converted the first time). */
  async convert(source: GdbSource, catalog: GdbCatalog, layer: GdbLayerInfo, options: { signal?: AbortSignal; onProgress?: (p: GdbProgress) => void } = {}): Promise<ConvertedLayer> {
    const key = sourceKey(source)
    const dir = this.cacheDir(key)
    const file = cacheFileName(layer.name)
    const target = path.join(dir, `${file}.fgb`)
    const domains = layerDomains(layer, catalog.domains)
    if (fs.existsSync(target)) {
      const now = new Date()
      fs.utimesSync(dir, now, now)
      return { path: target, size: fs.statSync(target).size, domains }
    }
    fs.mkdirSync(dir, { recursive: true })
    const partial = `${file}.part`
    fs.rmSync(path.join(dir, `${partial}.fgb`), { force: true })
    this.log(`geodatabase: reading layer ${layer.name} of ${path.basename(source.fsPath)}`)
    const started = Date.now()
    options.onProgress?.({ phase: 'convert', layer: layer.name })
    await this.call<{ path: string }>({ op: 'convert', source: await this.spec(source), layer: { name: layer.name, spatial: layer.spatial }, outDir: dir.replace(/\\/g, '/'), outFile: partial }, options)
    fs.renameSync(path.join(dir, `${partial}.fgb`), target)
    const size = fs.statSync(target).size
    this.log(`geodatabase: ${layer.name}: ${(size / 1024 / 1024).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)} s`)
    this.prune(key)
    return { path: target, size, domains }
  }

  /** Keeps the cache under its limit by removing the least recently used geodatabases (never `keep`). */
  private prune(keep: string): void {
    const limit = this.cacheLimitBytes()
    const dirs = this.entries()
    let total = dirs.reduce((sum, d) => sum + d.bytes, 0)
    for (const d of dirs.sort((a, b) => a.used - b.used)) {
      if (total <= limit) break
      if (d.key === keep) continue
      fs.rmSync(path.join(this.cacheRoot, d.key), { recursive: true, force: true })
      total -= d.bytes
    }
  }

  private entries(): Array<{ key: string; bytes: number; used: number; files: number }> {
    let keys: string[] = []
    try {
      keys = fs.readdirSync(this.cacheRoot)
    } catch {
      return []
    }
    return keys.flatMap((key) => {
      const dir = path.join(this.cacheRoot, key)
      try {
        const files = fs.readdirSync(dir)
        return [{ key, bytes: files.reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0), used: fs.statSync(dir).mtimeMs, files: files.length }]
      } catch {
        return []
      }
    })
  }

  /** Deletes every converted layer. */
  clearCache(): { files: number; bytes: number } {
    const all = this.entries()
    this.stop()
    fs.rmSync(this.cacheRoot, { recursive: true, force: true })
    return { files: all.reduce((sum, d) => sum + d.files, 0), bytes: all.reduce((sum, d) => sum + d.bytes, 0) }
  }
}
