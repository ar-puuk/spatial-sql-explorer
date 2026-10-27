// Spec 014: scratch shapes the user draws on the map (never edits to the data): what they are, their
// measurements, and the SQL that uses them: the `drawn` table, a spatial predicate on the layer, and
// GeoJSON export. Shapes are WGS84 GeoJSON (what Terra Draw and MapLibre work in). Pure builders.
import { quoteIdent, quoteLiteral } from '../query/util.js'
import { formatArea, formatLength, geodesicGeometry, lineLengthMeters, polygonAreaSquareMeters, polygonPerimeterMeters, type UnitSystem } from './geodesy.js'

export type ShapeKind = 'point' | 'line' | 'polygon' | 'rectangle' | 'circle' | 'freehand'

/** What the shape was drawn for: scratch geometry (draw), a measurement, or a selection of rows. */
/** `profile` and `area` (spec 027) read a raster's values along a line or inside an area; they are never queries or filters. */
export type ShapePurpose = 'draw' | 'measure' | 'select' | 'profile' | 'area'

export interface DrawnShape {
  /** Terra Draw's feature id (a UUID). */
  id: string
  kind: ShapeKind
  purpose: ShapePurpose
  /** WGS84 (EPSG:4326), [lon, lat]. */
  geometry: GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon
}

export interface ShapeMeasure {
  /** Line length, meters. */
  lengthM: number | null
  /** Polygon area, square meters. */
  areaM2: number | null
  /** Polygon outer ring length, meters. */
  perimeterM: number | null
}

/** Spherical measurements (within about half a percent of the spheroid), for labels and the `drawn` table. */
export function measureShape(shape: Pick<DrawnShape, 'geometry'>): ShapeMeasure {
  const g = shape.geometry
  if (g.type === 'LineString') return { lengthM: lineLengthMeters(g.coordinates), areaM2: null, perimeterM: null }
  if (g.type === 'Polygon') return { lengthM: null, areaM2: polygonAreaSquareMeters(g.coordinates), perimeterM: polygonPerimeterMeters(g.coordinates) }
  return { lengthM: null, areaM2: null, perimeterM: null }
}

/** The text on the map for a shape: a line's length, a polygon's area and perimeter; none for a point. */
export function shapeLabel(shape: Pick<DrawnShape, 'geometry'>, units: UnitSystem): string | null {
  const m = measureShape(shape)
  if (m.lengthM !== null) return formatLength(m.lengthM, units)
  if (m.areaM2 !== null && m.perimeterM !== null) return `${formatArea(m.areaM2, units)} · ${formatLength(m.perimeterM, units)}`
  return null
}

// --- SQL -----------------------------------------------------------------------------------------

/** The name a query uses for the shapes. */
export const DRAWN_TABLE = 'drawn'

// A line follows its great circle in SQL and in exports (geodesicGeometry), as it does on the map and in its length.
const geomText = (shape: Pick<DrawnShape, 'geometry'>): string => quoteLiteral(JSON.stringify(geodesicGeometry(shape.geometry)))

/** One shape as a geometry value. */
export function shapeGeometrySql(shape: Pick<DrawnShape, 'geometry'>): string {
  return `ST_GeomFromGeoJSON(${geomText(shape)})`
}

/** All the shapes as one geometry value (their union): a scalar subquery the engine evaluates once. */
export function shapesUnionSql(shapes: ReadonlyArray<Pick<DrawnShape, 'geometry'>>): string {
  if (shapes.length === 1) return shapeGeometrySql(shapes[0])
  return `(SELECT ST_Union_Agg(g) FROM (VALUES ${shapes.map((s) => `(${shapeGeometrySql(s)})`).join(', ')}) AS t(g))`
}

/** The shapes' union in a layer's CRS (WGS84 when `srid` is null or 4326). */
export function shapesInCrsSql(shapes: ReadonlyArray<Pick<DrawnShape, 'geometry'>>, srid: number | null): string {
  const union = shapesUnionSql(shapes)
  if (srid === null || srid === 4326) return union
  return `ST_Transform(${union}, 'EPSG:4326', 'EPSG:${Math.floor(srid)}', always_xy := true)`
}

/** How a shape relates to a feature for it to count. */
export type SpatialPredicate = 'intersects' | 'within' | 'contains' | 'centroid'

export const SPATIAL_PREDICATES: ReadonlyArray<{ id: SpatialPredicate; label: string; hint: string }> = [
  { id: 'intersects', label: 'Intersects', hint: 'Features that touch or overlap the shape.' },
  { id: 'within', label: 'Within', hint: 'Features entirely inside the shape.' },
  { id: 'contains', label: 'Contains', hint: 'Features that entirely contain the shape.' },
  { id: 'centroid', label: 'Centroid within', hint: "Features whose center point is inside the shape." },
]

/** The WHERE condition: `geom` (a quoted column or expression, in the CRS the shape is given in) against `shape`. */
export function spatialPredicateSql(predicate: SpatialPredicate, geom: string, shape: string): string {
  switch (predicate) {
    case 'within':
      return `ST_Within(${geom}, ${shape})`
    case 'contains':
      return `ST_Contains(${geom}, ${shape})`
    case 'centroid':
      return `ST_Within(ST_Centroid(${geom}), ${shape})`
    default:
      return `ST_Intersects(${geom}, ${shape})`
  }
}

const COLUMNS = 'id VARCHAR, kind VARCHAR, purpose VARCHAR, geom GEOMETRY, area_m2 DOUBLE, length_m DOUBLE, perimeter_m DOUBLE'
const num = (v: number | null): string => (v === null || !Number.isFinite(v) ? 'NULL' : String(v))

/** Statements that (re)build the `drawn` table: empty when there are no shapes. */
export function drawnTableSql(shapes: readonly DrawnShape[]): string[] {
  const out = [`CREATE OR REPLACE TEMP TABLE ${quoteIdent(DRAWN_TABLE)} (${COLUMNS})`]
  if (shapes.length === 0) return out
  const rows = shapes.map((s) => {
    const m = measureShape(s)
    return `(${quoteLiteral(s.id)}, ${quoteLiteral(s.kind)}, ${quoteLiteral(s.purpose)}, ${shapeGeometrySql(s)}, ${num(m.areaM2)}, ${num(m.lengthM)}, ${num(m.perimeterM)})`
  })
  out.push(`INSERT INTO ${quoteIdent(DRAWN_TABLE)} VALUES ${rows.join(', ')}`)
  return out
}

/** A query that shows the shapes as a layer (every export format then applies). */
export const DRAWN_QUERY = `SELECT * FROM ${DRAWN_TABLE}`

// --- GeoJSON export ------------------------------------------------------------------------------

/** The shapes as a GeoJSON FeatureCollection with their measurements as properties. */
export function shapesGeoJson(shapes: readonly DrawnShape[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: shapes.map((s) => {
      const m = measureShape(s)
      return { type: 'Feature', geometry: geodesicGeometry(s.geometry), properties: { id: s.id, kind: s.kind, purpose: s.purpose, area_m2: m.areaM2, length_m: m.lengthM, perimeter_m: m.perimeterM } }
    }),
  }
}
