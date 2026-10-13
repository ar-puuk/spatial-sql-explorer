// How the map draws the displayed result (spec 010, GeoLibre's maplibre-gl-vector auto mode):
// small results as one GeoJSON source, big ones as vector tiles the engine builds per tile.
import { tileRows } from '../source/readModes.js'

export type DrawMode = 'geojson' | 'tiles'

/** Results with at least this many rows are drawn as tiles (GeoLibre DUCKDB_VECTOR_FEATURE_WARN_COUNT). */
export const TILE_ROWS = 100_000
/** The opened file at or above this size is drawn as tiles (GeoLibre DUCKDB_VECTOR_ROUTE_BYTES). */
export const TILE_BYTES = 100 * 1024 * 1024
/** Most features one tile carries (maplibre-gl-vector TILE_FEATURE_LIMIT). */
export const TILE_FEATURE_LIMIT = 50_000

export interface DrawModeInput {
  rows: number
  /** The opened file's size; only counts for the default view (`SELECT * FROM layer`). */
  fileBytes: number | null
  defaultView: boolean
  /** The user chose "Load all" for this result. */
  loadAll: boolean
}

export function drawModeFor(i: DrawModeInput): DrawMode {
  if (i.loadAll) return 'geojson'
  if (i.rows >= tileRows()) return 'tiles'
  if (i.defaultView && i.fileBytes !== null && i.fileBytes >= TILE_BYTES) return 'tiles'
  return 'geojson'
}
