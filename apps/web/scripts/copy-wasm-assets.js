// Copies the single-threaded "eh" (exception-handling) DuckDB-WASM bundle's
// worker + wasm files into public/duckdb/ so they're served as static assets
// at a stable URL. Mirrors apps/vscode-ext/scripts/copy-duckdb-wasm.js —
// same bundle choice, for the same reason (research.md §1: the mvp bundle
// fails GDAL-driver formats with "_setThrew is not defined").
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
const maplibreSrcDir = fromPackage('ui', 'maplibre-gl')
const maplibreDestDir = join(__dirname, '..', 'public', 'maplibre')
mkdirSync(maplibreDestDir, { recursive: true })
copyFileSync(join(maplibreSrcDir, 'maplibre-gl-worker.mjs'), join(maplibreDestDir, 'maplibre-gl-worker.mjs'))
console.log('Copied maplibre-gl-worker.mjs -> public/maplibre/maplibre-gl-worker.mjs')

// Spec 008 (research §3): sql.js writes GeoPackage exports. Its wasm is loaded
// only when a GeoPackage is exported, from this static copy (never a CDN).
const sqljsSrc = join(fromPackage('core', 'sql.js'), 'sql-wasm.wasm')
const sqljsDestDir = join(__dirname, '..', 'public', 'sqljs')
mkdirSync(sqljsDestDir, { recursive: true })
copyFileSync(sqljsSrc, join(sqljsDestDir, 'sql-wasm.wasm'))
console.log(`Copied sql-wasm.wasm -> public/sqljs/sql-wasm.wasm`)
