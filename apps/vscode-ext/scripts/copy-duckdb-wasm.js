// Copies the single-threaded "eh" (exception-handling) DuckDB-WASM bundle's
// worker + wasm files into dist-webview/duckdb/ so extension.ts can serve
// them to the webview via webview.asWebviewUri() — see research.md §3
// (bundle, don't rely on the default CDN fetch, for offline/local-first use)
// and §4/§1 (T005's worker-bootstrap spike and T006's format-support spike).
// "eh" (not "mvp"): T006 found GDAL-driver format reads fail with
// "ReferenceError: _setThrew is not defined" under the mvp bundle — GDAL's
// C++ code relies on exceptions, and mvp's baseline-compatibility build
// omits the WASM exception-handling runtime glue mvp code paths need. "eh"
// still requires no SharedArrayBuffer (unlike "coi"), so it remains
// compatible with VS Code webviews per CLAUDE.md. It is also smaller
// (~35.9MB wasm + ~0.77MB worker vs mvp's ~41.3MB + ~0.84MB).
import { mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, '..', '..', '..', 'node_modules', '@duckdb', 'duckdb-wasm', 'dist')
const destDir = join(__dirname, '..', 'dist-webview', 'duckdb')

mkdirSync(destDir, { recursive: true })

const files = ['duckdb-browser-eh.worker.js', 'duckdb-eh.wasm']
for (const file of files) {
  copyFileSync(join(srcDir, file), join(destDir, file))
  console.log(`Copied ${file} -> dist-webview/duckdb/${file}`)
}
