// Spec 010 GeoJSON mode: a result under the tile threshold is read once, every
// mappable row with its attributes, and drawn from memory (no per-pan work).
// Pure builder; QuerySession.allFeatures runs it through featureBatches.ts.
import { reprojectToWgs84Sql } from '../crs.js'
import { quoteIdent } from '../query/util.js'
import { validGeometry, type ViewTarget } from './viewport.js'

/**
 * Degrees a feature must span to cover 2 screen px at zoom 0 (512 px tiles:
 * 2 * 360 / 512). A feature spanning `s` degrees reaches 2 px at zoom
 * log2(DOT_SPAN / s): below that zoom it is drawn as a dot (user decision
 * 2026-10-13, option C). MapLibre's GeoJSON tiler drops sub-pixel features,
 * so without the dot a map of small parcels is empty at its overview.
 */
export const DOT_SPAN = (2 * 360) / 512

/** Every mappable row of `t` as GeoJSON features, built once (spec 010 GeoJSON mode). */
export function allFeaturesSql(t: ViewTarget, attrs: string[], textAttrs: string[]): string {
  // Dates and times as DuckDB's text (Arrow hands them over as bare numbers), as recordByIdSql does.
  const columns = attrs.map((a) => (textAttrs.includes(a) ? `CAST(${quoteIdent(a)} AS VARCHAR) AS ${quoteIdent(a)}` : quoteIdent(a)))
  const w = '__se_w'
  // Lines and polygons also get their center and the zoom under which they show as a dot; points are dots already.
  const select = [
    ...columns,
    '__se_rowid',
    `ST_AsGeoJSON(${w}) AS __se_geojson`,
    // The center as two numbers, not a second GeoJSON text: the load must fit small memory limits.
    `CASE WHEN ST_Dimension(${w}) > 0 THEN ST_X(ST_Centroid(${w})) END AS __se_dotx`,
    `CASE WHEN ST_Dimension(${w}) > 0 THEN ST_Y(ST_Centroid(${w})) END AS __se_doty`,
    `CASE WHEN ST_Dimension(${w}) > 0 THEN log2(${DOT_SPAN} / greatest(ST_XMax(${w}) - ST_XMin(${w}), ST_YMax(${w}) - ST_YMin(${w}), 1e-9)) END AS __se_dotz`,
  ]
  return `SELECT ${select.join(', ')} FROM (SELECT *, ${reprojectToWgs84Sql(t.geom, t.srid)} AS ${w} FROM ${t.relation} WHERE ${validGeometry(t.geom, t.allValid)}) ORDER BY __se_rowid`
}
