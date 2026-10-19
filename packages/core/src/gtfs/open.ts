// Spec 024: opening a GTFS feed. The shell's GDAL reader (gdal3.js: the extension host's child
// process, a web worker) makes the stops and shapes into FlatGeobuf files from a light copy of
// the feed (gtfs/feed.ts); everything else is plain text the engine reads. The result is one
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
import { fullZip, readStopTimes, splitFeed, tripsLackShapes } from './feed.js'
import { GTFS_NETWORK, gtfsLayerNames, networkReaderSql, routesViewSql, servedTableSql, stopsViewSql, tableViewSql, type GtfsInventory } from './sql.js'
import { GTFS_ROUTE_FALLBACK, GTFS_STOP_FALLBACK, gtfsDefaultStyle } from './style.js'
import type { LayerStyle } from '../style/model.js'

export const GTFS_NO_READER = "This build can't read GTFS feeds. Unzip it and open stops.txt as a CSV (stop_lat, stop_lon) instead."

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
}

const layerOf = (name: string, geometryType: FileLayer['geometryType']): FileLayer => ({ name, geometryType, geometryColumn: geometryType ? 'geom' : null, featureCount: null, srid: geometryType ? 4326 : null })

/**
 * Reads the feed at `root` of `zip`. The GDAL layers asked for: the stops, the shapes when the
 * feed has any, and the trip lines only when some trip has no shape (that one case reads all of
 * `stop_times.txt` in GDAL).
 */
export async function openGtfsFeed(zip: Uint8Array, root: string, fileName: string, host: GdbHost | undefined, options: GdbCallOptions = {}): Promise<GtfsOpened> {
  if (!host?.convertFeed) throw new GdbError(GTFS_NO_READER, 'unreadable')
  const parts = await splitFeed(zip, root)
  const hasShapes = 'shapes.txt' in parts.tables
  const needTrips = !hasShapes || tripsLackShapes(parts.tables['trips.txt'])
  const wanted: Array<'stops' | 'shapes_geom' | 'trips'> = ['stops', ...(hasShapes ? (['shapes_geom'] as const) : []), ...(needTrips ? (['trips'] as const) : [])]
  const stopTimes = readStopTimes(zip, parts.stopTimesEntry)
  const converted = await host.convertFeed(needTrips ? fullZip(parts, stopTimes) : parts.lite, wanted, options)
  for (const layer of wanted) if (!converted[layer]) throw new GdbError(`The reader returned no ${layer} for this feed.`, 'unreadable')

  const primary = hasShapes ? 'shapes_geom' : 'trips'
  const file = (name: string, bytes: Uint8Array): { name: string; bytes: Uint8Array } => ({ name: `se-gtfs-${name}`, bytes })
  const sidecars = [
    ...wanted.filter((l) => l !== primary).map((l) => file(`${l}.fgb`, converted[l])),
    ...Object.entries(parts.tables).map(([name, bytes]) => file(name, bytes)),
    file('stop_times.txt', stopTimes),
  ]
  const tables = [...Object.keys(parts.tables), 'stop_times.txt'].map((n) => n.replace(/\.txt$/, ''))
  const inventory: GtfsInventory = { tables, geometry: wanted }
  const first = file(`${primary}.fgb`, converted[primary])
  return {
    source: { kind: 'bytes', name: first.name, size: first.bytes.byteLength, bytes: first.bytes, sidecars, styleSidecar: null },
    inventory,
    reader: networkReaderSql(inventory, { route: GTFS_ROUTE_FALLBACK, stop: GTFS_STOP_FALLBACK }),
    style: gtfsDefaultStyle(),
    layers: gtfsLayerNames(tables).map((n) => layerOf(n, n === GTFS_NETWORK ? 'Mixed' : n === 'routes' ? 'LineString' : n === 'stops' ? 'Point' : null)),
    fileName,
  }
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
    await conn.query(layer.name === 'routes' ? routesViewSql(sqlName, gtfs.inventory) : layer.name === 'stops' ? stopsViewSql(sqlName) : tableViewSql(sqlName, layer.name))
  }
}
