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
  setSizeClassVisible,
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
  loadCrsCatalog,
  isTemporalType,
  activeExtrusion,
  autoExtrusionScale,
  extrusionColumn,
  exportErrorMessage,
  QueryCancelledError,
  type ExportPlan,
  type ExportRequest,
  type Bbox,
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
  EMPTY_SELECTION,
  isEmptySelection,
  selectionSize,
  type ColumnFilter,
  type Selection,
} from '@spatial-explorer/core'
import { formatFromFileName, styleDataColumns } from '@spatial-explorer/core'
import { openTilesArchive, TILES_ONLY_REASON, type TilesArchive } from './pmtilesSource.js'
import type { LegendSpec, MapCapture } from './mapImage.js'

/** The attribute columns a style draws from (spec 007: map views read only these). */
function styleColumns(style: LayerStyle): string[] {
  // Spec 009: every channel's columns (color, bivariate axes, size).
  const cols = styleDataColumns(style)
  // Spec 008 US6: the extrusion's height column.
  const h = extrusionColumn(style)
  return h && !cols.includes(h) ? [...cols, h] : cols
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

/** Spec 008 US7: what a map image export did. */
export type MapImageOutcome =
  | { kind: 'saved'; location: string; width: number; height: number; notes: string[] }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string }

/** Spec 008: the engine's check of a typed EPSG code. */
export type ExportCrsCheck = { code: number; state: 'checking' } | { code: number; state: 'ok'; name: string } | { code: number; state: 'invalid'; reason: string }

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
  // --- Spec 008 US2: columns, filters, selection --------------------------
  /** Columns hidden in the table (FR-008/FR-009): remembered per file for the file's own columns. */
  readonly hiddenColumns: ReadonlySet<string>
  setHiddenColumns(hidden: string[]): void
  /** The table filters (FR-010), as parsed: invalid ones carry `valid: false` and a reason. */
  readonly filters: readonly ColumnFilter[]
  /** Replaces the filter on `column` (null removes it). */
  setFilter(column: string, filter: ColumnFilter | null): void
  clearFilters(): void
  /** "N of M" (FR-011) while filters or "show selected only" narrow the rows; null otherwise or while counting. */
  readonly filterCounts: { total: number; matching: number } | null
  /** True while the narrowed rows are being counted. */
  readonly filtering: boolean
  /** The ticked rows (FR-012): ids, or every row matching the filters. */
  readonly selection: Selection
  readonly selectedCount: number
  toggleSelected(id: number, selected?: boolean): void
  /** Map click (FR-012): replace the selection with one feature; with `add`, toggle it instead (Ctrl/Cmd). */
  selectOnMap(id: number | null, add: boolean): void
  selectAllMatching(): void
  clearSelection(): void
  readonly showSelectedOnly: boolean
  setShowSelectedOnly(on: boolean): void
  zoomToSelection(): Promise<void>
  /** Fits the map to a WGS84 box once per new request. */
  readonly fitRequest: { bbox: [number, number, number, number]; seq: number } | null
  /** Spec 008 FR-023: flat map or globe, remembered for the user. */
  readonly projection: 'mercator' | 'globe'
  setProjection(projection: 'mercator' | 'globe'): void
  /** The map's camera after its last move (null before the first). */
  readonly mapCamera: { center: [number, number]; zoom: number; pitch: number; bearing: number } | null
  setMapCamera(camera: { center: [number, number]; zoom: number; pitch: number; bearing: number }): void
  /** The layer to draw: the result, or (for a table-only result) the previous one, dimmed (FR-006). */
  readonly mapLayer: Layer | null
  readonly mapDimmed: boolean
  /** Bumps after every finished run (test hooks wait on it). */
  readonly runCount: number
  // --- Spec 005: export ---------------------------------------------------
  readonly exportOpen: boolean
  /** Spec 008 US8: place search is on (VS Code: the `spatialExplorer.placeSearch.enabled` setting). */
  readonly placeSearchEnabled: boolean
  /** The host has a setting to turn place search off (VS Code), so the notice can point to it. */
  readonly placeSearchConfigurable: boolean
  /** Whether the place search privacy notice was already shown (asked once per user). */
  placeSearchNoticeShown(): Promise<boolean>
  markPlaceSearchNoticeShown(): void
  /** Fits the map to a WGS84 box (a found place). */
  fitTo(bbox: [number, number, number, number]): void
  /** Spec 008 US7: the map image dialog. */
  readonly mapImageOpen: boolean
  openMapImage(): void
  closeMapImage(): void
  /** MapView hands over its capture once the map is ready. */
  setMapCapture(capture: MapCapture): void
  /** Captures the view (1x or 2x, with the legend or not) and saves it through the host as `<file>-map.png`. */
  exportMapImage(opts: { scale: 1 | 2; legend: LegendSpec | null }): Promise<MapImageOutcome>
  /** Test hook: the capture only, no save. */
  captureMapImage(opts: { scale: 1 | 2; legend: LegendSpec | null }): Promise<{ bytes: Uint8Array; width: number; height: number; notes: string[] } | null>
  openExport(): void
  closeExport(): void
  readonly exportRequest: ExportRequest
  setExportRequest(patch: Partial<ExportRequest>): void
  /** What an export would do now, or null when there's nothing to export. */
  readonly exportPlan: ExportPlan | null
  /** Spec 008: the engine's check of a typed EPSG code (export to another CRS). */
  readonly exportCrsCheck: ExportCrsCheck | null
  /** Spec 008: why the chosen output CRS can't be used yet (blocks the dialog's Export button only). */
  readonly exportCrsProblem: string | null
  /** Spec 008: the displayed data's WGS84 extent (the CRS picker suggests CRSs for it). */
  readonly exportExtent: Bbox | null
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
  /** Spec 008 US6: the displayed polygons are extruded (the map draws them raised). */
  readonly extruded: boolean
  /** Spec 008 US6: polygons drawn flat by the extrusion, or null (unknown, or a constant height). */
  readonly extrusionFlat: number | null
  /** Spec 008 US6: a height scale that makes `column` visible at the layer's extent (1 when unknown). */
  suggestExtrusionScale(column: string): Promise<number>
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
  /** Spec 008 US3: the layers of a multi-layer file, and the one shown; empty for single-layer files. */
  readonly fileLayers: ReadonlyArray<{ name: string; geometryType: string | null; featureCount: number | null }>
  readonly activeLayer: string | null
  /**
   * Shows another layer of the file (FR-016). A layer with geometry is opened
   * as `layer`; a table without geometry is shown as a query result. Each
   * layer keeps its own style for the session.
   */
  switchLayer(name: string): Promise<void>
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
  readonly cameraRequest: { center: [number, number]; zoom: number; pitch?: number; bearing?: number; seq: number } | null
  /** Moves the map at once (spec 008: with tilt and rotation, for share links). */
  jumpTo(center: [number, number], zoom: number, pitch?: number, bearing?: number): void
  /** The opened file's size in bytes, when known (share links name the file by name and size). */
  readonly openedSize: number | null
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
  /** The file's own result (its default view), reactive: the column view applies to its columns. */
  let initialLayerState = $state.raw<Layer | null>(null)
  function setLayer(l: Layer | null): void {
    displayedLayer = l
    session.layer = l
    // A new result: the table's loaded pages and sort belong to the old one.
    tableSort = null
    tableRevision++
    // ... and so do its filters and selection (the session clears its own).
    filters = []
    filterCounts = null
    selection = EMPTY_SELECTION
    showSelectedOnly = false
    resultHidden = []
  }

  // --- Spec 008 US2: the column view, filters and selection (data-model.md) ----
  /** Hidden columns of the source's own column set, saved per file. */
  let savedHidden = $state.raw<string[]>([])
  /** Hidden columns of a query result with other columns: this result only. */
  let resultHidden = $state.raw<string[]>([])
  let columnsKey: string | null = null
  const columnNames = (l: Layer | null): string => (l ? l.columns.map((c) => c.name).join('\u0000') : '')
  const sourceColumns = $derived(columnNames(initialLayerState))
  const showsSourceColumns = $derived(!!displayedLayer && columnNames(displayedLayer) === sourceColumns)
  // Selections are immutable values, replaced whole ($state.raw): a plain Set is right here.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const hiddenColumns = $derived(new Set(showsSourceColumns ? savedHidden : resultHidden))

  function loadColumnView(key: string): void {
    columnsKey = key
    savedHidden = []
    void hostAdapter
      .loadState<{ hidden?: unknown }>(`columns:${key}`)
      .then((v) => {
        if (columnsKey === key && Array.isArray(v?.hidden)) savedHidden = v.hidden.filter((n): n is string => typeof n === 'string')
      })
      .catch(() => {})
  }

  let filters = $state.raw<ColumnFilter[]>([])
  let filterCounts = $state.raw<{ total: number; matching: number } | null>(null)
  let filtering = $state(false)
  /** Bumps when the displayed rows are narrowed differently (filters, show selected only). */
  let narrowRevision = $state(0)
  let selection = $state.raw<Selection>(EMPTY_SELECTION)
  let showSelectedOnly = $state(false)
  let fitRequest = $state.raw<{ bbox: [number, number, number, number]; seq: number } | null>(null)
  // Spec 008 US8: follows the host's setting live.
  let placeSearchEnabled = $state(hostAdapter.getPreference?.('placeSearch.enabled') !== false)
  hostAdapter.onPreferenceChange?.(() => (placeSearchEnabled = hostAdapter.getPreference?.('placeSearch.enabled') !== false))
  const PLACE_NOTICE_KEY = 'placeSearchNoticeShown'
  // The map always opens flat; the globe is a view for this session, not
  // remembered (user decision, 2026-10-11).
  let projection = $state<'mercator' | 'globe'>('mercator')
  let mapCamera = $state.raw<{ center: [number, number]; zoom: number; pitch: number; bearing: number } | null>(null)

  /** After the rows were narrowed: new pages, a new view, the style and the count. */
  async function narrowed(): Promise<void> {
    const qs = querySession
    tableRevision++
    narrowRevision++
    if (lastViewArgs) void requestView(lastViewArgs.bbox, lastViewArgs.zoom, lastViewArgs.widthPx)
    if (!qs || (!filters.some((f) => f.valid) && !showSelectedOnly)) {
      filterCounts = null
      filtering = false
      return
    }
    const revision = narrowRevision
    filtering = true
    try {
      const counts = await retryWhenBusy(qs, () => qs.filterCounts())
      if (revision === narrowRevision) filterCounts = counts
    } catch (err) {
      if (!(err instanceof QueryCancelledError) && !noteOutOfMemory(err)) console.warn('Spatial Explorer: filter count failed', err)
    } finally {
      if (revision === narrowRevision) filtering = false
    }
  }

  function applyFilters(next: ColumnFilter[]): void {
    const qs = querySession
    filters = qs ? qs.setFilters(next) : next
    // "All matching" follows the new filters; a list of ids stays as it is.
    void narrowed()
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

  // Spec 008 US6: how many polygons the extrusion draws flat.
  let extrusionFlat = $state<number | null>(null)
  let flatKey: string | null = null
  async function refreshFlat(s: LayerStyle, layer: Layer | null, qs: QuerySession | null): Promise<void> {
    const e = activeExtrusion(s, layer?.geometryType)
    if (!e || e.source.kind !== 'column' || !layer || !qs) {
      flatKey = null
      extrusionFlat = null
      return
    }
    const key = `${layer.id}\u0000${layer.totalRows}\u0000${e.source.column}\u0000${e.scale}`
    if (key === flatKey) return
    flatKey = key
    try {
      const n = await retryWhenBusy(qs, () => qs.extrusionFlatCount(e))
      if (flatKey === key) extrusionFlat = n
    } catch (err) {
      if (!(err instanceof QueryCancelledError) && !noteOutOfMemory(err)) console.warn('Spatial Explorer: flat count failed', err)
    }
  }

  async function refreshStyle(): Promise<void> {
    const generation = ++styleGeneration
    const s = style
    const layer = displayedLayer
    const qs = querySession
    if (!qs || !layer) {
      void refreshHistogram(s, layer, qs)
      void refreshFlat(s, layer, qs)
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
        void refreshHistogram(s, layer, qs).then(() => refreshFlat(s, layer, qs))
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
      void narrowRevision
      void untrack(() => refreshStyle())
    })
  })
  let mapDimmed = $state(false)
  let runCount = $state(0)

  // --- Spec 005: export ------------------------------------------------------
  const EXPORT_PREFS_KEY = 'export.prefs'
  let exportOpen = $state(false)
  let mapImageOpen = $state(false)
  let mapCapture: MapCapture | null = null
  let savedExportPrefs = ''
  let exportRequest = $state<ExportRequest>({ format: 'geoparquet', crs: 'result', csvGeometry: 'wkt' })
  void hostAdapter
    .loadState<Partial<ExportRequest>>(EXPORT_PREFS_KEY)
    .then((saved) => {
      // Spec 007: older saved prefs may carry `rows` (the removed rows choice); only known fields are kept.
      if (saved && typeof saved === 'object') {
        const { format, crs, csvGeometry, crsCode } = { ...exportRequest, ...saved }
        exportRequest = { format, crs, csvGeometry, ...(typeof crsCode === 'number' ? { crsCode } : {}) }
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
    const narrowedRows = filters.some((f) => f.valid) ? (filterCounts?.matching ?? null) : null
    const selected = isEmptySelection(selection) ? null : selectionSize(selection, filterCounts?.matching ?? facts.totalRows)
    return planExport($state.snapshot(exportRequest), { sourceName: currentFileName ?? 'layer', layer, facts, scopes: { filtered: narrowedRows, selected } })
  })
  // Spec 008 (user request): the output EPSG code, checked before export.
  // Codes in the CRS list were all tested against the engine when the list
  // was built, so they need no engine work; any other code is checked once
  // (PROJ), and every result is remembered. Only while the dialog is open,
  // and only when the code changes (not on every other export setting).
  let exportCrsCheck = $state.raw<ExportCrsCheck | null>(null)
  // A cache, not state: exportCrsCheck is what the UI reads.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const crsChecked = new Map<number, ExportCrsCheck>()
  const crsToCheck = $derived(exportOpen && exportRequest.crs === 'custom' && exportRequest.crsCode !== undefined ? exportRequest.crsCode : null)
  // A root: the VS Code webview creates the store outside any component.
  $effect.root(() => {
    $effect(() => {
      const code = crsToCheck
      const qs = querySession
      if (code === null || !qs) {
        exportCrsCheck = null
        return
      }
      const known = crsChecked.get(code)
      if (known) {
        exportCrsCheck = known
        return
      }
      let current = true
      const settle = (r: ExportCrsCheck) => {
        if (r.state !== 'checking') crsChecked.set(code, r)
        if (current) exportCrsCheck = r
      }
      // After the dialog has painted: the list is ~560 KB to parse.
      const wait = new Promise<void>((resolve) => setTimeout(resolve, 150))
      void wait
        .then(() => (current ? loadCrsCatalog() : Promise.reject(new Error('stale'))))
        .then((catalog) => catalog.byCode.get(code) ?? null)
        .catch(() => null)
        .then(async (listed) => {
          if (!current) return
          if (listed) return settle({ code, state: 'ok', name: listed.name })
          if (current) exportCrsCheck = { code, state: 'checking' }
          const r = await retryWhenBusy(qs, () => qs.describeCrs(code))
          settle(r.ok ? { code, state: 'ok', name: r.name } : { code, state: 'invalid', reason: r.reason })
        })
        .catch(() => {
          if (current) exportCrsCheck = { code, state: 'invalid', reason: `EPSG:${code} could not be checked.` }
        })
      return () => {
        current = false
      }
    })
  })
  const customCrsProblem = $derived(
    exportRequest.crs !== 'custom' || exportPlan?.crs.forced || !exportPlan?.includeGeometry
      ? null
      : exportRequest.crsCode === undefined
        ? 'Enter an EPSG code for the output CRS.'
        : exportCrsCheck?.state === 'invalid'
          ? exportCrsCheck.reason
          : exportCrsCheck?.state === 'checking'
            ? 'Checking the CRS…'
            : null
  )
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
  let cameraRequest = $state<{ center: [number, number]; zoom: number; pitch?: number; bearing?: number; seq: number } | null>(null)
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

  // --- Spec 008 US3: layers of a multi-layer file -----------------------------
  let fileLayers = $state.raw<ReadonlyArray<{ name: string; geometryType: string | null; featureCount: number | null }>>([])
  let activeLayer = $state<string | null>(null)
  /** Each layer's style for this session (FR-016: switching back restores it). */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const layerStyles = new Map<string, { style: LayerStyle; styleSource: string | null; styleDirty: boolean }>()

  async function switchLayer(name: string): Promise<void> {
    const target = fileLayers.find((l) => l.name === name)
    if (!target || !openedRef || name === activeLayer) return
    if (target.geometryType === null) {
      // A table without geometry can't be `layer`: show it as a result (the map dims, the table lists it).
      queryText = `SELECT * FROM "${name.replace(/"/g, '""')}"`
      activeLayer = name
      await runQuery({ from: 0, to: queryText.length })
      return
    }
    if (activeLayer) layerStyles.set(activeLayer, { style, styleSource, styleDirty })
    await load({ ref: openedRef, layer: name })
  }

  async function load(options: { ref?: OpenedFileRef; loadWhole?: boolean; layer?: string } = {}): Promise<void> {
    const keptStyle = options.loadWhole ? { style, styleSource, styleDirty } : options.layer !== undefined ? (layerStyles.get(options.layer) ?? { style: { ...DEFAULT_LAYER_STYLE }, styleSource: null, styleDirty: false }) : null
    if (options.layer === undefined && !options.loadWhole) layerStyles.clear()
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
      loadColumnView(ref.stateKey)
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
        { loadWhole: options.loadWhole, layer: options.layer }
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
      initialLayerState = layer
      fileLayers = layer.facts?.layers ?? []
      activeLayer = layer.facts?.activeLayer ?? null
      // Spec 008: the column view is per layer of a multi-layer file.
      if (activeLayer && historyStateKey) loadColumnView(`${historyStateKey}#${activeLayer}`)
      setLayer(layer)
      session.loadState = 'ready'
      if (keptStyle) {
        // Loading the whole file (or switching layer) keeps that layer's style.
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
      if (filters.some((f) => f.valid) || showSelectedOnly) return filterCounts?.matching ?? 0
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
    get hiddenColumns() {
      return hiddenColumns
    },
    setHiddenColumns(hidden) {
      if (showsSourceColumns) {
        savedHidden = hidden
        if (columnsKey) void hostAdapter.saveState(`columns:${columnsKey}`, { hidden }).catch(() => {})
      } else resultHidden = hidden
    },
    get filters() {
      return filters
    },
    setFilter(column, filter) {
      applyFilters([...filters.filter((f) => f.column !== column), ...(filter ? [filter] : [])])
    },
    clearFilters() {
      applyFilters([])
    },
    get filterCounts() {
      return filterCounts
    },
    get filtering() {
      return filtering
    },
    get selection() {
      return selection
    },
    get selectedCount() {
      return selectionSize(selection, filterCounts?.matching ?? displayedLayer?.totalRows ?? 0)
    },
    toggleSelected(id, selected) {
      if (selection.kind === 'all-matching') {
        // Unticking one row of "all matching" needs the list of ids: only for results small enough to list.
        if (selected !== false) return
        const total = filterCounts?.matching ?? displayedLayer?.totalRows ?? 0
        if (total > 50_000) return
        const qs = querySession
        if (!qs) return
        void retryWhenBusy(qs, () => qs.page({ offset: 0, limit: total, sort: null })).then((page) => {
          // Selections are immutable values, replaced whole ($state.raw): a plain Set is right here.
          // eslint-disable-next-line svelte/prefer-svelte-reactivity
          selection = { kind: 'ids', ids: new Set(page.rows.map((r) => r.id).filter((r) => r !== id)) }
        })
        return
      }
      // Selections are immutable values, replaced whole ($state.raw): a plain Set is right here.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const ids = new Set(selection.ids)
      const on = selected ?? !ids.has(id)
      if (on) ids.add(id)
      else ids.delete(id)
      selection = { kind: 'ids', ids }
      if (showSelectedOnly) void querySession?.setShowSelectedOnly(selection).then(() => narrowed())
    },
    selectOnMap(id, add) {
      if (id === null) {
        if (!add) selection = EMPTY_SELECTION
        return
      }
      if (add) this.toggleSelected(id)
      // Selections are immutable values, replaced whole ($state.raw): a plain Set is right here.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      else selection = { kind: 'ids', ids: new Set([id]) }
    },
    selectAllMatching() {
      selection = { kind: 'all-matching' }
    },
    clearSelection() {
      selection = EMPTY_SELECTION
      if (showSelectedOnly) this.setShowSelectedOnly(false)
    },
    get showSelectedOnly() {
      return showSelectedOnly
    },
    setShowSelectedOnly(on) {
      const qs = querySession
      if (!qs || on === showSelectedOnly) return
      showSelectedOnly = on
      void qs.setShowSelectedOnly(on ? selection : null).then(() => narrowed())
    },
    async zoomToSelection() {
      const qs = querySession
      if (!qs || isEmptySelection(selection)) return
      const bbox = await retryWhenBusy(qs, () => qs.selectionExtent(selection)).catch(() => null)
      if (bbox) fitRequest = { bbox, seq: (fitRequest?.seq ?? 0) + 1 }
    },
    get fitRequest() {
      return fitRequest
    },
    fitTo(bbox) {
      fitRequest = { bbox, seq: (fitRequest?.seq ?? 0) + 1 }
    },
    get placeSearchEnabled() {
      return placeSearchEnabled
    },
    get placeSearchConfigurable() {
      return typeof hostAdapter.getPreference === 'function'
    },
    async placeSearchNoticeShown() {
      return (await hostAdapter.loadState<boolean>(PLACE_NOTICE_KEY).catch(() => null)) === true
    },
    markPlaceSearchNoticeShown() {
      void hostAdapter.saveState(PLACE_NOTICE_KEY, true).catch(() => {})
    },
    get projection() {
      return projection
    },
    get mapCamera() {
      return mapCamera
    },
    setMapCamera(camera) {
      mapCamera = camera
    },
    setProjection(next) {
      projection = next
    },
    get mapLayer() {
      return mapLayer
    },
    get mapDimmed() {
      return mapDimmed
    },
    get mapImageOpen() {
      return mapImageOpen
    },
    openMapImage() {
      mapImageOpen = true
    },
    closeMapImage() {
      mapImageOpen = false
    },
    setMapCapture(capture) {
      mapCapture = capture
    },
    async captureMapImage(opts) {
      return mapCapture ? mapCapture(opts) : null
    },
    async exportMapImage(opts) {
      if (!mapCapture) return { kind: 'failed', message: 'The map is not ready yet.' }
      try {
        const shot = await mapCapture(opts)
        const notes = [...shot.notes]
        // A basemap that already failed (blank fallback) isn't in the image either.
        if (basemapFailed && basemapNotice) notes.push('The basemap could not be loaded and is not in the image.')
        const base = (currentFileName ?? 'map').replace(/\.[^.]+$/, '')
        const saved = await hostAdapter.saveFile(`${base}-map.png`, shot.bytes, { kind: 'image' })
        if (!saved.saved) return { kind: 'cancelled' }
        return { kind: 'saved', location: saved.location ?? `${base}-map.png`, width: shot.width, height: shot.height, notes }
      } catch (err) {
        return { kind: 'failed', message: `The map image could not be made: ${err instanceof Error ? err.message : String(err)}` }
      }
    },
    get exportOpen() {
      return exportOpen
    },
    openExport() {
      exportOpen = true
      // The output name is per export: back to the default each time.
      if (exportRequest.fileName !== undefined) exportRequest = { ...exportRequest, fileName: undefined }
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
      // Saved only when a remembered setting changes (not on every keystroke in the file name).
      const { format, crs, csvGeometry, crsCode } = exportRequest
      const prefs = JSON.stringify({ format, crs, csvGeometry, crsCode })
      if (prefs !== savedExportPrefs) {
        savedExportPrefs = prefs
        void hostAdapter.saveState(EXPORT_PREFS_KEY, { format, crs, csvGeometry, crsCode }).catch(() => {})
      }
    },
    get exportPlan() {
      return exportPlan
    },
    get exportCrsCheck() {
      return exportCrsCheck
    },
    get exportCrsProblem() {
      return customCrsProblem
    },
    get exportExtent() {
      return displayedLayer?.extent ?? null
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
      if (!plan || !qs || exportDisabled || customCrsProblem || exportPhase === 'running') return
      exportPhase = 'running'
      exportOutcome = null
      const startedAt = performance.now()
      exportProgress = { rows: null, startedAt }
      try {
        const result = await qs.exportData(plan, { onProgress: (rows) => (exportProgress = { rows, startedAt }) }, selection)
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
    get extruded() {
      return !tilesArchive && activeExtrusion(style, displayedLayer?.geometryType) !== null
    },
    get extrusionFlat() {
      return extrusionFlat
    },
    async suggestExtrusionScale(column) {
      const qs = querySession
      const layer = displayedLayer
      if (!qs || !layer) return autoExtrusionScale(null, null)
      try {
        return autoExtrusionScale(await retryWhenBusy(qs, () => qs.extrusionHigh(column)), layer.extent)
      } catch (err) {
        if (!(err instanceof QueryCancelledError) && !noteOutOfMemory(err)) console.warn('Spatial Explorer: height scale failed', err)
        return autoExtrusionScale(null, null)
      }
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
      // Spec 009: size channel classes are keyed `size:…`.
      style = key.startsWith('size:') ? setSizeClassVisible(style, key, visible) : setClassVisible(style, key, visible)
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
    get fileLayers() {
      return fileLayers
    },
    get activeLayer() {
      return activeLayer
    },
    switchLayer,
    inspectTileFeature(feature) {
      detailFeature = feature
      session.selectedFeatureId = feature?.id ?? null
    },
    selectFeature(id) {
      session.selectedFeatureId = id
      // A view row carries only the style's columns (spec 007): fetch the full record for the inspector.
      // So do dates and times (spec 008): the record has them as text, the drawn row as numbers.
      const drawn = viewFeatures?.features.find((f) => f.id === id)
      const temporal = querySession?.lastResult?.columns.some((c) => isTemporalType(c.type)) ?? false
      if ((drawn?.partialAttributes || (drawn && temporal)) && typeof id === 'number' && querySession) {
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
    jumpTo(center, zoom, pitch, bearing) {
      cameraRequest = { center, zoom, ...(pitch !== undefined ? { pitch } : {}), ...(bearing !== undefined ? { bearing } : {}), seq: (cameraRequest?.seq ?? 0) + 1 }
    },
    get openedSize() {
      return openedSize
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
