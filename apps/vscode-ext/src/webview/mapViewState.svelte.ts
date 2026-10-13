// Reports how the map draws the result (spec 010: the mode, the features in
// memory, the tile URL) to the extension host for the spatialExplorer._getMapView test hook.
import type { ViewerStore } from '@spatial-explorer/ui'

export function watchMapViewState(store: ViewerStore, report: (state: unknown) => void): () => void {
  return $effect.root(() => {
    $effect(() => {
      report(store.drawMode ? { mode: store.drawMode, features: store.mapData?.features.length ?? null, tileUrl: store.tileUrl, drawCalls: store.drawCalls } : null)
    })
  })
}
