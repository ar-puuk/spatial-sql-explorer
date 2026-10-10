// Copies the single-threaded ("mvp") DuckDB-WASM bundle's worker + wasm
// files into dist-webview/duckdb/ so extension.ts can serve them to the
// webview via webview.asWebviewUri() — see research.md §3 (bundle, don't
// rely on the default CDN fetch, for offline/local-first use) and §4 (the
// T005 worker-bootstrap spike this bundle exists to support).
import { mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '..', '..', '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist')
const destDir = join(__dirname, '..', 'dist-webview', 'duckdb')

mkdirSync(destDir, { recursive: true })

const files = ['duckdb-browser-mvp.worker.js', 'duckdb-mvp.wasm']
for (const file of files) {
  copyFileSync(join(srcDir, file), join(destDir, file))
  console.log(`Copied ${file} -> dist-webview/duckdb/${file}`)
}
