// Spec 026: the raster's map tiles reach MapLibre through a custom protocol, like the engine's vector tiles
// (engineTiles.ts, which this follows). URLs: `se-raster://<key>/<version>/{z}/{x}/{y}`; <version> goes up when the
// picture changes (band, range, colors), so a style change is a new URL and MapLibre asks again. A tile is rendered by
// the tiler (cog-tiler-wasm) and encoded as PNG in core; reading the file's parts is the tiler's own business.
// Spec 027: a second scheme, `se-raster-dem://`, serves the same raster's VALUES packed as colors, for the hillshade layer.
// Both share one build queue (a few tiles at a time) and keep their own cache.
import { addProtocol, type AddProtocolAction } from 'maplibre-gl'

/** Builds one PNG tile. */
export type RasterTileProvider = (z: number, x: number, y: number) => Promise<Uint8Array>

/** Tiles kept by URL (a basemap swap reloads the source: it is served from here). */
const CACHE_ENTRIES = 256
/** Tiles built at once. The reads for a tile are network waits, so a few in flight keep a remote file moving. */
const CONCURRENCY = 4

interface Scheme {
  name: string
  pattern: RegExp
  providers: Map<string, RasterTileProvider>
  // A Map keeps insertion order: the first key is the least recently used.
  cache: Map<string, Uint8Array>
  registered: boolean
}

const makeScheme = (name: string): Scheme => ({ name, pattern: new RegExp(`^${name}://([^/]+)/(\\d+)/(\\d+)/(\\d+)/(\\d+)$`), providers: new Map(), cache: new Map(), registered: false })
const COLOR = makeScheme('se-raster')
const DEM = makeScheme('se-raster-dem')

let running = 0
const waiting: Array<() => void> = []
const stats = { built: 0, cacheHits: 0, demBuilt: 0 }
const buildMs: number[] = []

const abortError = (): DOMException => new DOMException('The tile request was aborted.', 'AbortError')
const asBuffer = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

function remember(scheme: Scheme, url: string, bytes: Uint8Array): void {
  scheme.cache.delete(url)
  scheme.cache.set(url, bytes)
  while (scheme.cache.size > CACHE_ENTRIES) scheme.cache.delete(scheme.cache.keys().next().value as string)
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

const handlerFor =
  (scheme: Scheme): AddProtocolAction =>
  async (params, abortController) => {
    const m = scheme.pattern.exec(params.url)
    if (!m) throw new Error(`Not a raster tile URL: ${params.url}`)
    const [, key, , z, x, y] = m
    const hit = scheme.cache.get(params.url)
    if (hit) {
      remember(scheme, params.url, hit)
      stats.cacheHits++
      return { data: asBuffer(hit) }
    }
    const provider = scheme.providers.get(key)
    if (!provider) throw new Error('No raster tile provider')
    const signal = abortController.signal
    await slot()
    try {
      // A tile that left the view while it waited (MapLibre aborts it) is dropped unbuilt.
      if (signal.aborted) throw abortError()
      const t0 = performance.now()
      const bytes = await provider(Number(z), Number(x), Number(y))
      if (scheme === COLOR) {
        stats.built++
        buildMs.push(Math.round(performance.now() - t0))
        if (buildMs.length > 500) buildMs.shift()
      } else stats.demBuilt++
      if (scheme.providers.get(key) === provider) remember(scheme, params.url, bytes)
      return { data: asBuffer(bytes) }
    } finally {
      release()
    }
  }

function ensure(scheme: Scheme): void {
  if (scheme.registered) return
  scheme.registered = true
  addProtocol(scheme.name, handlerFor(scheme))
}

/** Registers the `se-raster` protocol once per page. */
export function ensureRasterTilesProtocol(): void {
  ensure(COLOR)
}

function register(scheme: Scheme, key: string, provider: RasterTileProvider): () => void {
  ensure(scheme)
  scheme.providers.set(key, provider)
  return () => {
    if (scheme.providers.get(key) === provider) scheme.providers.delete(key)
    const prefix = `${scheme.name}://${key}/`
    for (const url of [...scheme.cache.keys()]) if (url.startsWith(prefix)) scheme.cache.delete(url)
  }
}

/** Serves `se-raster://<key>/…` from `provider` until the returned function unregisters it (and drops its cached tiles). */
export function registerRasterProvider(key: string, provider: RasterTileProvider): () => void {
  return register(COLOR, key, provider)
}

/** Spec 027: serves `se-raster-dem://<key>/…` (the values as colors, for the hillshade) the same way. */
export function registerDemProvider(key: string, provider: RasterTileProvider): () => void {
  return register(DEM, key, provider)
}

/** The tile URL template for a raster and a picture version. */
export function rasterTileUrl(key: string, version: number): string {
  return `se-raster://${key}/${version}/{z}/{x}/{y}`
}

/** Spec 027: the tile URL template of the values; the version goes up when the packing (the range of values) changes. */
export function demTileUrl(key: string, version: number): string {
  return `se-raster-dem://${key}/${version}/{z}/{x}/{y}`
}

/** Test hook: tiles built and served from the cache since the page loaded, and the last build times (ms). */
export function rasterTileStats(): { built: number; cacheHits: number; demBuilt: number; buildMs: number[] } {
  return { ...stats, buildMs: [...buildMs] }
}
