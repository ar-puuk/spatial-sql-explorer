// Copies MapLibre's worker into public/ (served as a static file). The SQL
// engine is NOT copied (spec 008 research §15): the app downloads DuckDB-WASM,
// its extensions and sql.js from pinned URLs and checks their hashes. For
// tests only (ENGINE_MIRROR=1), the same files are served from the app's own
// origin at /engine-mirror (scripts/engine-assets.mjs --mirror fills the cache).
import { mkdirSync, copyFileSync, existsSync, rmSync, cpSync } from 'node:fs'
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
const publicDir = join(__dirname, '..', 'public')
// Older builds copied the engine here; it must not ship.
for (const old of ['duckdb', 'sqljs', 'engine-mirror']) rmSync(join(publicDir, old), { recursive: true, force: true })
if (process.env.ENGINE_MIRROR === '1') {
  const cache = join(__dirname, '..', '..', '..', 'scripts', '.engine-cache', 'mirror')
  if (!existsSync(cache)) throw new Error('ENGINE_MIRROR=1 needs scripts/.engine-cache/mirror: run `node scripts/engine-assets.mjs --mirror` once.')
  cpSync(cache, join(publicDir, 'engine-mirror'), { recursive: true })
  console.log('Engine mirror (tests only) -> public/engine-mirror')
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
