import { mount } from 'svelte'
import { setWorkerUrl } from 'maplibre-gl'
import { parseTestOverrides, setTestOverrides } from '@spatial-explorer/core'
import App from './App.svelte'
import './theme.css'

// Must run before any maplibregl.Map is constructed (MapView.svelte, once a
// file loads). See scripts/copy-wasm-assets.js's comment: MapLibre's
// automatic worker-URL detection breaks under both Vite dev and build for
// this package, so we point it at a statically-served copy explicitly.
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs')

// Spec 007: test-only thresholds (`?e2e=1&cap=…`), applied before the
// engine starts (memoryLimit is set at creation). Empty without e2e=1.
setTestOverrides(parseTestOverrides(location.search))

const target = document.getElementById('app')
if (!target) throw new Error('Missing #app root element')

mount(App, { target })
