import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { noBundledWasm } from '../../scripts/viteNoBundledWasm.mjs'

export default defineConfig({
  // GitHub Pages serves the app under /<repo>/ (the deploy workflow sets
  // BASE_PATH); local dev, preview and tests use the root.
  base: process.env.BASE_PATH || '/',
  plugins: [svelte(), noBundledWasm()],

  // jsPDF's optional HTML and SVG converters are not used (see packages/ui/src/print/emptyModule.ts).
  resolve: {
    alias: Object.fromEntries(['html2canvas', 'canvg', 'dompurify'].map((name) => [name, fileURLToPath(new URL('../../packages/ui/src/print/emptyModule.ts', import.meta.url))]))
  },
  worker: {
    format: 'es',
    // Spec 026: the raster worker bundles the tiler packages: their default wasm URL (an emitted asset) is replaced by an error there too.
    plugins: () => [noBundledWasm()],
    // An inline (blob) worker cannot load chunks by a relative address: the packages' lazy codecs (pako, zstd, lerc) are bundled into it.
    rollupOptions: { output: { inlineDynamicImports: true } }
  },
  build: {
    target: 'esnext'
  },
  // maplibre-gl constructs its own worker via `new Worker(new URL(...))`
  // internally; Vite's esbuild-based dependency pre-bundling breaks that
  // reference (confirmed: "Worker failed to load" at runtime, traced to
  // node_modules/.vite/deps/maplibre-gl.js — a known maplibre-gl + Vite
  // issue). Excluding it from dep optimization lets Vite's own bundler
  // (which correctly transforms new Worker(new URL(...)) patterns) handle
  // it instead.
  optimizeDeps: {
    exclude: ['maplibre-gl']
  },
  server: {
    watch: {
      // The test runs' copy of the engine (scripts/engine-assets.mjs --mirror): large binaries that never change and that
      // Windows keeps locked while the app or a test reads them, which made the watcher fail on every start with EBUSY.
      ignored: ['**/public/engine-mirror/**']
    }
  }
})
