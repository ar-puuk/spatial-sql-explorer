import { build } from 'file:///D:/GitHub/spatial-sql-explorer/node_modules/esbuild/lib/main.js';
await build({ entryPoints: ['spike-entry.js'], bundle: true, format: 'iife', outfile: 'web/spike.js', define: { 'import.meta.url': '"http://localhost/"' }, alias: { module: './stub.js' }, logLevel: 'warning', nodePaths: [process.cwd() + '/node_modules'] });
await build({ entryPoints: ['node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs'], bundle: true, format: 'iife', outfile: 'web/maplibre-worker.js', logLevel: 'warning' });
