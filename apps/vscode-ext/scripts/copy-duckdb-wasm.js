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
import { mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
// Resolve packages the way Node does, from the workspace that depends on
// them: npm may hoist them to the root node_modules or keep them nested.
// (Node's lookup path list rather than require.resolve: some packages' `exports` hide package.json.)
const fromPackage = (workspace, pkg) => {
  const req = createRequire(join(__dirname, '..', '..', '..', 'packages', workspace, 'package.json'))
  const dir = req.resolve.paths(pkg).map((p) => join(p, pkg)).find((p) => existsSync(join(p, 'package.json')))
  if (!dir) throw new Error(`Cannot find ${pkg} from packages/${workspace}`)
  return join(dir, 'dist')
}
const srcDir = fromPackage('core', '@duckdb/duckdb-wasm')
const destDir = join(__dirname, '..', 'dist-webview', 'duckdb')

mkdirSync(destDir, { recursive: true })

const files = ['duckdb-browser-eh.worker.js', 'duckdb-eh.wasm']
for (const file of files) {
  copyFileSync(join(srcDir, file), join(destDir, file))
  console.log(`Copied ${file} -> dist-webview/duckdb/${file}`)
}

// MapLibre GL v6's worker: maplibre-gl derives its worker URL at runtime, so
// no bundler emits it, and without a worker a GeoJSON source never tiles: the
// map draws nothing, silently (GeoLibre hit the same, lib/maplibre-worker.ts).
// main.ts loads this through a same-origin blob: URL, like DuckDB's worker
// (research.md §4: a worker constructed directly from an asWebviewUri() URL
// is blocked in a webview).
const maplibreSrc = join(fromPackage('ui', 'maplibre-gl'), 'maplibre-gl-worker.mjs')
const maplibreDestDir = join(__dirname, '..', 'dist-webview', 'maplibre')
mkdirSync(maplibreDestDir, { recursive: true })
copyFileSync(maplibreSrc, join(maplibreDestDir, 'maplibre-gl-worker.mjs'))
console.log('Copied maplibre-gl-worker.mjs -> dist-webview/maplibre/maplibre-gl-worker.mjs')

// Spec 008 (research §3): sql.js writes GeoPackage exports. Its wasm is loaded
// only when a GeoPackage is exported, from this static copy (never a CDN).
const sqljsSrc = join(fromPackage('core', 'sql.js'), 'sql-wasm.wasm')
const sqljsDestDir = join(__dirname, '..', 'dist-webview', 'sqljs')
mkdirSync(sqljsDestDir, { recursive: true })
copyFileSync(sqljsSrc, join(sqljsDestDir, 'sql-wasm.wasm'))
console.log(`Copied sql-wasm.wasm -> dist-webview/sqljs/sql-wasm.wasm`)
