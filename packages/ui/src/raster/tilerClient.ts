// Spec 026: the page's side of the raster worker (tilerWorker.ts): one worker per page, requests answered by id. The wasm files
// are downloaded and hash-checked here (core: constitution IV and v1.2.0) and handed to the worker as bytes; the converter's
// wasm only when a striped file is opened. The worker's code is imported lazily (and built inline as a blob worker), so a page
// that never opens a raster loads none of it.
import { RasterOpenError, loadConverterBytes, loadRasterEngineBytes, type EngineSource, type RasterRenderOptions } from '@spatial-explorer/core'
import type { CogInput, ColormapTable, ConvertedCog, FromWorker, OpenedCog, PointAnswer, StatisticsAnswer, StripedInfo, ToWorker } from './tilerProtocol.js'

type Pending = { resolve(value: unknown): void; reject(error: Error): void; onNote?: (text: string) => void }

export class TilerClient {
  readonly #worker: Worker
  readonly #pending = new Map<number, Pending>()
  #next = 1
  #handles = 0
  #converter: Promise<void> | null = null
  /** The colormaps sampled by the tiler (for previews and the color bar), set when the worker is up. */
  colormaps: ColormapTable = {}

  constructor(worker: Worker) {
    this.#worker = worker
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data
      const p = this.#pending.get(m.id)
      if (!p) return
      if (m.kind === 'note') p.onNote?.(m.text)
      else {
        this.#pending.delete(m.id)
        if (m.kind === 'ok') p.resolve(m.result)
        else p.reject(m.code ? new RasterOpenError(m.code as ConstructorParameters<typeof RasterOpenError>[0], m.message) : new Error(m.message))
      }
    }
    worker.onerror = (event) => this.#failAll(new Error(`The raster reader stopped: ${event.message || 'unknown error'}`))
  }

  #failAll(error: Error): void {
    for (const p of this.#pending.values()) p.reject(error)
    this.#pending.clear()
  }

  call<T>(message: DistributiveOmit<ToWorker, 'id'>, onNote?: (text: string) => void): Promise<T> {
    const id = this.#next++
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onNote })
      this.#worker.postMessage({ ...message, id })
    })
  }

  async init(whitebox: ArrayBuffer, cogTiler: ArrayBuffer): Promise<void> {
    this.colormaps = await this.call<ColormapTable>({ type: 'init', whitebox, cogTiler })
  }

  open(source: CogInput): Promise<OpenedCog> {
    return this.call<OpenedCog>({ type: 'open', handle: ++this.#handles, source })
  }

  /** The striped file is read, made into a COG and opened inside the worker: the bytes never cross to the page. */
  async convertAndOpen(source: Exclude<CogInput, Uint8Array>, striped: StripedInfo, engineSource: EngineSource, onNote?: (text: string) => void): Promise<ConvertedCog> {
    if (!this.#converter) {
      const attempt = (async () => {
        onNote?.('Loading the GeoTIFF converter (the first time only)…')
        await this.call<true>({ type: 'initConverter', wasm: await loadConverterBytes(engineSource) })
      })()
      this.#converter = attempt
      attempt.catch(() => {
        if (this.#converter === attempt) this.#converter = null
      })
    }
    await this.#converter
    return this.call<ConvertedCog>({ type: 'convert', handle: ++this.#handles, source, striped }, onNote)
  }

  statistics(handle: number, maxSize: number): Promise<StatisticsAnswer> {
    return this.call<StatisticsAnswer>({ type: 'statistics', handle, maxSize })
  }

  point(handle: number, lon: number, lat: number): Promise<PointAnswer> {
    return this.call<PointAnswer>({ type: 'point', handle, lon, lat })
  }

  /** A PNG tile, made in the worker. */
  tile(handle: number, z: number, x: number, y: number, options: RasterRenderOptions): Promise<Uint8Array> {
    return this.call<Uint8Array>({ type: 'tile', handle, z, x, y, options })
  }

  close(handle: number): void {
    this.call({ type: 'close', handle }).catch(() => {})
  }
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

let client: Promise<TilerClient> | null = null
/** The page's raster worker: started and initialised once (again after a failed attempt, so a lost connection can be retried). */
export function getTilerClient(source: EngineSource = {}): Promise<TilerClient> {
  if (!client) {
    const attempt = (async (): Promise<TilerClient> => {
      const bytes = await loadRasterEngineBytes(source)
      // The worker's code, built inline (a blob worker).
      const { default: TilerWorker } = await import('./tilerWorker.ts?worker&inline')
      const worker = new TilerWorker()
      const c = new TilerClient(worker)
      try {
        await c.init(bytes.whitebox, bytes.cogTiler)
      } catch (error) {
        worker.terminate()
        throw error
      }
      return c
    })()
    client = attempt
    attempt.catch(() => {
      if (client === attempt) client = null
    })
  }
  return client
}

const sampled = new Map<string, string[]>()
let lastColormaps: ColormapTable | null = null

/**
 * The colors of a colormap from low to high as `#rrggbb`, `steps` of them (16 or 32), taken from the tiler itself so a preview,
 * the color bar and the map all show the same thing. Null until the worker is up (a raster is open when this matters).
 */
export function colormapColors(name: string, steps = 16, reversed = false): string[] | null {
  void client
  const table = lastColormaps
  const entry = table?.[name]
  if (!entry) return null
  const key = `${name}/${steps}/${reversed}`
  const hit = sampled.get(key)
  if (hit) return hit
  const base = steps <= 16 ? entry.s16 : entry.s32
  const colors = reversed ? [...base].reverse() : base
  sampled.set(key, colors)
  return colors
}

/** Called once the worker is up: the previews read this table. */
export function rememberColormaps(table: ColormapTable): void {
  lastColormaps = table
  sampled.clear()
}
