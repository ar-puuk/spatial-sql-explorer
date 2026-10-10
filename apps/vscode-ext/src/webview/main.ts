// Webview entry point — wires the VS Code HostAdapter (hostAdapter.ts) to
// packages/ui's ViewerLayout, completing the end-to-end VS Code path (T028).
// The hard part (DuckDB-WASM worker bootstrap inside this exact kind of
// webview) was proven by the T005/T006 spikes and now lives, tested, in
// packages/core/src/duckdbService.ts — see research.md §4/§1 for the full
// investigation.
import { mount } from 'svelte'
import { ViewerLayout, createViewerStore } from '@spatial-explorer/ui'
import { createVsCodeHostAdapter, getDuckDbAssets, reportLoadState, reportSelectionChanged, signalReady } from './hostAdapter.js'

async function main(): Promise<void> {
  signalReady()

  const hostAdapter = createVsCodeHostAdapter()
  const duckdbAssets = await getDuckDbAssets()
  const store = createViewerStore(hostAdapter, duckdbAssets)

  const appRoot = document.getElementById('app')
  if (!appRoot) throw new Error('Missing #app root element')

  mount(ViewerLayout, {
    target: appRoot,
    props: {
      get session() {
        return store.session
      },
      onSelectFeature: (id: string | number | null) => store.selectFeature(id),
      onCursorMove: (coords: { lon: number; lat: number } | null) => store.setCursor(coords),
    },
  })

  await store.load()

  // Regression guard (a real bug reached a real user: the webview's CSS —
  // including maplibre-gl's own required canvas-positioning rules — wasn't
  // being linked into the HTML at all, so the map canvas rendered at its
  // default zero/intrinsic size and was effectively invisible, while the
  // table, unaffected by that missing CSS, rendered fine). Reports the
  // MapLibre canvas's real bounding-box size so a test can assert it's
  // actually nonzero, not just that the element exists in the DOM.
  let mapCanvasRect: { width: number; height: number } | null = null
  if (store.session.loadState === 'ready') {
    for (let i = 0; i < 20; i++) {
      const canvas = document.querySelector('.maplibregl-canvas')
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        mapCanvasRect = { width: rect.width, height: rect.height }
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  reportLoadState(store.session.loadState, {
    featureCount: store.session.layer?.featureCount,
    invalidGeometryCount: store.session.layer?.invalidGeometryCount,
    errorMessage: store.session.loadError?.message,
    sourceCrsLabel: store.session.layer?.sourceCrs.label,
    crsAssumed: store.session.layer?.crsAssumed,
    extent: store.session.layer?.extent,
    mapCanvasRect,
  })

  // Test-only hook (T015): @vscode/test-electron cannot click inside this
  // webview's rendered DOM, so selection-sync is exercised by invoking the
  // same onSelectFeature path a real map/table click would — verifying the
  // real data flow (ViewerSession.selectedFeatureId propagation), not actual
  // mouse interaction.
  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as { type: string; id?: string | number | null }
    if (msg.type === 'testSelectFeature') {
      store.selectFeature(msg.id ?? null)
      reportSelectionChanged(store.session.selectedFeatureId)
    }
  })
}

void main()
