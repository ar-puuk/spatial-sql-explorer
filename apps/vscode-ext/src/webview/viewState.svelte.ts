// Reports the viewer's basemap/theme state to the extension host whenever it
// changes: for the output channel (basemap fallbacks) and for the
// `spatialExplorer._getViewState` test hook (T039-T041: theme-matched
// default, theme change while open, blank toggle).
import type { ViewerStore } from '@spatial-explorer/ui'

export function watchViewState(
  store: ViewerStore,
  report: (state: { basemapId: string; appearance: string; basemapNotice: string | null; sourceChanged: boolean }) => void
): () => void {
  return $effect.root(() => {
    $effect(() => {
      report({ basemapId: store.basemap.id, appearance: store.session.basemapAppearance, basemapNotice: store.basemapNotice, sourceChanged: store.sourceChanged })
    })
  })
}
