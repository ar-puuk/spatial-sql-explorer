// Spec 024: the SQL that makes a GTFS feed queryable. The feed's small tables are registered
// as text files and read by the engine (`read_csv`, every column as text: ids, padded times
// and times past 24:00 stay as they are). Stops are points made here from `stop_lat` and `stop_lon`
// (GDAL's stops layer turns a blank coordinate into 0, 0, which is wrong on a map). Lines come from
// one of two places: GDAL's GTFS driver (gtfs/feed.ts, the shells' readers), registered as FlatGeobuf
// files, or, when no GDAL reader is available, the engine itself (`ST_MakeLine`) from the same tables.
// A route is not a GDAL layer either way: its line is built here from the shapes its trips use,
// and the stops carry the routes that serve them.
import { quoteLiteral } from '../query/util.js'
import { SOURCE_DIR } from '../duckdbService.js'

/** Where each piece of a feed is registered with the engine (`/se-source/se-gtfs-<name>`). */
export const gtfsPath = (name: string): string => `${SOURCE_DIR}se-gtfs-${name}`

/** The internal table of which routes serve each stop (one pass over `stop_times.txt` at open). */
export const GTFS_SERVED_TABLE = '__se_gtfs_served'

/** What the engine has registered of a feed. */
export interface GtfsInventory {
  /** Text files present, as `routes`, `stop_times`, `calendar_dates`, ... (no extension, lower case). */
  tables: readonly string[]
  /** The GDAL layers converted: `shapes_geom` when the feed has shapes, `trips` when some trip has none. Empty when `mode` is `sql`. */
  geometry: readonly ('shapes_geom' | 'trips')[]
  /** Where geometry comes from: GDAL's layers (the default), or SQL over the text tables. */
  mode?: 'gdal' | 'sql'
  /** Whether `trips.txt` has a `shape_id` column (default: yes). */
  tripsHaveShapeId?: boolean
}

const csv = (table: string): string => `read_csv(${quoteLiteral(gtfsPath(`${table}.txt`))}, header = true, all_varchar = true, null_padding = true)`
const fgb = (layer: string): string => `ST_Read(${quoteLiteral(gtfsPath(`${layer}.fgb`))})`

const NO_SHAPES = '(SELECT NULL::VARCHAR AS shape_id, NULL::GEOMETRY AS geom WHERE false)'
const NO_TRIP_LINES = '(SELECT NULL::VARCHAR AS route_id, NULL::VARCHAR AS shape_id, NULL::GEOMETRY AS geom WHERE false)'

const isSql = (inv: GtfsInventory): boolean => inv.mode === 'sql'

/** Stops as a relation: every `stops.txt` column plus `geom`; a stop without usable coordinates has none. */
function stopsGeomSql(_inv: GtfsInventory): string {
  return `(SELECT *, CASE WHEN stop_lat BETWEEN -90 AND 90 AND stop_lon BETWEEN -180 AND 180 THEN ST_Point(stop_lon, stop_lat) END AS geom
           FROM (SELECT t.* REPLACE (TRY_CAST(t.stop_lat AS DOUBLE) AS stop_lat, TRY_CAST(t.stop_lon AS DOUBLE) AS stop_lon) FROM ${csv('stops')} t))`
}

/** The shapes as (shape_id, geom) lines, from `shapes.txt` ordered by `shape_pt_sequence` (SQL mode). */
function shapeLinesSql(): string {
  return `(SELECT shape_id, ST_MakeLine(list(ST_Point(lon, lat) ORDER BY seq)) AS geom
           FROM (SELECT shape_id, TRY_CAST(shape_pt_lon AS DOUBLE) AS lon, TRY_CAST(shape_pt_lat AS DOUBLE) AS lat, TRY_CAST(shape_pt_sequence AS INTEGER) AS seq FROM ${csv('shapes')})
           WHERE lon IS NOT NULL AND lat IS NOT NULL GROUP BY shape_id HAVING count(*) >= 2)`
}

/**
 * One line per route for the trips that name no shape (SQL mode): the stops of the route's longest
 * such trip, in `stop_sequence` order. The result has `route_id, shape_id, geom` like GDAL's trips layer.
 */
function tripLinesSql(inv: GtfsInventory): string {
  const noShape = inv.tripsHaveShapeId === false ? 'true' : "coalesce(t.shape_id, '') = ''"
  return `(WITH t AS (SELECT * FROM ${csv('trips')}),
        st AS (SELECT trim(trip_id) AS trip_id, trim(stop_id) AS stop_id, TRY_CAST(stop_sequence AS INTEGER) AS seq FROM ${csv('stop_times')}),
        pts AS (SELECT stop_id, geom FROM ${stopsGeomSql(inv)} WHERE geom IS NOT NULL),
        rep AS (SELECT route_id, arg_max(trip_id, n) AS trip_id FROM (SELECT t.route_id, t.trip_id, count(*) AS n FROM t JOIN st ON st.trip_id = t.trip_id WHERE ${noShape} GROUP BY t.route_id, t.trip_id) GROUP BY route_id)
      SELECT rep.route_id, '' AS shape_id, ST_MakeLine(list(pts.geom ORDER BY st.seq)) AS geom
      FROM rep JOIN st ON st.trip_id = rep.trip_id JOIN pts ON pts.stop_id = st.stop_id
      GROUP BY rep.route_id HAVING count(*) >= 2)`
}

/**
 * The routes layer as a FROM expression: every `routes.txt` column (route_type as a number),
 * the number of trips, and a (multi)line `geom`. A route's line is its distinct shapes; trips
 * with no shape contribute one line for the trip with the most points (GDAL's, or in SQL mode
 * the line through its stops). Routes with no geometry (no trips) are not in it.
 */
export function routesReaderSql(inv: GtfsInventory): string {
  const sql = isSql(inv)
  const withShapeColumn = inv.tripsHaveShapeId !== false
  const shapes = sql ? (inv.tables.includes('shapes') ? shapeLinesSql() : NO_SHAPES) : inv.geometry.includes('shapes_geom') ? fgb('shapes_geom') : NO_SHAPES
  // GDAL's trip lines carry the trip's shape_id (when the feed has the column); SQL mode builds them already shape-less.
  const byTrip = sql
    ? `by_trip AS (SELECT route_id, geom FROM ${tripLinesSql(inv)})`
    : `by_trip AS (SELECT route_id, arg_max(geom, ST_NPoints(geom)) AS geom FROM ${inv.geometry.includes('trips') ? fgb('trips') : NO_TRIP_LINES}${inv.geometry.includes('trips') && withShapeColumn ? " WHERE coalesce(shape_id, '') = ''" : ''} GROUP BY route_id)`
  const parts = [
    `routes AS (SELECT * FROM ${csv('routes')})`,
    `trips AS (SELECT route_id, ${withShapeColumn ? 'shape_id' : "'' AS shape_id"} FROM ${csv('trips')})`,
    `by_shape AS (SELECT t.route_id, ST_Collect(list(g.geom)) AS geom FROM (SELECT DISTINCT route_id, shape_id FROM trips WHERE coalesce(shape_id, '') <> '') t JOIN (SELECT shape_id, geom FROM ${shapes}) g USING (shape_id) GROUP BY t.route_id)`,
    byTrip,
    `geoms AS (SELECT route_id, geom FROM by_shape UNION ALL SELECT route_id, geom FROM by_trip WHERE route_id NOT IN (SELECT route_id FROM by_shape))`,
    `counts AS (SELECT route_id, count(*) AS n FROM trips GROUP BY route_id)`,
  ]
  return `(WITH ${parts.join(', ')} SELECT r.* REPLACE (TRY_CAST(r.route_type AS INTEGER) AS route_type), c.n::BIGINT AS trips, g.geom FROM routes r JOIN geoms g USING (route_id) LEFT JOIN counts c USING (route_id))`
}

/** Fills the internal table of routes per stop. Needs `routes`, `trips` and `stop_times`. */
export function servedTableSql(): string {
  return `CREATE OR REPLACE TABLE ${GTFS_SERVED_TABLE} AS
    WITH hits AS (SELECT DISTINCT t.route_id, trim(st.stop_id) AS stop_id FROM ${csv('stop_times')} st JOIN ${csv('trips')} t ON trim(st.trip_id) = t.trip_id)
    SELECT h.stop_id,
           string_agg(DISTINCT coalesce(nullif(r.route_short_name, ''), nullif(r.route_long_name, ''), r.route_id), ', ') AS routes,
           count(*)::BIGINT AS route_count,
           min(nullif(r.route_color, '')) AS route_color
    FROM hits h JOIN ${csv('routes')} r USING (route_id) GROUP BY h.stop_id`
}

/** The stops, with the routes that serve each stop. */
function stopsSelectSql(inv: GtfsInventory): string {
  return `SELECT s.*, v.routes, v.route_count, v.route_color FROM ${stopsGeomSql(inv)} s LEFT JOIN ${GTFS_SERVED_TABLE} v ON trim(s.stop_id) = v.stop_id`
}

/** The stops layer. */
export function stopsViewSql(sqlName: string, inv: GtfsInventory): string {
  return `CREATE OR REPLACE VIEW ${sqlName} AS ${stopsSelectSql(inv)}`
}

/** The routes layer, as a view beside the stops. */
export function routesViewSql(sqlName: string, inv: GtfsInventory): string {
  return `CREATE OR REPLACE VIEW ${sqlName} AS SELECT * FROM ${routesReaderSql(inv)}`
}

/** A color column as `#RRGGBB`, or the fallback where the feed gives none (or gives something that is not a color). */
const colorOf = (column: string, fallback: string): string => `CASE WHEN regexp_matches(coalesce(${column}, ''), '^[0-9A-Fa-f]{6}$') THEN '#' || upper(${column}) ELSE ${quoteLiteral(fallback)} END`

/**
 * The network, the feed's open layer: every route (a line) and every stop (a point) as one result, so
 * the map draws them together. `color` is what the default style paints with (route color; a stop takes
 * the color of a route that serves it); `name` is what it labels with. The routes and stops layers
 * hold all the columns.
 */
export function networkReaderSql(inv: GtfsInventory, colors: { route: string; stop: string }): string {
  return `(
    SELECT 'route' AS kind, r.route_id AS id,
           coalesce(nullif(r.route_short_name, ''), nullif(r.route_long_name, ''), r.route_id) AS name,
           NULL::VARCHAR AS routes, r.route_type AS route_type, r.trips AS trips, NULL::BIGINT AS route_count,
           ${colorOf('r.route_color', colors.route)} AS color, r.geom AS geom
    FROM ${routesReaderSql(inv)} r
    UNION ALL
    SELECT 'stop', s.stop_id, coalesce(nullif(s.stop_name, ''), s.stop_id), s.routes, NULL::INTEGER, NULL::BIGINT, s.route_count,
           ${colorOf('s.route_color', colors.stop)}, s.geom
    FROM (${stopsSelectSql(inv)}) s
  )`
}

/** A plain table of the feed (`calendar`, `shapes`, ...) as a view with every column as text. */
export function tableViewSql(sqlName: string, table: string): string {
  return `CREATE OR REPLACE VIEW ${sqlName} AS SELECT * FROM ${csv(table)}`
}

/** The counts the open layer's notice is made from: routes and stops in the text files, and how many of each the network draws (`layer` exists by then). */
export function feedCountsSql(): string {
  return `SELECT (SELECT count(*) FROM ${csv('routes')}) AS routes, (SELECT count(*) FROM ${csv('stops')}) AS stops,
                 (SELECT count(*) FROM layer WHERE kind = 'route') AS routes_drawn,
                 (SELECT count(*) FROM layer WHERE kind = 'stop' AND geom IS NOT NULL) AS stops_drawn`
}

/** Tables that are a layer of their own. */
const LAYER_TABLES = new Set(['routes', 'stops'])

/** The open layer: routes and stops together. */
export const GTFS_NETWORK = 'network'

/** The feed's layer names for its SQL schema: the network, routes and stops first, then the other tables in name order. */
export function gtfsLayerNames(tables: readonly string[]): string[] {
  return [GTFS_NETWORK, 'routes', 'stops', ...tables.filter((t) => !LAYER_TABLES.has(t)).sort()]
}
