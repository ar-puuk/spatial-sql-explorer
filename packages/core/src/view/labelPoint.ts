// Labels: one per polygon, at a point the engine picks. MapLibre labels every
// part of a multipolygon (Canada, Indonesia), and every tile's piece of a big
// polygon; QGIS labels the largest part once. So the label sits at the
// representative point (GEOS's point on surface, always inside) of the
// largest part: in GeoJSON mode as points read only while labels are on (the
// point on surface is too memory-hungry for the one-time load), in tiles mode
// as the tiles' own `labels` layer.
import { reprojectToWgs84Sql } from '../crs.js'
import { DOT_SPAN } from './features.js'
import { validGeometry, type ViewTarget } from './viewport.js'

/** The label point's column, added by labelPointSql (layer CRS; NULL for anything but polygons). */
export const LABEL_POINT = '__se_lp'

/** The largest part of the polygon `g` (planar area), or `g` itself; NULL for points and lines. */
export function largestPartSql(g: string): string {
  return `CASE WHEN ST_Dimension(${g}) <> 2 THEN NULL WHEN ST_NumGeometries(${g}) > 1 THEN list_sort([{a: ST_Area(p.geom), g: p.geom} FOR p IN ST_Dump(${g})], 'DESC')[1].g ELSE ${g} END`
}

/** `from` (a SELECT) with LABEL_POINT: the representative point of its geometry `g`'s largest part. */
export function labelPointSql(from: string, g: string): string {
  return `SELECT *, ST_PointOnSurface(${largestPartSql(g)}) AS ${LABEL_POINT} FROM (${from})`
}

/** A polygon's label point: its row id, lon, lat, and the zoom below which the polygon is a dot (as allFeaturesSql's __se_dotz). */
export type LabelPoint = [id: number, lon: number, lat: number, dotz: number]

/** GeoJSON mode: every polygon's label point in WGS84 (rows: __se_rowid, x, y, dotz). */
export function labelPointsSql(t: ViewTarget): string {
  const w = '__se_w'
  const polygons = `SELECT __se_rowid, ${reprojectToWgs84Sql(t.geom, t.srid)} AS ${w} FROM ${t.relation} WHERE ${validGeometry(t.geom, t.allValid)} AND ST_Dimension(${t.geom}) = 2`
  const dotz = `log2(${DOT_SPAN} / greatest(ST_XMax(${w}) - ST_XMin(${w}), ST_YMax(${w}) - ST_YMin(${w}), 1e-9))`
  return `SELECT __se_rowid, ST_X(${LABEL_POINT}) AS x, ST_Y(${LABEL_POINT}) AS y, ${dotz} AS dotz FROM (${labelPointSql(polygons, w)}) WHERE ${LABEL_POINT} IS NOT NULL`
}

/** The label points as map features: their polygon's id and properties (plus its dot zoom), at the label point. */
export function labelFeatures(features: readonly GeoJSON.Feature[], points: readonly LabelPoint[]): GeoJSON.Feature[] {
  const byId = new Map<unknown, GeoJSON.Feature>()
  for (const f of features) byId.set(f.id, f)
  return points.flatMap(([id, lon, lat, dotz]) => {
    const f = byId.get(id)
    if (!f) return []
    const properties = dotz > 0 ? { ...f.properties, __se_dotz: dotz } : f.properties
    return [{ type: 'Feature', id: f.id, properties, geometry: { type: 'Point', coordinates: [lon, lat] } } satisfies GeoJSON.Feature]
  })
}
