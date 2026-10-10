// Reactive ViewerSession state (Svelte 5 runes) — the one place
// packages/ui holds mutable state. Business logic (parsing, DuckDB, style
// interchange) stays in packages/core; this just drives the UI from a
// ViewerSession and routes file I/O through the HostAdapter.
import {
  DEFAULT_LAYER_STYLE,
  createInitialViewerSession,
  exportStyle,
  importStyle,
  openFile,
  prewarmDuckDb,
  sanitizeStyle,
  sidecarStyleFileName,
  styleFileName,
  STYLE_FILE_EXTENSIONS,
  type DuckDbAssetUrls,
  type HostAdapter,
  type LayerStyle,
  type StyleFormat,
  type ViewerSession,
} from '@spatial-explorer/core'

/** A short-lived message shown in the style panel (save/import outcome, format caveats). */
export interface StyleNotice {
  kind: 'info' | 'warning' | 'error'
  text: string
}

export interface ViewerStore {
  readonly session: ViewerSession
  readonly style: LayerStyle
  /** Where the current style came from, e.g. "world.qml"; null for defaults or local edits. */
  readonly styleSource: string | null
  readonly styleNotice: StyleNotice | null
  /** True when the style was edited since it was loaded, imported or saved. */
  readonly styleDirty: boolean
  /** Bumps on every host theme change, so canvas colors can be re-read (CLAUDE.md theming). */
  readonly themeRevision: number
  /** Bumps when a feature should be zoomed to; MapView reacts to it. */
  readonly zoomRequest: { id: string | number; seq: number } | null
  readonly canSaveSidecar: boolean
  prewarm(): void
  load(): Promise<void>
  selectFeature(id: string | number | null): void
  zoomToFeature(id: string | number): void
  setCursor(coords: { lon: number; lat: number } | null): void
  setStyle(patch: Partial<LayerStyle>): void
  resetStyle(): void
  saveStyle(): Promise<void>
  exportStyle(format: StyleFormat): Promise<void>
  importStyle(): Promise<void>
  dismissStyleNotice(): void
}

export function createViewerStore(hostAdapter: HostAdapter, duckdbAssets: DuckDbAssetUrls): ViewerStore {
  const session = $state<ViewerSession>(createInitialViewerSession())
  let style = $state<LayerStyle>({ ...DEFAULT_LAYER_STYLE })
  let styleSource = $state<string | null>(null)
  let styleNotice = $state<StyleNotice | null>(null)
  let styleDirty = $state(false)
  let themeRevision = $state(0)
  let zoomRequest = $state<{ id: string | number; seq: number } | null>(null)

  session.basemapAppearance = hostAdapter.getTheme() === 'dark' ? 'dark' : 'light'
  hostAdapter.onThemeChange((theme) => {
    session.basemapAppearance = theme === 'dark' ? 'dark' : 'light'
    themeRevision++
  })

  let currentFileName: string | null = null

  async function load(): Promise<void> {
    session.loadState = 'loading'
    session.loadError = null
    session.selectedFeatureId = null
    try {
      const [ref] = await hostAdapter.openFiles()
      currentFileName = ref.displayName
      const layer = await openFile(ref, { hostAdapter, duckdbAssets })
      session.layer = layer
      session.loadState = 'ready'
      applySidecar(layer.styleSidecar)
      hostAdapter.setStatus({ crs: layer.sourceCrs.label, featureCount: layer.featureCount })
    } catch (err) {
      session.layer = null
      session.loadState = 'error'
      session.loadError = { message: err instanceof Error ? err.message : String(err) }
    }
  }

  function applySidecar(sidecar: { fileName: string; text: string } | null): void {
    style = { ...DEFAULT_LAYER_STYLE }
    styleSource = null
    styleNotice = null
    styleDirty = false
    if (!sidecar) return
    try {
      const result = importStyle(sidecar.fileName, sidecar.text)
      style = result.style
      styleSource = sidecar.fileName
      if (result.notes.length > 0) styleNotice = { kind: 'warning', text: `${sidecar.fileName}: ${result.notes.join(' ')}` }
    } catch (err) {
      // A malformed sidecar must never block viewing the data itself.
      styleNotice = { kind: 'warning', text: `Ignored ${sidecar.fileName}: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async function saveStyle(): Promise<void> {
    if (!session.layer || !currentFileName) return
    const name = sidecarStyleFileName(currentFileName)
    const { text, notes } = exportStyle(style, 'qml', session.layer.geometryType, currentFileName)
    try {
      const result = hostAdapter.saveSidecar ? await hostAdapter.saveSidecar(name, text) : await hostAdapter.saveFile(name, text)
      if (!result.saved) return
      styleSource = name
      styleDirty = false
      styleNotice = {
        kind: notes.length > 0 ? 'warning' : 'info',
        text: [`Saved ${result.location ?? name}. QGIS loads it automatically with the data.`, ...notes].join(' '),
      }
    } catch (err) {
      styleNotice = { kind: 'error', text: `Could not save ${name}: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async function exportStyleAs(format: StyleFormat): Promise<void> {
    if (!session.layer || !currentFileName) return
    const name = styleFileName(currentFileName, format)
    const { text, notes } = exportStyle(style, format, session.layer.geometryType, currentFileName)
    try {
      const result = await hostAdapter.saveFile(name, text)
      if (!result.saved) return
      styleNotice = { kind: notes.length > 0 ? 'warning' : 'info', text: [`Exported ${result.location ?? name}.`, ...notes].join(' ') }
    } catch (err) {
      styleNotice = { kind: 'error', text: `Could not export ${name}: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async function importStyleFromFile(): Promise<void> {
    try {
      const picked = await hostAdapter.pickTextFile({ title: 'Import layer style', extensions: STYLE_FILE_EXTENSIONS })
      if (!picked) return
      const result = importStyle(picked.name, picked.text)
      style = result.style
      styleSource = picked.name
      styleDirty = false
      styleNotice = result.notes.length > 0 ? { kind: 'warning', text: result.notes.join(' ') } : { kind: 'info', text: `Applied ${picked.name}.` }
    } catch (err) {
      styleNotice = { kind: 'error', text: err instanceof Error ? err.message : String(err) }
    }
  }

  return {
    get session() {
      return session
    },
    get style() {
      return style
    },
    get styleSource() {
      return styleSource
    },
    get styleNotice() {
      return styleNotice
    },
    get styleDirty() {
      return styleDirty
    },
    get themeRevision() {
      return themeRevision
    },
    get zoomRequest() {
      return zoomRequest
    },
    get canSaveSidecar() {
      return typeof hostAdapter.saveSidecar === 'function'
    },
    prewarm() {
      prewarmDuckDb(duckdbAssets)
    },
    load,
    selectFeature(id) {
      session.selectedFeatureId = id
    },
    zoomToFeature(id) {
      session.selectedFeatureId = id
      zoomRequest = { id, seq: (zoomRequest?.seq ?? 0) + 1 }
    },
    setCursor(coords) {
      session.cursorCoordinates = coords
      hostAdapter.setStatus({ cursor: coords })
    },
    setStyle(patch) {
      style = sanitizeStyle({ ...style, ...patch })
      styleDirty = true
    },
    resetStyle() {
      style = { ...DEFAULT_LAYER_STYLE }
      styleSource = null
      styleNotice = null
      styleDirty = true
    },
    saveStyle,
    exportStyle: exportStyleAs,
    importStyle: importStyleFromFile,
    dismissStyleNotice() {
      styleNotice = null
    },
  }
}
