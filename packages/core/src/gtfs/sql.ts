// Spec 024: the SQL that makes a GTFS feed queryable. The feed's small tables are registered
// as text files and read by the engine (`read_csv`, every column as text: ids, padded times
// and times past 24:00 stay as they are); GDAL's geometry (gtfs/feed.ts, the shells' readers)
// is registered as FlatGeobuf files. A route is not a GDAL layer: its line is built here from
// the shapes its trips use, and the stops carry the routes that serve them.
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
  /** The GDAL layers converted: `stops` always, `shapes_geom` when the feed has shapes, `trips` when some trip has none. */
  geometry: readonly ('stops' | 'shapes_geom' | 'trips')[]
}

const csv = (table: string): string => `read_csv(${quoteLiteral(gtfsPath(`${table}.txt`))}, header = true, all_varchar = true, null_padding = true)`
const fgb = (layer: string): string => `ST_Read(${quoteLiteral(gtfsPath(`${layer}.fgb`))})`

const NO_SHAPES = '(SELECT NULL::VARCHAR AS shape_id, NULL::GEOMETRY AS geom WHERE false)'
const NO_TRIP_LINES = '(SELECT NULL::VARCHAR AS route_id, NULL::VARCHAR AS shape_id, NULL::GEOMETRY AS geom WHERE false)'

/**
 * The routes layer as a FROM expression: every `routes.txt` column (route_type as a number),
 * the number of trips, and a (multi)line `geom`. A route's line is its distinct shapes; trips
 * with no shape contribute GDAL's line for the trip with the most points. Routes with no
 * geometry (no trips) are not in it.
 */
export function routesReaderSql(inv: GtfsInventory): string {
  const shapes = inv.geometry.includes('shapes_geom') ? fgb('shapes_geom') : NO_SHAPES
  const tripLines = inv.geometry.includes('trips') ? fgb('trips') : NO_TRIP_LINES
  const parts = [
    `routes AS (SELECT * FROM ${csv('routes')})`,
    `trips AS (SELECT route_id, ${inv.tables.includes('trips') ? 'shape_id' : "'' AS shape_id"} FROM ${csv('trips')})`,
    `by_shape AS (SELECT t.route_id, ST_Collect(list(g.geom)) AS geom FROM (SELECT DISTINCT route_id, shape_id FROM trips WHERE coalesce(shape_id, '') <> '') t JOIN (SELECT shape_id, geom FROM ${shapes}) g USING (shape_id) GROUP BY t.route_id)`,
    `by_trip AS (SELECT route_id, arg_max(geom, ST_NPoints(geom)) AS geom FROM ${tripLines} WHERE coalesce(shape_id, '') = '' GROUP BY route_id)`,
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

/** The stops: GDAL's points, with the routes that serve each stop. */
function stopsSelectSql(): string {
  return `SELECT s.*, v.routes, v.route_count, v.route_color FROM (SELECT COLUMNS(c -> c <> 'OGC_FID') FROM ${fgb('stops')}) s LEFT JOIN ${GTFS_SERVED_TABLE} v ON trim(s.stop_id) = v.stop_id`
}

/** The stops layer. */
export function stopsViewSql(sqlName: string): string {
  return `CREATE OR REPLACE VIEW ${sqlName} AS ${stopsSelectSql()}`
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
    FROM (${stopsSelectSql()}) s
  )`
}

/** A plain table of the feed (`calendar`, `shapes`, ...) as a view with every column as text. */
export function tableViewSql(sqlName: string, table: string): string {
  return `CREATE OR REPLACE VIEW ${sqlName} AS SELECT * FROM ${csv(table)}`
}

/** Tables that are a layer of their own. */
const LAYER_TABLES = new Set(['routes', 'stops'])

/** The open layer: routes and stops together. */
export const GTFS_NETWORK = 'network'

/** The feed's layer names for its SQL schema: the network, routes and stops first, then the other tables in name order. */
export function gtfsLayerNames(tables: readonly string[]): string[] {
  return [GTFS_NETWORK, 'routes', 'stops', ...tables.filter((t) => !LAYER_TABLES.has(t)).sort()]
}
