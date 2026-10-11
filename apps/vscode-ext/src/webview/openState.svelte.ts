// Reports the open's phase and whole-file facts to the extension host for the
// spatialExplorer._getOpenState test hook (spec 007 T019). @vscode/test-electron
// can't see inside the webview, so this is how tests observe an open.
import type { ViewerStore } from '@spatial-explorer/ui'

export function watchOpenState(store: ViewerStore, report: (state: unknown) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      const ready = store.session.loadState === 'ready'
      report({
        phase: ready ? 'ready' : (store.openPhase ?? store.session.loadState),
        facts: store.session.layer?.facts ?? store.openFacts,
      })
    })
  })
}
