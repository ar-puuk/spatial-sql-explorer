// Spec 026: the worker that owns the WebAssembly raster tiler and the striped-file converter (see tilerProtocol.ts for why).
// Built inline (a blob worker: the webview's CSP allows `worker-src blob:`), and imported lazily by tilerClient.ts, so a page
// that never opens a raster never loads any of this. The wasm files are not fetched here: the page hands over the bytes it
// downloaded and hash-checked (constitution IV), and the packages' own default `new URL('...wasm')` is replaced by an error at
// build time (scripts/viteNoBundledWasm.mjs). Deep imports of core's raster files, not its index: the index would bring DuckDB.
import { init, openCog, colormaps } from 'cog-tiler-wasm'
import initTiler, { colorize } from 'cog-tiler-wasm/wasm'
import initConverter, { CogBuilder, GeoTiffReader } from 'geolibre-wasm'
import initWhitebox from 'whitebox-wasm'
import type { CogSource } from 'cog-tiler-wasm'
import { convertVerdict, overviewSteps, tooLargeToConvert } from '../../../core/src/raster/convert.js'
import { RasterOpenError } from '../../../core/src/raster/errors.js'
import { encodePng, transparentTilePng } from '../../../core/src/raster/png.js'
import type { ColormapTable, ConvertedCog, FromWorker, OpenedCog, PointAnswer, StatisticsAnswer, ToWorker } from './tilerProtocol.js'

const cogs = new Map<number, CogSource>()
const hex2 = (n: number): string => n.toString(16).padStart(2, '0')

function post(message: FromWorker, transfer: Transferable[] = []): void {
  ;(self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(message, transfer)
}

/** The colormaps, sampled from the tiler itself (16 and 32 steps, low to high). */
function sampleColormaps(): ColormapTable {
  const table: ColormapTable = {}
  const sample = (name: string, steps: number): string[] => {
    const values = new Float64Array(steps)
    for (let i = 0; i < steps; i++) values[i] = i / (steps - 1)
    const rgba = colorize(values, steps, 1, 0, 1, name, null, false, 'linear', 1, false, 1)
    return Array.from({ length: steps }, (_, i) => `#${hex2(rgba[i * 4])}${hex2(rgba[i * 4 + 1])}${hex2(rgba[i * 4 + 2])}`)
  }
  for (const name of colormaps()) {
    try {
      table[name] = { s16: sample(name, 16), s32: sample(name, 32) }
    } catch {
      // A colormap the tiler cannot sample is left out of the previews; it still draws.
    }
  }
  return table
}

function describe(cog: CogSource, handle: number): OpenedCog {
  cogs.set(handle, cog)
  return { handle, info: cog.info() as unknown as OpenedCog['info'], levels: cog.levels as unknown as OpenedCog['levels'], mode: cog.mode, hasPalette: cog.hasPalette }
}

const typeName = (bits: number, format: number): string => (format === 3 ? `float${bits}` : `${format === 2 ? 'int' : 'uint'}${bits}`)

async function readWhole(source: Exclude<ToWorker & { type: 'convert' }, never>['source']): Promise<Uint8Array> {
  if (typeof source === 'string') {
    const res = await fetch(source)
    if (!res.ok) throw new RasterOpenError('unreadable', `The file could not be read (HTTP ${res.status}).`)
    return new Uint8Array(await res.arrayBuffer())
  }
  return new Uint8Array(await source.arrayBuffer())
}

async function convert(id: number, message: Extract<ToWorker, { type: 'convert' }>): Promise<ConvertedCog> {
  const { striped } = message
  const name = typeof message.source === 'string' ? 'The file' : ((message.source as File).name ?? 'The file')
  const verdict = convertVerdict(striped.width, striped.height, striped.bands)
  if (verdict.kind === 'refuse') throw tooLargeToConvert(name, verdict.samples)
  const million = (verdict.samples / 1e6).toFixed(verdict.samples >= 10e6 ? 0 : 1)
  post({ id, kind: 'note', text: `Reading ${name}…` })
  const bytes = await readWhole(message.source)
  post({ id, kind: 'note', text: `Preparing ${million} million cells as a COG${verdict.large ? ' (large: it needs a gigabyte or more of memory)' : ''}…` })
  const reader = new GeoTiffReader(bytes)
  let cog: Uint8Array
  try {
    const { width, height, bands } = reader
    const builder = new CogBuilder(width, height, bands)
    try {
      const epsg = reader.epsg
      if (typeof epsg === 'number' && Number.isFinite(epsg)) builder.set_epsg(epsg)
      const geoTransform = reader.geo_transform()
      if (geoTransform.length >= 6) builder.set_geo_transform(geoTransform)
      const nodata = reader.nodata
      if (typeof nodata === 'number' && Number.isFinite(nodata)) builder.set_nodata(nodata)
      builder.set_tile_size(512)
      builder.set_compression('deflate')
      // A chain of reductions, not absolute factors (core convert.ts, research.md §4b).
      builder.set_overview_levels(new Uint32Array(overviewSteps(width, height)))
      // read_all_f64 decodes any sample type to one; then narrowed to what the COG holds (8 bit stays 8 bit).
      const pixels = reader.read_all_f64()
      const keepsBytes = striped.sampleFormat === 1 && striped.bitsPerSample <= 8
      cog = keepsBytes ? builder.write_u8(Uint8Array.from(pixels)) : builder.write_f32(Float32Array.from(pixels))
    } finally {
      builder.free()
    }
  } finally {
    reader.free()
  }
  const opened = describe(await openCog(cog), message.handle)
  return { ...opened, sourceType: typeName(striped.bitsPerSample, striped.sampleFormat), hadPalette: striped.palette }
}

async function handle(message: ToWorker): Promise<{ result: unknown; transfer?: Transferable[] }> {
  switch (message.type) {
    case 'init': {
      await initWhitebox({ module_or_path: message.whitebox })
      await initTiler({ module_or_path: message.cogTiler })
      await init()
      return { result: sampleColormaps() }
    }
    case 'initConverter': {
      await initConverter({ module_or_path: message.wasm })
      return { result: true }
    }
    case 'open':
      return { result: describe(await openCog(message.source), message.handle) }
    case 'convert':
      return { result: await convert(message.id, message) }
    case 'statistics': {
      const cog = cogs.get(message.handle)
      if (!cog) throw new Error('The raster is closed.')
      return { result: (await cog.statistics({ maxSize: message.maxSize })) as unknown as StatisticsAnswer }
    }
    case 'point': {
      const cog = cogs.get(message.handle)
      if (!cog) throw new Error('The raster is closed.')
      return { result: (await cog.point(message.lon, message.lat)) as unknown as PointAnswer }
    }
    case 'profile': {
      // Spec 027: the same reader as the cursor readout (point()), so a profile and a hover agree. Neighboring places share
      // decoded tiles (the tiler caches them), so a line reads each tile once; a few questions overlap their range reads.
      const cog = cogs.get(message.handle)
      if (!cog) throw new Error('The raster is closed.')
      const n = message.points.length / 2
      const per = message.bands.length
      const out = new Float64Array(n * per).fill(NaN)
      const BATCH = 24
      for (let start = 0; start < n; start += BATCH) {
        const end = Math.min(n, start + BATCH)
        await Promise.all(
          Array.from({ length: end - start }, async (_, k) => {
            const i = start + k
            const answer = await cog.point(message.points[i * 2], message.points[i * 2 + 1], { bidx: message.bands })
            if (!answer.outside) for (let b = 0; b < per; b++) out[i * per + b] = answer.values[b] ?? NaN
          }),
        )
      }
      return { result: out, transfer: [out.buffer as ArrayBuffer] }
    }
    case 'tile': {
      const cog = cogs.get(message.handle)
      if (!cog) throw new Error('The raster is closed.')
      const rgba = await cog.renderTileRGBA(message.z, message.x, message.y, message.options)
      const side = rgba ? Math.round(Math.sqrt(rgba.length / 4)) : 0
      // A copy: the transparent tile is one shared object, and a transferred buffer is gone from this side.
      const png = rgba && side * side * 4 === rgba.length ? encodePng(rgba, side, side) : transparentTilePng().slice()
      return { result: png, transfer: [png.buffer as ArrayBuffer] }
    }
    case 'close':
      cogs.delete(message.handle)
      return { result: true }
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data
  handle(message).then(
    ({ result, transfer }) => post({ id: message.id, kind: 'ok', result }, transfer),
    (error: unknown) => post({ id: message.id, kind: 'error', message: error instanceof Error ? error.message : String(error), ...(error instanceof RasterOpenError ? { code: error.code } : {}) }),
  )
}
