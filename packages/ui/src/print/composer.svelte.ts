// Spec 016: the Print Layout composer's state (GeoLibre's print-layout/state.ts,
// useLayoutOptions.ts, useMapCapture.ts and useExportActions.ts, as one Svelte
// 5 runes class). `layout` is what is remembered between sessions
// (HostAdapter.saveState('printLayout')); everything else is the session's:
// the captured map, progress, notices.
import { createDefaultPrintLayout, rampColors, type PrintLayoutConfig } from '@spatial-explorer/core'
import type { LegendSpec } from '../mapImage.js'
import type { ViewerStore } from '../viewerStore.svelte.js'
import { copyLayoutToClipboard, layoutPdf, layoutPng, layoutSvg, type CapturedMap, type PageFile } from './export.js'
import { computeScaleRatio, resolvePageSize, type CustomSize, type LayoutOptions } from './layout.js'

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
  /** The draft of the map background's hex field: only a complete color is committed. */
  mapBackgroundDraft = $state('')

  #store: ViewerStore
  #legend: () => LegendSpec | null
  #loaded = false
  #copiedTimer: ReturnType<typeof setTimeout> | null = null

  constructor(store: ViewerStore, legend: () => LegendSpec | null) {
    this.#store = store
    this.#legend = legend
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

  /** The legend as the map shows it, or null. */
  get legend(): LegendSpec | null {
    return this.#legend()
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
      dateText: l.dateText.trim() ? l.dateText : new Date().toLocaleDateString(),
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
      legend: this.#legend(),
      metersPerPixel: c?.metersPerPixel ?? 0,
      mapPixelRatio: c?.pixelRatio ?? 1,
      bearingDeg: c?.bearingDeg ?? 0,
      mapImage: c?.image ?? null,
      mapImageWidth: c?.width ?? 0,
      mapImageHeight: c?.height ?? 0,
      mapFit: 'cover',
    }
  })

  /** Only physical paper carries a true cartographic scale. */
  isMmPage = $derived(resolvePageSize(this.options).unit === 'mm')
  /** The 1:N scale the page renders the capture at, or 0. */
  currentRatio = $derived(computeScaleRatio(this.options))

  /** Takes the map as it is now (or the part inside the print extent). */
  async recapture(): Promise<void> {
    if (this.capturing) return
    this.capturing = true
    this.error = null
    try {
      const clip = this.layout.captureMode === 'extent' ? this.layout.extentBbox : null
      const shot = await this.#store.captureMap({ ratio: CAPTURE_RATIO, clip })
      const notes = [...shot.notes]
      if (this.#store.basemapMissingFromPrint) notes.push('The basemap could not be loaded and is not in the page.')
      this.captureNotes = notes
      this.captured = {
        image: shot.frame,
        width: shot.frame.width,
        height: shot.frame.height,
        // Per device pixel of the picture, as the layout measures.
        metersPerPixel: shot.metersPerPixel / shot.ratio,
        pixelRatio: shot.ratio,
        bearingDeg: shot.bearing,
      }
    } catch (err) {
      this.captured = null
      this.error = `The map could not be captured: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      this.capturing = false
    }
  }

  /** Copies the page to the clipboard as a PNG. */
  async copy(): Promise<void> {
    if (!this.captured) return void (this.error = 'Capture the map first.')
    this.exporting = true
    this.error = null
    try {
      await copyLayoutToClipboard(this.options)
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
      const file: PageFile = kind === 'png' ? await layoutPng(this.options) : kind === 'pdf' ? await layoutPdf(this.options) : await layoutSvg(this.options)
      const name = `${sanitizeFilename(this.options.title || this.#store.printBaseName)}.${kind}`
      const result = await this.#store.savePrintFile(name, file.bytes)
      if (result.saved) this.saved = { location: result.location ?? name, size: file.size, notes: [...this.captureNotes, ...file.notes] }
    } catch (err) {
      this.error = `The ${kind.toUpperCase()} could not be made: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      this.exporting = false
    }
  }
}
