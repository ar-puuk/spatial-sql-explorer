import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  worker: {
    format: 'es'
  },
  build: {
    target: 'esnext'
  }
})
