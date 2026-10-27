// Spec 026: what the interface shows for the open layer. One place decides it, so a raster hides every
// control that needs rows (FR-013) and a vector layer keeps today's behaviour. PMTiles (spec 007) is a
// vector layer the map reads itself: no SQL, table or export, as before.
import type { Layer } from '../models.js'

export type LayerKind = 'vector' | 'raster'

export interface Capabilities {
  kind: LayerKind
  /** The SQL panel, snippets and everything that runs a query. */
  query: boolean
  /** The attribute table, column chooser and column filters. */
  table: boolean
  /** Search (substring and words) over the rows. */
  search: boolean
  /** Selecting rows, the selection bar and the feature card. */
  selection: boolean
  /** Drawing, measuring, selecting by shape and shape filters. */
  shapes: boolean
  /** Bin into cells and dot density. */
  grid: boolean
  /** The time slider. */
  time: boolean
  /** Exporting rows (GeoJSON, GeoParquet, CSV, ...). */
  exportRows: boolean
  /** The hover tooltip over features. */
  tooltip: boolean
  /** The vector style panel and the Labels panel. */
  vectorStyle: boolean
  /** The raster style panel, the facts card and the pixel readout. */
  rasterStyle: boolean
  print: {
    /** Table and chart blocks. */
    blocks: boolean
    atlas: boolean
  }
}

const ALL: Capabilities = {
  kind: 'vector',
  query: true,
  table: true,
  search: true,
  selection: true,
  shapes: true,
  grid: true,
  time: true,
  exportRows: true,
  tooltip: true,
  vectorStyle: true,
  rasterStyle: false,
  print: { blocks: true, atlas: true },
}

const RASTER: Capabilities = {
  kind: 'raster',
  query: false,
  table: false,
  search: false,
  selection: false,
  shapes: false,
  grid: false,
  time: false,
  exportRows: false,
  tooltip: false,
  vectorStyle: false,
  rasterStyle: true,
  print: { blocks: false, atlas: false },
}

/** A vector layer the map reads itself (PMTiles): today it switches off Style, Labels, SQL, the table and export, and nothing else. */
const TILES_ONLY: Capabilities = { ...ALL, query: false, table: false, exportRows: false, vectorStyle: false }

/** What may be shown for `layer` (null: nothing is open yet, the vector defaults). */
export function capabilitiesFor(layer: Pick<Layer, 'raster'> | null, options: { tilesOnly?: boolean } = {}): Capabilities {
  if (layer?.raster) return RASTER
  return options.tilesOnly ? TILES_ONLY : ALL
}

/** The sentence the layer area shows for a raster, where the query panel would have been (FR-013). */
export const RASTER_NO_QUERY_NOTE = 'This layer is a raster. Queries, the table and the vector tools need a vector layer.'
