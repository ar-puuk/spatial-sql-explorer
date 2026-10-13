// Spec 010: the map's vector tiles for big results, built by the engine one
// tile at a time with ST_AsMVT (research.md S1: z10 tiles of a 230k-row file in
// a median 16 ms). Pure builders; QuerySession.tile runs them.
import type { Bbox } from '../models.js'
import { toWebMercatorSql } from '../crs.js'
import { quoteIdent } from '../query/util.js'
import { candidates, hiddenOverlap, validGeometry, type ViewTarget } from './viewport.js'
import { TILE_FEATURE_LIMIT } from './drawMode.js'

/** The MVT layer name every engine tile uses (MapLibre `source-layer`). */
export const TILE_LAYER = 'data'

/** WGS84 bounds of an XYZ tile (standard slippy-map math). */
export function tileBoundsWgs84(z: number, x: number, y: number): Bbox {
  const n = 2 ** z
  const lon = (i: number): number => (i / n) * 360 - 180
  const lat = (j: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)]
}

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
 */
export function tileSql(t: ViewTarget, z: number, x: number, y: number, box: Bbox, attrs: TileAttr[]): string {
  const struct = [
    `'__id': __se_rowid`,
    ...attrs.map((a) => `'${a.name.replace(/'/g, "''")}': ${tileValue(a)}`),
    `'geometry': ST_AsMVTGeom(${toWebMercatorSql(t.geom, t.srid)}, ST_Extent(ST_TileEnvelope(${z}, ${x}, ${y})))`,
  ]
  const near = t.index === 'bbox-table' ? `__se_rowid IN (SELECT rn FROM (${candidates(t, box)}))` : hiddenOverlap(box)
  const where = `${near} AND ${validGeometry(t.geom, t.allValid)}`
  return `SELECT ST_AsMVT({${struct.join(', ')}}, '${TILE_LAYER}') AS tile FROM (SELECT * FROM ${t.relation} WHERE ${where} LIMIT ${TILE_FEATURE_LIMIT})`
}
