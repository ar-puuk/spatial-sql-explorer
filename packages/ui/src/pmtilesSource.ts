// Spec 007 US5 (research §8): PMTiles archives are read by the map, not the
// engine. The `pmtiles` library reads the header, metadata and the tiles in
// view through HostAdapter.readRange (web: File.slice; VS Code: Range
// requests to the webview resource URI), so only what the map needs is read.
// MapLibre reaches the archive through the `pmtiles://` protocol, registered
// once. View-only (FR-009a): SQL, the table, styling and export are disabled.
import { addProtocol } from 'maplibre-gl'
import { PMTiles, Protocol, TileType, type Source } from 'pmtiles'
import type { DatasetFacts, GeometryType, HostAdapter, Layer, OpenedFileRef } from '@spatial-explorer/core'

/** The reason shown wherever SQL, the table, styling or export would be (FR-009a). */
export const TILES_ONLY_REASON = "PMTiles holds map tiles, not a table: SQL, table, styling and export aren't available."

let protocol: Protocol | null = null
function tilesProtocol(): Protocol {
  if (!protocol) {
    protocol = new Protocol({ metadata: true })
    addProtocol('pmtiles', protocol.tile)
  }
  return protocol
}

let nextKey = 0

export interface TilesArchive {
  /** The MapLibre source URL (`pmtiles://<key>`). */
  url: string
  /** The archive's vector layers, drawn one set of map layers each. */
  layers: string[]
}

interface ArchiveMetadata {
  vector_layers?: Array<{ id: string }>
  tilestats?: { layers?: Array<{ layer: string; count?: number; geometry?: string }> }
}

function geometryTypeOf(names: string[]): GeometryType {
  const kinds = new Set(names.map((g) => (/point/i.test(g) ? 'Point' : /line/i.test(g) ? 'LineString' : /polygon/i.test(g) ? 'Polygon' : 'Mixed')))
  return kinds.size === 1 ? ([...kinds][0] as GeometryType) : 'Mixed'
}

/**
 * Opens a PMTiles archive from its header and metadata (a few small range
 * reads), and makes it reachable by the map. Raster archives are refused:
 * Spatial Explorer views vector data.
 */
export async function openTilesArchive(ref: OpenedFileRef, hostAdapter: HostAdapter): Promise<{ layer: Layer; archive: TilesArchive }> {
  const key = `spatial-explorer-${++nextKey}`
  const source: Source = {
    getKey: () => key,
    getBytes: async (offset, length) => {
      const bytes = await hostAdapter.readRange(ref, offset, length)
      // A fresh ArrayBuffer of exactly these bytes (readRange may return a view).
      return { data: bytes.slice().buffer }
    },
  }
  const archive = new PMTiles(source)
  const header = await archive.getHeader()
  if (header.tileType !== TileType.Mvt) throw new Error('This PMTiles archive holds raster tiles. Spatial Explorer views vector tiles (MVT) only.')
  const metadata = ((await archive.getMetadata()) ?? {}) as ArchiveMetadata
  const layers = (metadata.vector_layers ?? []).map((l) => l.id).filter((id) => typeof id === 'string')
  if (!layers.length) throw new Error('This PMTiles archive lists no vector layers.')
  tilesProtocol().add(archive)

  const stats = metadata.tilestats?.layers ?? []
  const count = stats.reduce((n, l) => n + (l.count ?? 0), 0)
  const geometryType = geometryTypeOf(stats.map((l) => l.geometry ?? ''))
  const extent: [number, number, number, number] = [header.minLon, header.minLat, header.maxLon, header.maxLat]
  const crs = { label: 'EPSG:3857 (Web Mercator tiles)', isWgs84: false }
  const facts: DatasetFacts = {
    rows: count,
    rowsEstimated: false,
    invalid: null,
    extent,
    crs,
    crsAssumed: false,
    srid: 3857,
    geometryType,
    columns: [],
    readMode: 'tiles',
    spatialIndex: 'file',
    fallback: null,
    needsLoad: false,
    tiles: { minZoom: header.minZoom, maxZoom: header.maxZoom, layers },
  }
  const layer: Layer = {
    id: ref.id,
    sourceUri: ref.id,
    sourceFormat: 'pmtiles',
    geometryType,
    sourceCrs: crs,
    crsAssumed: false,
    rowCount: 0,
    featureCount: count,
    invalidGeometryCount: 0,
    truncated: false,
    totalRows: count,
    extent,
    columns: [],
    source: { rows: count, features: count, invalid: 0 },
    styleSidecar: null,
    facts,
  }
  return { layer, archive: { url: `pmtiles://${key}`, layers } }
}
