// Spec 010: the map's vector tiles for big results, built by the engine one
// tile at a time with ST_AsMVT (research.md S1: z10 tiles of a 230k-row file in
// a median 16 ms). Pure builders; QuerySession.tile runs them.
import type { Bbox } from '../models.js'
import { toWebMercatorSql } from '../crs.js'
import { quoteIdent } from '../query/util.js'
import { candidates, hiddenOverlap, validGeometry, type ViewTarget } from './viewport.js'
import { TILE_FEATURE_LIMIT } from './drawMode.js'
import { DOT_PROP } from '../style/expressions.js'

/** The MVT layer name every engine tile uses (MapLibre `source-layer`). */
export const TILE_LAYER = 'data'

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

/** A tile property's value: numbers as DOUBLE, booleans as they are, everything else as text. */
function tileValue(a: TileAttr): string {
  const col = quoteIdent(a.name)
  const type = a.type.trim()
  // Lists, structs and maps (INTEGER[] starts like a number) are text.
  if (/\[\d*\]$|^(STRUCT|MAP|UNION)\b/i.test(type)) return `CAST(${col} AS VARCHAR)`
  if (NUMERIC.test(type)) return `CAST(${col} AS DOUBLE)`
  if (/^BOOL/i.test(type)) return col
  return `CAST(${col} AS VARCHAR)`
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
export function tileSql(t: ViewTarget, z: number, x: number, y: number, box: Bbox, attrs: TileAttr[]): string {
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
