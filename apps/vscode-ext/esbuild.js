// Bundles the extension host (Node, CommonJS output) — separate from the
// webview, which is built by Vite via vite.webview.config.ts. Two different
// runtime targets, two different bundlers; that's expected, not a design
// smell. Output format is CJS (VS Code's extension host loads extensions as
// CommonJS) even though this build script itself is ESM, matching the rest
// of the monorepo's "type": "module" convention. Mirrors
// ../omx-viewer/apps/vscode-ext/esbuild.js.
import * as esbuild from 'esbuild'

async function build() {
  await esbuild.build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    // .cjs, not .js — this package is "type": "module", so a plain .js file
    // would be loaded as ESM regardless of its CJS-syntax content, and VS
    // Code's extension host would fail with "module is not defined".
    outfile: 'out/extension.cjs',
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
    sourcemap: true,
  })
  console.log('Build complete: out/extension.cjs')
}

build().catch((err) => {
  console.error(err)
  process.exit(1)
})
