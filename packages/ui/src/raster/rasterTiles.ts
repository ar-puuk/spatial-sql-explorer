// Spec 026: the raster's map tiles reach MapLibre through a custom protocol, like the engine's vector tiles
// (engineTiles.ts, which this follows). URLs: `se-raster://<key>/<version>/{z}/{x}/{y}`; <version> goes up when the
// picture changes (band, range, colors), so a style change is a new URL and MapLibre asks again. A tile is rendered by
// the tiler (cog-tiler-wasm) and encoded as PNG in core; reading the file's parts is the tiler's own business.
import { addProtocol, type AddProtocolAction } from 'maplibre-gl'

/** Builds one PNG tile. */
export type RasterTileProvider = (z: number, x: number, y: number) => Promise<Uint8Array>

const URL_PATTERN = /^se-raster:\/\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/
/** Tiles kept by URL (a basemap swap reloads the source: it is served from here). */
const CACHE_ENTRIES = 256
/** Tiles built at once. The reads for a tile are network waits, so a few in flight keep a remote file moving. */
const CONCURRENCY = 4

const providers = new Map<string, RasterTileProvider>()
// A Map keeps insertion order: the first key is the least recently used.
const cache = new Map<string, Uint8Array>()
let registered = false
let running = 0
const waiting: Array<() => void> = []
const stats = { built: 0, cacheHits: 0 }
const buildMs: number[] = []

const abortError = (): DOMException => new DOMException('The tile request was aborted.', 'AbortError')
const asBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

function remember(url: string, bytes: Uint8Array): void {
  cache.delete(url)
  cache.set(url, bytes)
  while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string)
}

async function slot(): Promise<void> {
  if (running < CONCURRENCY) {
    running++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  running++
}
function release(): void {
  running--
  waiting.shift()?.()
}

const handler: AddProtocolAction = async (params, abortController) => {
  const m = URL_PATTERN.exec(params.url)
  if (!m) throw new Error(`Not a raster tile URL: ${params.url}`)
  const [, key, , z, x, y] = m
  const hit = cache.get(params.url)
  if (hit) {
    remember(params.url, hit)
    stats.cacheHits++
    return { data: asBuffer(hit) }
  }
  const provider = providers.get(key)
  if (!provider) throw new Error('No raster tile provider')
  const signal = abortController.signal
  await slot()
  try {
    // A tile that left the view while it waited (MapLibre aborts it) is dropped unbuilt.
    if (signal.aborted) throw abortError()
    const t0 = performance.now()
    const bytes = await provider(Number(z), Number(x), Number(y))
    stats.built++
    buildMs.push(Math.round(performance.now() - t0))
    if (buildMs.length > 500) buildMs.shift()
    if (providers.get(key) === provider) remember(params.url, bytes)
    return { data: asBuffer(bytes) }
  } finally {
    release()
  }
}

/** Registers the `se-raster` protocol once per page. */
export function ensureRasterTilesProtocol(): void {
  if (registered) return
  registered = true
  addProtocol('se-raster', handler)
}

/** Serves `se-raster://<key>/…` from `provider` until the returned function unregisters it (and drops its cached tiles). */
export function registerRasterProvider(key: string, provider: RasterTileProvider): () => void {
  ensureRasterTilesProtocol()
  providers.set(key, provider)
  return () => {
    if (providers.get(key) === provider) providers.delete(key)
    const prefix = `se-raster://${key}/`
    for (const url of [...cache.keys()]) if (url.startsWith(prefix)) cache.delete(url)
  }
}

/** The tile URL template for a raster and a picture version. */
export function rasterTileUrl(key: string, version: number): string {
  return `se-raster://${key}/${version}/{z}/{x}/{y}`
}

/** Test hook: tiles built and served from the cache since the page loaded, and the last build times (ms). */
export function rasterTileStats(): { built: number; cacheHits: number; buildMs: number[] } {
  return { ...stats, buildMs: [...buildMs] }
}
