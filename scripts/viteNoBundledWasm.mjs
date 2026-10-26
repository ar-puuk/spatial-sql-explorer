// Spec 026: the raster engine's wasm files are downloaded at run time from pinned URLs and checked
// against SHA-256 hashes (constitution v1.2.0), never bundled. The packages (cog-tiler-wasm,
// whitebox-wasm, geolibre-wasm) default to `new URL('<name>_bg.wasm', import.meta.url)`, which Vite
// turns into an emitted asset (11 MB into dist). We always hand their init() the bytes, so that
// default branch is dead code: replace it with an error so nothing is emitted.
const PACKAGE_GLUE = /[\/](cog_tiler_wasm|whitebox_wasm|geolibre_wasm)\.js$/
const DEFAULT_URL = /new URL\((['"])([\w-]+_bg\.wasm)\1,\s*import\.meta\.url\)/g

export function noBundledWasm() {
  return {
    name: 'spatial-explorer:no-bundled-raster-wasm',
    enforce: 'pre',
    transform(code, id) {
      if (!PACKAGE_GLUE.test(id.split('?')[0])) return null
      const out = code.replace(
        DEFAULT_URL,
        (_m, _q, file) => `(() => { throw new Error('${file}: the raster engine is downloaded, pass its bytes to init') })()`,
      )
      return out === code ? null : { code: out, map: null }
    },
  }
}
