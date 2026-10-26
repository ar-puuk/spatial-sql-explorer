// Spike A, VS Code webview side (T002). Bundled by build-vscode.mjs and loaded by
// tests/vscode-ext/src/suite/raster-spike.test.ts into a real webview with the extension's CSP.
import initWhitebox from 'whitebox-wasm'
import initTiler from 'cog-tiler-wasm/wasm'
import { openCog, init } from 'cog-tiler-wasm'
import initConverter, { CogBuilder, GeoTiffReader } from 'geolibre-wasm'

const vscode = acquireVsCodeApi()
const P = JSON.parse(document.getElementById('params').dataset.json)
const R = {}
const t = () => performance.now()

async function main() {
  // 1. eval must stay blocked (no 'unsafe-eval' in the extension CSP); the tiler must not need it.
  try {
    new Function('return 1')()
    R.evalAllowed = true
  } catch {
    R.evalAllowed = false
  }
  // 2. engine bytes from the webview resource host (stands in for HostAdapter.engineFile)
  let t0 = t()
  const wb = await (await fetch(P.engine + '/whitebox_wasm_bg.wasm')).arrayBuffer()
  const ct = await (await fetch(P.engine + '/cog_tiler_wasm_bg.wasm')).arrayBuffer()
  R.engineFetchMs = Math.round(t() - t0)
  t0 = t()
  await initWhitebox({ module_or_path: wb })
  await initTiler({ module_or_path: ct })
  await init()
  R.engineInitMs = Math.round(t() - t0)

  // 3. each COG by the loopback range URL
  R.files = {}
  for (const f of P.files) {
    const r = (R.files[f.name] = {})
    try {
      t0 = t()
      const cog = await openCog(f.url)
      r.openMs = Math.round(t() - t0)
      r.levels = cog.levels.length
      r.mode = cog.mode
      r.bands = cog.levels[0]?.bands
      const b = cog.boundsLonLat
      // a first view: the 4 tiles around the centre at a zoom where the raster is about 1 tile wide
      const cx = (b[0] + b[2]) / 2
      const cy = (b[1] + b[3]) / 2
      const span = Math.max(b[2] - b[0], b[3] - b[1])
      const z = Math.max(0, Math.min(12, Math.round(Math.log2(360 / span))))
      const n = 2 ** z
      const x0 = Math.floor(((cx + 180) / 360) * n)
      const lat = (cy * Math.PI) / 180
      const y0 = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n)
      t0 = t()
      let opaque = 0
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const tile = await cog.renderTileRGBA(z, x0 + dx, y0 + dy, { min: -300, max: 1000, colormap: 'viridis' })
          if (tile) for (let i = 3; i < tile.length; i += 4) if (tile[i] > 0) opaque++
        }
      }
      r.firstViewMs = Math.round(t() - t0)
      r.zoom = z
      r.opaquePixels = opaque
      t0 = t()
      r.point = (await cog.point(cx, cy)).values
      r.pointMs = Math.round(t() - t0)
      t0 = t()
      const st = await cog.statistics({ maxSize: 512 })
      r.statsMs = Math.round(t() - t0)
      r.statsCount = Object.values(st)[0]?.count
      // PNG encode of one tile, the way the protocol handler will
      const rgba = await cog.renderTileRGBA(z, x0, y0, { min: -300, max: 1000, colormap: 'viridis' })
      if (rgba) {
        t0 = t()
        const oc = new OffscreenCanvas(256, 256)
        oc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)), 256, 256), 0, 0)
        const blob = await oc.convertToBlob({ type: 'image/png' })
        r.pngBytes = blob.size
        r.pngMs = Math.round(t() - t0)
      }
    } catch (e) {
      r.error = String(e).slice(0, 240)
    }
  }

  // 4. converter engine under the same CSP: striped -> COG
  try {
    t0 = t()
    const cw = await (await fetch(P.engine + '/geolibre_wasm_bg.wasm')).arrayBuffer()
    await initConverter({ module_or_path: cw })
    R.converterInitMs = Math.round(t() - t0)
    const striped = P.files.find((f) => f.name === P.stripedName)
    if (striped) {
      t0 = t()
      const whole = new Uint8Array(await (await fetch(striped.url)).arrayBuffer())
      R.stripedReadMs = Math.round(t() - t0)
      const reader = new GeoTiffReader(whole)
      const { width, height, bands } = reader
      const builder = new CogBuilder(width, height, bands)
      builder.set_epsg(reader.epsg)
      builder.set_geo_transform(reader.geo_transform())
      builder.set_tile_size(512)
      builder.set_compression('deflate')
      const lv = []
      for (let f = 2; Math.max(width, height) / f > 256; f *= 2) lv.push(f)
      builder.set_overview_levels(new Uint32Array(lv))
      t0 = t()
      const cog = builder.write_f32(Float32Array.from(reader.read_all_f64()))
      R.convertMs = Math.round(t() - t0)
      R.convertedMB = Math.round(cog.length / 1e6)
      const c2 = await openCog(cog)
      R.convertedOpens = c2.levels.length
    }
  } catch (e) {
    R.converterError = String(e).slice(0, 240)
  }
  R.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null
}

main()
  .catch((e) => {
    R.fatal = String(e) + ' | ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')
  })
  .finally(() => vscode.postMessage({ type: 'result', result: R }))
