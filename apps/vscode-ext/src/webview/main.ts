// Webview entry point — wires the VS Code HostAdapter (hostAdapter.ts) to
// packages/ui's ViewerLayout, completing the end-to-end VS Code path (T028).
// The hard part (DuckDB-WASM worker bootstrap inside this exact kind of
// webview) was proven by the T005/T006 spikes and now lives, tested, in
// packages/core/src/duckdbService.ts — see research.md §4/§1 for the full
// investigation.
import { mount } from 'svelte'
import { setWorkerUrl } from 'maplibre-gl'
import { ViewerLayout, createViewerStore } from '@spatial-explorer/ui'
import {
  createVsCodeHostAdapter,
  getDuckDbAssets,
  getMaplibreWorkerUrl,
  getPrimaryFileName,
  logToHost,
  reportLoadState,
  reportQueryState,
  reportStyleState,
  reportSelectionChanged,
  reportViewState,
  signalReady,
} from './hostAdapter.js'
import { watchViewState } from './viewState.svelte.js'
import { watchQueryState } from './queryState.svelte.js'
import { watchStyleState } from './styleState.svelte.js'
// The VS Code token file: maps the shared --se-* tokens onto VS Code theme
// variables. Vite bundles it into main.css, which getHtml() links.
import './theme.css'

async function main(): Promise<void> {
  signalReady()

  const hostAdapter = createVsCodeHostAdapter()
  const duckdbAssets = await getDuckDbAssets()
  const fileName = await getPrimaryFileName()
  const store = createViewerStore(hostAdapter, duckdbAssets)
  // The asset URLs arrive before the file's bytes do: start DuckDB + spatial
  // now so initialization overlaps the transfer (design-plan.md §8.2).
  store.prewarm()

  // MapLibre's worker must be set before the first Map is constructed. A
  // worker can't be constructed straight from an asWebviewUri() URL in a
  // webview (research.md §4), so fetch the script on this thread and run it
  // from a same-origin blob: URL — the same technique as DuckDB's worker.
  // Without it the map silently draws no data at all.
  const workerSource = await (await fetch(await getMaplibreWorkerUrl())).text()
  setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })))

  const appRoot = document.getElementById('app')
  if (!appRoot) throw new Error('Missing #app root element')

  mount(ViewerLayout, {
    target: appRoot,
    props: { store, fileName },
  })

  watchViewState(store, reportViewState)
  watchQueryState(store, reportQueryState)
  watchStyleState(store, reportStyleState)

  const started = performance.now()
  await store.load()
  const elapsed = Math.round(performance.now() - started)
  const loaded = store.session.layer
  if (loaded) {
    logToHost(
      `Opened ${fileName}: ${loaded.source.features.toLocaleString()} features` +
        (loaded.truncated ? ` (showing ${loaded.rowCount.toLocaleString()})` : '') +
        (loaded.source.invalid ? `, ${loaded.source.invalid} with invalid geometry` : '') +
        `, ${loaded.geometryType}, ${loaded.sourceCrs.label}${loaded.crsAssumed ? ' (assumed)' : ''}` +
        (store.styleSource ? `, style ${store.styleSource}` : '') +
        ` in ${elapsed} ms` +
        (loaded.loadTimings ? ` (${Object.entries(loaded.loadTimings).map(([k, v]) => `${k} ${v}`).join(', ')} ms)` : '')
    )
  } else {
    logToHost(`Could not open ${fileName}: ${store.session.loadError?.message ?? 'unknown error'} (${elapsed} ms)`)
  }

  // Regression guard (a real bug reached a real user: the webview's CSS —
  // including maplibre-gl's own required canvas-positioning rules — wasn't
  // being linked into the HTML at all, so the map canvas rendered at its
  // default zero/intrinsic size and was effectively invisible, while the
  // table, unaffected by that missing CSS, rendered fine). Reports the
  // MapLibre canvas's real bounding-box size so a test can assert it's
  // actually nonzero, not just that the element exists in the DOM.
  let mapCanvasRect: { width: number; height: number } | null = null
  let renderedFeatureCount: number | null = null
  if (store.session.loadState === 'ready') {
    for (let i = 0; i < 40; i++) {
      const canvas = document.querySelector('.maplibregl-canvas')
      const rendered = (document.querySelector('.canvas-host') as HTMLElement | null)?.dataset.renderedFeatures
      if (canvas && rendered !== undefined) {
        const rect = canvas.getBoundingClientRect()
        mapCanvasRect = { width: rect.width, height: rect.height }
        renderedFeatureCount = Number(rendered)
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  reportLoadState(store.session.loadState, {
    // File-level totals (spec 001's meaning); rowCount is the displayed result.
    featureCount: store.session.layer?.source.features,
    invalidGeometryCount: store.session.layer?.source.invalid,
    rowCount: store.session.layer?.rowCount,
    errorMessage: store.session.loadError?.message,
    sourceCrsLabel: store.session.layer?.sourceCrs.label,
    crsAssumed: store.session.layer?.crsAssumed,
    extent: store.session.layer?.extent,
    mapCanvasRect,
    renderedFeatureCount,
    styleSource: store.styleSource,
    loadMs: elapsed,
    loadTimings: store.session.layer?.loadTimings,
  })

  // Test-only hook (T015): @vscode/test-electron cannot click inside this
  // webview's rendered DOM, so selection-sync is exercised by invoking the
  // same onSelectFeature path a real map/table click would — verifying the
  // real data flow (ViewerSession.selectedFeatureId propagation), not actual
  // mouse interaction.
  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as { type: string; id?: string | number | null; sql?: string; confirm?: 'all' | 'first' | 'cancel'; style?: unknown }
    if (msg.type === 'testRunQuery' && typeof msg.sql === 'string') {
      // Test-only (spec 002 T028): the same store action the Run button uses,
      // with the whole text selected, auto-answering the large-result dialog.
      const sql = msg.sql
      const confirm = msg.confirm ?? 'first'
      store.setQueryText(sql)
      const answer = setInterval(() => {
        if (store.pendingLargeResult) store.answerLargeResult(confirm)
      }, 50)
      void store.runQuery({ from: 0, to: sql.length }).finally(() => clearInterval(answer))
    } else if (msg.type === 'testSetStyle' && msg.style && typeof msg.style === 'object') {
      // Test-only (spec 003 T013): the same store action the style panel uses.
      store.setStyle(msg.style as Parameters<typeof store.setStyle>[0])
    } else if (msg.type === 'testSaveStyle') {
      void store.saveStyle()
    } else if (msg.type === 'testCancelQuery') {
      void store.cancelQuery()
    } else if (msg.type === 'testSelectFeature') {
      store.selectFeature(msg.id ?? null)
      reportSelectionChanged(store.session.selectedFeatureId)
    }
  })
}

void main()
