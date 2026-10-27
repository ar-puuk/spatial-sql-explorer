import { build } from 'file:///D:/GitHub/spatial-sql-explorer/node_modules/esbuild/lib/main.js';
await build({ entryPoints: ['convert-entry.js'], bundle: true, format: 'iife', outfile: 'web/convert.js', define: { 'import.meta.url': '"http://localhost/"' }, logLevel: 'warning', alias: { module: './stub.js' } });
