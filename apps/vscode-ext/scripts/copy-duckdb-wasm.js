// Copies MapLibre's worker into dist-webview/ for extension.ts to serve. The
// SQL engine is NOT copied (spec 008 research §15, user decision): the webview
// downloads DuckDB-WASM, its extensions and sql.js from pinned URLs and checks
// each against its recorded SHA-256 (packages/core/src/engineAssets.ts).
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs'
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
// Older builds copied the engine here; it must not ship in the VSIX.
for (const old of ['duckdb', 'sqljs']) rmSync(join(__dirname, '..', 'dist-webview', old), { recursive: true, force: true })

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
