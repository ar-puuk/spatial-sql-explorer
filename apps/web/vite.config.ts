import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  // GitHub Pages serves the app under /<repo>/ (the deploy workflow sets
  // BASE_PATH); local dev, preview and tests use the root.
  base: process.env.BASE_PATH || '/',
  plugins: [svelte()],
  worker: {
    format: 'es'
  },
  build: {
    target: 'esnext'
  },
  // maplibre-gl constructs its own worker via `new Worker(new URL(...))`
  // internally; Vite's esbuild-based dependency pre-bundling breaks that
  // reference (confirmed: "Worker failed to load" at runtime, traced to
  // node_modules/.vite/deps/maplibre-gl.js — a known maplibre-gl + Vite
  // issue). Excluding it from dep optimization lets Vite's own bundler
  // (which correctly transforms new Worker(new URL(...)) patterns) handle
  // it instead.
  optimizeDeps: {
    exclude: ['maplibre-gl']
  }
})
