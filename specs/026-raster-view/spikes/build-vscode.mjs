// Builds the VS Code spike webview bundle. Run from the scratch folder that holds node_modules
// (see README.md); writes web/vscode-spike.js.
import { build } from 'file:///D:/GitHub/spatial-sql-explorer/node_modules/esbuild/lib/main.js'
await build({
  entryPoints: ['vscode-webview-entry.js'],
  bundle: true,
  format: 'iife',
  outfile: 'web/vscode-spike.js',
  define: { 'import.meta.url': '"http://localhost/"' },
  alias: { module: './stub.js' },
  logLevel: 'warning',
  nodePaths: [process.cwd() + '/node_modules'],
})
