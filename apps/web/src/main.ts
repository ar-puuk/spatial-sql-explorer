import { mount } from 'svelte'
import { setWorkerUrl } from 'maplibre-gl'
import App from './App.svelte'
import './theme.css'

// Must run before any maplibregl.Map is constructed (MapView.svelte, once a
// file loads). See scripts/copy-wasm-assets.js's comment: MapLibre's
// automatic worker-URL detection breaks under both Vite dev and build for
// this package, so we point it at a statically-served copy explicitly.
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

const target = document.getElementById('app')
if (!target) throw new Error('Missing #app root element')

mount(App, { target })
