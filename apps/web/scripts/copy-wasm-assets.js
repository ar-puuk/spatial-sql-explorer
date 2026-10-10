// Copies the single-threaded "eh" (exception-handling) DuckDB-WASM bundle's
// worker + wasm files into public/duckdb/ so they're served as static assets
// at a stable URL. Mirrors apps/vscode-ext/scripts/copy-duckdb-wasm.js —
// same bundle choice, for the same reason (research.md §1: the mvp bundle
// fails GDAL-driver formats with "_setThrew is not defined").
import { mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '..', '..', '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist')
const destDir = join(__dirname, '..', 'public', 'duckdb')

mkdirSync(destDir, { recursive: true })

const files = ['duckdb-browser-eh.worker.js', 'duckdb-eh.wasm']
for (const file of files) {
  copyFileSync(join(srcDir, file), join(destDir, file))
  console.log(`Copied ${file} -> public/duckdb/${file}`)
}

// maplibre-gl constructs its own worker internally via `new Worker(new
// URL(...))`, which both Vite's dev-server dep pre-bundling and its
// production Rollup build fail to rewrite correctly for this package
// (confirmed: "Worker failed to load", traced to maplibre-gl's own bundled
// code in both modes). MapLibre's own setWorkerUrl() API lets us bypass
// that automatic detection entirely with a statically-served copy.
const maplibreSrcDir = join(__dirname, '..', '..', '..', 'node_modules', 'maplibre-gl', 'dist')
const maplibreDestDir = join(__dirname, '..', 'public', 'maplibre')
mkdirSync(maplibreDestDir, { recursive: true })
copyFileSync(join(maplibreSrcDir, 'maplibre-gl-worker.mjs'), join(maplibreDestDir, 'maplibre-gl-worker.mjs'))
console.log('Copied maplibre-gl-worker.mjs -> public/maplibre/maplibre-gl-worker.mjs')
