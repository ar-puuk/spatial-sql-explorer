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
  type QueryHistoryEntry,
  type QuerySession,
  type RunOutcome,
  type EngineError,
  type Layer,
  DEFAULT_QUERY,
  describeOutcome,
  layerFromResult,
  type StyleFormat,
  type ViewerSession,
} from '@spatial-explorer/core'

/** A short-lived message shown in the style panel (save/import outcome, format caveats). */
export interface StyleNotice {
  kind: 'info' | 'warning' | 'error'
  text: string
}

/** Query lifecycle (spec 002 data-model.md, "Query state transitions"). */
export type QueryPhase = 'idle' | 'running' | 'awaitingConfirm' | 'succeeded' | 'failed' | 'cancelled' | 'refused'

export interface QueryTableInfo {
  name: string
  alias: string | null
  crsLabel: string
  rows: number
}

export interface ViewerStore {
  readonly session: ViewerSession
  /** The open file's query session (spec 002), or null before a file is open. */
  readonly querySession: QuerySession | null
  // --- spec 002: query ---------------------------------------------------
  readonly queryText: string
  setQueryText(text: string): void
  readonly queryPhase: QueryPhase
  /** The status line text (FR-010), e.g. "✓ 8 rows · 8 mapped · 84 ms". */
  readonly queryStatus: string
  readonly queryError: EngineError | null
  /** Position of the last error in editor offsets, for the editor squiggle (FR-008). */
  readonly queryErrorRange: { from: number; to: number } | null
  readonly queryTable: QueryTableInfo | null
  readonly resultCrs: { label: string; source: 'layer' | 'detected' | 'engine' | 'override' } | null
  readonly crsOverride: number | null
  setCrsOverride(epsg: number | null): void
  readonly fetchProgress: { fetched: number; total: number } | null
  readonly runStartedAt: number | null
  readonly pendingLargeResult: { rowCount: number } | null
  answerLargeResult(choice: 'all' | 'first' | 'cancel'): void
  /** The layer to draw: the result, or (for a table-only result) the previous one, dimmed (FR-006). */
  readonly mapLayer: Layer | null
  readonly mapDimmed: boolean
  /** Bumps after every finished run (test hooks wait on it). */
  readonly runCount: number
  /** Text of the last statement that actually ran. */
  readonly lastRunText: string | null
  /** The displayed result's mapped geometry column, or null for a table-only result. */
  readonly resultGeometryColumn: string | null
  /** Recent queries for the open file, newest first (FR-016; US5). */
  readonly history: QueryHistoryEntry[]
  runQuery(selection: { from: number; to: number }): Promise<void>
  /** True when the editor holds edits that haven't run yet (Reset asks first). */
  readonly queryEdited: boolean
  /** FR-011: back to the view as opened: default query, rows, extent, style. */
  resetQuery(): Promise<void>
  cancelQuery(): Promise<void>
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

  // --- spec 002: query state ------------------------------------------------
  let queryText = $state(DEFAULT_QUERY)
  let queryPhase = $state<QueryPhase>('idle')
  let queryStatus = $state('')
  let queryError = $state<EngineError | null>(null)
  let queryErrorRange = $state<{ from: number; to: number } | null>(null)
  let queryTable = $state<QueryTableInfo | null>(null)
  let resultCrs = $state<{ label: string; source: 'layer' | 'detected' | 'engine' | 'override' } | null>(null)
  let crsOverride = $state<number | null>(null)
  let fetchProgress = $state<{ fetched: number; total: number } | null>(null)
  let runStartedAt = $state<number | null>(null)
  let pendingLargeResult = $state<{ rowCount: number } | null>(null)
  let largeResultResolve: ((choice: 'all' | 'first' | 'cancel') => void) | null = null
  let mapLayer = $state.raw<Layer | null>(null)
  let mapDimmed = $state(false)
  let runCount = $state(0)
  let lastRun: { text: string; selection: { from: number; to: number } } | null = null
  let lastRunText = $state<string | null>(null)
  // The view as opened, restored by Reset (FR-011). Kept as the original
  // object: re-running LIMIT 1000 would lose the whole-file fit and the
  // "Showing 1,000 of N" truncation.
  let initialLayer: Layer | null = null
  let resultGeometryColumn = $state<string | null>('geom')
  const history = $state<QueryHistoryEntry[]>([]) // filled by US5 (T045-T046)

  function resetQueryState(): void {
    queryText = DEFAULT_QUERY
    queryPhase = 'idle'
    queryStatus = ''
    queryError = null
    queryErrorRange = null
    crsOverride = null
    fetchProgress = null
    runStartedAt = null
    pendingLargeResult = null
    mapLayer = null
    mapDimmed = false
    lastRun = null
    lastRunText = null
    resultGeometryColumn = 'geom'
    const t = querySession?.table
    queryTable = t ? { name: t.name, alias: t.alias, crsLabel: t.crs.label, rows: t.totals.rows } : null
    resultCrs = t ? { label: t.crs.label, source: 'layer' } : null
  }

  async function runQuery(selection: { from: number; to: number }): Promise<void> {
    const qs = querySession
    if (!qs || queryPhase === 'running' || queryPhase === 'awaitingConfirm') return
    queryPhase = 'running'
    queryError = null
    queryErrorRange = null
    fetchProgress = null
    runStartedAt = performance.now()
    lastRun = { text: queryText, selection }
    const outcome: RunOutcome = await qs.run(
      { editorText: queryText, selection, crsOverride },
      {
        confirmLargeResult: (rowCount) =>
          new Promise((resolve) => {
            queryPhase = 'awaitingConfirm'
            pendingLargeResult = { rowCount }
            largeResultResolve = (choice) => {
              pendingLargeResult = null
              largeResultResolve = null
              queryPhase = 'running'
              runStartedAt = performance.now()
              resolve(choice)
            }
          }),
        onProgress: (fetched, total) => {
          if (total > 2000) fetchProgress = { fetched, total }
        },
      }
    )
    applyOutcome(outcome)
  }

  function applyOutcome(outcome: RunOutcome): void {
    fetchProgress = null
    runStartedAt = null
    queryStatus = describeOutcome(outcome)
    switch (outcome.kind) {
      case 'result': {
        const built = outcome.result
        const previous = session.layer
        if (built.geometryColumn) {
          mapLayer = null
          mapDimmed = false
        } else {
          // FR-006: nothing to map; keep the last drawn layer, dimmed.
          mapLayer = mapDimmed ? mapLayer : previous
          mapDimmed = true
        }
        if (previous) session.layer = layerFromResult(previous, built)
        session.selectedFeatureId = null
        resultCrs = built.resultCrs ? { label: built.resultCrs.crs.label, source: built.resultCrs.source } : resultCrs
        resultGeometryColumn = built.geometryColumn
        queryPhase = 'succeeded'
        lastRunText = outcome.statement.text
        break
      }
      case 'ddl':
        queryPhase = 'succeeded'
        lastRunText = outcome.statement.text
        break
      case 'refused':
        queryPhase = 'refused'
        break
      case 'error':
        queryPhase = 'failed'
        queryError = outcome.error
        lastRunText = outcome.statement.text
        if (outcome.error.position) {
          // Underline the whole token at the error (an identifier, a quoted
          // name or a string), not a single character.
          const from = outcome.error.position.offset
          const token = /^("[^"]*"|'[^']*'|[\p{L}\p{N}_.$]+)/u.exec(queryText.slice(from))?.[0] ?? queryText.charAt(from)
          queryErrorRange = { from, to: Math.min(queryText.length, from + Math.max(1, token.length)) }
        }
        break
      case 'cancelled':
        queryPhase = 'cancelled'
        break
      case 'empty':
        queryPhase = 'idle'
        break
    }
    runCount++
  }

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
      resetQueryState()
      const layer = opened.layer
      initialLayer = layer
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
    get queryText() {
      return queryText
    },
    setQueryText(text) {
      queryText = text
      // An edit invalidates the error squiggle (FR-008).
      if (queryErrorRange) queryErrorRange = null
    },
    get queryEdited() {
      return queryText !== DEFAULT_QUERY && queryText !== (lastRunText ?? DEFAULT_QUERY)
    },
    async resetQuery() {
      if (queryPhase === 'running' || queryPhase === 'awaitingConfirm') await this.cancelQuery()
      const original = initialLayer
      resetQueryState()
      if (original) {
        session.layer = original
        session.selectedFeatureId = null
        applySidecar(original.styleSidecar)
      }
      queryStatus = 'Reset to the original view'
    },
    get queryPhase() {
      return queryPhase
    },
    get queryStatus() {
      return queryStatus
    },
    get queryError() {
      return queryError
    },
    get queryErrorRange() {
      return queryErrorRange
    },
    get queryTable() {
      return queryTable
    },
    get resultCrs() {
      return resultCrs
    },
    get crsOverride() {
      return crsOverride
    },
    setCrsOverride(epsg) {
      crsOverride = epsg
      // Re-run what's displayed with the new CRS.
      if (lastRun && queryPhase !== 'running') {
        const { selection } = lastRun
        queryText = lastRun.text
        void runQuery(selection)
      }
    },
    get fetchProgress() {
      return fetchProgress
    },
    get runStartedAt() {
      return runStartedAt
    },
    get pendingLargeResult() {
      return pendingLargeResult
    },
    answerLargeResult(choice) {
      largeResultResolve?.(choice)
    },
    get mapLayer() {
      return mapLayer
    },
    get mapDimmed() {
      return mapDimmed
    },
    get runCount() {
      return runCount
    },
    get lastRunText() {
      return lastRunText
    },
    get resultGeometryColumn() {
      return resultGeometryColumn
    },
    get history() {
      return history
    },
    runQuery,
    async cancelQuery() {
      // A pending large-result question is answered "cancel"; otherwise the engine is interrupted.
      if (largeResultResolve) largeResultResolve('cancel')
      await querySession?.cancel()
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
