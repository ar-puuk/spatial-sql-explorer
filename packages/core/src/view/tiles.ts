// Spec 010: the map's vector tiles for big results, built by the engine one
// tile at a time with ST_AsMVT (research.md S1: z10 tiles of a 230k-row file in
// a median 16 ms). Pure builders; QuerySession.tile runs them.
import type { Bbox } from '../models.js'
import { toWebMercatorSql } from '../crs.js'
import { quoteIdent } from '../query/util.js'
import { candidates, hiddenOverlap, validGeometry, type ViewTarget } from './viewport.js'
import { TILE_FEATURE_LIMIT } from './drawMode.js'
import { DOT_PROP } from '../style/expressions.js'
import { LABEL_POINT, labelPointSql } from './labelPoint.js'

/** The MVT layer name every engine tile uses (MapLibre `source-layer`). */
export const TILE_LAYER = 'data'

/** The MVT layer of polygons' label points (labelPoint.ts), in tiles drawn while labels are on. */
export const TILE_LABEL_LAYER = 'labels'

/** MVT tile coordinates (ST_AsMVTGeom's default extent). */
const EXTENT = 4096

/** WGS84 bounds of an XYZ tile (standard slippy-map math). */
export function tileBoundsWgs84(z: number, x: number, y: number): Bbox {
  const n = 2 ** z
  const lon = (i: number): number => (i / n) * 360 - 180
  const lat = (j: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)]
}

const num = (n: number): string => (Number.isFinite(n) ? String(n) : '0')

/** One attribute in a tile: its name and how it is encoded (S1 decides the accepted types). */
export interface TileAttr {
  name: string
  type: string
}

/** ST_AsMVT takes VARCHAR, FLOAT, DOUBLE, INTEGER, BIGINT and BOOLEAN only (research.md S1): numbers go as doubles. */
const NUMERIC = /^(TINYINT|SMALLINT|INTEGER|INT|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT|UHUGEINT|FLOAT|REAL|DOUBLE|DECIMAL|NUMERIC)\b/i

/** How a tile carries a property: numbers as DOUBLE, booleans as they are, everything else as text. */
function tileType(a: TileAttr): 'DOUBLE' | 'BOOLEAN' | 'VARCHAR' {
  const type = a.type.trim()
  // Lists, structs and maps (INTEGER[] starts like a number) are text.
  if (/\[\d*\]$|^(STRUCT|MAP|UNION)\b/i.test(type)) return 'VARCHAR'
  if (NUMERIC.test(type)) return 'DOUBLE'
  if (/^BOOL/i.test(type)) return 'BOOLEAN'
  return 'VARCHAR'
}

/** A tile property's value, as tileType carries it. */
function tileValue(a: TileAttr): string {
  const col = quoteIdent(a.name)
  const type = tileType(a)
  return type === 'BOOLEAN' ? col : `CAST(${col} AS ${type})`
}

/**
 * SQL building one Mapbox Vector Tile from `t.relation` (spec 010, adapted from maplibre-gl-vector's
 * mvtTileStreamQuery, MIT). `box` is the tile's bounds in the layer's own CRS (from viewBoxSql), so the
 * bbox columns prune rows by constants. Each feature carries `__id` (= __se_rowid) for promoteId.
 *
 * A line or polygon under ~2 px of this tile is sent as its center and marked
 * `__se_dot` (user decision 2026-10-13, option C): ST_AsMVTGeom would drop it,
 * and a map of small parcels would be sparse at its overview.
 */
export function tileSql(t: ViewTarget, z: number, x: number, y: number, box: Bbox, attrs: TileAttr[], cluster: TileClusters | null = null, labels = false): string {
  const data = cluster && z <= cluster.maxZoom ? clusteredTileSql(t, z, x, y, box, attrs, cluster) : plainTileSql(t, z, x, y, box, attrs)
  if (!labels) return data
  // Two layers in one tile: their encodings joined (a tile is a list of layers).
  return `SELECT coalesce((${data}), ''::BLOB) || coalesce((${labelTileSql(t, z, x, y, box, attrs)}), ''::BLOB) AS tile`
}

/**
 * The tile's `labels` layer: one point per polygon, at its label point, in the
 * one tile that holds it (a polygon spread over many tiles is labeled once).
 * Polygons under ~2 px are dots and get no label.
 */
function labelTileSql(t: ViewTarget, z: number, x: number, y: number, box: Bbox, attrs: TileAttr[]): string {
  const g = t.geom
  const span = num((box[2] - box[0]) / 256)
  const [x0, y0, x1, y1] = t.index === 'columns' ? ['__se_xmin', '__se_ymin', '__se_xmax', '__se_ymax'] : [`ST_XMin(${g})`, `ST_YMin(${g})`, `ST_XMax(${g})`, `ST_YMax(${g})`]
  const near = t.index === 'bbox-table' ? `__se_rowid IN (SELECT rn FROM (${candidates(t, box)}))` : hiddenOverlap(box)
  const polygons = `SELECT * FROM ${t.relation} WHERE ${near} AND ${validGeometry(t.geom, t.allValid)} AND ST_Dimension(${g}) = 2 AND NOT (${x1} - ${x0} < ${span} AND ${y1} - ${y0} < ${span}) LIMIT ${TILE_FEATURE_LIMIT}`
  const placed = `SELECT *, ST_AsMVTGeom(${toWebMercatorSql(LABEL_POINT, t.srid)}, ST_Extent(ST_TileEnvelope(${z}, ${x}, ${y}))) AS __lg FROM (${labelPointSql(polygons, g)})`
  const struct = [`'__id': __se_rowid`, ...attrs.map((a) => `'${a.name.replace(/'/g, "''")}': ${tileValue(a)}`), `'geometry': __lg`]
  return `SELECT ST_AsMVT({${struct.join(', ')}}, '${TILE_LABEL_LAYER}') FROM (${placed}) WHERE __lg IS NOT NULL AND ST_X(__lg) >= 0 AND ST_X(__lg) < ${EXTENT} AND ST_Y(__lg) >= 0 AND ST_Y(__lg) < ${EXTENT}`
}

function plainTileSql(t: ViewTarget, z: number, x: number, y: number, box: Bbox, attrs: TileAttr[]): string {
  const g = t.geom
  // 2 px of a 512 px tile, in the layer's units.
  const span = num((box[2] - box[0]) / 256)
  const [x0, y0, x1, y1] = t.index === 'columns' ? ['__se_xmin', '__se_ymin', '__se_xmax', '__se_ymax'] : [`ST_XMin(${g})`, `ST_YMin(${g})`, `ST_XMax(${g})`, `ST_YMax(${g})`]
  const small = `(ST_Dimension(${g}) > 0 AND ${x1} - ${x0} < ${span} AND ${y1} - ${y0} < ${span})`
  const shape = `CASE WHEN ${small} THEN ST_Centroid(${g}) ELSE ${g} END`
  const struct = [
    `'__id': __se_rowid`,
    ...attrs.map((a) => `'${a.name.replace(/'/g, "''")}': ${tileValue(a)}`),
    `'${DOT_PROP}': ${small}`,
    `'geometry': ST_AsMVTGeom(${toWebMercatorSql(shape, t.srid)}, ST_Extent(ST_TileEnvelope(${z}, ${x}, ${y})))`,
  ]
  const near = t.index === 'bbox-table' ? `__se_rowid IN (SELECT rn FROM (${candidates(t, box)}))` : hiddenOverlap(box)
  const where = `${near} AND ${validGeometry(t.geom, t.allValid)}`
  return `SELECT ST_AsMVT({${struct.join(', ')}}, '${TILE_LAYER}') AS tile FROM (SELECT * FROM ${t.relation} WHERE ${where} LIMIT ${TILE_FEATURE_LIMIT})`
}

/** Clusters in engine tiles: points this close on screen (px) group, up to this zoom. */
export interface TileClusters {
  radius: number
  maxZoom: number
}


/**
 * A tile with its points grouped (clusters, the tiles counterpart of
 * MapLibre's GeoJSON clustering). Points are binned on a grid of about the
 * cluster radius, in whole cells per tile so the grid lines up across tiles;
 * a cell with one point keeps the feature (its id and attributes), a cell
 * with more is a bubble at their mean position carrying `point_count` (the
 * map's cluster layers draw it; NULL properties are left out of the tile).
 * Every point of the tile is counted, not the first TILE_FEATURE_LIMIT.
 * Lines and polygons are drawn as in tileSql.
 */
function clusteredTileSql(t: ViewTarget, z: number, x: number, y: number, box: Bbox, attrs: TileAttr[], cluster: TileClusters): string {
  const g = t.geom
  const cells = Math.max(1, Math.round(512 / cluster.radius))
  const cell = num(EXTENT / cells)
  const near = t.index === 'bbox-table' ? `__se_rowid IN (SELECT rn FROM (${candidates(t, box)}))` : hiddenOverlap(box)
  const where = `${near} AND ${validGeometry(t.geom, t.allValid)}`
  const mvtGeom = (shape: string) => `ST_AsMVTGeom(${toWebMercatorSql(shape, t.srid)}, ST_Extent(ST_TileEnvelope(${z}, ${x}, ${y})))`
  const isPoint = `ST_Dimension(${g}) = 0 AND ST_GeometryType(${g}) = 'POINT'`
  // Every row the same struct: attributes NULL on bubbles, point_count NULL on features.
  const props = (from: 'f' | 'b') => [
    `'__id': ${from === 'f' ? '__se_rowid' : 'NULL::BIGINT'}`,
    ...attrs.map((a) => `'${a.name.replace(/'/g, "''")}': ${from === 'f' ? tileValue(a) : `NULL::${tileType(a)}`}`),
    `'${DOT_PROP}': false`,
    `'point_count': ${from === 'f' ? 'NULL::INTEGER' : 'n'}`,
  ]
  // Points inside this tile (ST_AsMVTGeom keeps a buffer around it, which the neighbors own), in their cells.
  const points = `SELECT *, ${mvtGeom(g)} AS __g FROM ${t.relation} WHERE ${where} AND ${isPoint}`
  const binned = `SELECT *, floor(__x / ${cell}) AS __cx, floor(__y / ${cell}) AS __cy
    FROM (SELECT *, ST_X(__g) AS __x, ST_Y(__g) AS __y FROM (${points}) WHERE __g IS NOT NULL)
    WHERE __x >= 0 AND __x < ${EXTENT} AND __y >= 0 AND __y < ${EXTENT}`
  // A group split across neighboring cells would show as overlapping bubbles: each cell joins its
  // heaviest neighbor (itself included) whose center is within the radius, and that one's, two hops.
  const r2 = num((cluster.radius * (EXTENT / 512)) ** 2)
  const merged = `WITH __b AS (${binned}),
    __c AS (SELECT __cx, __cy, count(*) AS n, avg(__x) AS mx, avg(__y) AS my FROM __b GROUP BY __cx, __cy),
    __m AS (SELECT a.__cx, a.__cy, arg_max([o.__cx, o.__cy], [o.n, o.__cx, o.__cy]) AS t FROM __c a JOIN __c o
      ON abs(a.__cx - o.__cx) <= 1 AND abs(a.__cy - o.__cy) <= 1 AND (a.mx - o.mx) ** 2 + (a.my - o.my) ** 2 < ${r2} GROUP BY a.__cx, a.__cy),
    __m2 AS (SELECT m.__cx, m.__cy, h.t AS __t FROM __m m JOIN __m h ON h.__cx = m.t[1] AND h.__cy = m.t[2])
    SELECT __b.*, __t, count(*) OVER (PARTITION BY __t) AS n FROM __b JOIN __m2 USING (__cx, __cy)`
  const singles = `SELECT {${[...props('f'), `'geometry': __g`].join(', ')}} AS f FROM (${merged}) WHERE n = 1`
  const bubbles = `SELECT {${[...props('b'), `'geometry': ST_Point(avg(__x), avg(__y))`].join(', ')}} AS f FROM (${merged}) WHERE n > 1 GROUP BY __t, n`
  // Lines and polygons as tileSql draws them (small ones as dots).
  const span = num((box[2] - box[0]) / 256)
  const [x0, y0, x1, y1] = t.index === 'columns' ? ['__se_xmin', '__se_ymin', '__se_xmax', '__se_ymax'] : [`ST_XMin(${g})`, `ST_YMin(${g})`, `ST_XMax(${g})`, `ST_YMax(${g})`]
  const small = `(${x1} - ${x0} < ${span} AND ${y1} - ${y0} < ${span})`
  const shapes = `SELECT {${[
    `'__id': __se_rowid`,
    ...attrs.map((a) => `'${a.name.replace(/'/g, "''")}': ${tileValue(a)}`),
    `'${DOT_PROP}': ${small}`,
    `'point_count': NULL::INTEGER`,
    `'geometry': ${mvtGeom(`CASE WHEN ${small} THEN ST_Centroid(${g}) ELSE ${g} END`)}`,
  ].join(', ')}} AS f FROM (SELECT * FROM ${t.relation} WHERE ${where} AND ST_Dimension(${g}) > 0 LIMIT ${TILE_FEATURE_LIMIT})`
  return `SELECT ST_AsMVT(f, '${TILE_LAYER}') AS tile FROM (${singles} UNION ALL ${bubbles} UNION ALL ${shapes})`
}
