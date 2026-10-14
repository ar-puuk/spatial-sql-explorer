// Spec 010: the engine's vector tiles reach MapLibre through a custom protocol, like PMTiles
// (pmtilesSource.ts). URLs: `se-tiles://<key>/{z}/{x}/{y}`; <key> = `<viewerId>-<dataVersion>-<attrsHash>`,
// so any change of data or carried columns is a new URL and MapLibre re-requests.
import { addProtocol, type AddProtocolAction } from 'maplibre-gl'

/** Builds one tile; empty tiles are a 0-byte array. Retries engine contention itself (the store's closure). */
export type TileProvider = (z: number, x: number, y: number) => Promise<Uint8Array>

const URL_PATTERN = /^se-tiles:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/
/** Tiles kept in memory, by URL: a basemap swap that reloads the data source is served from here (research.md S3). */
const CACHE_ENTRIES = 512

const providers = new Map<string, TileProvider>()
// A Map keeps insertion order: the first key is the least recently used.
const cache = new Map<string, Uint8Array>()
let registered = false
/** The engine is single-threaded: one tile at a time, in request order. */
let queue: Promise<unknown> = Promise.resolve()
const stats = { calls: 0, cacheHits: 0 }
/** The last tile build times, ms (measurements: the median tile time). */
const buildMs: number[] = []

const abortError = (): DOMException => new DOMException('The tile request was aborted.', 'AbortError')
const asBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

function remember(url: string, bytes: Uint8Array): void {
  cache.delete(url)
  cache.set(url, bytes)
  while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string)
}

const handler: AddProtocolAction = async (params, abortController) => {
  const m = URL_PATTERN.exec(params.url)
  if (!m) throw new Error(`Not an engine tile URL: ${params.url}`)
  const [, key, z, x, y] = m
  const hit = cache.get(params.url)
  if (hit) {
    remember(params.url, hit)
    stats.cacheHits++
    return { data: asBuffer(hit) }
  }
  const provider = providers.get(key)
  if (!provider) throw new Error('No tile provider')
  const signal = abortController.signal
  // Run after the tiles already queued; a tile that left the view meanwhile (MapLibre aborts it) is dropped unbuilt.
  const run = queue.then(async () => {
    if (signal.aborted) throw abortError()
    stats.calls++
    const t0 = performance.now()
    const bytes = await provider(Number(z), Number(x), Number(y))
    buildMs.push(Math.round(performance.now() - t0))
    if (buildMs.length > 500) buildMs.shift()
    return bytes
  })
  queue = run.catch(() => {})
  const bytes = await run
  if (providers.get(key) === provider) remember(params.url, bytes)
  return { data: bytes.length ? asBuffer(bytes) : new ArrayBuffer(0) }
}

/** Registers the `se-tiles` protocol once per page. */
export function ensureEngineTilesProtocol(): void {
  if (registered) return
  registered = true
  addProtocol('se-tiles', handler)
}

/** Serves `se-tiles://<key>/…` from `provider` until the returned function unregisters it (and drops its cached tiles). */
export function registerTileProvider(key: string, provider: TileProvider): () => void {
  ensureEngineTilesProtocol()
  providers.set(key, provider)
  return () => {
    if (providers.get(key) === provider) providers.delete(key)
    const prefix = `se-tiles://${key}/`
    for (const url of [...cache.keys()]) if (url.startsWith(prefix)) cache.delete(url)
  }
}

/** Test hook: tiles built by the engine and served from the cache since the page loaded, and the last build times (ms). */
export function engineTileStats(): { calls: number; cacheHits: number; buildMs: number[] } {
  return { ...stats, buildMs: [...buildMs] }
}
