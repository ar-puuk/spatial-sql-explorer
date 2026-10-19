// Spec 024: opening a GTFS feed. The shell's GDAL reader (gdal3.js: the extension host's child
// process, a web worker) makes the shapes (and trip lines) into FlatGeobuf files from a light copy of
// the feed (gtfs/feed.ts); everything else, the stops included, is plain text the engine reads. The result is one
// FileSource: the shapes (or the trip lines, for a feed without shapes) as the file that is
// opened, and every other piece registered beside it. The open layer is the `network` (every route and
// every stop in one result, so the map draws them together); `routes`, `stops` and the feed's tables are
// views in a schema named after the feed.
import type { AsyncDuckDBConnection } from '@duckdb/duckdb-wasm'
import type { FileSource } from '../hostAdapter.js'
import type { GdbCallOptions, GdbHost } from '../gdb/types.js'
import { GdbError } from '../gdb/types.js'
import type { FileLayer } from '../source/layers.js'
import type { FileSqlNames } from '../sql/names.js'
import { csvHeader } from './detect.js'
import { fullZip, readStopTimes, splitFeed, tripsLackShapes } from './feed.js'
import { feedCountsSql, GTFS_NETWORK, gtfsLayerNames, networkReaderSql, routesViewSql, servedTableSql, stopsViewSql, tableViewSql, type GtfsInventory } from './sql.js'
import { GTFS_ROUTE_FALLBACK, GTFS_STOP_FALLBACK, gtfsDefaultStyle } from './style.js'
import type { LayerStyle } from '../style/model.js'
import { testOverrides } from '../source/readModes.js'

export interface GtfsOpened {
  /** The file to open (its extension says FlatGeobuf) with everything else the feed needs registered beside it. */
  source: FileSource
  inventory: GtfsInventory
  /** The FROM expression that is the open layer: the network (routes and stops). */
  reader: string
  /** The style a feed starts with. */
  style: LayerStyle
  /** The feed's layers in SQL order: the network, routes, stops, then its other tables. */
  layers: FileLayer[]
  /** `GTFS.zip` or the like: what SQL names are cleaned from. */
  fileName: string
  /** How the geometry was made: by GDAL (the shell's reader), or in SQL when no reader could be used. */
  mode: 'gdal' | 'sql'
  /** Why GDAL was not used (SQL mode), for the notice. */
  readerProblem: string | null
  /** Some routes are drawn from one trip's stops, not from shapes. */
  tripLines: boolean
}

const layerOf = (name: string, geometryType: FileLayer['geometryType']): FileLayer => ({ name, geometryType, geometryColumn: geometryType ? 'geom' : null, featureCount: null, srid: geometryType ? 4326 : null })

/** The message of a reader failure, short enough for a notice. */
const brief = (err: unknown): string => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 160)

/**
 * Reads the feed at `root` of `zip`. The GDAL layers asked for: the shapes when the
 * feed has any, and the trip lines only when some trip has no shape (that one case reads all of
 * `stop_times.txt` in GDAL). Where GDAL is not available (no reader in this shell, the download
 * blocked, a layer too large for it) the geometry is made in SQL from the same tables instead
 * (gtfs/sql.ts, `mode: 'sql'`); only a cancelled open stops.
 */
export async function openGtfsFeed(zip: Uint8Array, root: string, fileName: string, host: GdbHost | undefined, options: GdbCallOptions = {}): Promise<GtfsOpened> {
  const parts = await splitFeed(zip, root)
  const hasShapes = 'shapes.txt' in parts.tables
  const tripsHaveShapeId = csvHeader(parts.tables['trips.txt'].subarray(0, 8192)).includes('shape_id')
  const needTrips = !hasShapes || tripsLackShapes(parts.tables['trips.txt'])
  const stopTimes = readStopTimes(zip, parts.stopTimesEntry)
  const file = (name: string, bytes: Uint8Array): { name: string; bytes: Uint8Array } => ({ name: `se-gtfs-${name}`, bytes })
  const tableFiles = [...Object.entries(parts.tables).map(([name, bytes]) => file(name, bytes)), file('stop_times.txt', stopTimes)]
  const tables = [...Object.keys(parts.tables), 'stop_times.txt'].map((n) => n.replace(/\.txt$/, ''))
  const layers = gtfsLayerNames(tables).map((n) => layerOf(n, n === GTFS_NETWORK ? 'Mixed' : n === 'routes' ? 'LineString' : n === 'stops' ? 'Point' : null))
  const finish = (source: FileSource, inventory: GtfsInventory, extra: Pick<GtfsOpened, 'mode' | 'readerProblem'>): GtfsOpened => ({
    source,
    inventory,
    reader: networkReaderSql(inventory, { route: GTFS_ROUTE_FALLBACK, stop: GTFS_STOP_FALLBACK }),
    style: gtfsDefaultStyle(),
    layers,
    fileName,
    tripLines: needTrips,
    ...extra,
  })

  let converted: Record<string, Uint8Array> | null = null
  let problem: string | null = null
  const wanted: Array<'shapes_geom' | 'trips'> = [...(hasShapes ? (['shapes_geom'] as const) : []), ...(needTrips ? (['trips'] as const) : [])]
  if (testOverrides().noGdal) problem = 'switched off for a test'
  else if (!host?.convertFeed) problem = 'this build has no GDAL reader'
  else {
    try {
      converted = await host.convertFeed(needTrips ? fullZip(parts, stopTimes) : parts.lite, wanted, options)
      for (const layer of wanted) if (!converted[layer]) throw new GdbError(`The reader returned no ${layer} for this feed.`, 'unreadable')
    } catch (err) {
      if (err instanceof GdbError && err.code === 'cancelled') throw err
      converted = null
      problem = brief(err)
    }
  }

  if (converted) {
    const primary = hasShapes ? 'shapes_geom' : 'trips'
    const first = file(`${primary}.fgb`, converted[primary])
    const sidecars = [...wanted.filter((l) => l !== primary).map((l) => file(`${l}.fgb`, converted[l])), ...tableFiles]
    const inventory: GtfsInventory = { tables, geometry: wanted, mode: 'gdal', tripsHaveShapeId }
    return finish({ kind: 'bytes', name: first.name, size: first.bytes.byteLength, bytes: first.bytes, sidecars, styleSidecar: null }, inventory, { mode: 'gdal', readerProblem: null })
  }

  // No GDAL: the file opened is an empty placeholder (nothing reads it), and the geometry is SQL.
  const placeholder = file('none.fgb', new Uint8Array(0))
  const inventory: GtfsInventory = { tables, geometry: [], mode: 'sql', tripsHaveShapeId }
  return finish({ kind: 'bytes', name: placeholder.name, size: 0, bytes: placeholder.bytes, sidecars: tableFiles, styleSidecar: null }, inventory, { mode: 'sql', readerProblem: problem })
}

/** What to tell the person about how the feed was drawn, or null when there is nothing to say. */
export function feedNotice(info: { mode: 'gdal' | 'sql'; readerProblem: string | null; tripLines: boolean; routes: number; routesDrawn: number; stops: number; stopsDrawn: number }): string | null {
  const said: string[] = []
  const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
  if (info.mode === 'sql') said.push(`The GDAL reader could not be used${info.readerProblem ? ` (${info.readerProblem})` : ''}, so lines are built from the feed's own tables.`)
  if (info.tripLines) said.push('Routes whose trips have no shape are drawn through the stops of one trip.')
  const missingRoutes = info.routes - info.routesDrawn
  if (missingRoutes > 0) said.push(`${plural(missingRoutes, 'route has', 'routes have')} no trips and ${missingRoutes === 1 ? 'is' : 'are'} not drawn.`)
  const missingStops = info.stops - info.stopsDrawn
  if (missingStops > 0) said.push(`${plural(missingStops, 'stop has', 'stops have')} no usable coordinates and ${missingStops === 1 ? 'is' : 'are'} not on the map.`)
  return said.length ? said.join(' ') : null
}

/** The notice for an opened feed, counting from the engine (`layer` must exist). */
export async function describeGtfsFeed(conn: AsyncDuckDBConnection, gtfs: GtfsOpened): Promise<string | null> {
  const row = (await conn.query(feedCountsSql())).toArray()[0]?.toJSON() as Record<string, bigint | number> | undefined
  const n = (key: string): number => Number(row?.[key] ?? 0)
  return feedNotice({ mode: gtfs.mode, readerProblem: gtfs.readerProblem, tripLines: gtfs.tripLines, routes: n('routes'), routesDrawn: n('routes_drawn'), stops: n('stops'), stopsDrawn: n('stops_drawn') })
}

/** Before the network is read: which routes serve each stop (one pass over `stop_times.txt`). */
export async function prepareGtfs(conn: AsyncDuckDBConnection): Promise<void> {
  await conn.query(servedTableSql())
}

/** The feed's SQL schema: routes, stops and every other table, beside the network (which `openFile` creates as the open layer). */
export async function setUpGtfsViews(conn: AsyncDuckDBConnection, gtfs: GtfsOpened, names: FileSqlNames): Promise<void> {
  for (const layer of gtfs.layers) {
    const sqlName = names.layers.get(layer.name)
    if (!sqlName || layer.name === GTFS_NETWORK) continue
    await conn.query(layer.name === 'routes' ? routesViewSql(sqlName, gtfs.inventory) : layer.name === 'stops' ? stopsViewSql(sqlName, gtfs.inventory) : tableViewSql(sqlName, layer.name))
  }
}
