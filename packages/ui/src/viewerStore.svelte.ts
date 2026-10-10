// Reactive ViewerSession state (Svelte 5 runes) — the one place
// packages/ui holds mutable state. Business logic (parsing, DuckDB) stays in
// packages/core; this just drives the UI from a ViewerSession.
import {
  createInitialViewerSession,
  openFile,
  type DuckDbAssetUrls,
  type HostAdapter,
  type ViewerSession,
} from '@spatial-explorer/core'

export interface ViewerStore {
  readonly session: ViewerSession
  load(): Promise<void>
  selectFeature(id: string | number | null): void
  setCursor(coords: { lon: number; lat: number } | null): void
}

export function createViewerStore(hostAdapter: HostAdapter, duckdbAssets: DuckDbAssetUrls): ViewerStore {
  const session = $state<ViewerSession>(createInitialViewerSession())

  session.basemapAppearance = hostAdapter.getTheme() === 'dark' ? 'dark' : 'light'
  hostAdapter.onThemeChange((theme) => {
    session.basemapAppearance = theme === 'dark' ? 'dark' : 'light'
  })

  async function load(): Promise<void> {
    session.loadState = 'loading'
    try {
      const [ref] = await hostAdapter.openFiles()
      const layer = await openFile(ref, { hostAdapter, duckdbAssets })
      session.layer = layer
      session.loadState = 'ready'
      hostAdapter.setStatus({ crs: layer.sourceCrs.label, featureCount: layer.featureCount })
    } catch (err) {
      session.loadState = 'error'
      session.loadError = { message: err instanceof Error ? err.message : String(err) }
    }
  }

  function selectFeature(id: string | number | null): void {
    session.selectedFeatureId = id
  }

  function setCursor(coords: { lon: number; lat: number } | null): void {
    session.cursorCoordinates = coords
    hostAdapter.setStatus({ cursor: coords })
  }

  return {
    get session() {
      return session
    },
    load,
    selectFeature,
    setCursor,
  }
}
