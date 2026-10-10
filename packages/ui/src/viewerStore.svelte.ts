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
  resolveBasemap,
  themeAppearance,
  type BasemapCatalogEntry,
  type BasemapChoice,
  sanitizeStyle,
  sidecarStyleFileName,
  styleFileName,
  STYLE_FILE_EXTENSIONS,
  type DuckDbAssetUrls,
  type HostAdapter,
  type LayerStyle,
  type QuerySession,
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
  /** The open file's query session (spec 002), or null before a file is open. */
  readonly querySession: QuerySession | null
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
  /** 'auto' (the initial value) follows the host theme (FR-009/FR-017) until the user picks one. */
  readonly basemapChoice: BasemapChoice
  /** User-chosen blank background color; null = match the host theme (the default). Remembered via HostAdapter.saveState. */
  readonly blankColor: string | null
  setBlankColor(color: string | null): void
  readonly basemap: BasemapCatalogEntry
  /** Short FR-016 message after a basemap failure; null when fine. */
  readonly basemapNotice: string | null
  /** The opened file changed on disk since it was loaded (hosts that can watch files). */
  readonly sourceChanged: boolean
  reloadSource(): void
  setBasemap(choice: BasemapChoice): void
  reportBasemapFailure(message: string): void
  dismissBasemapNotice(): void
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
  let basemapChoice = $state<BasemapChoice>('auto')
  let basemapNotice = $state<string | null>(null)
  // Falls back to blank after a failure, until the user picks again.
  let basemapFailed = $state(false)
  let sourceChanged = $state(false)
  let blankColor = $state<string | null>(null)
  const BLANK_COLOR_KEY = 'basemap.blankColor'
  void hostAdapter
    .loadState<string | null>(BLANK_COLOR_KEY)
    .then((saved) => {
      if (typeof saved === 'string' && /^#[0-9a-f]{6}$/i.test(saved)) blankColor = saved
    })
    .catch(() => {})
  hostAdapter.onSourceChanged?.(() => {
    if (session.loadState === 'ready' || session.loadState === 'error') sourceChanged = true
  })

  session.basemapAppearance = themeAppearance(hostAdapter.getTheme())
  hostAdapter.onThemeChange((theme) => {
    const appearance = themeAppearance(theme)
    if (appearance !== session.basemapAppearance && basemapChoice === 'auto') {
      // A theme switch is a fresh attempt at the new default (FR-017).
      basemapFailed = false
      basemapNotice = null
    }
    session.basemapAppearance = appearance
    syncBasemapEnabled()
    themeRevision++
  })

  const basemap = $derived.by(() => {
    const entry = resolveBasemap(basemapChoice, session.basemapAppearance)
    return basemapFailed ? resolveBasemap('blank', session.basemapAppearance) : entry
  })
  /** Keeps the session's informational flag in step with the derived entry. */
  function syncBasemapEnabled(): void {
    session.basemapEnabled = basemap.type !== 'blank'
  }
  syncBasemapEnabled()

  let currentFileName: string | null = null
  // The viewer's query session (spec 002). Deliberately not $state: it holds
  // live engine connections, which must never be proxied or posted.
  let querySession: QuerySession | null = null

  async function load(): Promise<void> {
    session.loadState = 'loading'
    session.loadError = null
    session.selectedFeatureId = null
    try {
      const [ref] = await hostAdapter.openFiles()
      currentFileName = ref.displayName
      // One file per viewer: the previous file's views, tables and session
      // go before the next file's `layer` view is created.
      await querySession?.dispose().catch(() => {})
      querySession = null
      const opened = await openFile(ref, { hostAdapter, duckdbAssets })
      querySession = opened.session
      const layer = opened.layer
      session.layer = layer
      session.loadState = 'ready'
      applySidecar(layer.styleSidecar)
      // File-level metadata (FR-006): the whole file, not the displayed result.
      hostAdapter.setStatus({ crs: layer.sourceCrs.label, featureCount: layer.source.features })
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
    get querySession() {
      return querySession
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
    get sourceChanged() {
      return sourceChanged
    },
    reloadSource() {
      sourceChanged = false
      hostAdapter.reloadSource?.()
    },
    get basemapChoice() {
      return basemapChoice
    },
    get blankColor() {
      return blankColor
    },
    setBlankColor(color) {
      blankColor = color
      void hostAdapter.saveState(BLANK_COLOR_KEY, color).catch(() => {})
    },
    get basemap() {
      return basemap
    },
    get basemapNotice() {
      return basemapNotice
    },
    setBasemap(choice) {
      basemapChoice = choice
      basemapFailed = false
      basemapNotice = null
      syncBasemapEnabled()
    },
    reportBasemapFailure(message) {
      basemapFailed = true
      basemapNotice = message
      syncBasemapEnabled()
    },
    dismissBasemapNotice() {
      basemapNotice = null
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
