import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Webview bundle — built by Vite, same mechanism as apps/web, but with no
// HTML entry point (the extension host constructs the HTML dynamically in
// extension.ts, wrapping asset URLs via webview.asWebviewUri()) and fixed
// (non-hashed) output filenames so extension.ts can reference them directly.
// Mirrors ../omx-viewer/apps/vscode-ext/vite.webview.config.ts.
export default defineConfig({
  plugins: [svelte()],

  // jsPDF's optional HTML and SVG converters are not used (see packages/ui/src/print/emptyModule.ts).
  resolve: {
    alias: Object.fromEntries(['html2canvas', 'canvg', 'dompurify'].map((name) => [name, fileURLToPath(new URL('../../packages/ui/src/print/emptyModule.ts', import.meta.url))]))
  },

  base: './',

  worker: {
    format: 'es'
  },

  build: {
    target: 'esnext',
    outDir: 'dist-webview',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/webview/main.ts',
      output: {
        entryFileNames: 'main.js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'main.css'
          return 'assets/[name][extname]'
        }
      }
    }
  }
})
