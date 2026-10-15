import { mount } from 'svelte'
import { setWorkerUrl } from 'maplibre-gl'
import { parseTestOverrides, setTestOverrides } from '@spatial-explorer/core'
import App from './App.svelte'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/fira-code/latin-400.css'
import '@fontsource/fira-code/latin-500.css'
import './theme.css'

// Must run before any maplibregl.Map is constructed (MapView.svelte, once a
// file loads). See scripts/copy-wasm-assets.js's comment: MapLibre's
// automatic worker-URL detection breaks under both Vite dev and build for
// this package, so we point it at a statically-served copy explicitly.
setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`)

// Spec 007: test-only thresholds (`?e2e=1&cap=…`), applied before the
// engine starts (memoryLimit is set at creation). Empty without e2e=1.
setTestOverrides(parseTestOverrides(location.search))

const target = document.getElementById('app')
if (!target) throw new Error('Missing #app root element')

mount(App, { target })

// The fonts are fetched when text first uses them, which would re-flow a panel the first time it shows data text.
// Fetch them once the app is idle at start instead (a panel opening must not wait for a font).
const warmFonts = (): void => {
  for (const face of ['400 13px "IBM Plex Sans"', '500 13px "IBM Plex Sans"', '600 13px "IBM Plex Sans"', '400 12px "Fira Code"', '500 12px "Fira Code"']) void document.fonts?.load(face)
}
if ('requestIdleCallback' in window) window.requestIdleCallback(warmFonts, { timeout: 2000 })
else setTimeout(warmFonts, 500)

