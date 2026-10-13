// Spec 010 GeoJSON mode: a result under the tile threshold is read once, every
// mappable row with its attributes, and drawn from memory (no per-pan work).
// Pure builder; QuerySession.allFeatures runs it through featureBatches.ts.
import { reprojectToWgs84Sql } from '../crs.js'
import { quoteIdent } from '../query/util.js'
import { validGeometry, type ViewTarget } from './viewport.js'

/** Every mappable row of `t` as GeoJSON features, built once (spec 010 GeoJSON mode). */
export function allFeaturesSql(t: ViewTarget, attrs: string[], textAttrs: string[]): string {
  // Dates and times as DuckDB's text (Arrow hands them over as bare numbers), as recordByIdSql does.
  const columns = attrs.map((a) => (textAttrs.includes(a) ? `CAST(${quoteIdent(a)} AS VARCHAR) AS ${quoteIdent(a)}` : quoteIdent(a)))
  const select = [...columns, '__se_rowid', `ST_AsGeoJSON(${reprojectToWgs84Sql(t.geom, t.srid)}) AS __se_geojson`]
  return `SELECT ${select.join(', ')} FROM ${t.relation} WHERE ${validGeometry(t.geom, t.allValid)} ORDER BY __se_rowid`
}
