// Reports the drawn map view (spec 007 T031) to the extension host for the
// spatialExplorer._getMapView test hook.
import type { ViewerStore } from '@spatial-explorer/ui'

export function watchMapViewState(store: ViewerStore, report: (state: unknown) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      const v = store.viewFeatures
      report(v ? { generation: v.generation, drawn: v.features.length, inView: v.inView, thinned: v.thinned } : null)
    })
  })
}
