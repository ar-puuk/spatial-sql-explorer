// Spec 010: rows of the one-time GeoJSON load (allFeaturesSql) become map
// features without holding the main thread for the whole result: `JSON.parse`
// of each row's ST_AsGeoJSON text plus the row decode is ~0.7 s for 200k points
// in one task (GeoLibre #2858). Each Arrow batch arrives on its own task
// (streamRows awaits the worker); a batch that still runs past the budget is
// sliced. The JSON parse is JS's job: the engine hands GeoJSON over as text.
import { sanitizeAttributes } from '../query/util.js'

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
  const { __se_geojson, __se_rowid, ...attributes } = row
  if (typeof __se_geojson !== 'string') return null
  const id = Number(__se_rowid)
  return { type: 'Feature', id, properties: { ...sanitizeAttributes(attributes), __id: id }, geometry: JSON.parse(__se_geojson) as GeoJSON.Geometry }
}

export interface FeatureCollector {
  readonly features: GeoJSON.Feature[]
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
  let seen = 0
  return {
    features,
    async add(rows) {
      // Awaiting the next batch already let the event loop run.
      let sliceStart = now()
      for (const row of rows) {
        const feature = rowToFeature(row)
        if (feature) features.push(feature)
        // Checked every 256 rows: a clock read per row would cost more than the yields it schedules.
        if ((++seen & 0xff) === 0 && now() - sliceStart > budget) {
          await yieldFn()
          sliceStart = now()
        }
      }
    },
  }
}
