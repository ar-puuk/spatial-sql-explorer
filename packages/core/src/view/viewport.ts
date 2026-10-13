// What the map's SQL shares (spec 007 research §6; spec 010: per-pan views are
// gone, the map draws GeoJSON once or engine tiles): the relation a drawing
// reads, bbox predicates, the view box in the layer CRS, and one feature's
// record by id. Pure builders (tests/core/viewport-helpers.test.ts).
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

/** Rows whose geometry can be drawn (spec 010: tiles and the one-time GeoJSON load use it too). */
export const validGeometry = (g: string, allValid = false): string => (allValid ? `${g} IS NOT NULL` : `${g} IS NOT NULL AND ST_IsValid(${g})`)

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

/** One FlatGeobuf feature read in parts, by its id (until spec 010 phase 5 reads FlatGeobuf whole). */
export function fgbByIdSql(t: ViewTarget, id: number, asText = false): string {
  if (t.index !== 'fgb' || !t.path) throw new Error('fgbByIdSql needs a FlatGeobuf target')
  const rowid = t.rowidExpr ?? '"OGC_FID"'
  return `SELECT ${[...recordAttrs(t, asText), `${rowid} AS __se_rowid`, `ST_AsGeoJSON(${reprojectToWgs84Sql(t.geom, t.srid)}) AS __se_geojson`].join(', ')} FROM ST_Read(${literal(t.path)}) WHERE ${rowid} = ${Math.floor(id)}`
}
