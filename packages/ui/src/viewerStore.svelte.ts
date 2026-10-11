// Reactive ViewerSession state (Svelte 5 runes) — the one place
// packages/ui holds mutable state. Business logic (parsing, DuckDB, style
// interchange) stays in packages/core; this just drives the UI from a
// ViewerSession and routes file I/O through the HostAdapter.
import { untrack } from 'svelte'
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
  setClassVisible,
  resolveStyle,
  type ResolvedStyle,
  type ResolveInput,
  sidecarStyleFileName,
  styleFileName,
  STYLE_FILE_EXTENSIONS,
  type DuckDbAssetUrls,
  type HostAdapter,
  type LayerStyle,
  type ValueHistogram,
  rendererOf,
  type QueryHistoryEntry,
  addHistoryEntry,
  historyEntryFromOutcome,
  loadHistory,
  recordHistory,
  type CatalogSnapshot,
  type QuerySession,
  type RunOutcome,
  planExport,
  exportErrorMessage,
  QueryCancelledError,
  type ExportPlan,
  type ExportRequest,
  type EngineError,
  type Layer,
  type OpenedFileRef,
  DEFAULT_QUERY,
  describeOutcome,
  layerFromResult,
  type StyleFormat,
  type ViewerSession,
  type DatasetFacts,
  type OpenPhase,
  type Feature,
  type ViewFeatures,
  type TablePage,
  PAGE_SIZE,
  viewCapFor,
  ViewSkippedError,
  WorkPreemptedError,
  OutOfMemoryError,
} from '@spatial-explorer/core'
import { formatFromFileName } from '@spatial-explorer/core'
import { openTilesArchive, TILES_ONLY_REASON, type TilesArchive } from './pmtilesSource.js'

/** The attribute columns a style draws from (spec 007: map views read only these). */
function styleColumns(style: LayerStyle): string[] {
  const r = style.renderer
  return r && r.kind !== 'single' && r.column ? [r.column] : []
}

/** A short-lived message shown in the style panel (save/import outcome, format caveats). */
/** The result of the last export (spec 005 data-model ExportOutcome). */
export type ExportOutcome =
  | { kind: 'saved'; location: string; rows: number; bytes: number; notices: string[]; durationMs: number }
  | { kind: 'notSaved' }
  | { kind: 'cancelled'; durationMs: number }
  | { kind: 'failed'; message: string }

export interface StyleNotice {
  kind: 'info' | 'warning' | 'error'
  text: string
}

/** Query lifecycle (spec 002 data-model.md, "Query state transitions"). */
export type QueryPhase = 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'refused'

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
  readonly runStartedAt: number | null
  /** Spec 007: the attribute table pages the whole result (FR-011). */
  readonly tableTotal: number
  readonly tableSort: { column: string; dir: 'asc' | 'desc' } | null
  /** Bumps when the result or the sort changes: loaded pages are stale. */
  readonly tableRevision: number
  /** A big result whose pages and views re-run the query (said once in the table header). */
  readonly tableReRuns: boolean
  setTableSort(sort: { column: string; dir: 'asc' | 'desc' } | null): void
  /** One page of rows (PAGE_SIZE) at `offset`, in the current sort; null when there's nothing to page. */
  loadPage(offset: number): Promise<TablePage | null>
  /** The layer to draw: the result, or (for a table-only result) the previous one, dimmed (FR-006). */
  readonly mapLayer: Layer | null
  readonly mapDimmed: boolean
  /** Bumps after every finished run (test hooks wait on it). */
  readonly runCount: number
  // --- Spec 005: export ---------------------------------------------------
  readonly exportOpen: boolean
  openExport(): void
  closeExport(): void
  readonly exportRequest: ExportRequest
  setExportRequest(patch: Partial<ExportRequest>): void
  /** What an export would do now, or null when there's nothing to export. */
  readonly exportPlan: ExportPlan | null
  /** Why Export is unavailable right now (a query is running, nothing open), or null. */
  readonly exportDisabled: string | null
  readonly exportPhase: 'idle' | 'running' | 'done' | 'failed' | 'cancelled'
  /** Rows written (null while an engine COPY runs) and when the export started. */
  readonly exportProgress: { rows: number | null; startedAt: number } | null
  readonly exportOutcome: ExportOutcome | null
  runExport(): Promise<void>
  cancelExport(): Promise<void>
  /** Text of the last statement that actually ran. */
  readonly lastRunText: string | null
  /** The displayed result's mapped geometry column, or null for a table-only result. */
  readonly resultGeometryColumn: string | null
  /** Recent queries for the open file, newest first (FR-016; US5). */
  readonly history: QueryHistoryEntry[]
  /** Puts a history entry in the editor without running it (FR-016). */
  loadFromHistory(entry: QueryHistoryEntry): void
  runQuery(selection: { from: number; to: number }): Promise<void>
  /** Live catalog for autocomplete (FR-015); refreshed after open and after temp DDL. */
  readonly catalog: CatalogSnapshot | null
  /** True when the editor holds edits that haven't run yet (Reset asks first). */
  readonly queryEdited: boolean
  /** FR-011: back to the view as opened: default query, rows, extent, style. */
  resetQuery(): Promise<void>
  cancelQuery(): Promise<void>
  readonly style: LayerStyle
  /** The style resolved against the displayed result (spec 003): what the map and legend draw. */
  readonly resolvedStyle: ResolvedStyle
  /** The displayed result without reactive proxies, for classification and pickers. */
  readonly displayedLayer: Layer | null
  /** Spec 007: a style is being classified over a big result (shown after 300 ms). */
  readonly classifying: boolean
  /** Spec 008 FR-003: the graduated column's value distribution, or null (not graduated, or loading). */
  readonly styleHistogram: ValueHistogram | null
  /** What the style panel resolves against: columns, rows, distinct counts. */
  readonly styleInput: ResolveInput | null
  /** Legend collapsed (spec 003 FR-010), remembered via HostAdapter state. */
  readonly legendCollapsed: boolean
  setLegendCollapsed(collapsed: boolean): void
  /** FR-009: hide or show one class on the map. */
  setClassVisible(key: string, visible: boolean): void
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
  /**
   * Spec 007 T044: a FlatGeobuf read in parts. The map works; queries, the
   * table, thematic styles and export wait for `loadWhole()`. Null otherwise.
   */
  readonly needsLoad: { sizeLabel: string } | null
  /** Re-opens the file whole into memory (progress and Cancel through the open). */
  loadWhole(): Promise<void>
  /** Spec 007 US5: the open PMTiles archive (the map draws its tiles), or null. */
  readonly tiles: TilesArchive | null
  /** FR-009a: why SQL, the table, styling and export aren't available (PMTiles), or null. */
  readonly tilesOnlyReason: string | null
  /** A PMTiles feature clicked on the map: shown by the inspector. */
  inspectTileFeature(feature: Feature | null): void
  /** Spec 007 FR-004: a whole read over the threshold, waiting for the user (ReadWholeDialog). */
  readonly wholeReadPrompt: { sizeBytes: number; format: string } | null
  answerWholeRead(open: boolean): void
  /** Spec 007: the open in progress (null when none), its whole-file facts as soon as known, and Cancel (FR-001, FR-002). */
  readonly openPhase: OpenPhase | null
  readonly openStartedAt: number | null
  readonly openFacts: DatasetFacts | null
  cancelOpen(): Promise<void>
  /** Spec 007: the features drawn for the current map view (FR-005), and what the map should say about them (FR-006, FR-016). */
  readonly viewFeatures: ViewFeatures | null
  readonly viewLoading: boolean
  readonly viewNotice: { text: string; kind: 'info' | 'warning'; dismissible: boolean } | null
  /** A selected feature outside the drawn set, fetched by id and drawn highlighted (FR-008). */
  readonly outsideFeature: Feature | null
  /** The full record of a map-selected feature (view rows carry only the style's columns). */
  readonly detailFeature: Feature | null
  /** The map drew the latest view data (MapLibre idle after setData). */
  notifyPainted(): void
  /** The map moved (debounced): load the result's features for this WGS84 view. */
  requestView(bbox: [number, number, number, number], zoom: number, widthPx?: number): Promise<void>
  dismissViewNotice(): void
  /** The last view the map asked for (WGS84). */
  readonly lastViewBbox: [number, number, number, number] | null
  /** Moves the camera (test hooks); MapView applies each new request once. */
  readonly cameraRequest: { center: [number, number]; zoom: number; seq: number } | null
  jumpTo(center: [number, number], zoom: number): void
  selectFeature(id: string | number | null): void
  zoomToFeature(id: string | number): void
  setCursor(coords: { lon: number; lat: number } | null): void
  setStyle(patch: Partial<LayerStyle>): void
  /**
   * Spec 008 FR-004: shows `next` on the map and legend without committing it
   * (not marked modified, not saved). `null` restores the committed style. The
   * next `setStyle` commits on top of the committed style, not the preview.
   */
  previewStyle(next: LayerStyle | null): void
  resetStyle(): void
  saveStyle(): Promise<void>
  /** Spec 008 FR-006: the Save menu. `qml` is the sidecar (same as `saveStyle`); others are saved or downloaded. */
  saveStyleAs(format: StyleFormat): Promise<void>
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
  const LEGEND_COLLAPSED_KEY = 'legend.collapsed'
  let legendCollapsed = $state(false)
  void hostAdapter
    .loadState<boolean>(LEGEND_COLLAPSED_KEY)
    .then((saved) => {
      if (typeof saved === 'boolean') legendCollapsed = saved
    })
    .catch(() => {})
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
  let runStartedAt = $state<number | null>(null)
  // Spec 007: the table's paging state.
  let tableSort = $state<{ column: string; dir: 'asc' | 'desc' } | null>(null)
  let tableRevision = $state(0)
  let mapLayer = $state.raw<Layer | null>(null)
  // The displayed result, unproxied: classification walks every row, which
  // must not create a reactive signal per attribute (spec 003 T012). Kept in
  // step with session.layer by setLayer().
  let displayedLayer = $state.raw<Layer | null>(null)
  function setLayer(l: Layer | null): void {
    displayedLayer = l
    session.layer = l
    // A new result: the table's loaded pages and sort belong to the old one.
    tableSort = null
    tableRevision++
  }
  // Spec 007 FR-012: styles are resolved by the engine over the whole result
  // (fetched values for small results, SQL statistics for big ones).
  let resolvedStyle = $state.raw<ResolvedStyle>(resolveStyle(DEFAULT_LAYER_STYLE, null))
  let styleDistinct = $state.raw<Record<string, number>>({})
  let classifying = $state(false)
  let styleGeneration = 0
  let distinctFor: Layer | null = null
  // Spec 008 FR-003: the graduated column's distribution, loaded once per result and column.
  let styleHistogram = $state.raw<ValueHistogram | null>(null)
  let histogramKey: { layer: Layer; column: string } | null = null
  /** The committed style while a preview is shown (FR-004), else null. */
  let previewBase: LayerStyle | null = null

  async function refreshHistogram(s: LayerStyle, layer: Layer | null, qs: QuerySession | null): Promise<void> {
    const r = rendererOf(s)
    if (r.kind !== 'graduated' || !r.column || !layer || !qs) {
      histogramKey = null
      styleHistogram = null
      return
    }
    if (histogramKey && histogramKey.layer === layer && histogramKey.column === r.column) return
    const key = { layer, column: r.column }
    histogramKey = key
    styleHistogram = null
    try {
      const h = await retryWhenBusy(qs, () => qs.valueHistogram(key.column))
      if (histogramKey === key) styleHistogram = h
    } catch (err) {
      if (!(err instanceof QueryCancelledError) && !noteOutOfMemory(err)) console.warn('Spatial Explorer: value distribution failed', err)
    }
  }

  async function refreshStyle(): Promise<void> {
    const generation = ++styleGeneration
    const s = style
    const layer = displayedLayer
    const qs = querySession
    if (!qs || !layer) {
      void refreshHistogram(s, layer, qs)
      resolvedStyle = resolveStyle(s, layer ? { columns: layer.columns, rowCount: layer.totalRows } : null)
      return
    }
    const slow = setTimeout(() => {
      if (generation === styleGeneration) classifying = true
    }, 300)
    try {
      if (distinctFor !== layer) {
        distinctFor = layer
        styleDistinct = await retryWhenBusy(qs, () => qs.distinctCounts()).catch(() => ({}))
      }
      const r = await retryWhenBusy(qs, () => qs.resolveStyle(s))
      if (generation === styleGeneration) {
        resolvedStyle = r
        // After the style: the chart is secondary, and must not compete with it for the engine.
        void refreshHistogram(s, layer, qs)
      }
    } catch (err) {
      if (!(err instanceof QueryCancelledError) && !noteOutOfMemory(err)) console.warn('Spatial Explorer: style failed', err)
    } finally {
      clearTimeout(slow)
      if (generation === styleGeneration) classifying = false
    }
  }

  /** Runs engine work, waiting out a running query or export (it never queues behind them). */
  async function retryWhenBusy<T>(qs: QuerySession, work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work()
      } catch (err) {
        // Interrupted by user work: always ask again. Blocked by it: a few times.
        const preempted = err instanceof WorkPreemptedError
        const busy = err instanceof Error && /already running/.test(err.message)
        if (!preempted && (attempt >= 20 || !busy)) throw err
        await qs.whenIdle()
      }
    }
  }

  $effect.root(() => {
    $effect(() => {
      void style
      void displayedLayer
      void untrack(() => refreshStyle())
    })
  })
  let mapDimmed = $state(false)
  let runCount = $state(0)

  // --- Spec 005: export ------------------------------------------------------
  const EXPORT_PREFS_KEY = 'export.prefs'
  let exportOpen = $state(false)
  let exportRequest = $state<ExportRequest>({ format: 'geoparquet', crs: 'result', csvGeometry: 'wkt' })
  void hostAdapter
    .loadState<Partial<ExportRequest>>(EXPORT_PREFS_KEY)
    .then((saved) => {
      // Spec 007: older saved prefs may carry `rows` (the removed rows choice); only known fields are kept.
      if (saved && typeof saved === 'object') {
        const { format, crs, csvGeometry } = { ...exportRequest, ...saved }
        exportRequest = { format, crs, csvGeometry }
      }
    })
    .catch(() => {})
  let exportPhase = $state<'idle' | 'running' | 'done' | 'failed' | 'cancelled'>('idle')
  let exportProgress = $state<{ rows: number | null; startedAt: number } | null>(null)
  let exportOutcome = $state.raw<ExportOutcome | null>(null)
  // The session's facts aren't reactive: runCount and the displayed layer
  // change whenever they do, so the plan re-derives from those.
  const exportPlan = $derived.by((): ExportPlan | null => {
    void runCount
    const layer = displayedLayer
    const facts = querySession?.lastResult
    if (!layer || !facts) return null
    return planExport($state.snapshot(exportRequest), { sourceName: currentFileName ?? 'layer', layer, facts })
  })
  // Spec 007 T044: the opened file, to load it whole later, and its size.
  let openedRef: OpenedFileRef | null = null
  let openedSize = $state<number | null>(null)

  const sizeLabel = (bytes: number): string =>
    bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
  const needsLoad = $derived(session.layer?.facts?.needsLoad && openedSize !== null ? { sizeLabel: sizeLabel(openedSize) } : null)

  // Spec 007 US5: a PMTiles archive is drawn by the map from its tiles; there is no engine session.
  let tilesArchive = $state.raw<TilesArchive | null>(null)
  const tilesOnlyReason = $derived(tilesArchive ? TILES_ONLY_REASON : null)
  const exportDisabled = $derived(
    !displayedLayer
      ? 'Open a file first.'
      : tilesOnlyReason
        ? tilesOnlyReason
        : needsLoad
        ? `Load the whole file (${needsLoad.sizeLabel}) to export it.`
        : queryPhase === 'running'
          ? 'Wait for the running query to finish.'
          : (exportPlan?.blocked ?? null)
  )
  let lastRun: { text: string; selection: { from: number; to: number } } | null = null
  let lastRunText = $state<string | null>(null)
  // The view as opened, restored by Reset (FR-011). Kept as the original
  // object: re-running LIMIT 1000 would lose the whole-file fit and the
  // "Showing 1,000 of N" truncation.
  let initialLayer: Layer | null = null
  let catalog = $state.raw<CatalogSnapshot | null>(null)

  async function refreshCatalog(): Promise<void> {
    const qs = querySession
    if (!qs) return
    const snapshot = await retryWhenBusy(qs, () => qs.catalog()).catch(() => null)
    if (snapshot && qs === querySession) catalog = snapshot
  }
  let resultGeometryColumn = $state<string | null>('geom')
  let history = $state.raw<QueryHistoryEntry[]>([])
  /** OpenedFileRef.stateKey of the open file: history is per file. */
  let historyStateKey: string | null = null

  function remember(outcome: RunOutcome): void {
    const key = historyStateKey
    const entry = historyEntryFromOutcome(outcome)
    if (!key || !entry) return
    history = addHistoryEntry(history, entry)
    void recordHistory(hostAdapter, key, entry)
      .then((saved) => {
        if (key === historyStateKey) history = saved
      })
      .catch(() => {})
  }

  function resetQueryState(): void {
    queryText = DEFAULT_QUERY
    queryPhase = 'idle'
    queryStatus = ''
    queryError = null
    queryErrorRange = null
    crsOverride = null
    runStartedAt = null
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
    if (!qs || queryPhase === 'running') return
    queryPhase = 'running'
    queryError = null
    queryErrorRange = null
    runStartedAt = performance.now()
    lastRun = { text: queryText, selection }
    // Spec 007 FR-009: no large-result prompt; any result size is shown by view and page.
    const outcome: RunOutcome = await qs.run({ editorText: queryText, selection, crsOverride })
    applyOutcome(outcome)
  }

  function applyOutcome(outcome: RunOutcome): void {
    runStartedAt = null
    queryStatus = describeOutcome(outcome)
    remember(outcome)
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
        if (previous) setLayer(layerFromResult(displayedLayer ?? previous, built))
        session.selectedFeatureId = null
        outsideFeature = null
        resultCrs = built.resultCrs ? { label: built.resultCrs.crs.label, source: built.resultCrs.source } : resultCrs
        resultGeometryColumn = built.geometryColumn
        queryPhase = 'succeeded'
        lastRunText = outcome.statement.text
        break
      }
      case 'ddl':
        queryPhase = 'succeeded'
        lastRunText = outcome.statement.text
        void refreshCatalog()
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

  // Spec 007: map views (research §6). Each request gets a generation; an
  // older one's features never replace a newer one's, and the previous
  // features stay drawn until replaced (FR-007).
  let viewFeatures = $state.raw<ViewFeatures | null>(null)
  let viewLoading = $state(false)
  let outsideFeature = $state.raw<Feature | null>(null)
  let viewGeneration = 0
  let lastViewArgs: { bbox: [number, number, number, number]; zoom: number; widthPx?: number } | null = null
  /** The attribute columns the drawn view carries (the style's column; spec 007). */
  let viewAttrs: string[] = []
  // The map reports each paint of new view data (MapView onPainted).
  let paintWaiters: Array<() => void> = []
  function waitForPaint(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        paintWaiters = paintWaiters.filter((w) => w !== done)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      paintWaiters.push(done)
    })
  }
  /** The full record of a map-selected feature whose view row had only the style's columns. */
  let detailFeature = $state.raw<Feature | null>(null)
  /** The layer whose first view already had its preview (see requestView). */
  let previewedLayer: Layer | null = null
  /** Features in the quick first view of a new file or result. */
  const PREVIEW_CAP = 2_000
  let fallbackDismissed = $state(false)
  // FR-014: a map view, table page or style that ran out of memory says so (the session has recovered).
  let memoryNotice = $state<string | null>(null)
  function noteOutOfMemory(err: unknown): boolean {
    if (!(err instanceof OutOfMemoryError)) return false
    memoryNotice = err.message
    return true
  }
  let lastViewBbox = $state.raw<[number, number, number, number] | null>(null)
  let cameraRequest = $state<{ center: [number, number]; zoom: number; seq: number } | null>(null)
  const viewNf = new Intl.NumberFormat()

  async function requestView(bbox: [number, number, number, number], zoom: number, widthPx?: number): Promise<void> {
    const qs = querySession
    const layer = session.layer
    // A table-only result keeps the previous features, dimmed (spec 002 FR-006).
    if (!qs || !layer || mapDimmed) return
    lastViewBbox = bbox
    const generation = ++viewGeneration
    const current = (): boolean => generation === viewGeneration && querySession === qs
    const slow = setTimeout(() => {
      if (generation === viewGeneration) viewLoading = true
    }, 300)
    const cap = viewCapFor(layer.facts?.readMode ?? 'whole')
    lastViewArgs = { bbox, zoom, widthPx }
    const attrs = styleColumns(style)
    viewAttrs = attrs
    // The first view of a new file or result is drawn in two steps: a quick
    // spread-out preview, then the full view, which replaces it without a
    // blank map (FR-007). The preview shows no subset notice (it's replaced at
    // once). Only for files in memory, where drawing dominates; for files read
    // in parts the overview is I/O-bound, and a preview would double it.
    let preview = previewedLayer !== layer && cap > PREVIEW_CAP && (layer.facts?.readMode ?? 'whole') === 'whole'
    previewedLayer = layer
    try {
      // A view never blocks user work (a query, export, autocomplete): it is
      // skipped or interrupted, then asked again once the engine is free,
      // unless a newer view came meanwhile. No attempt limit: each retry
      // waits for the engine to go idle, and background work (styles, the
      // value distribution, table pages) can take the engine first several
      // times in a row (spec 008: a view gave up after 5 and the map stayed empty).
      while (current()) {
        try {
          const v = await qs.view({ generation, bbox, zoom, cap: preview ? PREVIEW_CAP : cap, widthPx, attrs })
          if (!current()) return
          if (preview) {
            viewFeatures = { ...v, thinned: false, preview: true }
            preview = false
            // Paint the preview before loading the full view; otherwise a
            // quick full view replaces it unseen (at most 1 s).
            await waitForPaint(1000)
            continue
          }
          viewFeatures = v
          return
        } catch (err) {
          if (!(err instanceof ViewSkippedError || err instanceof QueryCancelledError)) throw err
          await qs.whenIdle()
        }
      }
    } catch (err) {
      if (!noteOutOfMemory(err)) console.warn('Spatial Explorer: map view failed', err)
    } finally {
      clearTimeout(slow)
      if (generation === viewGeneration) viewLoading = false
    }
  }

  const viewNotice = $derived.by((): { text: string; kind: 'info' | 'warning'; dismissible: boolean } | null => {
    if (memoryNotice) return { text: memoryNotice, kind: 'warning', dismissible: true }
    const facts = session.layer?.facts
    if (facts?.fallback && !fallbackDismissed) return { text: `Reading the whole file: ${facts.fallback}`, kind: 'warning', dismissible: true }
    const v = viewFeatures
    if (v?.thinned) {
      const of = v.inViewEstimated ? `about ${viewNf.format(v.inView)}` : v.inViewAtLeast ? `more than ${viewNf.format(v.inView)}` : viewNf.format(v.inView)
      return { text: `Showing ${viewNf.format(v.features.length)} of ${of} in view. Zoom in to see all.`, kind: 'info', dismissible: false }
    }
    return null
  })

  // Spec 007: the open in progress.
  let openPhase = $state<OpenPhase | null>(null)
  let openStartedAt = $state<number | null>(null)
  let openFacts = $state<DatasetFacts | null>(null)
  let openCancelled = false
  let openInterrupt: (() => Promise<void>) | null = null
  let wholeReadPrompt = $state<{ sizeBytes: number; format: string; resolve: (open: boolean) => void } | null>(null)

  function answerWholeRead(open: boolean): void {
    const prompt = wholeReadPrompt
    wholeReadPrompt = null
    prompt?.resolve(open)
  }

  async function loadWhole(): Promise<void> {
    if (!openedRef || !needsLoad) return
    await load({ ref: openedRef, loadWhole: true })
  }

  async function load(options: { ref?: OpenedFileRef; loadWhole?: boolean } = {}): Promise<void> {
    const keptStyle = options.loadWhole ? { style, styleSource, styleDirty } : null
    session.loadState = 'loading'
    session.loadError = null
    session.selectedFeatureId = null
    openCancelled = false
    openFacts = null
    viewFeatures = null
    outsideFeature = null
    fallbackDismissed = false
    memoryNotice = null
    openPhase = null
    openStartedAt = null
    try {
      const ref = options.ref ?? (await hostAdapter.openFiles())[0]
      openedRef = ref
      currentFileName = ref.displayName
      historyStateKey = ref.stateKey
      history = []
      void loadHistory(hostAdapter, ref.stateKey).then((list) => {
        if (ref.stateKey === historyStateKey) history = list
      })
      // One file per viewer: the previous file's views, tables and session
      // go before the next file's `layer` view is created.
      await querySession?.dispose().catch(() => {})
      querySession = null
      tilesArchive = null
      openStartedAt = performance.now()
      openPhase = 'registering'
      if (formatFromFileName(ref.displayName) === 'pmtiles') {
        // US5: the map reads the archive itself; the engine isn't involved.
        const { layer, archive } = await openTilesArchive(ref, hostAdapter)
        openPhase = null
        openStartedAt = null
        resetQueryState()
        catalog = null
        tilesArchive = archive
        initialLayer = layer
        setLayer(layer)
        session.loadState = 'ready'
        applySidecar(null)
        hostAdapter.setStatus({ crs: layer.sourceCrs.label, featureCount: layer.source.features, countLabel: 'features' })
        return
      }
      const opened = await openFile(
        ref,
        { hostAdapter, duckdbAssets },
        {
          onPhase: (phase, detail) => {
            if (!openCancelled) openPhase = phase
            if (detail?.sizeBytes !== undefined) openedSize = detail.sizeBytes
          },
          onFacts: (facts) => {
            openFacts = facts
            // File-level metadata (FR-006) before the first view (FR-001).
            hostAdapter.setStatus({ crs: facts.crs.label, featureCount: facts.rows - (facts.invalid ?? 0), countLabel: facts.invalid === null ? 'rows' : 'features' })
          },
          confirmWholeRead: (sizeBytes, format) => new Promise<boolean>((resolve) => (wholeReadPrompt = { sizeBytes, format, resolve })),
          onCancelHandle: (interrupt) => {
            openInterrupt = interrupt
          },
          isCancelled: () => openCancelled,
        },
        { loadWhole: options.loadWhole }
      )
      openInterrupt = null
      openPhase = null
      openStartedAt = null
      querySession = opened.session
      resetQueryState()
      catalog = null
      void refreshCatalog()
      const layer = opened.layer
      initialLayer = layer
      setLayer(layer)
      session.loadState = 'ready'
      if (keptStyle) {
        // Loading the whole file keeps the style the user was looking at.
        style = keptStyle.style
        styleSource = keptStyle.styleSource
        styleDirty = keptStyle.styleDirty
      } else applySidecar(layer.styleSidecar)
      // File-level metadata (FR-006): the whole file, not the displayed result.
      hostAdapter.setStatus({ crs: layer.sourceCrs.label, featureCount: layer.source.features, countLabel: layer.facts?.invalid === null ? 'rows' : 'features' })
    } catch (err) {
      openInterrupt = null
      openStartedAt = null
      setLayer(null)
      if (err instanceof QueryCancelledError || openCancelled) {
        // FR-002: back to the empty state, no error (the previous file was
        // already closed: one `layer` per engine).
        openPhase = 'cancelled'
        openFacts = null
        session.loadState = 'idle'
        hostAdapter.setStatus({})
        return
      }
      openPhase = 'failed'
      session.loadState = 'error'
      session.loadError = { message: err instanceof Error ? err.message : String(err) }
    }
  }

  async function cancelOpen(): Promise<void> {
    if (session.loadState !== 'loading') return
    openCancelled = true
    await openInterrupt?.().catch(() => {})
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
    const { text, notes } = exportStyle(style, 'qml', session.layer.geometryType, currentFileName, resolvedStyle, displayedLayer?.columns)
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
    const { text, notes } = exportStyle(style, format, session.layer.geometryType, currentFileName, resolvedStyle, displayedLayer?.columns)
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
    get openPhase() {
      return openPhase
    },
    get openStartedAt() {
      return openStartedAt
    },
    get openFacts() {
      return openFacts
    },
    cancelOpen,
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
    get catalog() {
      return catalog
    },
    get queryEdited() {
      return queryText !== DEFAULT_QUERY && queryText !== (lastRunText ?? DEFAULT_QUERY)
    },
    async resetQuery() {
      if (queryPhase === 'running') await this.cancelQuery()
      const original = initialLayer
      resetQueryState()
      querySession?.showDefaultView()
      if (original) {
        setLayer(original)
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
    get runStartedAt() {
      return runStartedAt
    },
    get tableTotal() {
      return displayedLayer?.totalRows ?? 0
    },
    get tableSort() {
      return tableSort
    },
    get tableRevision() {
      return tableRevision
    },
    get tableReRuns() {
      return querySession?.lastResult?.reRuns ?? false
    },
    setTableSort(sort) {
      tableSort = sort
      tableRevision++
    },
    async loadPage(offset) {
      const qs = querySession
      if (!qs) return null
      try {
        // Waits out style or map work holding the engine rather than leaving skeleton rows.
        const sort = tableSort ? { column: tableSort.column, dir: tableSort.dir } : null
        return await retryWhenBusy(qs, () => qs.page({ offset, limit: PAGE_SIZE, sort }))
      } catch (err) {
        // A page interrupted by user work: the table asks again when it next scrolls or redraws.
        if (err instanceof QueryCancelledError) return null
        if (noteOutOfMemory(err)) return null
        throw err
      }
    },
    get mapLayer() {
      return mapLayer
    },
    get mapDimmed() {
      return mapDimmed
    },
    get exportOpen() {
      return exportOpen
    },
    openExport() {
      exportOpen = true
      if (exportPhase !== 'running') {
        exportPhase = 'idle'
        exportOutcome = null
      }
    },
    closeExport() {
      if (exportPhase === 'running') return
      exportOpen = false
    },
    get exportRequest() {
      return exportRequest
    },
    setExportRequest(patch) {
      exportRequest = { ...exportRequest, ...patch }
      const { format, crs, csvGeometry } = exportRequest
      void hostAdapter.saveState(EXPORT_PREFS_KEY, { format, crs, csvGeometry }).catch(() => {})
    },
    get exportPlan() {
      return exportPlan
    },
    get exportDisabled() {
      return exportDisabled
    },
    get exportPhase() {
      return exportPhase
    },
    get exportProgress() {
      return exportProgress
    },
    get exportOutcome() {
      return exportOutcome
    },
    async runExport() {
      const plan = exportPlan
      const qs = querySession
      if (!plan || !qs || exportDisabled || exportPhase === 'running') return
      exportPhase = 'running'
      exportOutcome = null
      const startedAt = performance.now()
      exportProgress = { rows: null, startedAt }
      try {
        const result = await qs.exportData(plan, { onProgress: (rows) => (exportProgress = { rows, startedAt }) })
        exportProgress = null
        const saved = await hostAdapter.saveFile(plan.fileName, result.bytes, { kind: 'data' })
        exportOutcome = saved.saved
          ? { kind: 'saved', location: saved.location ?? plan.fileName, rows: result.rows, bytes: result.bytes.length, notices: result.notices, durationMs: Math.round(performance.now() - startedAt) }
          : { kind: 'notSaved' }
        exportPhase = saved.saved ? 'done' : 'idle'
      } catch (err) {
        exportProgress = null
        if (err instanceof QueryCancelledError) {
          exportOutcome = { kind: 'cancelled', durationMs: Math.round(performance.now() - startedAt) }
          exportPhase = 'cancelled'
        } else {
          exportOutcome = { kind: 'failed', message: exportErrorMessage(err) }
          exportPhase = 'failed'
        }
      }
    },
    async cancelExport() {
      if (exportPhase === 'running') await querySession?.cancel()
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
    loadFromHistory(entry) {
      if (queryPhase === 'running') return
      queryText = entry.text
      queryError = null
      queryErrorRange = null
      queryPhase = 'idle'
      queryStatus = 'Loaded from history · not run (Ctrl+Enter to run)'
    },
    runQuery,
    async cancelQuery() {
      await querySession?.cancel()
    },
    get resolvedStyle() {
      return resolvedStyle
    },
    get classifying() {
      return classifying
    },
    get styleHistogram() {
      return styleHistogram
    },
    get styleInput() {
      const l = displayedLayer
      return l ? { columns: l.columns, rowCount: l.totalRows, distinct: styleDistinct } : null
    },
    get displayedLayer() {
      return displayedLayer
    },
    get legendCollapsed() {
      return legendCollapsed
    },
    setLegendCollapsed(collapsed) {
      legendCollapsed = collapsed
      void hostAdapter.saveState(LEGEND_COLLAPSED_KEY, collapsed).catch(() => {})
    },
    setClassVisible(key, visible) {
      style = setClassVisible(style, key, visible)
      styleDirty = true
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
    load: () => load(),
    get needsLoad() {
      return needsLoad
    },
    loadWhole,
    get wholeReadPrompt() {
      return wholeReadPrompt
    },
    answerWholeRead,
    get tiles() {
      return tilesArchive
    },
    get tilesOnlyReason() {
      return tilesOnlyReason
    },
    inspectTileFeature(feature) {
      detailFeature = feature
      session.selectedFeatureId = feature?.id ?? null
    },
    selectFeature(id) {
      session.selectedFeatureId = id
      // A view row carries only the style's columns (spec 007): fetch the full record for the inspector.
      const drawn = viewFeatures?.features.find((f) => f.id === id)
      if (drawn?.partialAttributes && typeof id === 'number' && querySession) {
        const qs = querySession
        void retryWhenBusy(qs, () => qs.featureById(id))
          .then((f) => {
            if (session.selectedFeatureId === id) detailFeature = f
          })
          .catch(() => {})
      }
    },
    get detailFeature() {
      return detailFeature
    },
    zoomToFeature(id) {
      session.selectedFeatureId = id
      // FR-008: a feature outside the drawn set is fetched by its stable id, drawn highlighted, then zoomed to.
      const drawn = viewFeatures?.features.some((f) => f.id === id) || outsideFeature?.id === id
      if (drawn || typeof id !== 'number' || !querySession) {
        zoomRequest = { id, seq: (zoomRequest?.seq ?? 0) + 1 }
        return
      }
      const qs = querySession
      void retryWhenBusy(qs, () => qs.featureById(id))
        .then((f) => {
          if (session.selectedFeatureId !== id) return
          outsideFeature = f
          zoomRequest = { id, seq: (zoomRequest?.seq ?? 0) + 1 }
        })
        .catch(() => {})
    },
    get viewFeatures() {
      return viewFeatures
    },
    get viewLoading() {
      return viewLoading
    },
    get viewNotice() {
      return viewNotice
    },
    get outsideFeature() {
      return outsideFeature
    },
    requestView,
    notifyPainted() {
      for (const w of [...paintWaiters]) w()
    },
    get lastViewBbox() {
      return lastViewBbox
    },
    get cameraRequest() {
      return cameraRequest
    },
    jumpTo(center, zoom) {
      cameraRequest = { center, zoom, seq: (cameraRequest?.seq ?? 0) + 1 }
    },
    dismissViewNotice() {
      if (memoryNotice) memoryNotice = null
      else fallbackDismissed = true
    },
    setCursor(coords) {
      session.cursorCoordinates = coords
      hostAdapter.setStatus({ cursor: coords })
    },
    setStyle(patch) {
      if (previewBase) {
        style = previewBase
        previewBase = null
      }
      style = sanitizeStyle({ ...style, ...patch })
      styleDirty = true
      // A thematic column the drawn view doesn't carry yet: load the view again with it.
      if (lastViewArgs && styleColumns(style).some((c) => !viewAttrs.includes(c))) void requestView(lastViewArgs.bbox, lastViewArgs.zoom, lastViewArgs.widthPx)
    },
    previewStyle(next) {
      if (next === null) {
        if (previewBase) style = previewBase
        previewBase = null
        return
      }
      previewBase ??= style
      style = sanitizeStyle(next)
    },
    resetStyle() {
      previewBase = null
      style = { ...DEFAULT_LAYER_STYLE }
      styleSource = null
      styleNotice = null
      styleDirty = true
    },
    saveStyle,
    saveStyleAs: (format) => (format === 'qml' ? saveStyle() : exportStyleAs(format)),
    exportStyle: exportStyleAs,
    importStyle: importStyleFromFile,
    dismissStyleNotice() {
      styleNotice = null
    },
  }
}
