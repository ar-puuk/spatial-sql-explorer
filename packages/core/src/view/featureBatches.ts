// Spec 010: rows of the one-time GeoJSON load (allFeaturesSql) become map
// features without holding the main thread for the whole result: `JSON.parse`
// of each row's ST_AsGeoJSON text plus the row decode is ~0.7 s for 200k points
// in one task (GeoLibre #2858). Each Arrow batch arrives on its own task
// (streamRows awaits the worker); a batch that still runs past the budget is
// sliced. The JSON parse is JS's job: the engine hands GeoJSON over as text.
import { sanitizeAttributes } from '../query/util.js'
import { DOT_PROP } from '../style/expressions.js'

/** The map's data in GeoJSON mode: the features, and a dot for each one too small to see at low zoom (option C). */
export interface MapData extends GeoJSON.FeatureCollection {
  /** Points at the features' centers, with their properties plus `__se_dot` and `__se_dotz` (shown below that zoom). */
  dots: GeoJSON.Feature[]
}

/** The property holding the zoom below which a feature is drawn as a dot. */
export const DOT_ZOOM_PROP = '__se_dotz'

/**
 * How long one slice of row conversion may run before yielding to the event
 * loop. Short enough to keep input responsive, long enough that the cost of
 * yielding stays a rounding error on the total.
 */
export const FEATURE_SLICE_BUDGET_MS = 12

/** Resolves on a later task, so pending input, paint and messages can run. */
// Adapted from GeoLibre apps/geolibre-desktop/src/lib/duckdb-feature-batches.ts (MIT)
export function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof scheduler?.yield === 'function') return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** One row of allFeaturesSql as a map feature: `id` and `__id` are its row id (promoteId); null without geometry. */
export function rowToFeature(row: Record<string, unknown>): GeoJSON.Feature | null {
  return rowToFeatures(row)?.feature ?? null
}

/** The feature, and its dot when it is too small to see below some zoom (same id: selection and hover follow). */
export function rowToFeatures(row: Record<string, unknown>): { feature: GeoJSON.Feature; dot: GeoJSON.Feature | null } | null {
  const { __se_geojson, __se_rowid, __se_dotx, __se_doty, __se_dotz, ...attributes } = row
  if (typeof __se_geojson !== 'string') return null
  const id = Number(__se_rowid)
  const properties = { ...sanitizeAttributes(attributes), __id: id }
  const feature: GeoJSON.Feature = { type: 'Feature', id, properties, geometry: JSON.parse(__se_geojson) as GeoJSON.Geometry }
  const dotz = Number(__se_dotz)
  // A feature already 2 px wide at zoom 0 never needs one.
  const dot: GeoJSON.Feature | null =
    typeof __se_dotx === 'number' && typeof __se_doty === 'number' && Number.isFinite(dotz) && dotz > 0
      ? { type: 'Feature', id, properties: { ...properties, [DOT_PROP]: true, [DOT_ZOOM_PROP]: dotz }, geometry: { type: 'Point', coordinates: [__se_dotx, __se_doty] } }
      : null
  return { feature, dot }
}

export interface FeatureCollector {
  readonly features: GeoJSON.Feature[]
  readonly dots: GeoJSON.Feature[]
  /** Converts one batch of rows, yielding whenever a slice runs past the budget. */
  add(rows: ReadonlyArray<Record<string, unknown>>): Promise<void>
}

/**
 * Collects features batch by batch (streamRows's onBatch), in row order.
 * Adapted from GeoLibre apps/geolibre-desktop/src/lib/duckdb-feature-batches.ts (MIT)
 * (featureCollectionFromBatches): the same budget and 256-row clock checks.
 */
export function featureCollector(options: { budgetMs?: number; now?: () => number; yieldFn?: () => Promise<void> } = {}): FeatureCollector {
  const budget = options.budgetMs ?? FEATURE_SLICE_BUDGET_MS
  const now = options.now ?? (() => performance.now())
  const yieldFn = options.yieldFn ?? yieldToEventLoop
  const features: GeoJSON.Feature[] = []
  const dots: GeoJSON.Feature[] = []
  let seen = 0
  return {
    features,
    dots,
    async add(rows) {
      // Awaiting the next batch already let the event loop run.
      let sliceStart = now()
      for (const row of rows) {
        const f = rowToFeatures(row)
        if (f) {
          features.push(f.feature)
          if (f.dot) dots.push(f.dot)
        }
        // Checked every 256 rows: a clock read per row would cost more than the yields it schedules.
        if ((++seen & 0xff) === 0 && now() - sliceStart > budget) {
          await yieldFn()
          sliceStart = now()
        }
      }
    },
  }
}
