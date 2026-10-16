// Spec 016: the atlas (map series) of the print layout, from the composer's settings (GeoLibre's useAtlasSeries.ts):
// the coverage features the engine holds, the pages they make (one per feature, or stretches along a line), the
// current page, and whether the settings can be exported. One layer is on the map, so it is the coverage layer.
import { MAX_ATLAS_FEATURES, type PrintLayoutConfig } from '@spatial-explorer/core'
import type { ViewerStore } from '../viewerStore.svelte.js'
import {
  buildAtlasPages,
  buildLineAtlasPages,
  hasLineGeometry,
  listAtlasFields,
  parseAtlasFilter,
  type AtlasBounds,
  type AtlasFeatureInfo,
  type AtlasPage,
  type AtlasTokenContext,
} from './atlas.js'

/** Line features read for along-a-line coverage: their geometry is cut into stretches here. */
const MAX_LINE_FEATURES = 2000

export class AtlasState {
  /** One page per feature: id, bounds, attributes. */
  features = $state.raw<AtlasFeatureInfo[]>([])
  /** Along a line: the line features as GeoJSON. */
  lines = $state.raw<GeoJSON.FeatureCollection | null>(null)
  /** The layer has more features than an atlas reads. */
  truncated = $state(false)
  loading = $state(false)
  /** The current page (may go stale when a filter shrinks the series: see `clampedIndex`). */
  index = $state(0)
  /** True while the atlas drives the live map (stepping or exporting). */
  busy = $state(false)
  progress = $state<{ current: number; total: number } | null>(null)
  /** Out-of-range notice from the last fixed-scale page. */
  scaleNotice = $state<string | null>(null)
  /** What the last captured page shows, to filter data blocks to it. */
  viewBounds = $state.raw<{ index: number; bounds: AtlasBounds } | null>(null)

  #store: ViewerStore
  #layout: () => PrintLayoutConfig
  #reading = false
  #again = false

  constructor(store: ViewerStore, layout: () => PrintLayoutConfig) {
    this.#store = store
    this.#layout = layout
  }

  /** The map the atlas needs: flat (no globe). */
  get supported(): boolean {
    return this.#store.projection !== 'globe'
  }
  enabled = $derived.by(() => this.#layout().atlasEnabled && this.supported)

  /**
   * Reads the coverage features from the engine (again when the layer or the coverage changes). One read at a time: a
   * request that comes while one runs makes the running one read again when it is done, with the settings then.
   */
  async load(): Promise<void> {
    if (this.#reading) {
      this.#again = true
      return
    }
    this.#reading = true
    this.loading = true
    try {
      do {
        this.#again = false
        await this.#read()
      } while (this.#again)
    } finally {
      this.#reading = false
      this.loading = false
    }
  }

  async #read(): Promise<void> {
    const line = this.#layout().atlasCoverage === 'line'
    const { rows, truncated } = await this.#store.printAtlasFeatures(line, line ? MAX_LINE_FEATURES : MAX_ATLAS_FEATURES)
    this.truncated = truncated
    if (line) {
      this.lines = {
        type: 'FeatureCollection',
        features: rows.flatMap((r) => {
          if (!r.geometry) return []
          try {
            return [{ type: 'Feature' as const, properties: r.properties, geometry: JSON.parse(r.geometry) as GeoJSON.Geometry }]
          } catch {
            return []
          }
        }),
      }
      this.features = []
    } else {
      this.features = rows.flatMap((r, i) => (r.bounds ? [{ sourceIndex: i, rowId: r.rowId, bounds: r.bounds, properties: r.properties }] : []))
      this.lines = null
    }
  }

  /** The attributes a page can be named or sorted by. */
  fields = $derived.by((): string[] => (this.#layout().atlasCoverage === 'line' ? listAtlasFields(this.lines?.features ?? []) : listAtlasFields(this.features)))
  /** How many features can seed along-a-line coverage. */
  lineFeatureCount = $derived.by((): number => (this.lines?.features ?? []).filter((f) => hasLineGeometry(f.geometry)).length)
  /** Null: the filter expression is malformed (an error is shown, and no filter is applied, so half a condition never blanks the list). */
  predicate = $derived.by(() => parseAtlasFilter(this.#layout().atlasFilter))

  pages = $derived.by((): AtlasPage[] => {
    const l = this.#layout()
    if (!this.enabled) return []
    const filter = this.predicate ?? undefined
    if (l.atlasCoverage === 'line') {
      return this.lines ? buildLineAtlasPages(this.lines, { segmentKm: Number(l.atlasSegmentKm), nameField: l.atlasNameField || undefined, filter }) : []
    }
    return buildAtlasPages(this.features, { nameField: l.atlasNameField || undefined, sortField: l.atlasSortField || undefined, sortDescending: l.atlasSortDescending, filter })
  })
  count = $derived(this.pages.length)
  clampedIndex = $derived(Math.min(this.index, Math.max(0, this.count - 1)))
  currentPage = $derived(this.enabled ? (this.pages[this.clampedIndex] ?? null) : null)
  active = $derived(this.enabled && this.count > 0)
  tokenContext = $derived.by((): AtlasTokenContext | null => {
    const page = this.currentPage
    return page ? { name: page.name, pageNumber: this.clampedIndex + 1, total: this.count, properties: page.properties } : null
  })

  /** Margin applied when fitting a page's bounds (a fixed scale fits tight and zooms after). */
  fitMarginPct = $derived.by(() => (this.#layout().atlasExtentMode === 'margin' ? this.#layout().atlasMarginPct : 0))
  scaleValid = $derived.by(() => this.#layout().atlasExtentMode !== 'scale' || Number(this.#layout().atlasScale) > 0)
  /** A floor (not just above zero) so a mistyped tiny length does not cut a long line into an enormous list. */
  segmentValid = $derived.by(() => this.#layout().atlasCoverage !== 'line' || Number(this.#layout().atlasSegmentKm) >= 0.1)
  /** A bad filter, a blank scale or segment length blocks the export: it would silently export every feature. */
  configBlocked = $derived(this.enabled && (this.predicate === null || !this.scaleValid || !this.segmentValid))
  /** Changes when the pages or how they are framed change: the preview is driven to its page again. */
  driveKey = $derived.by((): string => {
    const l = this.#layout()
    return JSON.stringify([this.pages.map((p) => p.sourceIndex), l.atlasExtentMode, l.atlasMarginPct, l.atlasScale, l.atlasMaskEnabled, l.atlasCoverage, l.atlasSegmentKm])
  })
}
