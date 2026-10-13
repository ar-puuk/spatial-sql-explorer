// The SQL behind a map view (spec 007 research §6, contracts/core-data-access.md
// QuerySession.view): the result's features that intersect the view, capped,
// and spread across the view when over the cap. Pure builders; the session
// runs them (tests/core/viewport-sql.test.ts).
//
// Bounding boxes are compared as CONSTANTS in the layer's own CRS, so the
// engine can prune Parquet row groups by their statistics (research §2).
import { reprojectToWgs84Sql } from '../crs.js'
import type { Bbox } from '../models.js'
import { quoteIdent } from '../query/util.js'

/** Where a view's features come from, and how their bboxes are reached. */
export interface ViewTarget {
  /** `__se_layer`, `__se_result`, or a subquery that provides the hidden columns. */
  relation: string
  /**
   * - `columns`: the relation has `__se_rowid` and `__se_xmin…` (covering columns, a parsed table, a materialized result);
   * - `bbox-table`: bboxes live in `__se_bbox` (rn, xmin…), joined on `__se_rowid` (GeoParquet without covering);
   * - `fgb`: FlatGeobuf read in parts, filtered by its own index (`spatial_filter_box`).
   */
  index: 'columns' | 'bbox-table' | 'fgb'
  /** Quoted geometry column of the relation, in `srid`. */
  geom: string
  /** EPSG of the geometry and bbox columns; null = WGS84. */
  srid: number | null
  /** Visible attribute columns (names, unquoted). */
  attrs: string[]
  /** Spec 008: the temporal ones among them, as text in the inspector's record (recordByIdSql). */
  textAttrs?: string[]
  /** FlatGeobuf only: the registered path. */
  path?: string
  /** FlatGeobuf only: the feature id expression (`"OGC_FID"` when GDAL exposes it, else a geometry hash). */
  rowidExpr?: string
  /** FlatGeobuf only: the file's envelope (header), in `srid`; tiles outside it are never queried. */
  extent?: Bbox | null
  /** Every non-null geometry is known valid (the open counted none invalid): skip ST_IsValid per feature. */
  allValid?: boolean
  /**
   * Spec 008: the relation is narrowed (table filters, "show selected only").
   * `bbox-table` candidates then keep only rows the relation still has.
   */
  narrowed?: boolean
}

const num = (n: number): string => (Number.isFinite(n) ? String(n) : '0')
const literal = (s: string): string => `'${s.replace(/'/g, "''")}'`

/** Clamps a WGS84 view to valid lon/lat (Web Mercator stops at ±85.05°). */
export function clampWgs84(b: Bbox): Bbox {
  return [Math.max(-180, b[0]), Math.max(-85.0511, b[1]), Math.min(180, b[2]), Math.min(85.0511, b[3])]
}

/**
 * The SQL that turns a WGS84 view into the layer CRS's bbox (x0, y0, x1, y1),
 * or null when the layer is WGS84 already. Run it first; its numbers then go
 * into the view SQL as constants.
 */
export function viewBoxSql(view: Bbox, srid: number | null): string | null {
  if (srid === null || srid === 4326) return null
  const [x0, y0, x1, y1] = clampWgs84(view)
  const e = `ST_Transform(ST_MakeEnvelope(${num(x0)}, ${num(y0)}, ${num(x1)}, ${num(y1)}), 'EPSG:4326', 'EPSG:${srid}', always_xy := true)`
  return `SELECT ST_XMin(e) AS x0, ST_YMin(e) AS y0, ST_XMax(e) AS x1, ST_YMax(e) AS y1 FROM (SELECT ${e} AS e)`
}

/** Bbox-overlap predicate on columns named `<prefix>xmin` … (constants: prunable). */
function overlaps(box: Bbox, x0: string, y0: string, x1: string, y1: string): string {
  return `${x0} <= ${num(box[2])} AND ${x1} >= ${num(box[0])} AND ${y0} <= ${num(box[3])} AND ${y1} >= ${num(box[1])}`
}

/** Bbox-overlap predicate on the relation's hidden bbox columns (spec 010: tiles use it too). */
export const hiddenOverlap = (box: Bbox): string => overlaps(box, '__se_xmin', '__se_ymin', '__se_xmax', '__se_ymax')
const tableOverlap = (box: Bbox): string => overlaps(box, 'xmin', 'ymin', 'xmax', 'ymax')

/** Rows of the relation whose bbox meets the view, as `(rn, xmin, ymin, xmax, ymax)` (not for `fgb`). */
export function candidates(t: ViewTarget, box: Bbox): string {
  if (t.index === 'bbox-table') return `SELECT rn, xmin, ymin, xmax, ymax FROM __se_bbox WHERE ${tableOverlap(box)}${t.narrowed ? ` AND rn IN (SELECT __se_rowid FROM ${t.relation})` : ''}`
  return `SELECT __se_rowid AS rn, __se_xmin AS xmin, __se_ymin AS ymin, __se_xmax AS xmax, __se_ymax AS ymax FROM ${t.relation} WHERE ${hiddenOverlap(box)}`
}

/** Exact count of rows whose bbox meets the view (null-bbox rows have no geometry: never counted). */
export function viewCountSql(t: ViewTarget, box: Bbox): string {
  if (t.index === 'fgb') throw new Error('FlatGeobuf views are counted per tile (fgbTileSql)')
  return `SELECT count(*) AS n FROM (${candidates(t, box)})`
}

/** Hash buckets for the proportional sample. */
const BUCKETS = 1_000_003

/**
 * The keep-condition of a proportional, deterministic sample (research §6):
 * each row in view is kept with probability ~cap / inView, decided by a hash
 * of its id. Unlike one-per-grid-cell thinning, which made dense cities and
 * sparse countryside look alike, density stays visible; and a feature is in or
 * out by its id, so panning doesn't shuffle features. 10% extra makes the cap
 * fill; the final LIMIT cuts in hash order, not file order.
 */
function sampleWhere(id: string, cap: number, inView: number): string {
  const ratio = inView > 0 ? Math.min(1, (cap * 1.1) / inView) : 1
  return `hash(${id}) % ${BUCKETS} < ${Math.ceil(BUCKETS * ratio)}`
}

/** Row ids of a proportional sample of the view (`bbox-table` targets, whose attributes are fetched by id). */
export function thinnedIdsSql(t: ViewTarget, box: Bbox, cap: number, inView: number): string {
  const limit = Math.max(1, Math.floor(cap))
  return `SELECT rn FROM (${candidates(t, box)}) WHERE ${sampleWhere('rn', limit, inView)} ORDER BY hash(rn), rn LIMIT ${limit}`
}

/**
 * A thinned view without reading geometry (research §6): a proportional
 * sample's attributes, ids and bboxes, and a WGS84 dot at each bbox center. At
 * overview zoom nearly every feature is under 2 px, so the dot IS its map
 * geometry; only the few larger ones need their geometry fetched
 * (featuresByIdsSql). Reading 25,000 geometries spread over a 762 MB file
 * touched nearly every row group (19.6 s); bbox and attribute columns don't
 * (5.1 s including engine start). Not for `bbox-table` targets, whose
 * attributes come from the relation (thinnedIdsSql + featuresByIdsSql).
 */
export function thinnedRowsSql(t: ViewTarget, box: Bbox, cap: number, inView: number): string {
  if (t.index !== 'columns') throw new Error('thinnedRowsSql needs bbox columns on the relation')
  const limit = Math.max(1, Math.floor(cap))
  const keep = [...t.attrs.map(quoteIdent), '__se_rowid', '__se_xmin', '__se_ymin', '__se_xmax', '__se_ymax']
  const dot = reprojectToWgs84Sql('ST_Point((__se_xmin + __se_xmax) / 2, (__se_ymin + __se_ymax) / 2)', t.srid)
  return `SELECT ${keep.join(', ')}, ST_AsGeoJSON(${dot}) AS __se_dotjson FROM ${t.relation} WHERE ${hiddenOverlap(box)} AND ${sampleWhere('__se_rowid', limit, inView)} ORDER BY hash(__se_rowid), __se_rowid LIMIT ${limit}`
}

/**
 * The map geometry: a feature smaller than `minSize` (layer units, ~2 px at
 * this view) in both directions is sent as its centroid, so an overview of
 * tiny polygons shows dots instead of nothing (MapLibre doesn't rasterize
 * sub-pixel polygons) and transfers far less data.
 */
function mapGeometry(g: string, minSize: number | undefined): string {
  if (!minSize || !(minSize > 0)) return g
  const s = num(minSize)
  return `CASE WHEN ST_XMax(${g}) - ST_XMin(${g}) < ${s} AND ST_YMax(${g}) - ST_YMin(${g}) < ${s} THEN ST_Centroid(${g}) ELSE ${g} END`
}

/** Feature columns for the map: attributes, the row id, and WGS84 GeoJSON (invalid geometry excluded). */
function featureSelect(t: ViewTarget, minSize?: number, rowid = '__se_rowid'): string {
  const g = mapGeometry(t.geom, minSize)
  return [...t.attrs.map(quoteIdent), rowid === '__se_rowid' ? rowid : `${rowid} AS __se_rowid`, `ST_AsGeoJSON(${reprojectToWgs84Sql(g, t.srid)}) AS __se_geojson`].join(', ')
}

/** Rows whose geometry can be drawn (spec 010: tiles and the one-time GeoJSON load use it too). */
export const validGeometry = (g: string, allValid = false): string => (allValid ? `${g} IS NOT NULL` : `${g} IS NOT NULL AND ST_IsValid(${g})`)

/** Every feature in the view (when the count is at or below the cap). */
export function viewFeaturesSql(t: ViewTarget, box: Bbox, cap: number, minSize?: number): string {
  if (t.index === 'fgb') throw new Error('FlatGeobuf views are loaded per tile (fgbTileSql)')
  const where = t.index === 'bbox-table' ? `__se_rowid IN (SELECT rn FROM (${candidates(t, box)}))` : hiddenOverlap(box)
  return `SELECT ${featureSelect(t, minSize)} FROM ${t.relation} WHERE ${where} AND ${validGeometry(t.geom, t.allValid)} ORDER BY __se_rowid LIMIT ${Math.max(1, Math.floor(cap))}`
}

/** The features for a list of row ids (a thinned view, or a selection outside it). */
export function featuresByIdsSql(t: ViewTarget, idsSql: string, minSize?: number): string {
  if (t.index === 'fgb') throw new Error('FlatGeobuf features are fetched with fgbByIdSql')
  return `SELECT ${featureSelect(t, minSize)} FROM ${t.relation} WHERE __se_rowid IN (${idsSql}) AND ${validGeometry(t.geom, t.allValid)} ORDER BY __se_rowid`
}

/**
 * FlatGeobuf read in parts: its packed Hilbert R-tree answers bbox filters,
 * but each feature costs ~0.74 ms (research §4), so a view is loaded as a
 * grid of tiles, each capped — spread across the view without counting it.
 *
 * DuckDB-WASM 1.4.3 bug (research §4): a `spatial_filter_box` matching no
 * feature returns one full batch (2,048 rows) of stale data instead of none.
 * So rows are re-checked against the tile, tiles outside the file's envelope
 * are skipped (`tileMeetsExtent`), and the session treats a WKB parse error
 * in a tile as an empty tile.
 */
export function fgbTileSql(t: ViewTarget, tile: Bbox, limit: number, minSize?: number): string {
  if (t.index !== 'fgb' || !t.path) throw new Error('fgbTileSql needs a FlatGeobuf target')
  const box = `ST_MakeBox2D(ST_Point(${num(tile[0])}, ${num(tile[1])}), ST_Point(${num(tile[2])}, ${num(tile[3])}))`
  const g = t.geom
  return `SELECT ${featureSelect(t, minSize, t.rowidExpr ?? '"OGC_FID"')} FROM ST_Read(${literal(t.path)}, spatial_filter_box := ${box}) WHERE ${validGeometry(g, t.allValid)} AND ${overlaps(tile, `ST_XMin(${g})`, `ST_YMin(${g})`, `ST_XMax(${g})`, `ST_YMax(${g})`)} LIMIT ${Math.max(1, Math.floor(limit))}`
}

/** Whether a FlatGeobuf tile can hold features at all (an empty filter returns stale rows). */
export function tileMeetsExtent(tile: Bbox, extent: Bbox | null | undefined): boolean {
  if (!extent) return true
  return tile[0] <= extent[2] && tile[2] >= extent[0] && tile[1] <= extent[3] && tile[3] >= extent[1]
}

/** The view split into a k × k grid (k = 6: 36 tiles) for FlatGeobuf tile loading. */
export function viewTiles(box: Bbox, k = 6): Bbox[] {
  const w = (box[2] - box[0]) / k
  const h = (box[3] - box[1]) / k
  const tiles: Bbox[] = []
  for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) tiles.push([box[0] + i * w, box[1] + j * h, box[0] + (i + 1) * w, box[1] + (j + 1) * h])
  return tiles
}

/** Attributes as selected for display: temporal ones as DuckDB's text. */
const recordAttrs = (t: ViewTarget, asText: boolean): string[] =>
  t.attrs.map((a) => (asText && t.textAttrs?.includes(a) ? `CAST(${quoteIdent(a)} AS VARCHAR) AS ${quoteIdent(a)}` : quoteIdent(a)))

/**
 * Spec 008: one feature's full record, for the inspector: every attribute,
 * dates and times as text.
 */
export function recordByIdSql(t: ViewTarget, id: number): string {
  if (t.index === 'fgb') return fgbByIdSql(t, id, true)
  return `SELECT ${[...recordAttrs(t, true), '__se_rowid', `ST_AsGeoJSON(${reprojectToWgs84Sql(t.geom, t.srid)}) AS __se_geojson`].join(', ')} FROM ${t.relation} WHERE __se_rowid = ${Math.floor(id)} AND ${validGeometry(t.geom, t.allValid)}`
}

/** One FlatGeobuf feature by its id (selection outside the drawn set). */
export function fgbByIdSql(t: ViewTarget, id: number, asText = false): string {
  if (t.index !== 'fgb' || !t.path) throw new Error('fgbByIdSql needs a FlatGeobuf target')
  const rowid = t.rowidExpr ?? '"OGC_FID"'
  return `SELECT ${[...recordAttrs(t, asText), `${rowid} AS __se_rowid`, `ST_AsGeoJSON(${reprojectToWgs84Sql(t.geom, t.srid)}) AS __se_geojson`].join(', ')} FROM ST_Read(${literal(t.path)}) WHERE ${rowid} = ${Math.floor(id)}`
}
