// Spec 016: the Print Layout composer's state (GeoLibre's print-layout/state.ts,
// useLayoutOptions.ts, useMapCapture.ts and useExportActions.ts, as one Svelte
// 5 runes class). `layout` is what is remembered between sessions
// (HostAdapter.saveState('printLayout')); everything else is the session's:
// the captured map, progress, notices.
import {
  barData,
  createDefaultPrintLayout,
  DEFAULT_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  pieData,
  rampColors,
  type BlockScope,
  type GroupRow,
  type LineBlockResult,
  type PrintLayoutConfig,
  type TableBlockResult,
} from '@spatial-explorer/core'
import type { LegendSpec, MapShot } from '../mapImage.js'
import { atlasEntryName, atlasViewportFrame, expandBounds, geometryBounds, stripAtlasTokens, substituteAtlasTokens, type AtlasBounds, type AtlasPage, type AtlasTokenContext } from './atlas.js'
import { AtlasState } from './atlasState.svelte.js'
import { applyLegendEdits, editRow, legendEditorRows, moveRow, NO_LEGEND_EDITS, type LegendEdits } from './legendEdit.js'
import type { ViewerStore } from '../viewerStore.svelte.js'
import { atlasPdf, atlasPngZip, copyLayoutToClipboard, layoutPdf, layoutPng, layoutSvg, type AtlasExportSource, type CapturedMap, type PageFile } from './export.js'
import type { PrintExtent } from './extent.js'
import { computeScaleRatio, mapBodyAspectRatio, resolvePageSize, scaleZoomTarget, type CustomSize, type LayoutOptions } from './layout.js'

export type ExportKind = 'png' | 'pdf' | 'svg'

/** A safe file base name from a title: letters and digits of any script, spaces to hyphens. */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .replace(/\s+/g, '-')
  return cleaned || 'map-layout'
}

/** Device pixels per CSS pixel the map is captured at: sharper than the screen, within what the GPU draws. */
const CAPTURE_RATIO = 2

export class PrintComposer {
  /** The page's settings: remembered. */
  layout = $state<PrintLayoutConfig>(createDefaultPrintLayout())
  captured = $state.raw<CapturedMap | null>(null)
  /** The captured map's notices (a basemap left out, a lower pixel ratio). */
  captureNotes = $state<string[]>([])
  capturing = $state(false)
  exporting = $state(false)
  /** Brief "Copied" on the clipboard button. */
  copied = $state(false)
  error = $state<string | null>(null)
  /** What the last export did, to say so. */
  saved = $state<{ location: string; size: string; notes: string[] } | null>(null)
  /** True while the dialog is hidden for the user to drag the print extent on the map. */
  drawingExtent = $state(false)
  /** Set when a typed scale is out of the map's zoom range. */
  scaleNotice = $state<string | null>(null)
  /** The attribute table and the chart, as the page draws them (read from the engine: see `refreshBlocks`). */
  dataTable = $state.raw<LayoutOptions['dataTable']>(null)
  dataChart = $state.raw<LayoutOptions['dataChart']>(null)
  /** The legend's edits: renames, hidden and moved classes, a title. Session only: the map's own legend is untouched. */
  legendEdits = $state<LegendEdits>(NO_LEGEND_EDITS)
  /** The draft of the map background's hex field: only a complete color is committed. */
  mapBackgroundDraft = $state('')

  /** The atlas (map series): its coverage features, pages and current page. */
  atlas: AtlasState

  #store: ViewerStore
  #legend: () => LegendSpec | null
  #loaded = false
  #copiedTimer: ReturnType<typeof setTimeout> | null = null
  #drawAbort: AbortController | null = null
  #blockSeq = 0

  constructor(store: ViewerStore, legend: () => LegendSpec | null) {
    this.#store = store
    this.#legend = legend
    this.atlas = new AtlasState(store, () => this.layout)
    this.mapBackgroundDraft = this.layout.mapBackground
    void store.loadPrintLayout().then((saved) => {
      if (saved && !this.#loaded) {
        this.layout = saved
        this.mapBackgroundDraft = saved.mapBackground
      }
      this.#loaded = true
    })
  }

  /** Writes a patch to the settings and remembers them. */
  set(patch: Partial<PrintLayoutConfig>): void {
    this.#loaded = true
    this.layout = { ...this.layout, ...patch }
    this.#store.savePrintLayout(this.layout)
  }

  /** The page at the size of the map on screen (times `scale`), in px: nothing is scaled, nothing is cropped. */
  useMapSize(scale: 1 | 2 = 1): void {
    const c = this.captured
    if (!c) return
    this.set({ paperSize: 'custom', customUnit: 'px', customWidth: Math.round((c.width / c.pixelRatio) * scale), customHeight: Math.round((c.height / c.pixelRatio) * scale), pageMargin: 'none' })
  }

  /** A typed or picked map background: a complete color is committed. */
  commitMapBackground(value: string): void {
    this.mapBackgroundDraft = value
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())) this.set({ mapBackground: value.trim() })
  }

  /** The legend as the page shows it: the map's, with the edits. */
  legend = $derived.by(() => applyLegendEdits(this.#legend(), this.legendEdits))
  /** What the legend editor lists. */
  editorRows = $derived.by(() => legendEditorRows(this.#legend(), this.legendEdits))
  /** The map's own legend title, the editor's placeholder. */
  get mapLegendTitle(): string {
    return this.#legend()?.title ?? ''
  }
  renameLegendRow(key: string, original: string, label: string): void {
    this.legendEdits = editRow(this.legendEdits, key, original, { label })
  }
  toggleLegendRow(key: string, original: string, hidden: boolean): void {
    this.legendEdits = editRow(this.legendEdits, key, original, { hidden })
  }
  moveLegendRow(group: number, original: string, direction: -1 | 1): void {
    this.legendEdits = moveRow(this.#legend(), this.legendEdits, group, original, direction)
  }
  setLegendTitle(title: string): void {
    this.legendEdits = { ...this.legendEdits, title: title.trim() ? title : null }
  }
  resetLegend(): void {
    this.legendEdits = NO_LEGEND_EDITS
  }

  /** The page as the export pipeline takes it: the settings resolved against the open file, the legend and the captured map. */
  options = $derived.by((): LayoutOptions => {
    const l = this.layout
    const c = this.captured
    const customSize: CustomSize | null = l.paperSize === 'custom' ? { width: l.customWidth, height: l.customHeight, unit: l.customUnit } : null
    const number = (text: string): number => (Number.isFinite(Number(text)) ? Number(text) : 0)
    return {
      // A blank title follows the open file's name, and a blank date is today: neither is written into the settings.
      title: l.title.trim() ? l.title : this.#store.printBaseName,
      subtitle: l.subtitle,
      paperSize: l.paperSize,
      orientation: l.orientation,
      customSize,
      showTitle: l.showTitle,
      showSubtitle: l.showSubtitle,
      titlePlacement: l.titlePlacement,
      titleAlign: l.titleAlign,
      showLegend: l.showLegend,
      showScaleBar: l.showScaleBar,
      scaleUnit: this.#store.drawUnits,
      showNorthArrow: l.showNorthArrow,
      navigationGrouped: l.navigationGrouped,
      showFooter: l.showFooter,
      footerText: l.footerText,
      showDate: l.showDate,
      dateText: l.dateText.trim() ? l.dateText : new Intl.DateTimeFormat().format(),
      showAttribution: l.showAttribution,
      attributionText: 'Created with Spatial Explorer',
      pageMargin: l.pageMargin,
      showPageBorder: l.showPageBorder,
      pageBorderColor: l.pageBorderColor,
      pageBorderWidth: l.pageBorderWidth,
      mapBorderColor: l.mapBorderColor,
      mapBorderWidth: l.mapBorderWidth,
      mapBackground: l.mapBackground,
      colorbar: l.showColorbar
        ? {
            colors: rampColors({ id: l.colorbarRamp, reversed: false }, 16),
            min: number(l.colorbarMin),
            max: number(l.colorbarMax),
            label: l.colorbarLabel,
            orientation: l.colorbarOrientation,
            position: l.colorbarPosition,
            lengthPct: l.colorbarLength,
          }
        : null,
      customLegend: l.showCustomLegend ? { title: l.customLegendTitle, entries: l.customLegendEntries.map((e) => ({ label: e.label, color: e.color })), position: l.customLegendPosition } : null,
      showInfoBlock: l.showInfoBlock,
      author: l.author,
      projectNumber: l.projectNumber,
      crs: l.crs,
      revision: l.revision,
      legend: this.legend,
      dataTable: this.dataTable,
      dataChart: this.dataChart,
      metersPerPixel: c?.metersPerPixel ?? 0,
      mapPixelRatio: c?.pixelRatio ?? 1,
      bearingDeg: c?.bearingDeg ?? 0,
      mapImage: c?.image ?? null,
      mapImageWidth: c?.width ?? 0,
      mapImageHeight: c?.height ?? 0,
      mapFit: 'cover',
    }
  })

  /** The page as it is drawn and saved: the options with this atlas page's tokens resolved (the inputs keep the template). */
  display = $derived.by((): LayoutOptions => {
    const ctx = this.atlas.tokenContext
    const o = this.options
    return ctx ? { ...o, title: substituteAtlasTokens(o.title, ctx), subtitle: substituteAtlasTokens(o.subtitle, ctx), footerText: substituteAtlasTokens(o.footerText, ctx) } : o
  })

  /** Only physical paper carries a true cartographic scale. */
  isMmPage = $derived(resolvePageSize(this.options).unit === 'mm')
  /** The 1:N scale the page renders the capture at, or 0. */
  currentRatio = $derived(computeScaleRatio(this.options))

  /** The layer's columns a block can show: not geometry, not the app's helpers. */
  get fields(): Array<{ name: string; numeric: boolean }> {
    return (this.#store.displayedLayer?.columns ?? [])
      .filter((col) => !col.name.startsWith('__se_') && !/^(GEOMETRY|BLOB|WKB)/i.test(col.type))
      .map((col) => ({ name: col.name, numeric: /^(U?TINYINT|U?SMALLINT|U?INTEGER|U?BIGINT|HUGEINT|UHUGEINT|FLOAT|DOUBLE|REAL|DECIMAL)/i.test(col.type) }))
  }
  /** The table's columns: those picked and still in the layer, or the first few. */
  get tableColumns(): string[] {
    const names = this.fields.map((f) => f.name)
    const picked = this.layout.tableColumns.filter((n) => names.includes(n))
    return picked.length ? picked : names.slice(0, DEFAULT_TABLE_COLUMNS)
  }
  /** Everything a block depends on, as one string: a change refreshes the blocks. */
  get blocksKey(): string {
    const l = this.layout
    return JSON.stringify([
      l.showDataTable, this.tableColumns, l.tableTitle, l.tableSortField, l.tableSortDesc, l.tableMaxRows, l.tableFitRows, l.tablePosition, l.tablePageFilter,
      l.showDataChart, l.chartTitle, l.chartType, l.chartCategoryField, l.chartAggregation, l.chartValueField, l.chartPosition, l.chartPageFilter,
      l.tableFilterToAtlasFeature, l.atlasCoverage, this.atlas.active ? [this.atlas.clampedIndex, this.atlas.viewBounds?.bounds] : null,
      this.captured?.extent, this.#store.displayedLayer?.columns.map((col) => col.name),
    ])
  }

  /** The rows a block reads: the page's extent (the atlas page's own frame when there is one), filtered as chosen. */
  #scope(mode: BlockScope['mode'], forTable: boolean, atlasBounds?: AtlasBounds | null, rowId?: number | null): BlockScope {
    const page = this.atlas.viewBounds
    const here = this.atlas.active && page && page.index === this.atlas.clampedIndex ? page.bounds : null
    const bbox = atlasBounds ?? here ?? this.captured?.extent ?? null
    const own = forTable && this.layout.tableFilterToAtlasFeature && this.layout.atlasCoverage === 'features' ? (rowId ?? this.atlas.currentPage?.rowId ?? null) : null
    return { mode, bbox, rowId: own }
  }

  /** What the table and the chart show, asked of the engine (the displayed rows, in the scopes given). */
  async #buildBlocks(tableScope: BlockScope, chartScope: BlockScope): Promise<{ table: LayoutOptions['dataTable']; chart: LayoutOptions['dataChart'] }> {
    const l = this.layout
    const store = this.#store
    const title = (own: string): string => (own.trim() ? own : store.printBaseName)
    let table: LayoutOptions['dataTable'] = null
    let chart: LayoutOptions['dataChart'] = null
    if (l.showDataTable && this.tableColumns.length) {
      const r = await store.printBlock({ kind: 'table', columns: this.tableColumns, sortField: l.tableSortField, sortDesc: l.tableSortDesc, limit: l.tableFitRows ? MAX_TABLE_ROWS : l.tableMaxRows, ...tableScope })
      if (r && 'rows' in r) table = { title: title(l.tableTitle), columns: (r as TableBlockResult).columns, rows: (r as TableBlockResult).rows, truncated: (r as TableBlockResult).truncated, position: l.tablePosition }
    }
    if (l.showDataChart) {
      const colors = (n: number): string[] => rampColors({ id: 'okabe-ito', reversed: false }, Math.max(1, n))
      if (l.chartType === 'line') {
        if (l.chartValueField) {
          const r = (await store.printBlock({ kind: 'line', valueField: l.chartValueField, ...chartScope })) as LineBlockResult | null
          if (r && 'points' in r) chart = { title: title(l.chartTitle), position: l.chartPosition, data: { kind: 'line', points: r.points, min: r.min, max: r.max, length: r.length, color: colors(1)[0] } }
        }
      } else if (l.chartCategoryField && (l.chartAggregation === 'count' || l.chartValueField)) {
        const rows = (await store.printBlock({ kind: 'groups', category: l.chartCategoryField, valueField: l.chartAggregation === 'count' ? null : l.chartValueField, ...chartScope })) as GroupRow[] | null
        if (rows && Array.isArray(rows)) {
          if (l.chartType === 'pie') {
            const pie = pieData(rows, l.chartAggregation)
            if (pie) chart = { title: title(l.chartTitle), position: l.chartPosition, data: { kind: 'pie', slices: pie.slices.map((sl, i) => ({ ...sl, color: colors(pie.slices.length)[i] })), total: pie.total } }
          } else {
            const bar = barData(rows, l.chartAggregation)
            if (bar) chart = { title: title(l.chartTitle), position: l.chartPosition, data: { kind: 'bar', bars: bar.bars.map((b, i) => ({ ...b, color: colors(bar.bars.length)[i] })), maxValue: bar.maxValue, minValue: bar.minValue, truncated: bar.truncated } }
          }
        }
      }
    }
    return { table, chart }
  }

  /** Asks the engine for the table and the chart of the page now, and keeps the answer if no newer ask came. */
  async refreshBlocks(): Promise<void> {
    const seq = ++this.#blockSeq
    const l = this.layout
    const { table, chart } = await this.#buildBlocks(this.#scope(l.tablePageFilter, true), this.#scope(l.chartPageFilter, false))
    // A newer ask is on its way: this answer is stale.
    if (seq !== this.#blockSeq) return
    this.dataTable = table
    this.dataChart = chart
  }

  /** A capture as the layout measures it: meters per device pixel of the picture. */
  #toCaptured(shot: MapShot): CapturedMap {
    return { image: shot.frame, width: shot.frame.width, height: shot.frame.height, metersPerPixel: shot.metersPerPixel / shot.ratio, pixelRatio: shot.ratio, bearingDeg: shot.bearing, extent: shot.extent }
  }

  /** Takes the map as it is now (or the part inside the print extent); in an atlas, drives the map to the current page. */
  async recapture(): Promise<void> {
    if (this.atlas.active) return this.goToAtlasPage(this.atlas.clampedIndex)
    if (this.capturing) return
    this.capturing = true
    this.error = null
    try {
      const clip = this.layout.captureMode === 'extent' ? this.layout.extentBbox : null
      const shot = await this.#store.captureMap({ ratio: CAPTURE_RATIO, clip })
      const notes = [...shot.notes]
      if (this.#store.basemapMissingFromPrint) notes.push('The basemap could not be loaded and is not in the page.')
      this.captureNotes = notes
      this.captured = this.#toCaptured(shot)
    } catch (err) {
      this.captured = null
      this.error = `The map could not be captured: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      this.capturing = false
    }
  }

  /** Shows the saved extent box on the map when the composer opens; takes it down when it closes. */
  attach(): void {
    const { captureMode, extentBbox } = this.layout
    if (captureMode === 'extent' && extentBbox) this.#store.printCamera?.showExtent(extentBbox)
  }
  detach(): void {
    this.#drawAbort?.abort()
    this.#store.printCamera?.showExtent(null)
    if (this.#copiedTimer) clearTimeout(this.#copiedTimer)
  }

  /** Moves the map to a typed or preset 1:N scale and captures it again. The scale is linear in meters per pixel, which halves per zoom level. */
  async applyScale(target: number): Promise<void> {
    const camera = this.#store.printCamera
    // A drawn extent fixes the ground area: zooming would not reach the scale.
    if (!camera || this.layout.captureMode === 'extent') return
    const { min, max } = camera.zoomLimits()
    const to = scaleZoomTarget(camera.zoom(), this.currentRatio, target, min, max)
    if (!to) return
    // A scale the map cannot reach is applied as far as it goes, and says so.
    this.scaleNotice = to.clamped ? 'The map cannot zoom that far: the closest scale it can reach is used.' : null
    if (!to.unchanged) {
      camera.setZoom(to.zoom)
      await camera.settled()
    }
    await this.recapture()
  }

  /** Hides the dialog so the map takes the drag, then keeps the extent that was drawn. */
  async drawExtent(): Promise<void> {
    const camera = this.#store.printCamera
    if (!camera || this.drawingExtent) return
    const size = resolvePageSize(this.options)
    const abort = new AbortController()
    this.#drawAbort = abort
    this.drawingExtent = true
    let extent: PrintExtent | null
    try {
      extent = await camera.drawExtent({ aspect: size.width / size.height, signal: abort.signal })
    } finally {
      this.#drawAbort = null
      this.drawingExtent = false
    }
    if (abort.signal.aborted) return
    const previous = this.layout.extentBbox
    if (extent) {
      this.scaleNotice = null
      this.set({ extentBbox: extent, captureMode: 'extent' })
      await this.recapture()
    } else {
      // Cancelled: the box goes back to the one before (or away).
      camera.showExtent(this.layout.captureMode === 'extent' ? previous : null)
    }
  }

  clearExtent(): void {
    this.#store.printCamera?.showExtent(null)
    this.set({ extentBbox: null, captureMode: 'viewport' })
    void this.recapture()
  }

  /** Switches between the viewport and the drawn extent. */
  setCaptureMode(mode: 'viewport' | 'extent'): void {
    if (mode === this.layout.captureMode) return
    if (mode === 'extent') this.scaleNotice = null
    this.set({ captureMode: mode })
    // The box is on the map in extent mode only.
    this.#store.printCamera?.showExtent(mode === 'extent' ? this.layout.extentBbox : null)
    void this.recapture()
  }

  /** The layer's coverage features, read again when the atlas turns on, its coverage changes or another layer is shown. */
  get atlasLoadKey(): string {
    return JSON.stringify([this.atlas.enabled, this.layout.atlasCoverage, this.#store.displayedLayer?.columns.map((col) => col.name)])
  }

  /**
   * Drives the live map to one atlas page and captures it. A margin grows the feature's box before fitting; a fixed scale
   * fits tight, then corrects the zoom by the log2 of the ratio and captures again. The page's frame (what the cover-crop
   * keeps of the map) is its visible extent, so data blocks leave out the part that is cropped away.
   */
  async captureAtlasPage(page: AtlasPage, total = this.atlas.count): Promise<{ cap: CapturedMap; viewBounds: AtlasBounds }> {
    const camera = this.#store.printCamera
    if (!camera) throw new Error('The map is not ready.')
    const l = this.layout
    const ctx: AtlasTokenContext = { name: page.name, pageNumber: page.index + 1, total, properties: page.properties }
    const o = this.options
    const pageOptions: LayoutOptions = { ...o, title: substituteAtlasTokens(o.title, ctx), subtitle: substituteAtlasTokens(o.subtitle, ctx), footerText: substituteAtlasTokens(o.footerText, ctx) }
    const { width: vw, height: vh } = camera.viewport()
    const frame = atlasViewportFrame(vw, vh, mapBodyAspectRatio(pageOptions))
    // Everything outside a polygon feature is dimmed on request.
    let mask: GeoJSON.Feature | null = null
    if (l.atlasMaskEnabled && l.atlasCoverage === 'features' && page.rowId !== undefined) {
      const f = await this.#store.printFeatureGeometry(page.rowId)
      if (f && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')) mask = f
    }
    camera.fit(expandBounds(page.bounds, this.atlas.fitMarginPct), frame.padding)
    await camera.settled()
    let cap = this.#toCaptured(await this.#store.captureMap({ ratio: CAPTURE_RATIO, mask }))
    this.atlas.scaleNotice = null
    if (l.atlasExtentMode === 'scale') {
      const target = Number(l.atlasScale)
      // Measured against the page's own text: a title made of tokens can resolve to nothing and change the body height.
      const measure = (): number => computeScaleRatio({ ...pageOptions, metersPerPixel: cap.metersPerPixel, mapPixelRatio: cap.pixelRatio, bearingDeg: cap.bearingDeg, mapImage: cap.image, mapImageWidth: cap.width, mapImageHeight: cap.height })
      // One correction usually lands it; up to three more, the last only to measure what ships.
      for (let attempt = 0; attempt < 4; attempt++) {
        const ratio = measure()
        if (!(target > 0 && ratio > 0)) break
        if (attempt > 0 && Math.abs(ratio / target - 1) < 0.005) {
          this.atlas.scaleNotice = null
          break
        }
        if (attempt === 3) {
          this.atlas.scaleNotice = 'The map cannot zoom that far: this page is at the closest scale it can reach.'
          break
        }
        const zoom = camera.zoom() + Math.log2(ratio / target)
        const { min, max } = camera.zoomLimits()
        const clamped = Math.max(min, Math.min(max, zoom))
        this.atlas.scaleNotice = Math.abs(clamped - zoom) > 1e-3 ? 'The map cannot zoom that far: this page is at the closest scale it can reach.' : null
        if (Math.abs(clamped - camera.zoom()) <= 1e-3) break
        camera.setZoom(clamped)
        await camera.settled()
        cap = this.#toCaptured(await this.#store.captureMap({ ratio: CAPTURE_RATIO, mask }))
      }
    }
    const corners = [
      [frame.crop.left, frame.crop.top],
      [frame.crop.right, frame.crop.top],
      [frame.crop.right, frame.crop.bottom],
      [frame.crop.left, frame.crop.bottom],
    ]
      .map(([x, y]) => camera.unproject(x, y))
      .filter((p): p is [number, number] => p !== null)
    const viewBounds = geometryBounds({ type: 'MultiPoint', coordinates: corners }) ?? cap.extent
    return { cap, viewBounds }
  }

  /** Steps the preview to a page: drives the map there and captures it. */
  async goToAtlasPage(index: number): Promise<void> {
    const page = this.atlas.pages[index]
    if (!page || this.atlas.busy) return
    this.atlas.busy = true
    this.capturing = true
    this.error = null
    try {
      const { cap, viewBounds } = await this.captureAtlasPage(page)
      this.captured = cap
      this.atlas.index = index
      this.atlas.viewBounds = { index, bounds: viewBounds }
    } catch (err) {
      this.error = `The page could not be captured: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      this.atlas.busy = false
      this.capturing = false
    }
  }

  /** A page of the series, as the layout takes it: the page's map and its own blocks, its tokens resolved. */
  async #atlasPageOptions(page: AtlasPage, total: number): Promise<LayoutOptions> {
    const { cap, viewBounds } = await this.captureAtlasPage(page, total)
    // Mirrored into the preview as pages are made.
    this.captured = cap
    this.atlas.index = page.index
    this.atlas.viewBounds = { index: page.index, bounds: viewBounds }
    const l = this.layout
    const { table, chart } = await this.#buildBlocks(this.#scope(l.tablePageFilter, true, viewBounds, page.rowId), this.#scope(l.chartPageFilter, false, viewBounds))
    const ctx: AtlasTokenContext = { name: page.name, pageNumber: page.index + 1, total, properties: page.properties }
    const o = this.options
    return {
      ...o,
      title: substituteAtlasTokens(o.title, ctx),
      subtitle: substituteAtlasTokens(o.subtitle, ctx),
      footerText: substituteAtlasTokens(o.footerText, ctx),
      dataTable: table,
      dataChart: chart,
      metersPerPixel: cap.metersPerPixel,
      mapPixelRatio: cap.pixelRatio,
      bearingDeg: cap.bearingDeg,
      mapImage: cap.image,
      mapImageWidth: cap.width,
      mapImageHeight: cap.height,
    }
  }

  /** Exports every page: one multi-page PDF, or a PNG for each in a zip. The pages and the settings are those of the click. */
  async exportAtlas(kind: 'pdf' | 'zip'): Promise<void> {
    if (!this.atlas.active || this.atlas.busy || this.atlas.configBlocked) return
    const camera = this.#store.printCamera
    const pages = this.atlas.pages
    const total = pages.length
    const start = camera?.view()
    this.exporting = true
    this.atlas.busy = true
    this.error = null
    this.saved = null
    const tokens = (i: number): AtlasTokenContext => ({ name: pages[i].name, pageNumber: i + 1, total, properties: pages[i].properties })
    const source: AtlasExportSource = {
      total,
      onProgress: (current, of) => (this.atlas.progress = { current, total: of }),
      optionsForPage: (i) => this.#atlasPageOptions(pages[i], total),
    }
    try {
      // The combined file's name cannot carry any one page's tokens.
      const base = sanitizeFilename(stripAtlasTokens(this.layout.title) || this.#store.printBaseName)
      const file = kind === 'pdf' ? await atlasPdf(source) : await atlasPngZip(source, (i) => atlasEntryName(this.layout.atlasFilenamePattern, tokens(i)))
      const name = `${base}-atlas.${kind === 'pdf' ? 'pdf' : 'zip'}`
      const result = await this.#store.savePrintFile(name, file.bytes)
      if (result.saved) this.saved = { location: result.location ?? name, size: file.size, notes: [...this.captureNotes, ...file.notes] }
    } catch (err) {
      this.error = `The atlas could not be made: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      this.exporting = false
      this.atlas.busy = false
      this.atlas.progress = null
      // The map goes back to where it was, and the preview to the page it shows.
      if (start) camera?.restoreView(start)
      void this.goToAtlasPage(Math.min(this.atlas.index, Math.max(0, this.atlas.count - 1)))
    }
  }

  /** Copies the page to the clipboard as a PNG. */
  async copy(): Promise<void> {
    if (!this.captured) return void (this.error = 'Capture the map first.')
    this.exporting = true
    this.error = null
    try {
      await copyLayoutToClipboard(this.display)
      this.copied = true
      if (this.#copiedTimer) clearTimeout(this.#copiedTimer)
      this.#copiedTimer = setTimeout(() => (this.copied = false), 2000)
    } catch (err) {
      this.error = `The page could not be copied: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      this.exporting = false
    }
  }

  /** Saves the page. */
  async export(kind: ExportKind): Promise<void> {
    if (!this.captured) return void (this.error = 'Capture the map first.')
    this.exporting = true
    this.error = null
    this.saved = null
    try {
      const file: PageFile = kind === 'png' ? await layoutPng(this.display) : kind === 'pdf' ? await layoutPdf(this.display) : await layoutSvg(this.display)
      const name = `${sanitizeFilename(this.display.title || this.#store.printBaseName)}.${kind}`
      const result = await this.#store.savePrintFile(name, file.bytes)
      if (result.saved) this.saved = { location: result.location ?? name, size: file.size, notes: [...this.captureNotes, ...file.notes] }
    } catch (err) {
      this.error = `The ${kind.toUpperCase()} could not be made: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      this.exporting = false
    }
  }
}
